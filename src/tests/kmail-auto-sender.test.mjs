import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAutomatedSender } from '../worker/kmail-auto-sender.js';

const H = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });

test('회신 불가·반송·안내 주소는 자동 발송으로 본다', () => {
  for (const a of ['noreply@feedback.dnb.com', 'no-reply@x.com', 'analyticsnoreply@google.com', 'do-not-reply@a.kr', 'donotreply@a.kr',
    'mailer-daemon@x.com', 'postmaster@x.com', 'bounce-123@x.com', 'b1auj@cfbounce.naviweb.kr', 'Notifications@github.com', 'NOREPLY@X.COM'])
    assert.equal(isAutomatedSender(a), true, a);
});

test('사람 주소는 자동 발송이 아니다', () => {
  for (const a of ['kim@example.com', 'ceo@naviweb.kr', 'replyme@x.com', 'alert.kim@x.com'.replace('alert.', 'al.'), 'info@company.co.kr'])
    assert.equal(isAutomatedSender(a, H({})), false, a);
});

test('헤더로 자동·대량 메일을 가린다', () => {
  assert.equal(isAutomatedSender('kim@x.com', H({ 'auto-submitted': 'auto-generated' })), true);
  assert.equal(isAutomatedSender('kim@x.com', H({ 'auto-submitted': 'no' })), false);
  assert.equal(isAutomatedSender('kim@x.com', H({ precedence: 'bulk' })), true);
  assert.equal(isAutomatedSender('kim@x.com', H({ 'list-unsubscribe': '<mailto:u@x.com>' })), true);
  assert.equal(isAutomatedSender('kim@x.com', H({ 'x-auto-response-suppress': 'All' })), true);
  assert.equal(isAutomatedSender('', null), false);
});

test('worker.js 가 수신 자동응답 앞에서 이 판별을 쓴다', () => {
  const w = readFileSync(new URL('../../worker.js', import.meta.url), 'utf8');
  assert.match(w, /!_isKmailAddress\(fromEmail\) && !_isAutomatedSender\(fromEmail, message\.headers\)/);
});
