/**
 * sp_klaw_v151_hooks.test.js — K-Law v15.1 표본 이식(2026-10-17) 정적 검사
 *
 * 대상: SP_EXPERT_BASE v1.3 §3-B(선택 적용 훅 ⑱~㉓ + 공통 절차 2개)와, 이를 선언한 직군 10개 SP
 * (감정평가사·관세사·도선사·법무사·변리사·변호사·세무사·의사·행정사·회계사).
 * 확인하는 것: 카탈로그가 새 파일을 가리킴 · 헤더 버전 = 파일명 버전 · STEP B+ 절이 STEP B 뒤 STEP R 앞에 있음 ·
 * ⑱~㉓ 훅이 모두 채워짐 · 상위 규칙(C5 등)을 완화하는 문구 없음 · 이용자에게 보이는 "상담" 표현 없음 · 직전 버전 파일 보존.
 * 실제 응답 품질은 정적 검사로 알 수 없다(LLM 호출 필요) — 별도 시험 대상.
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
  ['SP_appraiser', 'SP_appraiser_v1_10.md', 'SP_appraiser_v1_9.md', 'v1.10'],
  ['SP_customs-broker', 'SP_customs-broker_v1_8.md', 'SP_customs-broker_v1_7.md', 'v1.8'],
  ['SP_marine-pilot', 'SP_marine-pilot_v3_5.md', 'SP_marine-pilot_v3_4.md', 'v3.5'],
  ['SP_judicial-scrivener', 'SP_judicial-scrivener_v3_2.md', 'SP_judicial-scrivener_v3_1.md', 'v3.2'],
  ['SP_patent-attorney', 'SP_patent-attorney_v1_9.md', 'SP_patent-attorney_v1_8.md', 'v1.9'],
  ['SP_lawyer', 'SP_lawyer_v5_6.md', 'SP_lawyer_v5_5.md', 'v5.6'],
  ['SP_tax-accountant', 'SP_tax-accountant_v2_5.md', 'SP_tax-accountant_v2_4.md', 'v2.5'],
  ['SP_physician', 'SP_physician_v2_6.md', 'SP_physician_v2_5.md', 'v2.6'],
  ['SP_administrative-scrivener', 'SP_administrative-scrivener_v1_2.md', 'SP_administrative-scrivener_v1_1.md', 'v1.2'],
  ['SP_accountant', 'SP_accountant_v1_11.md', 'SP_accountant_v1_10.md', 'v1.11'],
];

describe('SP_EXPERT_BASE v1.3 §3-B', () => {
  const base = read('prompts/SP_EXPERT_BASE_v1_3.md');
  it('카탈로그가 v1.3을 가리키고 직전 버전 파일이 보존된다', () => {
    assert.equal(catalog.SP_EXPERT_BASE, 'SP_EXPERT_BASE_v1_3.md');
    assert.ok(existsSync(join(ROOT, 'prompts/SP_EXPERT_BASE_v1_2.md')));
  });
  it('제목 버전이 v1.3이고 변경 이력에 기록된다', () => {
    assert.match(base.split('\n')[0], /\(SP_EXPERT_BASE\) v1\.3$/);
    assert.match(base, /- v1\.3 \(2026-10-17/);
  });
  it('§3-B 가 ⑱~㉓ 훅과 공통 절차 2개(폴백·재판단 격리)를 정의한다', () => {
    const sec = base.slice(base.indexOf('## 3-B.'), base.indexOf('## 1-2-A.'));
    assert.ok(sec.length > 1500);
    for (const h of ['⑱', '⑲', '⑳', '㉑', '㉒', '㉓']) assert.ok(sec.includes('**' + h), h + ' 훅 정의 누락');
    assert.ok(sec.includes('폴백') && sec.includes('재판단 격리'));
    assert.ok(sec.includes('opt-in'), '선택 적용 명시 누락');
  });
  it('§3-B 는 상위 규칙을 완화하지 않는다는 취지를 유지한다(C5·C33-2·C39 참조)', () => {
    const sec = base.slice(base.indexOf('## 3-B.'), base.indexOf('## 1-2-A.'));
    for (const c of ['C5', 'C39', 'C47']) assert.ok(sec.includes(c), c);
    assert.ok(/확정적 서류·결론은 만들지 않는다/.test(sec));
  });
});

for (const [key, file, prev, ver] of JOBS) {
  describe(`${key} ${ver}`, () => {
    const t = read('prompts/' + file);
    it('카탈로그가 새 파일을 가리키고 직전 파일이 남아 있다', () => {
      assert.equal(catalog[key], file);
      assert.ok(existsSync(join(ROOT, 'prompts/' + prev)), '직전 버전 파일 보존');
    });
    it('1행 버전 표기가 파일명 버전과 일치한다', () => {
      assert.ok(t.split('\n')[0].trimEnd().endsWith(' ' + ver), t.split('\n')[0]);
    });
    it('STEP B+ 절이 STEP B 다음·STEP R 앞에 정확히 한 번 있다', () => {
      const re = /^## STEP B\+ — K-Law v15\.1 이식 훅/gm;
      assert.equal((t.match(re) || []).length, 1);
      const b = t.search(/^## STEP B /m), bp = t.search(re), r = t.search(/^## STEP R — /m);
      assert.ok(b >= 0 && b < bp && bp < r, `순서 b=${b} b+=${bp} r=${r}`);
    });
    it('⑱~㉓ 훅이 모두 채워져 있고 ⑱ 표가 2~4행이다', () => {
      const s = t.slice(t.search(/^## STEP B\+ /m), t.search(/^## STEP R — /m));
      for (const h of ['⑱', '⑲', '⑳', '㉑', '㉒', '㉓']) assert.ok(s.includes('**' + h), h);
      const rows = s.split('\n').filter((l) => /^\| /.test(l) && !/^\| 규범·서류/.test(l) && !/^\|---/.test(l));
      assert.ok(rows.length >= 2 && rows.length <= 4, '표 행 수 ' + rows.length);
      for (const r of rows) assert.equal(r.split('|').length, 6, '표 열 수 불일치: ' + r.slice(0, 40));
      assert.ok(/최강사실 유형 — 1\)/.test(s), '⑲ 최강사실 목록');
    });
    it('이 절이 상위 규칙을 완화하지 않는다고 밝힌다', () => {
      const s = t.slice(t.search(/^## STEP B\+ /m), t.search(/^## STEP R — /m));
      assert.ok(/완화하지 않는다/.test(s));
    });
    it('이용자에게 보이는 상담 제공 표현을 새로 넣지 않았다', () => {
      const s = t.slice(t.search(/^## STEP B\+ /m), t.search(/^## STEP R — /m));
      assert.ok(!/상담해 드립|상담 AI|상담을 제공|상담 서비스/.test(s));
    });
    it('변경 이력에 이번 개정이 기록된다', () => {
      assert.match(t, new RegExp('- (\\*\\*)?' + ver.replace('.', '\\.') + ' \\(2026-10-17'));
    });
    it('직전 버전과 비교해 삭제된 줄은 1행(버전 표기)뿐이다 — 기존 절을 건드리지 않는다', () => {
      const a = read('prompts/' + prev).split('\n'), b = new Set(t.split('\n'));
      const missing = a.filter((l, i) => i > 0 && !b.has(l));
      assert.equal(missing.length, 0, '사라진 줄: ' + missing.slice(0, 2).join(' / '));
    });
  });
}

describe('참조 일관성', () => {
  it('목록·소개 페이지와 데이터 인덱스가 새 파일명을 가리킨다(옛 직군 SP 파일명이 남지 않음)', () => {
    const olds = JOBS.map((j) => j[2]).concat(['SP_EXPERT_BASE_v1_2.md']);
    for (const f of ['prompts/sp-catalog.json', 'prompts/sp-catalog-categories.json', 'pages/expert-personas.html', 'pages/professional-ai.html', 'data/expert-persona-index.json']) {
      const txt = read(f);
      for (const o of olds) assert.ok(!txt.includes(o), `${f} 에 옛 파일명 ${o}`);
    }
  });
  it('카탈로그의 모든 값이 실제 파일을 가리킨다(이번에 바꾼 11건 포함)', () => {
    for (const k of ['SP_EXPERT_BASE', ...JOBS.map((j) => j[0])]) assert.ok(existsSync(join(ROOT, 'prompts/' + catalog[k])), k);
  });
});
