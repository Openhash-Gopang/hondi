import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseConsults, extractReport, stripInternal, baseBody, assembleSpecialist, escapeHtml, renderMarkdown,
  renderReportHtml, runTurn, FAILSAFE_TEXT, MAX_CONSULTS_PER_TURN,
} from '../../assets/kdoctor-chat-core.js';
import { validateDiagnosis, audienceView } from '../../src/gopang/ai/hondi-doctor-verdict.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REG = JSON.parse(readFileSync(join(ROOT, 'prompts/kdoctor-specialties.json'), 'utf8'));
const BASE = readFileSync(join(ROOT, 'prompts', REG.base), 'utf8');

const goodReport = () => ({
  model_version: 'SP-29-v0.1', case_id: 'C1',
  patient: { age_years: 30, sex: 'F', pregnancy: 'no', weight_kg: 60 }, chief_complaint: '인후통',
  triage: { level: 'routine', red_flags: [] },
  specialties_consulted: [{ id: 'kdoctor-internal', summary: 's' }],
  hypotheses: [{ name: '급성 상기도 감염', icd10: 'J06.9', must_not_miss: false, probability_band: 'high',
    supports: [{ text: '3일 인후통', basis: 'history' }], against: [{ text: '고열 없음', basis: 'history' }] }],
  final: { claimed_kind: 'confirmed', primary: { name: '급성 상기도 감염', icd10: 'J06.9' }, alternatives: [] },
  confidence: { clinical: 8, information: 7 },
  plan: { tests: [], treatments: [{ kind: 'self_care', description: '휴식', requires_clinician: false, basis: 'guideline' }],
    followup: { reassess_in_days: 3, return_if: ['38.5℃ 이상 고열이 이틀 지속'] } },
  summary_clinical: '상기도 감염 가능성', summary_plain: '감기일 가능성이 높습니다.', warnings: [],
});
const wrap = (r) => `[K-Doctor v0.1 적용 | 케이스: C1 | 층위: 전문가]\n[STEP-B-COMPLETE | x]\n[DIAGNOSIS_REPORT]\n${JSON.stringify(r)}\n[/DIAGNOSIS_REPORT]\n확진입니다(원문은 숨겨져야 함)`;

const mkDeps = (replies, extra = {}) => {
  const calls = [];
  let i = 0;
  return {
    calls,
    deps: {
      callLLM: async (system, messages) => { calls.push({ system, messages }); const r = replies[Math.min(i++, replies.length - 1)]; return typeof r === 'function' ? r(system, messages) : r; },
      orchestratorSP: 'ORCH', registry: REG,
      loadSpecialist: async (id) => 'SPEC:' + id, validate: validateDiagnosis, audienceView, audience: undefined, ...extra,
    },
  };
};

test('parseConsults — 여러 태그·공백 허용', () => {
  const r = parseConsults('앞 [CONSULT_SPECIALIST: id=kdoctor-emergency, question=흉통 + 식은땀?] 중간 [CONSULT_SPECIALIST:id=kdoctor-internal ,question=발열]');
  assert.deepEqual(r, [{ id: 'kdoctor-emergency', question: '흉통 + 식은땀?' }, { id: 'kdoctor-internal', question: '발열' }]);
  assert.deepEqual(parseConsults('없음'), []);
});

test('extractReport — 정상·코드펜스·깨진 JSON·없음', () => {
  assert.equal(extractReport(wrap(goodReport())).report.case_id, 'C1');
  assert.equal(extractReport('[DIAGNOSIS_REPORT]\n```json\n{"a":1}\n```\n[/DIAGNOSIS_REPORT]').report.a, 1);
  assert.equal(extractReport('[DIAGNOSIS_REPORT]{oops}[/DIAGNOSIS_REPORT]').error, 'json_parse_failed');
  assert.equal(extractReport('그냥 텍스트').found, false);
});

test('stripInternal — 내부 태그·JSON·협진 태그 제거', () => {
  const t = stripInternal(wrap(goodReport()) + '\n[CONSULT_SPECIALIST: id=x, question=y]');
  assert.ok(!t.includes('DIAGNOSIS_REPORT') && !t.includes('STEP-') && !t.includes('CONSULT') && !t.includes('K-Doctor v0.1'));
});

test('assembleSpecialist — 조립 규칙 제외, 공통 규칙 포함', () => {
  const s = REG.specialties[0];
  const spec = readFileSync(join(ROOT, 'prompts', s.file), 'utf8');
  const out = assembleSpecialist(spec, BASE);
  assert.ok(out.includes('[규칙 C1]') && !out.includes('@@BASE_INCLUDE@@') && !out.includes('[조립 규칙]'));
  assert.ok(baseBody(BASE).includes('[한계]'));
});

test('escapeHtml/renderMarkdown — 스크립트 주입 방지', () => {
  assert.ok(!escapeHtml('<script>alert(1)</script>').includes('<script>'));
  assert.ok(!renderMarkdown('**a** <img src=x onerror=alert(1)>').includes('<img'));
});

test('일반 질문 응답(보고서 없음) — 텍스트만, 내부 표식 제거', async () => {
  const { deps } = mkDeps(['[K-Doctor v0.1 적용 | 케이스: C1 | 층위: 전문가]\n[STEP-0-COMPLETE | x]\n언제부터 시작됐나요?']);
  const out = await runTurn([], '머리가 아파요', deps);
  assert.equal(out.view.type, 'text'); assert.equal(out.view.text, '언제부터 시작됐나요?');
  assert.equal(out.history.length, 2);
});

test('정상 보고서 — 카드 렌더, 원문 자연어(확진 문구)는 숨김, 코드 재계산 표시', async () => {
  const { deps } = mkDeps([wrap(goodReport())]);
  const out = await runTurn([], '인후통 3일', deps);
  assert.equal(out.view.type, 'report'); assert.equal(out.view.kind, 'confirmed');
  assert.ok(out.view.html.includes('급성 상기도 감염') && out.view.html.includes('J06.9'));
  assert.ok(!out.view.html.includes('확진입니다'));
  assert.equal(out.view.text, undefined);
});

test('협진 — 한 턴에 과목 SP 호출 후 결과를 총괄에 되돌린다', async () => {
  const { deps, calls } = mkDeps([
    '먼저 협진합니다 [CONSULT_SPECIALIST: id=kdoctor-emergency, question=흉통+식은땀, 55세 남성 — 배제할 진단?]',
    '[SPECIALIST_FINDING]{"answer":"ACS 배제 필요"}[/SPECIALIST_FINDING]',
    wrap(goodReport()),
  ]);
  // 두 번째 호출은 과목 SP 호출이어야 하므로 순서를 시스템 프롬프트로 구분
  const seq = [];
  deps.callLLM = async (system, messages) => {
    seq.push(system);
    if (system === 'ORCH' && seq.filter((s) => s === 'ORCH').length === 1) return '협진합니다 [CONSULT_SPECIALIST: id=kdoctor-emergency, question=흉통+식은땀]';
    if (system.startsWith('SPEC:')) return '[SPECIALIST_FINDING]{"answer":"ACS 배제 필요"}[/SPECIALIST_FINDING]';
    calls.push(messages); return wrap(goodReport());
  };
  const out = await runTurn([], '가슴이 조여요', deps);
  assert.deepEqual(seq, ['ORCH', 'SPEC:kdoctor-emergency', 'ORCH']);
  const lastMsgs = calls[calls.length - 1];
  assert.ok(lastMsgs.at(-1).content.includes('[CONSULT_SPECIALIST 결과 — 응급의학과]'));
  assert.deepEqual(out.view.consults, [{ id: 'kdoctor-emergency', ok: true }]);
});

test('지어낸 과목 id는 호출하지 않고 오류 결과를 돌려준다', async () => {
  const seq = []; const seen = [];
  const { deps } = mkDeps([]);
  deps.callLLM = async (system, messages) => {
    seq.push(system); seen.push(messages);
    if (seq.length === 1) return '[CONSULT_SPECIALIST: id=kdoctor-astrology, question=별자리로 진단?]';
    return wrap(goodReport());
  };
  const out = await runTurn([], '증상', deps);
  assert.deepEqual(seq, ['ORCH', 'ORCH']);
  assert.ok(seen[1].at(-1).content.includes('존재하지 않는 과목 id'));
  assert.deepEqual(out.view.consults, [{ id: 'kdoctor-astrology', ok: false }]);
});

test(`협진 호출은 한 턴에 최대 ${MAX_CONSULTS_PER_TURN}회`, async () => {
  let specCalls = 0; let orch = 0;
  const { deps } = mkDeps([]);
  const ids = ['emergency', 'internal', 'pediatrics', 'dermatology', 'family'].map((x) => `[CONSULT_SPECIALIST: id=kdoctor-${x}, question=q${x}]`).join(' ');
  deps.callLLM = async (system) => {
    if (system.startsWith('SPEC:')) { specCalls++; return 'finding'; }
    orch++; return orch === 1 ? ids : wrap(goodReport());
  };
  await runTurn([], '증상', deps);
  assert.equal(specCalls, MAX_CONSULTS_PER_TURN);
});

test('협진이 계속 요청돼도 라운드 상한 후 종료한다(무한 루프 없음)', async () => {
  let n = 0;
  const { deps } = mkDeps([]);
  deps.callLLM = async (system) => { n++; if (system.startsWith('SPEC:')) return 'f'; return '[CONSULT_SPECIALIST: id=kdoctor-internal, question=계속]'; };
  const out = await runTurn([], '증상', deps);
  assert.ok(n < 20); assert.equal(out.view.type, 'text');
  assert.ok(!out.view.text.includes('CONSULT_SPECIALIST'));
});

test('검증 실패(금지 문구) → 1회 재생성 후 통과하면 카드', async () => {
  const bad = goodReport(); bad.summary_plain = '확진입니다';
  const { deps, calls } = mkDeps([wrap(bad), wrap(goodReport())]);
  const out = await runTurn([], '증상', deps);
  assert.equal(calls.length, 2); assert.equal(out.view.type, 'report');
  assert.ok(calls[1].messages.at(-1).content.includes('[시스템] 결과 검증 실패'));
});

test('두 번 연속 검증 실패 → 페일세이프(119·109 안내), 실패 원문은 이력에 남기지 않음', async () => {
  const bad = goodReport(); bad.summary_plain = '진단서 발급';
  const { deps } = mkDeps([wrap(bad), wrap(bad)]);
  const out = await runTurn([], '증상', deps);
  assert.equal(out.view.type, 'failsafe'); assert.equal(out.view.text, FAILSAFE_TEXT);
  assert.ok(FAILSAFE_TEXT.includes('119') && FAILSAFE_TEXT.includes('109'));
  assert.ok(!JSON.stringify(out.history).includes('진단서 발급'));
});

test('깨진 JSON 보고서도 재생성 후 실패하면 페일세이프', async () => {
  const { deps } = mkDeps(['[DIAGNOSIS_REPORT]{oops}[/DIAGNOSIS_REPORT]']);
  assert.equal((await runTurn([], '증상', deps)).view.type, 'failsafe');
});

test('응급 보고서 — 응급 배너, 전문의약품 제안 제거', async () => {
  const r = goodReport(); r.triage = { level: 'emergency', red_flags: [{ id: 'R3', evidence: '식은땀 동반 흉통' }] };
  r.plan.treatments.push({ kind: 'prescription_drug', description: '아스피린 등', requires_clinician: true, basis: 'guideline' });
  const { deps } = mkDeps([wrap(r)]);
  const out = await runTurn([], '흉통', deps);
  assert.equal(out.view.kind, 'emergency_referral');
  assert.ok(out.view.html.includes('119') && !out.view.html.includes('아스피린'));
});

test('렌더링은 값을 이스케이프한다', async () => {
  const r = goodReport(); r.hypotheses[0].name = '<b>x</b>'; r.final.primary.name = '<b>x</b>'; r.summary_plain = '<script>1</script>';
  const v = validateDiagnosis(r);
  const html = renderReportHtml(audienceView(v), v);
  assert.ok(!html.includes('<script>') && !html.includes('<b>x</b>'));
});

test('위젯이 import하는 상대경로 파일이 실제로 존재한다', () => {
  const w = readFileSync(join(ROOT, 'assets/kdoctor-chat-widget.js'), 'utf8');
  for (const m of w.matchAll(/from '(\.[^']+)'/g)) readFileSync(join(ROOT, 'assets', m[1]));
  for (const f of ['prompts/kdoctor-specialties.json', 'prompts/SP-29_kdoctor_v0_1.txt']) assert.ok(w.includes(f.split('/')[1]) );
});

test('worker.js ALLOWED_ORIGINS에 doctor.hondi.net이 있다', () => {
  assert.ok(readFileSync(join(ROOT, 'worker.js'), 'utf8').includes("'https://doctor.hondi.net'"));
});

test('doctor 전용 DeepSeek 키 배선: worker.js가 doctor Origin에만 DEEPSEEK_DOCTOR_KEY를 쓰고 배포 워크플로가 시크릿을 전달한다', () => {
  const w = readFileSync(join(ROOT, 'worker.js'), 'utf8');
  assert.ok(w.includes("meta?.origin==='https://doctor.hondi.net'"));
  assert.ok(w.includes('env.DEEPSEEK_DOCTOR_KEY'));
  assert.ok(w.includes("'DEEPSEEK_DOCTOR_KEY_MISSING'"), '전용 키가 없으면 공용 키로 폴백하지 않고 오류를 내야 함');
  const y = readFileSync(join(ROOT, '.github/workflows/deploy-worker.yml'), 'utf8');
  assert.ok(y.includes('DEEPSEEK_DOCTOR_KEY: ${{ secrets.DEEPSEEK_DOCTOR_KEY }}'));
  assert.ok(/secrets: \|\n\s+DEEPSEEK_DOCTOR_KEY/.test(y));
  assert.ok(!/DEEPSEEK_DOCTOR_KEY\s*[:=]\s*['"]?sk-/.test(w + y), '키 값이 코드에 들어가면 안 됨');
});
