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
  assert.equal(scoreRecord(em, { ...base, called_ids: ['kdoctor-neurology'], all_text: '119' }).reason, 'consult_in_emergency');
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
