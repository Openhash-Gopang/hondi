/**
 * tests/kmail-confirm.test.mjs — 발송 전 확인 단계 방어 장치. 네트워크 없음.
 * 실행: node --test tests/kmail-confirm.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rescueDanglingLookup, hasConfirmationAsk, previousAssistantAsked, buildConfirmationSummary, evaluateSendGuard, buildSentMailPreview } from '../src/worker/kmail-confirm.js';

const NOW = Date.parse('2026-10-27T07:58:16.000Z');
const parsedOne = { recipients: [{ name: '', email: 'tensor.city@gmail.com' }], subject: '테스트 메일', body: '안녕하세요, K-Mail 테스트 발송입니다.', send_at: '2026-10-27T16:58:16+09:00' };

test('확인 질문은 질문형만 인정한다', () => {
  for (const ok of ['이대로 보낼까요?', '제목이나 본문을 바꾸고 싶으시면 말씀해 주세요. 이대로 보낼까요?', '이 내용으로 발송할까요?', '이대로 발송해도 될까요?', '이대로 보내도 괜찮을까요?', '이대로 진행할까요?', '전송할까요', '예약할까요?', '이대로 괜찮으신가요?']) assert.equal(hasConfirmationAsk(ok), true, ok);
  for (const no of ['확인했습니다. 지금 바로 발송하겠습니다.', '이대로 보냅니다.', '보내드렸습니다.', '발송 완료되었습니다.', '', null, undefined, '수신자는 tensor.city@gmail.com 입니다']) assert.equal(hasConfirmationAsk(no), false, String(no));
});

test('바로 앞 비서 메시지가 확인 질문이어야 한다 — 비서 메시지가 없으면 안 됨, 오래된 확인은 무효', () => {
  assert.equal(previousAssistantAsked([{ role: 'user', content: 'tensor.city@gmail.com에 테스트 메일 발송' }]), false, '보고된 실제 사례(첫 요청 한 번에 발송)');
  assert.equal(previousAssistantAsked([{ role: 'user', content: '보내줘' }, { role: 'assistant', content: '받는 사람: a@b.com … 이대로 보낼까요?' }, { role: 'user', content: '네' }]), true);
  assert.equal(previousAssistantAsked([{ role: 'user', content: 'x' }, { role: 'assistant', content: '이대로 보낼까요?' }, { role: 'user', content: '제목을 바꿔줘' }, { role: 'assistant', content: '제목을 바꿨습니다.' }, { role: 'user', content: '보내세요' }]), false, '확인 뒤 수정이 있었고 다시 묻지 않았다면 새로 확인받아야 한다');
  assert.equal(previousAssistantAsked([]), false); assert.equal(previousAssistantAsked(null), false);
  assert.equal(previousAssistantAsked([{ role: 'assistant', content: '이대로 보낼까요?' }]), true);
});

test('확인 요약: 받는 사람·제목·시각·본문을 서버가 직접 정리하고 "아직 발송하지 않았습니다"를 먼저 말한다', () => {
  const t = buildConfirmationSummary(parsedOne, NOW);
  assert.match(t, /^⚠️ 아직 발송하지 않았습니다/); assert.match(t, /\*\*받는 사람\*\*: tensor\.city@gmail\.com \(총 1명\)/); assert.match(t, /\*\*제목\*\*: 테스트 메일/); assert.match(t, /\*\*발송 시각\*\*: 지금 즉시/);
  assert.match(t, /안녕하세요, K-Mail 테스트 발송입니다\./); assert.match(t, /이대로 보낼까요\?/);
  assert.equal(hasConfirmationAsk(t), true, '서버가 만든 요약 자체가 다음 턴의 확인 질문으로 인정돼야 한다');
});

test('확인 요약: 이름이 있으면 함께, 많으면 10명까지만 나열하고 "외 N명", 미래 시각은 한국 시간', () => {
  const many = { ...parsedOne, recipients: Array.from({ length: 13 }, (_, i) => ({ name: i === 0 ? '홍길동' : '', email: `u${i}@x.com` })), send_at: '2026-10-28T00:00:00Z' };
  const t = buildConfirmationSummary(many, NOW);
  assert.match(t, /홍길동<u0@x\.com>, u1@x\.com/); assert.match(t, / 외 3명 \(총 13명\)/); assert.ok(!t.includes('u10@x.com')); assert.match(t, /\*\*발송 시각\*\*: 10월 28일 09:00/);
});

test('확인 요약: 필드가 비어도 깨지지 않는다(제목 없음·시각 미정·받는 사람 없음)', () => {
  const t = buildConfirmationSummary({}, NOW); assert.match(t, /\(없음\)/); assert.match(t, /\(제목 없음\)/); assert.match(t, /시각 미정/); assert.match(t, /\(본문 없음\)/);
  assert.doesNotThrow(() => buildConfirmationSummary(null, NOW)); assert.doesNotThrow(() => buildConfirmationSummary({ recipients: [null, {}, { email: 'a@b.com' }] }, NOW));
});

test('본문이 너무 길면 요약에 일부만 담지 않는다 — 잘린 본문이 그대로 나가는 사고 방지', () => {
  const long = '가'.repeat(5000);
  const t = buildConfirmationSummary({ ...parsedOne, body: long }, NOW);
  assert.ok(t.length < 1200); assert.ok(!t.includes('가가가가가가')); assert.match(t, /5000자라 여기서는 생략/); assert.match(t, /발송할 내용 전체를 보여줘/);
  assert.equal(hasConfirmationAsk(t), false, '이 경우는 확인 질문이 아니라 먼저 전체를 보라는 안내 — 다음 턴에 바로 통과하지 않는다');
});

test('발송 판정: 확인 없이 낸 태그는 막고 요약+action을, 확인된 태그는 통과', () => {
  const blocked = evaluateSendGuard([{ role: 'user', content: '테스트 메일 발송' }], parsedOne, NOW);
  assert.equal(blocked.allow, false); assert.equal(blocked.action.type, 'send_confirmation_required'); assert.match(blocked.reply, /아직 발송하지 않았습니다/);
  const afterSummary = evaluateSendGuard([{ role: 'user', content: '테스트 메일 발송' }, { role: 'assistant', content: blocked.reply }, { role: 'user', content: '네' }], parsedOne, NOW);
  assert.equal(afterSummary.allow, true, '서버 요약 뒤 사용자가 동의하면 같은 내용으로 통과');
});

test('worker.js: 확인 판정이 연락처 저장·캠페인 생성보다 먼저 일어나고, 막히면 거기서 응답한다', () => {
  const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const guard = w.indexOf('_kmailEvaluateSendGuard(cleanMessages, parsed');
  const create = w.indexOf('await _kmailChatCreateCampaign(env, guid, parsed)');
  assert.ok(guard > 0 && create > 0 && guard < create, '판정이 생성보다 앞서야 한다');
  const between = w.slice(guard, create);
  assert.match(between, /if \(!sendGuard\.allow\)/); assert.match(between, /return new Response/);
  assert.equal((w.match(/await _kmailChatCreateCampaign\(/g) || []).length, 1, '대화에서 캠페인을 만드는 호출이 하나뿐이어야 우회가 없다');
});

test('시스템 프롬프트: 확인 질문 형태와 서버 요약 뒤 재발송 규칙', () => {
  const sp = fs.readFileSync(new URL('../prompts/SP-25_kmail_v1_30.txt', import.meta.url), 'utf8');
  for (const w of ['확인 질문은 서버가 검사합니다', '이대로 보낼까요?', '서버가 위 요약을 보여 준 뒤', '지어내지 마세요', '2026-10-27 보정(v1.30, 세 번째)']) assert.ok(sp.includes(w), w);
});

test('확인 요약: 보내는 사람 줄(이름 있음/없음)', () => {
  const withName = buildConfirmationSummary(parsedOne, NOW, { address: 'ceo@hondi.kr', name: '도 영민' });
  assert.match(withName, /- \*\*보내는 사람\*\*: 도 영민 <ceo@hondi\.kr>/);
  assert.ok(withName.indexOf('보내는 사람') < withName.indexOf('받는 사람'), '보내는 사람 줄이 먼저');
  const noName = buildConfirmationSummary(parsedOne, NOW, { address: 'swift-heron-482@hondi.kr', name: '' });
  assert.match(noName, /\*\*보내는 사람\*\*: swift-heron-482@hondi\.kr \(이름 없음/);
  assert.ok(!buildConfirmationSummary(parsedOne, NOW).includes('보내는 사람'), 'sender를 안 주면 줄을 넣지 않는다(기존 동작)');
  assert.equal(evaluateSendGuard([{ role: 'user', content: 'x' }], parsedOne, NOW, { address: 'a@hondi.kr', name: '' }).reply.includes('보내는 사람'), true);
  assert.equal(hasConfirmationAsk(noName), true);
});
test('worker.js: 확인 가드에 보내는 사람 정보를 넘기고, 프롬프트 변수 {{SENDER_DISPLAY}}·{{SENDER_NAME}}을 채운다', () => {
  const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(w, /_kmailEvaluateSendGuard\(cleanMessages, parsed, Date\.now\(\), \{ address:/);
  assert.match(w, /\\\{\\\{SENDER_DISPLAY\\\}\\\}/); assert.match(w, /\\\{\\\{SENDER_NAME\\\}\\\}/);
  const sp = fs.readFileSync(new URL('../prompts/SP-25_kmail_v1_30.txt', import.meta.url), 'utf8');
  for (const k of ['{{SENDER_DISPLAY}}', '{{SENDER_NAME}}', '보내는 이름을 정해', '2026-10-27 보정(v1.30, 다섯 번째)']) assert.ok(sp.includes(k), k);
});

// 2026-10-28 — 이름만 말한 수신자: SP에 조회 우선 규칙과 이름<이메일> 확인 형식이 들어 있어야 한다
import { readFileSync as __readSp } from 'node:fs';
test('SP-25: 이름만 말한 수신자는 주소록 조회 후 이름<이메일>로 확인', () => {
  const sp = __readSp(new URL('../prompts/SP-25_kmail_v1_30.txt', import.meta.url), 'utf8');
  assert.match(sp, /여섯 번째/);
  assert.match(sp, /사람 이름·별칭만/);
  assert.match(sp, /받는 사람 이름<이메일>/);
});

// 2026-10-28 — 발송 후 '보낸 메일 내용'
test('보낸 메일 내용: 발송 완료는 받는 사람·제목·본문·시각을 모두 보여 준다', () => {
  const now = Date.parse('2026-10-27T22:31:00Z');   // KST 10월 28일 07:31
  const t = buildSentMailPreview({ recipients: [{ name: '주피터', email: 'tensor.city@gmail.com' }], subject: '테스트 메일', body: '테스트 메일입니다.\n두 번째 줄', send_at: '2026-10-27T22:31:00Z' },
    { address: 'ceo@hondi.kr', name: '' }, 'sent', Date.parse('2026-10-27T22:31:00Z'), now);
  assert.match(t, /보낸 메일 내용/); assert.match(t, /\*\*보내는 사람\*\*: ceo@hondi\.kr/);
  assert.match(t, /주피터<tensor\.city@gmail\.com> \(총 1명\)/); assert.match(t, /\*\*제목\*\*: 테스트 메일/);
  assert.match(t, /발송 시각\*\*: 10월 28일 07:31/); assert.match(t, /> 테스트 메일입니다\.\n> 두 번째 줄/);
});
test('보낸 메일 내용: 예약·접수는 "발송할 메일 내용", 실패는 붙이지 않는다', () => {
  const now = Date.parse('2026-10-27T22:31:00Z');
  const p = { recipients: [{ email: 'a@x.com' }], subject: 's', body: 'b' };
  assert.match(buildSentMailPreview(p, null, 'scheduled', Date.parse('2026-10-29T00:00:00Z'), now), /발송할 메일 내용[\s\S]*발송 예정\*\*: 10월 29일 09:00/);
  assert.match(buildSentMailPreview(p, null, 'queued', now, now), /발송 예정\*\*: 곧/);
  assert.equal(buildSentMailPreview(p, null, 'failed', now, now), '');
});
test('보낸 메일 내용: 아주 긴 본문은 잘라 보여 주고 안내한다', () => {
  const t = buildSentMailPreview({ recipients: [{ email: 'a@x.com' }], subject: 's', body: '가'.repeat(5000) }, null, 'sent', 0, 0);
  assert.match(t, /이하 2000자 생략/); assert.ok(t.length < 3400);
});

// 2026-10-28 — "찾아볼게요"만 말하고 멈춘 응답 구제
test('rescueDanglingLookup: "주피터님을 주소록에서 찾아볼게요."에 조회 태그를 붙인다', () => {
  const r = rescueDanglingLookup('주피터님을 주소록에서 찾아볼게요.');
  assert.match(r, /\nKMAIL_LOOKUP_CONTACTS \{"q":"주피터"/);
  assert.match(rescueDanglingLookup('네, 김철수 씨를 주소록에서 조회해 볼게요!'), /"q":"김철수"/);
  assert.match(rescueDanglingLookup('홍길동을 주소록에서 확인하겠습니다'), /"q":"홍길동"/);
});
test('rescueDanglingLookup: 이미 태그가 있거나 해당 문장이 아니면 그대로 둔다', () => {
  const tagged = '찾아볼게요.\nKMAIL_LOOKUP_CONTACTS {"q":"주피터"}';
  assert.equal(rescueDanglingLookup(tagged), tagged);
  assert.equal(rescueDanglingLookup('주소록에서 찾았습니다. 보낼까요?'), '주소록에서 찾았습니다. 보낼까요?');
  assert.equal(rescueDanglingLookup('주피터님을 주소록에서 찾아볼게요. 잠시만요 기다려 주세요'), '주피터님을 주소록에서 찾아볼게요. 잠시만요 기다려 주세요');
  assert.equal(rescueDanglingLookup(''), '');
});
test('worker.js: 응답 태그 판정 전에 rescueDanglingLookup 을 거친다', () => {
  const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(w, /reply = _kmailRescueDanglingLookup\(reply\);[^\n]*\n\n  const searchMatch = reply\.match/);
});
