import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { e164LookupHash, profilePhoneFilter, last8Filter, pickGuidByLast8 } from '../../src/worker/phone-lookup.js';

const SECRET = 'test-secret', E164 = '+8201096627170';

test('해시가 pb_hooks의 $security.hs256("e164-lookup:"+e164, secret) 와 같은 값(HMAC-SHA256 hex) — Node crypto 로 교차 검증', async () => {
  const expected = createHmac('sha256', SECRET).update('e164-lookup:' + E164).digest('hex');
  assert.equal(await e164LookupHash(SECRET, E164), expected);
});
test('필터: 새 계정(해시)과 옛 계정(평문)을 OR 로 함께 찾는다', async () => {
  const f = await profilePhoneFilter({ PHONE_VERIFY_SECRET: SECRET }, E164);
  const h = createHmac('sha256', SECRET).update('e164-lookup:' + E164).digest('hex');
  assert.equal(f, `(e164_hash='${h}' || e164='${E164}')`);
});
test('비밀값이 없으면 예전 동작(평문 필터만)', async () => {
  assert.equal(await profilePhoneFilter({}, E164), `e164='${E164}'`);
  assert.equal(await profilePhoneFilter(undefined, E164), `e164='${E164}'`);
});
test('필터 값의 따옴표·역슬래시는 이스케이프(필터 주입 방지)', async () => {
  const f = await profilePhoneFilter({}, "+82'||1=1||'");
  assert.ok(f.includes("\\'")); assert.ok(!/e164='\+82'\|\|/.test(f));
  assert.ok(last8Filter("1' || x='").includes("\\'"));
});
test('8자리 후보 필터: e164_last8 일치 또는 평문 부분일치', () => {
  assert.equal(last8Filter('96627170'), "(e164_last8='96627170' || e164~'96627170')");
});
test('pickGuidByLast8: 새 계정(last8 칸)·옛 계정(평문)·정확히 1건만 채택', () => {
  assert.equal(pickGuidByLast8([{ guid: 'g-new', e164: '', e164_last8: '96627170' }], '96627170'), 'g-new');
  assert.equal(pickGuidByLast8([{ guid: 'g-old', e164: '+8201096627170', e164_last8: '' }], '96627170'), 'g-old');
  // 번호 중간에 우연히 낀 경우는 제외
  assert.equal(pickGuidByLast8([{ guid: 'x', e164: '+8296627170123', e164_last8: '' }], '96627170'), null);
  // 충돌 2건·0건은 자동 처리 포기
  assert.equal(pickGuidByLast8([{ guid: 'a', e164_last8: '96627170' }, { guid: 'b', e164: '+8201096627170' }], '96627170'), null);
  assert.equal(pickGuidByLast8([], '96627170'), null); assert.equal(pickGuidByLast8(undefined, '96627170'), null);
});
