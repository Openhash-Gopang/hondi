/**
 * scrivener-write-page.test.mjs — 법무사·행정사 「서류 작성하기」(STEP W) 정적 검사 (2026-10-21)
 * 확인하는 것: 두 직역 페이지의 헤더 버튼이 존재하는 화면을 가리킴 · SP에 STEP W(W-1~W-9)와 상태 줄 형식이 있음 ·
 * 화면의 상태 줄 정규식이 SP가 정한 형식을 읽음 · 승인·제출·납부를 AI가 하지 않는다는 규율과 dpaper 미연동 표기가 SP·화면에 있음 ·
 * expert-chat 임베드 연결이 화면의 메시지 규약과 같음. (실제 대화·로그인은 브라우저가 필요해 범위 밖)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const catalog = JSON.parse(read('prompts/sp-catalog.json'));
const JOBS = [
  ['judicial-scrivener', 'SP_judicial-scrivener', '법무사'],
  ['administrative-scrivener', 'SP_administrative-scrivener', '행정사'],
];
const js = read('assets/scrivener-write.js');
const html = read('pages/scrivener-write.html');
const chat = read('pages/expert-chat.html');
const statusRe = /\[[^\]|]*보조 AI\s*\|\s*서류 작성 트랙\s*\|\s*현재:\s*W-([1-9])([^\]]*)\]/;

for (const [pid, key, role] of JOBS) {
  describe(`${role} 서류 작성하기`, () => {
    const page = read(`pages/${pid}.html`);
    const sp = read('prompts/' + catalog[key + '-assistant']);   // 서류 작성 도구는 전문가용(-assistant) SP 에만 있다(2026-10-21 분리)
    it('헤더 버튼이 서류 작성 화면을 가리키고 그 화면이 이 직역을 알고 있다', () => {
      assert.ok(page.includes(`heroButton: { label: '서류 작성하기', href: '/pages/scrivener-write.html?persona=${pid}'`));
      assert.ok(existsSync(join(ROOT, 'pages/scrivener-write.html')));
      assert.ok(js.includes(`'${pid}': {`) && js.includes(`role: '${role}'`));
    });
    it('SP에 STEP W 9단계와 상태 줄 형식이 있다', () => {
      assert.equal((sp.match(/^## STEP W — 서류 작성 트랙/gm) || []).length, 1);
      for (let n = 1; n <= 9; n++) assert.ok(new RegExp(`^### W-${n}\\. `, 'm').test(sp), `W-${n} 절`);
      assert.ok(sp.includes(`[${role} 보조 AI | 서류 작성 트랙 | 현재: W-n |`));
      const at = (re) => sp.search(re);
      assert.ok(at(/^## STEP D /m) < at(/^## STEP W — /m) && at(/^## STEP W — /m) < at(/^## 부록 A — /m), '절 순서: STEP D → STEP W → 부록 A');
    });
    it('SP가 정한 상태 줄 형식을 화면의 정규식이 읽는다', () => {
      const sample = `[${role} 보조 AI | 서류 작성 트랙 | 현재: W-6 | 서류: 테스트서류 | 서식: 신규 | 게이트: 서류 승인 대기]`;
      const m = statusRe.exec(sample);
      assert.ok(m && m[1] === '6');
      assert.ok(js.includes('서류 작성 트랙\\s*\\|\\s*현재:\\s*W-([1-9])'));
    });
    it('승인·제출·납부는 사람이 하고 dpaper는 미연동이라고 밝힌다', () => {
      assert.ok(/제출\(W-7\)·납부\(W-8\)·기명날인은 .+직접 하고, 이 도구는 하지 않는다/.test(sp));
      assert.ok(sp.includes('dpaper API 연동은 아직 승인·개통되지 않았다(미연동)'));
      assert.ok(sp.includes('FORM_LOOKUP') && sp.includes('FORM_SAVE_PROPOSAL'));
      const sec = sp.slice(sp.search(/^## STEP W — /m), sp.search(/^## 부록 A — /m));
      for (const m of sec.matchAll(/CONNECT_HUMAN_EXPERT[^\n]*/g)) assert.ok(m[0].includes('출력하지 않는다'), 'STEP W 가 소개·연결 태그를 쓰게 하면 안 됨');
    });
    it('SP의 §LEGAL-LIMIT 절은 직전 버전과 같다', () => {
      const cut = (t) => t.slice(t.indexOf('## §LEGAL-LIMIT'), t.indexOf('## 0. IDENTITY'));
      const prev = key === 'SP_judicial-scrivener' ? 'SP_judicial-scrivener_v3_2.md' : 'SP_administrative-scrivener_v1_2.md';
      assert.equal(cut(sp), cut(read('prompts/' + prev)));
    });
  });
}

describe('서류 작성 화면과 대화 화면 연결', () => {
  it('화면은 dpaper 미연동과 제출 버튼 비활성을 표시한다', () => {
    assert.ok(html.includes('dpaper 연동: 미연동'));
    assert.ok(js.includes('dpaper로 제출 (미연동)') && js.includes('disabled title='));
  });
  it('메시지 규약이 두 쪽에서 같다', () => {
    for (const t of ['expert-embed-send', 'expert-embed-reply', 'expert-embed-ready']) { assert.ok(js.includes(t), t + ' (화면)'); assert.ok(chat.includes(t), t + ' (대화)'); }
    assert.ok(chat.includes("_qs.get('embed') === '1'") && chat.includes('e.source !== window.parent'));
    assert.equal((chat.match(/_embedReply\(full\);/g) || []).length, 2);
  });
  it('9단계가 모두 정의되어 있다', () => {
    for (let n = 1; n <= 9; n++) assert.ok(js.includes(`k: 'W-${n}'`), `W-${n}`);
  });
});
