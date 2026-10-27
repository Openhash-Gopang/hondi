/**
 * tests/mail-id.test.mjs — 메일 아이디 규칙(형식·예약어·읽기 쉬운 기본값·변경 횟수 정책)과
 * 가입 훅(pb_hooks/main.pb.js)이 worker와 같은 기본 아이디를 만드는지 확인한다. 네트워크 없음.
 * 실행: node --test tests/mail-id.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  ADJECTIVES, NOUNS, defaultMailIdFromHash, checkMailId, changePolicyConfig, evaluateChange, recordChange, recordConfirm, limitMessage, readState, writeState, DAY_MS, MAIL_ID_PATTERN,
} from '../src/worker/mail-id.js';

const hmacHex = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('hex');
const fakeKv = () => { const m = new Map(); return { m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };

test('단어 목록: 중복·예약어·형식 위반이 없다', () => {
  assert.equal(new Set(ADJECTIVES).size, ADJECTIVES.length); assert.equal(new Set(NOUNS).size, NOUNS.length);
  for (const w of [...ADJECTIVES, ...NOUNS]) assert.match(w, /^[a-z]+$/, w);
  assert.equal(ADJECTIVES.filter(w => NOUNS.includes(w)).length, 0, '형용사와 명사가 겹치면 "coral-coral" 같은 이름이 나온다');
});

test('기본 아이디: 형식이 맞고 같은 입력이면 같은 값, 다른 입력이면 대체로 다른 값', () => {
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    const id = defaultMailIdFromHash(hmacHex('k', 'mail-id-seed:guid-' + i + ':0'));
    assert.match(id, /^[a-z]+-[a-z]+-[1-9]\d\d$/, id);
    assert.ok(id.length <= 30 && MAIL_ID_PATTERN.test(id), id);
    assert.equal(checkMailId(id).ok, true, id + ' 는 검사를 통과해야 한다');
    seen.add(id);
  }
  assert.ok(seen.size > 2900, '3,000명 중 거의 모두 달라야 한다: ' + seen.size);
  const h = hmacHex('k', 'x'); assert.equal(defaultMailIdFromHash(h), defaultMailIdFromHash(h));
});

test('형식·예약어: 숫자만 금지, 사칭 방지, 대소문자 정규화', () => {
  const ok = id => checkMailId(id);
  for (const good of ['jupiter', 'swift-heron-482', 'my_name', 'a1b', 'Jupiter', ' jupiter ']) assert.equal(ok(good).ok, true, good);
  assert.equal(ok('Jupiter').normalized, 'jupiter');
  for (const [bad, why] of [['12345678', 'numeric'], ['000', 'numeric'], ['1-2-3', 'numeric'], ['ab', 'format'], ['-abc', 'format'], ['abc-', 'format'], ['a'.repeat(31), 'format'], ['한글이름', 'format'], ['a b c', 'format'], ['a.b.c', 'format'],
    ['admin', 'reserved'], ['Admin01', 'reserved'], ['support-2', 'reserved'], ['postmaster', 'reserved'], ['hondi', 'reserved'], ['hondi-fan', 'reserved'], ['kmailer', 'reserved'], ['no-reply', 'reserved'], ['police', 'reserved'], ['gopang1', 'reserved']]) {
    const r = ok(bad); assert.equal(r.ok, false, bad); assert.equal(r.reason, why, bad + ' → ' + r.reason); assert.ok(r.message.length > 10);
  }
  for (const tooShort of ['a', 'a1', 'z', '9']) assert.equal(ok(tooShort).ok, false, tooShort + ' — 3자 미만은 안 된다(1글자가 통과하던 결함의 회귀 방지)');
  for (const edge of ['abc', 'a'.repeat(30)]) assert.equal(ok(edge).ok, true, edge.length + '자 경계');
  assert.equal(ok('a'.repeat(31)).ok, false);
  assert.equal(ok('administrator-kim').ok, true, '예약어로 시작해도 뒤에 다른 말이 붙으면 쓸 수 있다(관리자·브랜드 접두어는 제외)');
  assert.equal(ok('bankim').ok, true, '우연히 단어가 포함된 이름까지 막지는 않는다');
});

test('변경 정책: 기본 30일 3번, 환경 변수로 조정', () => {
  assert.deepEqual(changePolicyConfig({}), { limit: 3, windowDays: 30 });
  assert.deepEqual(changePolicyConfig({ MAIL_ID_CHANGE_LIMIT: '1', MAIL_ID_CHANGE_WINDOW_DAYS: '90' }), { limit: 1, windowDays: 90 });
  assert.deepEqual(changePolicyConfig({ MAIL_ID_CHANGE_LIMIT: 'x', MAIL_ID_CHANGE_WINDOW_DAYS: '0' }), { limit: 3, windowDays: 30 });
});

test('변경 정책: 가입 직후 첫 선택은 세지 않고, 그다음부터 30일에 3번', () => {
  const cfg = changePolicyConfig({}); const t0 = 1_800_000_000_000;
  let st = null;
  let ev = evaluateChange(st, t0, cfg, { hasCurrent: true });
  assert.equal(ev.exempt, true); assert.equal(ev.allowed, true);                       // 아직 선택 화면을 거치지 않음
  st = recordChange(st, t0, { exempt: ev.exempt });                                      // 첫 선택
  assert.deepEqual(st.changes, []); assert.equal(st.confirmed, 'chosen');
  for (let i = 1; i <= 3; i++) {
    ev = evaluateChange(st, t0 + i * 1000, cfg); assert.equal(ev.allowed, true, i + '번째'); assert.equal(ev.left, 3 - (i - 1));
    st = recordChange(st, t0 + i * 1000, { exempt: ev.exempt });
  }
  ev = evaluateChange(st, t0 + 5000, cfg);
  assert.equal(ev.allowed, false); assert.equal(ev.left, 0);
  assert.equal(ev.nextChangeAt, new Date(t0 + 1000 + 30 * DAY_MS).toISOString(), '가장 오래된 변경이 30일 지난 시각');
  assert.equal(evaluateChange(st, t0 + 1000 + 30 * DAY_MS + 1, cfg).allowed, true, '30일이 지나면 다시 바꿀 수 있다');
  assert.equal(evaluateChange(st, t0 + 1000 + 30 * DAY_MS + 1, cfg).left, 1);
});

test('변경 정책: 아이디가 아직 없을 때(첫 배정)는 언제나 허용, 기본값을 그대로 쓰기로 한 뒤의 변경은 센다', () => {
  const cfg = changePolicyConfig({}); const t0 = 1_800_000_000_000;
  assert.equal(evaluateChange({ confirmed: 'chosen', changes: [t0, t0, t0] }, t0 + 1, cfg, { hasCurrent: false }).allowed, true);
  let st = recordConfirm(null, 'accept'); assert.equal(st.confirmed, 'accepted');
  const ev = evaluateChange(st, t0, cfg); assert.equal(ev.exempt, false); assert.equal(ev.left, 3);
  assert.equal(recordConfirm(null, 'skip').confirmed, 'skipped');
  assert.throws(() => recordConfirm(null, 'later'));
});

test('안내 문구: 기간·횟수·다음 가능 시각(한국 시간)', () => {
  const ev = { windowDays: 30, limit: 3, nextChangeAt: '2026-11-26T15:30:00.000Z' };
  const m = limitMessage(ev); assert.match(m, /30일 동안 3번/); assert.match(m, /11월 27일 00:30/);
  assert.match(limitMessage({ windowDays: 7, limit: 2, nextChangeAt: null }), /7일 동안 2번/);
});

test('상태 저장: 읽기·쓰기, KV가 없거나 망가진 값이어도 안전', async () => {
  const kv = fakeKv(); assert.deepEqual(await readState(kv, 'g'), { confirmed: null, changes: [], autoN: 0 });
  await writeState(kv, 'g', { confirmed: 'chosen', changes: [1, 2], autoN: 4 });
  assert.deepEqual(await readState(kv, 'g'), { confirmed: 'chosen', changes: [1, 2], autoN: 4 });
  kv.m.set('hondi:mail_id_state:bad', '{깨짐'); assert.deepEqual(await readState(kv, 'bad'), { confirmed: null, changes: [], autoN: 0 });
  assert.deepEqual(await readState(null, 'g'), { confirmed: null, changes: [], autoN: 0 }); await writeState(null, 'g', {});
});

test('가입 훅(pb_hooks/main.pb.js)과 worker 모듈이 같은 기본 아이디를 만든다', () => {
  const hook = fs.readFileSync(new URL('../pb_hooks/main.pb.js', import.meta.url), 'utf8');
  const arr = name => JSON.parse(hook.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1]);
  assert.deepEqual(arr('ADJ'), ADJECTIVES, '형용사 목록이 훅과 같아야 한다');
  assert.deepEqual(arr('NOUN'), NOUNS, '명사 목록이 훅과 같아야 한다');
  const expr = hook.match(/const candidate = (ADJ\[parseInt\(hash[^;]*);/)[1];
  const fromHook = new Function('hash', 'ADJ', 'NOUN', 'return ' + expr);
  for (let i = 0; i < 500; i++) {
    const hash = hmacHex('secret-' + (i % 7), `mail-id-seed:2601:db80:${i}:${i % 10}`);
    assert.equal(fromHook(hash, ADJECTIVES, NOUNS), defaultMailIdFromHash(hash), '훅과 worker의 결과가 다르다: ' + hash);
  }
  assert.ok(!/candidate = hash\.substring\(0, 8\)/.test(hook), '옛 8자리 hex 방식이 남아 있으면 안 된다');
});
