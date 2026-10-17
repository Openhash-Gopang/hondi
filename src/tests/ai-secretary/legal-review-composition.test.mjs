// legal-review-composition.test.mjs (2026-10-17 신설)
// 실행: node --test src/tests/ai-secretary/legal-review-composition.test.mjs
//
// 법률 검토 모드의 상속 조립을 검증한다.
// ① 조립 순서(H2): 공통 가드레일 → 공통 골격 → 직업군 훅. EXPERT_BASE는 조립하지 않는다.
// ② 세부분야(parentKey)는 루트 직업군 훅을 상속한다.
// ③ 레지스트리의 모든 루트 직업군에 훅 SP 파일이 있고 카탈로그에 등록돼 있다(hondi-guide 제외).
// ④ 고정 면책 문구가 JS 상수와 공통 골격 본문에서 글자 단위로 일치한다(SSOT).
// ⑤ 훅 파일이 7개 훅을 모두 갖고, 공통 골격 내용을 재서술하지 않는다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = { addEventListener: () => {}, getElementById: () => null,
  createElement: () => ({}), querySelector: () => null };

const PROMPTS = new URL('../../../prompts/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('sp-catalog.json', PROMPTS), 'utf8'));

const STUB = {
  'UNIVERSAL-INTEGRITY': '[UI]', 'TASK-DELEGATION-GUIDE': '[TD]', 'CONTROL-TOWER-PRINCIPLE': '[CT]',
  'UNIVERSAL-common': '[UC]', 'PROFESSIONAL-common': '[PC]', 'SP_common_guardrails': '[GUARD]',
  'SP_common_medical_safety': '[MED]', 'SP_EXPERT_BASE': '[EXPERT_BASE]',
};
const stubByFile = {};
for (const [k, v] of Object.entries(STUB)) if (catalog[k]) stubByFile[catalog[k]] = v;

globalThis.fetch = async (url) => {
  const fname = String(url).split('/').pop();
  if (fname === 'sp-catalog.json') return { ok: true, json: async () => catalog, text: async () => JSON.stringify(catalog) };
  if (fname in stubByFile) return { ok: true, text: async () => stubByFile[fname] };
  const p = new URL(fname, PROMPTS);
  if (!existsSync(p)) return { ok: false, status: 404 };
  return { ok: true, text: async () => readFileSync(p, 'utf8') };
};

const lr = await import(new URL('../../gopang/ai/legal-review.js', import.meta.url));
const { EXPERT_REGISTRY } = await import(new URL('../../gopang/ai/expert-registry.js', import.meta.url));

const idx = (s, t) => s.indexOf(t);
const rootIds = () => Object.entries(EXPERT_REGISTRY).filter(([, d]) => !d.parentKey).map(([id]) => id);

describe('조립 순서', () => {
  test('가드레일 → 공통 골격 → 직업군 훅, EXPERT_BASE 미포함', async () => {
    lr._clearLegalReviewCacheForTest();
    const s = await lr._composeLegalReviewPrompt('tax-accountant');
    assert.ok(s, '합성 결과 없음');
    const g = idx(s, '[GUARD]'), b = idx(s, 'SP-COMMON-08'), h = idx(s, '세무사 — 법률 검토 훅');
    assert.ok(g >= 0 && b > g && h > b, `순서 위반 g=${g} b=${b} h=${h}`);
    assert.equal(idx(s, '[EXPERT_BASE]'), -1, 'EXPERT_BASE가 섞임');
    assert.equal(s.split('SP-COMMON-08 ·').length - 1, 1, '공통 골격이 2회 이상 삽입됨');
  });

  test('의료 페르소나는 의료 안전모듈이 골격보다 앞에 온다', async () => {
    lr._clearLegalReviewCacheForTest();
    const s = await lr._composeLegalReviewPrompt('physician');
    assert.ok(idx(s, '[MED]') >= 0 && idx(s, '[MED]') < idx(s, 'SP-COMMON-08'));
  });

  test('공통 골격이 없으면 null(페일세이프)', async () => {
    lr._clearLegalReviewCacheForTest();
    const saved = catalog['SP_LEGAL_REVIEW_BASE'];
    delete catalog['SP_LEGAL_REVIEW_BASE'];
    try {
      globalThis.__m = null;
      const { _loadManifest } = await import(new URL('../../gopang/ai/manifest-loader.js', import.meta.url));
      await _loadManifest(); // 캐시는 같은 객체를 참조하므로 삭제가 반영된다
      assert.equal(await lr._composeLegalReviewPrompt('lawyer'), null);
    } finally { catalog['SP_LEGAL_REVIEW_BASE'] = saved; lr._clearLegalReviewCacheForTest(); }
  });
});

describe('상속 해석', () => {
  test('세부분야는 루트 직업군의 훅 키를 쓴다', () => {
    const child = Object.entries(EXPERT_REGISTRY).find(([, d]) => d.parentKey && EXPERT_REGISTRY[d.parentKey]);
    assert.ok(child, '세부분야 없음');
    const [id, d] = child;
    const root = lr.resolveLegalReviewRoot(id);
    assert.ok(!EXPERT_REGISTRY[root].parentKey);
    assert.equal(lr.legalReviewHookKey(id), 'SP_legal-review-' + root);
  });

  test('순환·미등록 parentKey에서도 무한루프 없이 종료', () => {
    const reg = { a: { parentKey: 'b' }, b: { parentKey: 'a' }, c: { parentKey: 'zzz' } };
    assert.ok(typeof lr.resolveLegalReviewRoot('a', reg) === 'string');
    assert.equal(lr.resolveLegalReviewRoot('c', reg), 'zzz');
  });

  test('3단 이상 체인(교수 세부전공)도 최상위 루트로 수렴', () => {
    const deep = Object.entries(EXPERT_REGISTRY).find(([id]) => lr.resolveLegalReviewRoot(id) === 'professor' && EXPERT_REGISTRY[EXPERT_REGISTRY[id].parentKey]?.parentKey);
    if (deep) assert.equal(lr.legalReviewHookKey(deep[0]), 'SP_legal-review-professor');
  });
});

describe('커버리지', () => {
  test('모든 루트 직업군(hondi-guide 제외)에 훅이 카탈로그에 등록되어 있다', () => {
    const missing = rootIds().filter(id => id !== 'hondi-guide' && !catalog['SP_legal-review-' + id]);
    assert.deepEqual(missing, [], '훅 누락: ' + missing.join(', '));
  });

  test('행정사 훅이 있고 레지스트리에 등록된 직역이다', () => {
    assert.ok(catalog['SP_legal-review-administrative-scrivener']);
    assert.ok(EXPERT_REGISTRY['administrative-scrivener']);
  });

  test('서버 UNIVERSAL 주입 경로(페이지 위젯)는 UNIVERSAL 3종을 조립하지 않는다', async () => {
    lr._clearLegalReviewCacheForTest();
    const s = await lr._composeLegalReviewPrompt('administrative-scrivener', undefined, { serverInjectsUniversal: true });
    assert.ok(s.includes('[PC]') && s.includes('[GUARD]') && s.includes('SP-COMMON-08'));
    for (const t of ['[UI]', '[UC]', '[CT]']) assert.equal(s.includes(t), false, t + ' 중복 조립');
    lr._clearLegalReviewCacheForTest();
  });
});

describe('SSOT·형식', () => {
  test('면책 문구가 JS 상수와 공통 골격 본문에서 일치', () => {
    const base = readFileSync(new URL(catalog['SP_LEGAL_REVIEW_BASE'], PROMPTS), 'utf8');
    assert.ok(base.includes(lr.LEGAL_REVIEW_DISCLAIMER), '면책 문구 불일치');
  });

  test('모든 훅 파일: 7개 훅 존재 · [VERIFY] 포함 · 면책 문구/STEP 재서술 없음 · 버전 고정 참조 없음', () => {
    const hooks = Object.entries(catalog).filter(([k]) => k.startsWith('SP_legal-review-'));
    assert.ok(hooks.length >= 60, `훅 수 부족: ${hooks.length}`);
    for (const [k, f] of hooks) {
      const t = readFileSync(new URL(f, PROMPTS), 'utf8');
      for (const m of ['① ', '② ', '③ ', '④ ', '⑤ ', '⑥ ', '⑦ ']) assert.ok(t.includes('## ' + m), `${k}: 훅 ${m} 누락`);
      assert.ok(t.includes('[VERIFY]'), `${k}: [VERIFY] 없음`);
      assert.ok(!t.includes(lr.LEGAL_REVIEW_DISCLAIMER), `${k}: 면책 문구 재서술`);
      assert.ok(!/### STEP [0A-D]/.test(t), `${k}: STEP 재서술`);
      assert.ok(!/SP_[A-Za-z_-]+_v\d/.test(t), `${k}: 버전 고정 SP 참조`);
      assert.ok(!t.includes('# 상위 상속:'), `${k}: 미선언 상속 헤더`);
    }
  });

  test('훅 ⑥⑦: 특정 변호사 소개·알선 금지와 연결 태그 금지가 모든 훅에 있다', () => {
    const hooks = Object.entries(catalog).filter(([k]) => k.startsWith('SP_legal-review-'));
    for (const [k, f] of hooks) {
      const t = readFileSync(new URL(f, PROMPTS), 'utf8');
      assert.ok(t.includes('소개·추천하지 않는다'), `${k}: 소개 금지 문구 없음`);
      assert.ok(t.includes('[CONNECT_HUMAN_EXPERT]` 태그를 출력하지 않는다'), `${k}: 연결 태그 금지 없음`);
    }
  });
});
