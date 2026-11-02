import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
for (const f of ['../auth/user-badge.js', '../auth/k-service-auth-client.js']) {
  test(f + ': hondi.net 이 아닌 주소(naviweb.kr)에서는 그 주소 자신의 쿠키 도메인을 쓴다', () => {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(s.includes("/(^|\\.)hondi\\.net$/.test(location.hostname) ? '.hondi.net' : location.hostname"));
  });
}
