import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
for (const f of ['../auth/user-badge.js', '../auth/k-service-auth-client.js']) {
  test(f + ': naviweb.kr 이 아닌 주소에서는 그 주소 자신의 쿠키 도메인을 쓴다', () => {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(s.includes("/(^|\\.)naviweb\\.kr$/.test(location.hostname) ? '.naviweb.kr' : location.hostname"));
  });
}
