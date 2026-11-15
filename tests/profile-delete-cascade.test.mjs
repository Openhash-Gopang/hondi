// 사용자(프로필)를 지우면 그 사용자가 등록한 메일 정보(이메일 ID 포함)도 함께 지운다 (2026-11-15, 주피터 지시)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const hook = readFileSync(new URL('../pb_hooks/main.pb.js', import.meta.url), 'utf8');

test('프로필 삭제 후 훅이 메일 관련 컬렉션을 owner_user_guid로 지운다', () => {
  const i = hook.indexOf('onRecordAfterDeleteRequest');
  assert.ok(i > 0);
  const body = hook.slice(i, i + 1500);
  assert.match(body, /e\.collection\.name !== "profiles"/);
  for (const c of ['kmail_user_settings', 'kmail_contacts', 'kmail_drafts', 'kmail_blocklist']) assert.ok(body.includes(c), c);
  assert.match(body, /owner_user_guid/);
  assert.match(body, /deleteRecord/);
});
