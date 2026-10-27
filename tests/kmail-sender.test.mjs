/**
 * tests/kmail-sender.test.mjs — 보내는 사람 표시(이름) 규칙. 네트워크 없음.
 * 실행: node --test tests/kmail-sender.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkSenderName, effectiveSenderName, formatSender, LEGACY_DEFAULT_NAME, SENDER_NAME_MAX } from '../src/worker/kmail-sender.js';

test('기본은 이름 없음 → 주소만, 이름이 있으면 "이름 <주소>"', () => {
  assert.equal(formatSender('ceo@hondi.kr', ''), 'ceo@hondi.kr');
  assert.equal(formatSender('ceo@hondi.kr', undefined), 'ceo@hondi.kr');
  assert.equal(formatSender('ceo@hondi.kr', '도 영민'), '도 영민 <ceo@hondi.kr>');
  assert.equal(formatSender('ceo@hondi.kr', '  도   영민 '), '도 영민 <ceo@hondi.kr>', '공백 정리');
});

test('옛 기본값 "나비 K-Mail"은 이름 없음으로 본다(기존 사용자도 주소만 나감)', () => {
  assert.equal(LEGACY_DEFAULT_NAME, '나비 K-Mail');
  assert.equal(effectiveSenderName('나비 K-Mail'), ''); assert.equal(formatSender('ceo@hondi.kr', '나비 K-Mail'), 'ceo@hondi.kr');
  assert.equal(effectiveSenderName(' 나비  K-Mail '), '');
  assert.equal(effectiveSenderName('나비 K-Mail 팀'), '나비 K-Mail 팀', '다른 이름은 그대로');
});

test('저장 검사: 이름·공백 정리·빈 값 허용(= 이름 지우기)', () => {
  assert.deepEqual(checkSenderName('도 영민'), { ok: true, value: '도 영민' });
  assert.deepEqual(checkSenderName('  Do   Youngmin  '), { ok: true, value: 'Do Youngmin' });
  assert.deepEqual(checkSenderName(''), { ok: true, value: '' }); assert.deepEqual(checkSenderName('   '), { ok: true, value: '' }); assert.deepEqual(checkSenderName(null), { ok: true, value: '' });
  assert.equal(checkSenderName('Zoë Kim').ok, true); assert.equal(checkSenderName('金 太郎').ok, true); assert.equal(checkSenderName('도영민(대표)').ok, true); assert.equal(checkSenderName("O'Brien-Kim Jr.").ok, true);
});

test('저장 검사: 주소를 흉내 내거나 헤더를 깨뜨릴 수 있는 문자는 거절', () => {
  for (const bad of ['a<b', 'a>b', 'ceo@hondi.kr', '"도 영민"', 'a\\b', 'a;b', 'a:b', 'a,b']) { const r = checkSenderName(bad); assert.equal(r.ok, false, bad); assert.equal(r.reason, 'chars', bad); assert.match(r.message, /쓸 수 없습니다/); }
});

test('저장 검사: 줄바꿈·보이지 않는 문자·글자 방향 바꾸기는 거절(헤더 삽입·속임수 방지)', () => {
  for (const bad of ['a\nb', 'a\r\nBcc: x@y.com', 'a\tb', 'a\u200Bb', 'a\u202Eb', 'a\u2066b', '\uFEFFa']) assert.equal(checkSenderName(bad).reason, 'control', JSON.stringify(bad));
});

test(`저장 검사: ${SENDER_NAME_MAX}자 제한(글자 수 기준)`, () => {
  assert.equal(checkSenderName('가'.repeat(SENDER_NAME_MAX)).ok, true); assert.equal(checkSenderName('가'.repeat(SENDER_NAME_MAX + 1)).reason, 'length');
  assert.equal(checkSenderName('😀'.repeat(SENDER_NAME_MAX)).ok, true, '이모지도 한 글자로 센다');
});

test('저장 검사: 서비스·기관 사칭 말은 거절하고 관리자는 허용', () => {
  for (const bad of ['혼디 고객센터', 'Hondi Support', '관리자', '공식 계정', 'OFFICIAL', '보안팀', 'Postmaster']) assert.equal(checkSenderName(bad).reason, 'reserved', bad);
  assert.equal(checkSenderName('혼디넷 대표 도영민', { isAdmin: true }).ok, true);
  assert.equal(checkSenderName('도 영민', { isAdmin: false }).ok, true);
});

test('보낼 때: 예전에 검사 없이 저장된 위험한 값은 이름 없음으로 처리해 주소만 보낸다', () => {
  for (const bad of ['a<b>', 'x@y.com', 'a\nBcc: z', 'a\u202Eb', '가'.repeat(81)]) assert.equal(effectiveSenderName(bad), '', JSON.stringify(bad));
});

test('worker.js: 이름 없는 발신은 문자열 주소, 있으면 {email,name}으로 보낸다 / 기본값 "나비 K-Mail"이 코드에 남지 않는다', () => {
  const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(w, /from: fromName \? \{ email: fromAddr, name: fromName \} : fromAddr/g);
  assert.equal((w.match(/from: fromName \? \{ email: fromAddr, name: fromName \} : fromAddr/g) || []).length, 2, '일반 발송·자동 응답 두 곳');
  const stripped = w.split('\n').filter(l => !l.trim().startsWith('//') && !l.includes('2026-10-27')).join('\n');
  assert.ok(!/sender_display_name: '나비 K-Mail'/.test(stripped) && !/\|\| '나비 K-Mail'/.test(stripped), '코드에 남은 기본 이름이 없어야 한다');
  const hook = fs.readFileSync(new URL('../pb_hooks/main.pb.js', import.meta.url), 'utf8');
  assert.ok(!/rec\.set\("sender_display_name"/.test(hook), '가입 훅이 이름을 채우지 않는다');
});

test('worker.js: 채팅 설정 태그도 REST와 같은 공용 헬퍼를 거친다(변경 횟수 정책 우회 없음)', () => {
  const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.equal((w.match(/await _kmailPlanMailIdChange\(/g) || []).length, 2, 'REST와 채팅 두 곳이 같은 계획 함수를 쓴다');
  assert.equal((w.match(/await _kmailCommitMailIdChange\(/g) || []).length, 2);
  assert.ok(!/_kmailNormalizeMailId\(parsed\.mail_id\)/.test(w), '채팅 경로의 직접 검증·저장 코드가 사라졌다');
  assert.equal((w.match(/await _kmailValidateSenderName\(/g) || []).length, 2, '이름 검사도 두 경로 모두');
});

test('시스템 프롬프트: 기본은 주소만, 이름 지우기는 빈 문자열, 사칭 거절 안내', () => {
  const sp = fs.readFileSync(new URL('../prompts/SP-25_kmail_v1_30.txt', import.meta.url), 'utf8');
  for (const w of ['보내는 사람 표시(sender_display_name)', '{"sender_display_name": ""}', '도 영민 <ceo@hondi.kr>', '"나비 K-Mail"을 기본 이름으로 붙이지 않습니다', '2026-10-27 보정(v1.30, 네 번째)']) assert.ok(sp.includes(w), w);
});
