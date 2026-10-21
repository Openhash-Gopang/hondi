// 사업 계획 v6 와 2026-10-21 세션 기록이 목록·메뉴에 등록돼 있고 파일이 있다 (2026-10-21).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
test('admin 사업 계획 목록에 v6 링크와 파일', () => {
  assert.ok(rd('admin.html').includes('./docs/business-plan/consortium/consortium-business-plan-summary-v6.md'));
  const t = rd('docs/business-plan/consortium/consortium-business-plan-summary-v6.md');
  assert.ok(t.includes('v6') && t.includes('직역별 단계 개시') && t.includes('연 99,000원 구독'));
});
test('개발자 문서 메뉴에 세션 기록 등록과 파일', () => {
  assert.ok(rd('desktop.html').includes('./docs/SESSION_SUMMARY_PRO_VERIFY_SUBSCRIPTION_REVIEW_20261021_v1_0.md'));
  const t = rd('docs/SESSION_SUMMARY_PRO_VERIFY_SUBSCRIPTION_REVIEW_20261021_v1_0.md');
  for (const k of ['PRO_SESSION_SECRET', 'PRO_GATE_MODE', 'PRO_SUB_MODE', '1795000002', '배포 순서']) assert.ok(t.includes(k), k);
});
