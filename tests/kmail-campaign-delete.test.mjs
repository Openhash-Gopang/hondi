import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCampaignDeleteRequest, ownedCampaignFilter } from '../src/worker/kmail-campaign-delete.js';

test('all:true 는 전체 삭제', () => {
  assert.deepEqual(parseCampaignDeleteRequest({ all: true }), { ok: true, all: true, ids: [] });
});
test('id 목록: 중복 제거·공백 제거', () => {
  const r = parseCampaignDeleteRequest({ campaign_ids: ['a1', ' a1 ', 'b2'] });
  assert.equal(r.ok, true); assert.deepEqual(r.ids, ['a1', 'b2']); assert.equal(r.all, false);
});
test('빈 목록·이상한 id·200건 초과는 거절', () => {
  assert.equal(parseCampaignDeleteRequest({}).ok, false);
  assert.equal(parseCampaignDeleteRequest({ campaign_ids: ["a' || 1=1"] }).ok, false);
  assert.equal(parseCampaignDeleteRequest({ campaign_ids: Array.from({ length: 201 }, (_, i) => 'x' + i) }).ok, false);
  assert.equal(parseCampaignDeleteRequest({ campaign_ids: Array.from({ length: 200 }, (_, i) => 'x' + i) }).ok, true);
});
test('필터는 항상 본인 소유를 포함하고 따옴표를 이스케이프', () => {
  assert.equal(ownedCampaignFilter("g'1", []), "owner_user_guid='g\\'1'");
  assert.equal(ownedCampaignFilter('g1', ['a', 'b']), "owner_user_guid='g1' && (id='a' || id='b')");
});
