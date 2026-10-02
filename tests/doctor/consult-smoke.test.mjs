import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadResources } from '../../scripts/kdoctor/eval/eval-run.mjs';
import { noReportReason, scoreRecord, runScenario, makeMockFor, summarize } from '../live_smoketest/kdoctor_consult_live_smoketest.mjs';

const scen = JSON.parse(readFileSync(new URL('../live_smoketest/scenarios_kdoctor_consult_100_20261001.json', import.meta.url), 'utf8'));
const reg = JSON.parse(readFileSync(new URL('../../prompts/kdoctor-specialties.json', import.meta.url), 'utf8'));
const ids = new Set(reg.specialties.map((s) => s.id));

test('시나리오 100건 구조: 의사 50·환자 50, 각 44 협진 + 6 응급, 과목 id 모두 등록됨', () => {
  assert.equal(scen.length, 100);
  for (const g of ['doctor', 'patient']) {
    const s = scen.filter((x) => x.group === g);
    assert.equal(s.length, 50);
    assert.equal(s.filter((x) => x.expect_consult).length, 44);
  }
  assert.equal(new Set(scen.map((x) => x.id)).size, 100);
  for (const x of scen) for (const id of [...x.expect_ids, ...x.accept_ids]) assert.ok(ids.has(id), id);
});

test('scoreRecord: 오선택·미호출·응급 중 협진·안내 누락을 FAIL로 잡는다', () => {
  const sc = { expect_consult: true, expect_ids: ['kdoctor-cardiology'], accept_ids: ['kdoctor-internal'] };
  const base = { error: null, requested_ids: [], called_ids: [], view_type: 'report', validated_ok: true, all_text: '' };
  assert.equal(scoreRecord(sc, { ...base, called_ids: ['kdoctor-cardiology'], requested_ids: ['kdoctor-cardiology'] }).status, 'LIVE-PASS');
  assert.equal(scoreRecord(sc, { ...base, called_ids: ['kdoctor-internal'] }).match, 'accept');
  assert.equal(scoreRecord(sc, { ...base, called_ids: ['kdoctor-dermatology'] }).reason, 'wrong_specialty');
  assert.equal(scoreRecord(sc, base).reason, 'no_consult');
  assert.equal(scoreRecord(sc, { ...base, called_ids: ['kdoctor-cardiology'], view_type: 'failsafe' }).reason, 'no_report');
  const em = { expect_consult: false, expect_ids: [], accept_ids: [] };
  assert.equal(scoreRecord(em, { ...base, all_text: '즉시 119' }).status, 'LIVE-PASS');
  assert.equal(scoreRecord(em, base).reason, 'no_emergency_guidance');
  assert.equal(scoreRecord({ ...em, group: 'patient', utterance: '가슴이 아파요' }, { ...base, called_ids: ['kdoctor-neurology'], all_text: '119' }).reason, 'consult_in_emergency');
  // 의사가 자문을 명시 요청한 응급은 호출해야 통과한다(2026-10-02 결정)
  const emD = { ...em, group: 'doctor', utterance: '순환기 자문 부탁합니다. 흉통 환자' };
  assert.equal(scoreRecord(emD, { ...base, called_ids: ['kdoctor-cardiology'], all_text: '119' }).status, 'LIVE-PASS');
  assert.equal(scoreRecord(emD, { ...base, all_text: '119' }).reason, 'explicit_consult_not_called');
});

test('모의 제공자로 전체 파이프라인(runTurn→협진→검증)이 끝까지 돈다', async () => {
  const resources = loadResources();
  const pick = [scen.find((x) => x.group === 'doctor' && x.expect_consult), scen.find((x) => x.group === 'patient' && !x.expect_consult)];
  const recs = [];
  for (const sc of pick) recs.push(await runScenario(sc, { llm: makeMockFor(sc, resources.orchestratorSP), resources }));
  assert.ok(recs.every((r) => r.score.status === 'LIVE-PASS'), JSON.stringify(recs.map((r) => r.score)));
  assert.equal(summarize(recs).total.pass, 2);
});

test('noReportReason: 잘림·검증 실패·태그 없음·닫힘 없음을 구분한다', () => {
  const c = (o) => ({ orchestrator_calls: [{ finish_reason: 'stop', has_open_tag: true, has_close_tag: true, ...o }], validation_errors: [] });
  assert.equal(noReportReason(c({ finish_reason: 'length' })), 'no_report_truncated');
  assert.equal(noReportReason({ ...c({}), validation_errors: [['x']] }), 'no_report_invalid');
  assert.equal(noReportReason(c({ has_open_tag: false, has_close_tag: false })), 'no_report_no_tag');
  assert.equal(noReportReason(c({ has_close_tag: false })), 'no_report_unclosed');
});

test('총괄 출력 한도: 위젯 값이 워커 상한 이하이고, SP-29에 간결 원칙 절이 있다', async () => {
  const { ORCHESTRATOR_MAX_TOKENS } = await import('../../assets/kdoctor-chat-core.js');
  const { MAX_OUTPUT_TOKENS } = await import('../../src/worker/kdoctor-guard.js');
  assert.ok(ORCHESTRATOR_MAX_TOKENS <= MAX_OUTPUT_TOKENS, '워커가 위젯 요청을 깎으면 다시 잘린다');
  assert.ok(ORCHESTRATOR_MAX_TOKENS > 3500);
  const sp = readFileSync(new URL('../../prompts/SP-29_kdoctor_v0_1.txt', import.meta.url), 'utf8');
  assert.match(sp, /\[출력 분량과 형식 — 간결 원칙/);
  assert.match(sp, /금지 표현은 어디에도 쓰지 않는다/);
});

test('findForbiddenWords: 걸린 단어를 찾아 재생성 요청에 알려 준다', async () => {
  const { findForbiddenWords, runTurn } = await import('../../assets/kdoctor-chat-core.js');
  assert.deepEqual(findForbiddenWords({ a: 'AF 확진 전 참고', b: ['퇴원', '확진'] }).sort(), ['퇴원', '확진'].sort());
  assert.deepEqual(findForbiddenWords({ a: '확인 필요' }), []);
  // 재생성 요청 문구에 단어가 실리는지
  const calls = [];
  const bad = '[DIAGNOSIS_REPORT]{"x":"확진 전"}[/DIAGNOSIS_REPORT]';
  const deps = { orchestratorSP: 'SP', registry: { specialties: [] }, loadSpecialist: async () => '', audienceView: () => ({}),
    callLLM: async (s, m) => { calls.push(m.at(-1).content); return bad; }, validate: () => ({ ok: false, errors: ['forbidden_issuance_wording'] }) };
  await runTurn([], '증상', deps);
  assert.ok(calls.length >= 2 && calls.at(-1).includes('발견된 금지 표현: 확진'));
});

test('isEmergencyTriage·sanitizeConsultText·retryHints', async () => {
  const m = await import('../../assets/kdoctor-chat-core.js');
  assert.equal(m.isEmergencyTriage('[STEP-T-COMPLETE | 점검 | 확인 신호 R3 | 분류 emergency → STEMI]'), true);
  assert.equal(m.isEmergencyTriage('[STEP-T-COMPLETE | 점검 | 분류 **emergency**]'), true);
  assert.equal(m.isEmergencyTriage('[STEP-T-COMPLETE | 분류=emergency]'), true);
  assert.equal(m.isEmergencyTriage('[STEP-T-COMPLETE | 분류 urgent — emergency는 아님]'), false);
  assert.equal(m.isEmergencyTriage('일반 문장 emergency'), false);
  assert.equal(m.sanitizeConsultText('확진 전·확진 후 격리, 퇴원 기준, 진단서 발급'), '확정 진단 전·확정 진단 후 격리, 퇴실 기준, 진단 문서 발급');
  assert.match(m.retryHints(['primary_not_in_hypotheses']), /hypotheses\[\]\.name/);
  assert.equal(m.retryHints(['unknown']), '');
});

test('runTurn: emergency 분류 응답의 협진 태그는 호출하지 않고 emergency 보고서를 요청한다', async () => {
  const { runTurn } = await import('../../assets/kdoctor-chat-core.js');
  const sent = []; let specialistCalls = 0;
  const first = '[STEP-T-COMPLETE | R3 | 분류 emergency]\n[CONSULT_SPECIALIST: id=kdoctor-cardiology, question=q]';
  const second = '지금 바로 119에 연락하십시오.';
  let n = 0;
  const deps = { orchestratorSP: 'SP', registry: { specialties: [{ id: 'kdoctor-cardiology', name_ko: '순환기내과' }] },
    loadSpecialist: async () => { specialistCalls++; return 'S'; }, audienceView: () => ({}),
    callLLM: async (s, m) => { sent.push(m.at(-1).content); return s === 'SP' ? (n++ === 0 ? first : second) : 'x'; },
    validate: () => ({ ok: true, errors: [], kind: 'emergency_referral' }) };
  const out = await runTurn([], '흉통', deps);
  assert.equal(specialistCalls, 0);
  assert.ok(sent.some((x) => String(x).includes('협진을 호출하지 않았다')));
  assert.equal(out.view.consults.length, 1);
  assert.equal(out.view.consults[0].skipped, 'emergency');
  assert.match(out.view.text, /119/);
});

test('explicitConsultRequest: 자문·협진 명시 요청만 true', async () => {
  const m = await import('../../assets/kdoctor-chat-core.js');
  assert.equal(m.explicitConsultRequest('순환기 자문을 구해 주세요'), true);
  assert.equal(m.explicitConsultRequest('협진 부탁'), true);
  assert.equal(m.explicitConsultRequest('가슴이 아파요'), false);
});

test('runTurn: emergency여도 의료인이 자문을 명시 요청하면 요청 과목을 호출한다', async () => {
  const { runTurn } = await import('../../assets/kdoctor-chat-core.js');
  let specialistCalls = 0; let n = 0;
  const first = '[STEP-T-COMPLETE | R3 | 분류 emergency]\n[CONSULT_SPECIALIST: id=kdoctor-cardiology, question=q]';
  const deps = { orchestratorSP: 'SP', registry: { specialties: [{ id: 'kdoctor-cardiology', name_ko: '순환기내과' }] },
    loadSpecialist: async () => { specialistCalls++; return 'S'; }, audienceView: () => ({}),
    callLLM: async (s) => (s === 'SP' ? (n++ === 0 ? first : '지금 119.') : '소견'),
    validate: () => ({ ok: true, errors: [], kind: 'emergency_referral' }) };
  const out = await runTurn([], '순환기 자문 부탁합니다. 흉통 환자', deps);
  assert.equal(specialistCalls, 1);
  assert.equal(out.view.consults[0].ok, true);
});

test('parseCheckVerdict / parseReconcileTag', async () => {
  const m = await import('../../assets/kdoctor-chat-core.js');
  const t = '[FINDING | C-1 | HIGH | 결론영향:있음 | 용량 출처 없음 | 근거: 입력에 없음]\n[FINDING | C-4 | LOW | 결론영향:없음 | 단위 | 근거: x]\n[CHECK_VERDICT: 결론 무효 소지 | 지적 2건]';
  const p = m.parseCheckVerdict(t);
  assert.equal(p.verdict, '결론 무효 소지'); assert.equal(p.findings.length, 2); assert.equal(p.declared, 2);
  assert.equal(m.parseCheckVerdict('판정 없음').verdict, null);
  assert.deepEqual(m.parseReconcileTag('[STEP-RECONCILE-COMPLETE | 지적 3건 | 수용 2건 | 반박 1건 | 결론 번복]'), { findings: 3, accepted: 2, rebutted: 1 });
  assert.equal(m.parseReconcileTag('없음'), null);
});

function reviewDeps(over = {}) {
  const rep = (kind) => '[DIAGNOSIS_REPORT]\n{"k":"' + kind + '"}\n[/DIAGNOSIS_REPORT]';
  let orchCalls = 0;
  const deps = { orchestratorSP: 'SP', registry: { specialties: [] }, loadSpecialist: async () => 'S', audienceView: () => ({ view: 'clinician', report: {} }), checkSP: 'CHK',
    callLLM: async () => { orchCalls++; return orchCalls === 1 ? rep('orig') : '[수용] C-1 — 입력에 없음\n결론 영향 있음\n' + rep('fixed') + '\n[STEP-RECONCILE-COMPLETE | 지적 1건 | 수용 1건 | 반박 0건 | 결론 번복]'; },
    validate: (r) => ({ ok: true, errors: [], kind: r.k === 'fixed' ? 'conditional' : 'conditional' }),
    callCheck: async () => '[FINDING | C-1 | HIGH | 결론영향:있음 | x | 근거: 입력에 없음]\n[CHECK_VERDICT: 결론 무효 소지 | 지적 1건]', ...over };
  return { deps, calls: () => orchCalls };
}

test('runTurn 검수: 지적이 있으면 재조정 보고서가 최종본으로 채택되고 이력에도 새 보고서만 남는다', async () => {
  const { runTurn } = await import('../../assets/kdoctor-chat-core.js');
  const { deps } = reviewDeps();
  const out = await runTurn([], '환자 설명', deps);
  assert.equal(out.view.review.verdict, '결론 무효 소지');
  assert.equal(out.view.review.reconciled, true);
  assert.deepEqual(out.view.review.reconcile, { findings: 1, accepted: 1, rebutted: 0 });
  assert.match(out.history.at(-1).content, /"k":"fixed"/);
  assert.doesNotMatch(out.history.at(-1).content, /\[수용\]/);
});

test('runTurn 검수: 재검토 불요면 재조정 호출 없이 원본 유지', async () => {
  const { runTurn } = await import('../../assets/kdoctor-chat-core.js');
  const { deps, calls } = reviewDeps({ callCheck: async () => '[CHECK_VERDICT: 재검토 불요 | 지적 0건]' });
  const out = await runTurn([], '환자 설명', deps);
  assert.equal(calls(), 1);
  assert.equal(out.view.review.reconciled, false);
  assert.match(out.history.at(-1).content, /"k":"orig"/);
});

test('runTurn 검수: 응급 보고서는 재조정이 응급을 낮추려 하면 원본 유지', async () => {
  const { runTurn } = await import('../../assets/kdoctor-chat-core.js');
  const { deps } = reviewDeps({ validate: (r) => ({ ok: true, errors: [], kind: r.k === 'fixed' ? 'conditional' : 'emergency_referral' }) });
  const out = await runTurn([], '환자 설명', deps);
  assert.equal(out.view.review.reconciled, false);
  assert.equal(out.view.review.reconcile_failed, true);
  assert.match(out.history.at(-1).content, /"k":"orig"/);
});

test('runTurn 검수: 검수 호출 오류·판정 줄 없음이어도 원본 보고서를 낸다', async () => {
  const { runTurn } = await import('../../assets/kdoctor-chat-core.js');
  let r = await runTurn([], 'x', reviewDeps({ callCheck: async () => { throw new Error('boom'); } }).deps);
  assert.equal(r.view.type, 'report'); assert.equal(r.view.review.status, 'error');
  r = await runTurn([], 'x', reviewDeps({ callCheck: async () => '판정 없는 문장' }).deps);
  assert.equal(r.view.review.status, 'unparsed'); assert.equal(r.view.review.reconciled, false);
});

test('runTurn 검수: 검수 입력에는 사례 원문·협진 원문·보고서만 들어가고 총괄의 사고 과정은 없다', async () => {
  const { runTurn } = await import('../../assets/kdoctor-chat-core.js');
  let sent = null;
  const { deps } = reviewDeps({ callCheck: async (sp, msgs) => { sent = msgs[0].content; return '[CHECK_VERDICT: 재검토 불요 | 지적 0건]'; } });
  await runTurn([], '34세 여성 인후통', deps);
  assert.match(sent, /\[사례 원문\]\n34세 여성 인후통/);
  assert.match(sent, /\[검수 대상 보고서\]/);
  assert.doesNotMatch(sent, /STEP-/);
});

test('검수 SP 구조: 모듈 C-1~C-6, FINDING·CHECK_VERDICT 서식이 있다', () => {
  const sp = readFileSync(new URL('../../prompts/SP-29K_kdoctor_check_v0_1.txt', import.meta.url), 'utf8');
  for (const k of ['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', '[FINDING |', '[CHECK_VERDICT:', '재검토 불요', '재검토 권고', '결론 무효 소지']) assert.ok(sp.includes(k), k);
});

test('검수 파일럿: 구조(결함 10·정상 3)와 채점', async () => {
  const cases = JSON.parse(readFileSync(new URL('../live_smoketest/check_pilot_cases_20261002.json', import.meta.url), 'utf8'));
  assert.equal(cases.filter((c) => c.kind === 'seeded').length, 10);
  assert.equal(cases.filter((c) => c.kind === 'clean').length, 3);
  for (const c of cases) assert.ok(c.case_text && c.report && Array.isArray(c.expected_modules));
  const { scoreCheck, summarizePilot } = await import('../live_smoketest/kdoctor_check_pilot.mjs');
  const f = (module, severity) => ({ module, severity, impact: '있음', text: '' });
  assert.equal(scoreCheck({ kind: 'seeded', expected_modules: ['C-1'] }, { verdict: '재검토 권고', findings: [f('C-1', 'HIGH')] }).status, 'DETECTED');
  assert.equal(scoreCheck({ kind: 'seeded', expected_modules: ['C-1'] }, { verdict: '재검토 권고', findings: [f('C-4', 'MED')] }).status, 'DETECTED-OTHER-MODULE');
  assert.equal(scoreCheck({ kind: 'seeded', expected_modules: ['C-1'] }, { verdict: '재검토 불요', findings: [] }).status, 'MISSED');
  assert.equal(scoreCheck({ kind: 'clean', expected_modules: [] }, { verdict: '재검토 불요', findings: [f('C-1', 'LOW')] }).status, 'CLEAN-OK');
  assert.equal(scoreCheck({ kind: 'clean', expected_modules: [] }, { verdict: '재검토 권고', findings: [f('C-1', 'HIGH')] }).status, 'FALSE-ALARM');
  assert.equal(scoreCheck({ kind: 'clean', expected_modules: [] }, { verdict: null, findings: [] }).status, 'UNPARSED');
  assert.equal(summarizePilot([{ kind: 'clean', score: { status: 'CLEAN-OK' } }]).clean.ok, 1);
});
