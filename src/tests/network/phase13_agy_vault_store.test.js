// phase13_agy_vault_store.test.js
// 실행: node --test src/tests/network/phase13_agy_vault_store.test.js
//
// 배경: docs 없음(이번 세션 안에서 발견) — AGENCY-AC-COMMON §1(5)이
// 65개 이상 국가기관 SP 템플릿에 [AGY_VAULT_STORE: ...] 태그를 응답에
// 넣으라고 지시하지만, 그 태그를 실제로 읽어 owner_pdv에 저장하고
// 응답에서 제거하는 서버 코드가 이번에 처음 생겼다(handleGovRelay).
// 이 테스트는 그 처리를 실제로 확인한다 — canDelegate가 아닌(위임
// 오케스트레이션을 타지 않는) 일반 agency로 최소 시나리오만 검증한다
// (delegation 경로의 알려진 한계는 worker.js 주석 참조, 이 테스트 범위 밖).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
import worker from '../../../worker.js';

const ORIGIN = 'https://worker.example';

function req(payload) {
  return new Request(`${ORIGIN}/gov/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://public.naviweb.kr' },
    body: JSON.stringify(payload),
  });
}
function makeEnv() { return { DEEPSEEK_API_KEY: 'test-key', GOPANG_MASTER_KEY: 'test-master-key' }; }

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(()  => { globalThis.fetch = originalFetch; });

describe('AVS: AGY_VAULT_STORE 서버측 처리 (handleGovRelay, 2026-07-23 신설)', () => {

  it('AVS-01: 태그가 있으면 owner_pdv에 기록되고 응답 텍스트에서 제거된다', async () => {
    let pbWriteBody = null;
    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url.includes('api.deepseek.com')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content:
            '제주시 한림읍 주민등록 등본 발급을 도와드렸습니다.' +
            '[AGY_VAULT_STORE: agency_id=emd:한림읍:agent, who=익명 민원인, ' +
            'when=2026-07-23T10:00:00Z, where=한림읍행정복지센터, ' +
            'what=주민등록등본 발급 안내, why=전입신고 첨부용, how=단독 처리]'
          } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }), { status: 200 });
      }
      if (url.includes('/api/collections/owner_pdv/records')) {
        pbWriteBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ id: 'rec1' }), { status: 200 });
      }
      throw new Error('unexpected fetch: ' + url);
    };

    const res = await worker.fetch(req({
      guid: 'test-guid-1', agency: 'gov_national', // canDelegate=false인 agency로 위임 분기 회피
      agencyPrompt: '[SP 텍스트]', messages: [{ role: 'user', content: '등본 발급 도와줘' }],
      stream: false,
    }), makeEnv(), { waitUntil: (p) => p.catch(() => {}) });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(!data.choices[0].message.content.includes('AGY_VAULT_STORE'),
      '응답 텍스트에 태그 원문이 남아있으면 안 됨(사용자에게 노출 금지)');
    assert.ok(data.choices[0].message.content.includes('주민등록 등본 발급을 도와드렸습니다'),
      '태그를 제외한 나머지 응답 텍스트는 그대로 보존돼야 함');

    // waitUntil로 넘긴 비동기 기록이 끝날 시간을 준다
    await new Promise(r => setTimeout(r, 10));
    assert.ok(pbWriteBody, 'owner_pdv에 실제로 POST돼야 함');
    assert.equal(pbWriteBody.owner_agency, 'emd:한림읍:agent');
    assert.equal(pbWriteBody.record_type, 'consultation');
    // ★ 2026-08-30 수정 — _writeOwnerPdvRecord가 2026-08-20부터 what/why/
    // detail을 프로즈 원문이 아니라 SHA-256 해시로만 받는다(원문 미저장
    // 원칙). 서버측 자동감지 경로(_interceptAgyVaultStore)도 이제 파싱된
    // 원문을 그 자리에서 해싱해 넘기므로, 여기서도 평문이 아니라 같은
    // 방식으로 계산한 해시와 비교한다.
    assert.equal(pbWriteBody.what, await sha256Hex('주민등록등본 발급 안내'));
    assert.equal(pbWriteBody.why, await sha256Hex('전입신고 첨부용'));
    assert.equal(pbWriteBody.how, 'completed');
    assert.equal(pbWriteBody.detail, await sha256Hex(JSON.stringify({ procedure: '단독 처리' })));
    assert.ok(pbWriteBody.who_hash, 'who_hash가 계산돼 있어야 함');
    assert.notEqual(pbWriteBody.who_hash, 'test-guid-1', 'guid 원문이 그대로 들어가면 안 됨(해시돼야 함)');
  });

  it('AVS-02: 태그가 없으면 owner_pdv 기록 자체를 시도하지 않는다', async () => {
    let pbCalled = false;
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url.includes('api.deepseek.com')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '일반 안내 답변입니다.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }), { status: 200 });
      }
      if (url.includes('/api/collections/owner_pdv/records')) { pbCalled = true; return new Response('{}', { status: 200 }); }
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req({
      guid: 'test-guid-2', agency: 'gov_national', agencyPrompt: '[SP]',
      messages: [{ role: 'user', content: '안녕' }], stream: false,
    }), makeEnv(), { waitUntil: (p) => p.catch(() => {}) });
    const data = await res.json();
    assert.equal(data.choices[0].message.content, '일반 안내 답변입니다.');
    await new Promise(r => setTimeout(r, 10));
    assert.equal(pbCalled, false, '태그 없으면 owner_pdv 쓰기 시도 자체가 없어야 함');
  });

  it('AVS-03: 태그 파싱 실패(형식 이상)해도 응답 흐름은 계속된다', async () => {
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url.includes('api.deepseek.com')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '답변입니다. [AGY_VAULT_STORE: 형식이상함]' } }],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }), { status: 200 });
      }
      throw new Error('unexpected fetch(파싱 실패 시 owner_pdv 호출 자체가 없어야 함): ' + url);
    };
    const res = await worker.fetch(req({
      guid: 'test-guid-3', agency: 'gov_national', agencyPrompt: '[SP]',
      messages: [{ role: 'user', content: '질문' }], stream: false,
    }), makeEnv(), { waitUntil: (p) => p.catch(() => {}) });
    assert.equal(res.status, 200, '태그 파싱에 실패해도 500이 아니라 정상 응답이어야 함');
    const data = await res.json();
    assert.ok(!data.choices[0].message.content.includes('AGY_VAULT_STORE'), '파싱 실패해도 태그 자체는 응답에서 제거됨');
  });
});
