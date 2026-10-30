import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuery, buildFilter, publicRow } from '../worker/kmail-people-search.js';
import { senderLocalPart } from '../worker/kmail-address.js';

test('검색어: 2자 미만·40자 초과는 검색하지 않는다', () => {
  assert.equal(normalizeQuery(''), ''); assert.equal(normalizeQuery('a'), ''); assert.equal(normalizeQuery('  '), '');
  assert.equal(normalizeQuery('x'.repeat(41)), ''); assert.equal(normalizeQuery('주피'), '주피');
});
test('검색어: @ 접두와 대소문자를 정리하고 필터를 깨는 글자를 뺀다', () => {
  assert.equal(normalizeQuery('@Jupiter'), 'jupiter');
  assert.equal(normalizeQuery("a'b%c\\d\""), 'abcd');
});
test('필터: 허용한 사람만, 자기 자신 제외', () => {
  const f = buildFilter('jup', "g'1");
  assert.match(f, /^discoverable=true && mail_id!='' /);
  assert.ok(f.includes("owner_user_guid!='g\\'1'"));
  assert.ok(f.includes("mail_id~'jup'") && f.includes("sender_display_name~'jup'"));
});
test('공개 카드: 이름·메일 아이디·주소만, 허용하지 않았으면 null', () => {
  const row = { owner_user_guid: 'aaaa:bbbb:cccc:dddd:eeee:ffff:0000:1111', mail_id: 'jupiter', sender_display_name: '주피터', discoverable: true, signature: 'x', auto_reply_text: 'y' };
  const c = publicRow(row, senderLocalPart, (n) => n);
  assert.deepEqual(c, { name: '주피터', mail_id: 'jupiter', email: 'jupiter@naviweb.kr' });
  assert.equal(publicRow({ ...row, discoverable: false }, senderLocalPart), null);
  assert.equal(publicRow({ ...row, mail_id: '' }, senderLocalPart), null);
  assert.deepEqual(Object.keys(c).sort(), ['email', 'mail_id', 'name']);
});
