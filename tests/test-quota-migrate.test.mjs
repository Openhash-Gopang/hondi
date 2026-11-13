/**
 * tests/test-quota-migrate.test.mjs — 테스트 계정 한도(무료 이용 100원 또는 24시간 중 먼저)·차단, 정식 계정으로 데이터 이동 단위 시험(네트워크 없음).
 * 실행: node --test tests/test-quota-migrate.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaConfig, evaluate, getStatus, startFree, setPlan, addSpend, blockedMessage, setPaid, setExtra, addExtraSpend, exhaustedMessage } from '../src/worker/test-quota.js';
import { migrateTestData, mergeKmailSettings, MIGRATION_TARGETS } from '../src/worker/test-migrate.js';

const H = 3600 * 1000;
const fakeKv = () => { const m = new Map(); return { m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const CFG = quotaConfig({ FREE_TRIAL_KRW: "100" });             // 로직 시험은 한도 100원으로 고정(실제 기본값은 500원 — 아래 첫 시험)

test('quotaConfig: 기본값 500원·24시간, 환경 변수로 바꿀 수 있고 옛 변수는 무시한다', () => {
  const D = quotaConfig({});
  assert.equal(D.limitKrw, 500); assert.equal(D.freeHours, 24); assert.equal(D.freeMs, 24 * H); assert.equal(D.graceMs, 0);
  const c = quotaConfig({ FREE_TRIAL_KRW: '300', FREE_TRIAL_HOURS: '12' });
  assert.equal(c.limitKrw, 300); assert.equal(c.freeMs, 12 * H);
  assert.equal(quotaConfig({ FREE_TRIAL_KRW: 'abc', FREE_TRIAL_HOURS: '' }).limitKrw, 500);
  assert.equal(quotaConfig({ TEST_QUOTA_KRW: '300', TEST_GRACE_HOURS: '24' }).limitKrw, 500);   // 옛 변수가 남아 있어도 무시
  assert.equal(CFG.limitKrw, 100);                                                           // 이 파일의 로직 시험용 고정값
});

test('evaluate: 100원 미만·24시간 미만이면 active, 둘 중 먼저 오는 쪽에서 blocked', () => {
  const t0 = 1_700_000_000_000;
  assert.equal(evaluate({ spent_krw: 99.99, started_at: t0 }, t0 + 23 * H, CFG).status, 'active');
  const bySpend = evaluate({ spent_krw: 100, started_at: t0, exceeded_at: t0 + H }, t0 + 2 * H, CFG);
  assert.equal(bySpend.status, 'blocked'); assert.equal(bySpend.ended_reason, 'spent');
  const byTime = evaluate({ spent_krw: 10, started_at: t0 }, t0 + 24 * H, CFG);
  assert.equal(byTime.status, 'blocked'); assert.equal(byTime.ended_reason, 'time');
  assert.equal(byTime.free_ends_at, new Date(t0 + 24 * H).toISOString()); assert.equal(byTime.started_at, new Date(t0).toISOString());
  // 둘 다 지났으면 먼저 온 쪽: 20시간째에 100원을 넘겼다면 spent, 30시간째에 넘겼다면 time
  assert.equal(evaluate({ spent_krw: 150, started_at: t0, exceeded_at: t0 + 20 * H }, t0 + 40 * H, CFG).ended_reason, 'spent');
  assert.equal(evaluate({ spent_krw: 150, started_at: t0, exceeded_at: t0 + 30 * H }, t0 + 40 * H, CFG).ended_reason, 'time');
  assert.equal(evaluate({ spent_krw: 0 }, 5, CFG).status, 'active');                  // 시작 시각이 없으면 지금부터
});

test('startFree: 처음 한 번만 시작 시각을 기록하고 다시 인증해도 24시간이 새로 시작되지 않는다', async () => {
  const kv = fakeKv(); const t0 = 1_700_000_000_000;
  await startFree(kv, 's1', t0); await startFree(kv, 's1', t0 + 10 * H);
  assert.equal(JSON.parse(kv.m.get('hondi:test_quota:s1')).started_at, t0);
  assert.equal((await getStatus(kv, 's1', t0 + 23 * H, CFG)).status, 'active');
  assert.equal((await getStatus(kv, 's1', t0 + 24 * H, CFG)).status, 'blocked');
  await addSpend(kv, 's1', 5, t0 + 1, CFG);                                           // 사용분을 쌓아도 시작 시각은 그대로
  assert.equal(JSON.parse(kv.m.get('hondi:test_quota:s1')).started_at, t0);
  await startFree(null, 's1', t0);                                                    // KV 없음은 조용히 넘어간다
});

test('addSpend: 100원이 되는 순간 blocked, exceeded_at은 한 번만 기록', async () => {
  const kv = fakeKv(); const t0 = 1_700_000_000_000;
  assert.equal((await addSpend(kv, 'g1', 40, t0, CFG)).status, 'active');
  assert.equal((await addSpend(kv, 'g1', 59.5, t0 + 1000, CFG)).status, 'active');
  const over = await addSpend(kv, 'g1', 1, t0 + 5000, CFG);
  assert.equal(over.status, 'blocked'); assert.equal(over.ended_reason, 'spent');
  const first = JSON.parse(kv.m.get('hondi:test_quota:g1')).exceeded_at;
  assert.equal(first, t0 + 5000);
  await addSpend(kv, 'g1', 50, t0 + 9000, CFG);
  assert.equal(JSON.parse(kv.m.get('hondi:test_quota:g1')).exceeded_at, first);
});

test('addSpend: 0원·음수·KV 없음은 아무 일도 하지 않는다(차단 쪽으로 실패하지 않는다)', async () => {
  const kv = fakeKv();
  assert.equal(await addSpend(kv, 'g2', 0, 1, CFG), null);
  assert.equal(await addSpend(kv, 'g2', -5, 1, CFG), null);
  assert.equal(await addSpend(null, 'g2', 10, 1, CFG), null);
  assert.equal(kv.m.size, 0);
  assert.equal((await getStatus(null, 'g2', 1, CFG)).status, 'active');
});

test('getStatus: 시작 기록이 없던 계정은 처음 조회한 시점부터 24시간, 이미 100원을 넘었다면 바로 blocked', async () => {
  const kv = fakeKv(); const t0 = 1_700_000_000_000;
  assert.equal((await getStatus(kv, 'g3', t0, CFG)).status, 'active');
  assert.equal(JSON.parse(kv.m.get('hondi:test_quota:g3')).started_at, t0);
  kv.m.set('hondi:test_quota:g4', JSON.stringify({ spent_krw: 400, exceeded_at: null }));   // 옛 형식(시작 기록 없음)
  assert.equal((await getStatus(kv, 'g4', t0, CFG)).status, 'blocked');
});

test('addSpend: 같은 정산 키는 한 번만 센다(같은 KV 항목에 최근 키 30개 보관), 키가 없으면 매번 센다', async () => {
  const kv = fakeKv(); const t0 = 1_700_000_000_000; let writes = 0; const put = kv.put; kv.put = async (k, v) => { writes++; return put(k, v); };
  await addSpend(kv, 'gd', 10, t0, CFG, 'k1'); await addSpend(kv, 'gd', 10, t0, CFG, 'k1'); await addSpend(kv, 'gd', 10, t0, CFG, 'k1');
  assert.equal(JSON.parse(kv.m.get('hondi:test_quota:gd')).spent_krw, 10); assert.equal(writes, 1);
  await addSpend(kv, 'gd', 5, t0, CFG, 'k2'); assert.equal(JSON.parse(kv.m.get('hondi:test_quota:gd')).spent_krw, 15);
  await addSpend(kv, 'gd', 1, t0, CFG); await addSpend(kv, 'gd', 1, t0, CFG); assert.equal(JSON.parse(kv.m.get('hondi:test_quota:gd')).spent_krw, 17);
  for (let i = 0; i < 40; i++) await addSpend(kv, 'gd', 0.1, t0, CFG, 'x' + i);
  assert.ok(JSON.parse(kv.m.get('hondi:test_quota:gd')).recent.length <= 30);
});

test('blockedMessage: 끝난 이유(비용/시간)에 맞는 문구와 유료 회원 전환 안내', () => {
  const m = blockedMessage({ limit_krw: 100, free_hours: 24, ended_reason: 'spent' });
  assert.match(m, /100원/); assert.match(m, /유료 회원/); assert.match(m, /정식 아이디/);
  assert.match(blockedMessage({ limit_krw: 100, free_hours: 24, ended_reason: 'time' }), /24시간/);
});

test('무료 플랜 삭제(2026-11-14): 무료 기간이 끝나면 blocked(GDC 결제 단계), \'free\'를 지정해도 되돌아가지 않는다', async () => {
  const kv = fakeKv(); const t0 = 1_700_000_000_000;
  await startFree(kv, 'p2', t0);
  assert.equal((await getStatus(kv, 'p2', t0 + 25 * H, CFG)).status, 'blocked');
  await setPlan(kv, 'p2', 'free', t0 + 25 * H);                                      // 옛 화면이 보내도 무료 플랜은 더 이상 없다
  const ev = await getStatus(kv, 'p2', t0 + 25 * H, CFG);
  assert.equal(ev.status, 'blocked'); assert.notEqual(ev.phase, 'free'); assert.equal(ev.plan || null, null);
  await kv.put('hondi:test_quota:p3', JSON.stringify({ spent_krw: 0, started_at: t0, plan: 'free', fp_spent: 0 }));   // 옛 기록에 남은 plan:'free'도 무시한다
  assert.equal((await getStatus(kv, 'p3', t0 + 25 * H, CFG)).status, 'blocked');
  await setPlan(null, 'p2', 'free', 1);                                              // KV 없음은 조용히 넘어간다
});

test('유료 플랜: 포함 사용량 → 추가 사용량(켠 경우, 월 한도까지) → 소진, 기간이 지나면 다시 채워진다', async () => {
  const kv = fakeKv(); const t0 = 1_700_000_000_000; const D = 24 * H;
  assert.equal(CFG.included.p10, 5000); assert.equal(CFG.included.p100, 50000); assert.equal(CFG.included.p200, 100000);
  await setPaid(kv, 'u1', 'p10', t0 + 30 * D, t0);
  let ev = await getStatus(kv, 'u1', t0 + H, CFG);
  assert.equal(ev.status, 'active'); assert.equal(ev.phase, 'paid'); assert.equal(ev.included_krw, 5000);
  ev = await addSpend(kv, 'u1', 4990, t0 + 2 * H, CFG); assert.equal(ev.phase, 'paid');
  ev = await addSpend(kv, 'u1', 20, t0 + 3 * H, CFG);                                   // 포함 사용량을 넘김
  assert.equal(ev.status, 'exhausted');                                                 // 추가 사용량이 꺼져 있으면 멈춘다
  assert.match(exhaustedMessage(ev), /추가 사용량/);
  await setExtra(kv, 'u1', true, 3000, t0 + 4 * H);
  ev = await getStatus(kv, 'u1', t0 + 4 * H, CFG); assert.equal(ev.status, 'active'); assert.equal(ev.phase, 'extra');
  ev = await addExtraSpend(kv, 'u1', 2000, t0 + 5 * H, CFG); assert.equal(ev.phase, 'extra'); assert.equal(ev.extra_used_krw, 2000);
  ev = await addExtraSpend(kv, 'u1', 1000, t0 + 6 * H, CFG); assert.equal(ev.status, 'exhausted'); assert.equal(ev.extra_limit_krw, 3000);   // 월 한도 도달
  await setExtra(kv, 'u1', false, undefined, t0 + 7 * H);
  assert.equal(JSON.parse(kv.m.get('hondi:test_quota:u1')).extra_limit_krw, 3000);      // 끄기만 해도 한도값은 남는다
  ev = await getStatus(kv, 'u1', t0 + 31 * D, CFG);                                      // 만료(30일)가 지나면 유료 상태가 아니다
  assert.equal(ev.tier, undefined);
  await setPaid(kv, 'u1', 'p10', t0 + 90 * D, t0 + 31 * D);                              // 같은 등급 갱신: 기간 시작은 유지(이미 31일 지나 새 기간으로 굴러감)
  ev = await getStatus(kv, 'u1', t0 + 31 * D, CFG);
  assert.equal(ev.used_krw, 0, '새 기간에는 사용분이 0');
});

test('유료 플랜: 같은 등급 갱신은 이번 기간 사용분을 유지하고, 등급이 바뀌면 새로 시작한다', async () => {
  const kv = fakeKv(); const t0 = 1_700_000_000_000; const D = 24 * H;
  await setPaid(kv, 'u2', 'p100', t0 + 30 * D, t0); await addSpend(kv, 'u2', 1234, t0 + H, CFG);
  await setPaid(kv, 'u2', 'p100', t0 + 60 * D, t0 + 2 * H);
  assert.equal((await getStatus(kv, 'u2', t0 + 3 * H, CFG)).used_krw, 1234);
  await setPaid(kv, 'u2', 'p200', t0 + 60 * D, t0 + 4 * H);
  const ev = await getStatus(kv, 'u2', t0 + 5 * H, CFG);
  assert.equal(ev.used_krw, 0); assert.equal(ev.included_krw, 100000);
  await setPaid(kv, 'u2', null, 0, t0 + 6 * H);
  assert.notEqual((await getStatus(kv, 'u2', t0 + 7 * H, CFG)).phase, 'paid');
  assert.equal(await addExtraSpend(kv, 'nobody', 5, t0, CFG), null);                    // 유료가 아니면 아무 일도 하지 않는다
  assert.equal(quotaConfig({ PLAN_INCLUDED_KRW: '{"p10":7000}' }).included.p10, 7000);
  assert.equal(quotaConfig({ PLAN_INCLUDED_KRW: 'oops' }).included.p10, 5000);
});

// ── 데이터 이동 ────────────────────────────────────────────
function fakeL1(db, opts = {}) {
  const calls = [];
  const l1 = async (path, init = {}) => {
    calls.push(`${init.method || 'GET'} ${path.split('?')[0]}`);
    const m = path.match(/^\/api\/collections\/([a-z_]+)\/records(?:\/([^/?]+))?/);
    const [, col, id] = m;
    if (opts.missing && opts.missing.includes(col)) return new Response('{}', { status: 404 });
    const rows = db[col] || [];
    if ((init.method || 'GET') === 'GET') {
      const raw = decodeURIComponent(path).match(/filter=(.*?)&perPage/)[1];            // 예: owner='T' && id!='c1'
      const conds = [...raw.matchAll(/([a-z_]+)(!?=)'((?:\\'|[^'])*)'/g)].map(m => ({ f: m[1], neg: m[2] === '!=', v: m[3].replace(/\\'/g, "'") }));
      const q = new URL('http://x' + path).searchParams;
      const perPage = Number(q.get('perPage')) || 30, page = Number(q.get('page')) || 1;
      const hit = rows.filter(r => conds.every(c => c.neg ? r[c.f] !== c.v : r[c.f] === c.v));
      return new Response(JSON.stringify({ items: hit.slice((page - 1) * perPage, page * perPage).map(r => ({ id: r.id, ...r })), totalItems: hit.length, totalPages: Math.max(1, Math.ceil(hit.length / perPage)) }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    const row = rows.find(r => r.id === id);
    if (opts.failIds && opts.failIds.includes(id)) return new Response('{"message":"unique"}', { status: 400 });
    Object.assign(row, body);
    return new Response(JSON.stringify(row), { status: 200 });
  };
  return { l1, calls };
}
const T = 'test-guid', F = 'formal-guid';
const mkDb = () => ({
  kmail_contacts: Array.from({ length: 450 }, (_, i) => ({ id: 'c' + i, owner_user_guid: i % 10 === 0 ? 'someone-else' : T })),
  kmail_campaigns: [{ id: 'k1', owner_user_guid: T }, { id: 'k2', owner_user_guid: F }],
  kplan_plans: [{ id: 'p1', guid: T }],
});

test('migrateTestData: 테스트 guid 소유분만 정식 guid로 바꾸고, 남의 것·정식 계정 것은 건드리지 않는다', async () => {
  const db = mkDb(); const { l1 } = fakeL1(db);
  const r = await migrateTestData({ l1, fromGuid: T, toGuid: F });
  const mine = 450 - 45;
  assert.equal(r.done, true); assert.equal(r.clean, true);
  assert.equal(r.totals.moved, mine + 1 + 1);
  assert.equal(db.kmail_contacts.filter(x => x.owner_user_guid === T).length, 0);
  assert.equal(db.kmail_contacts.filter(x => x.owner_user_guid === 'someone-else').length, 45);
  assert.equal(db.kmail_campaigns.find(x => x.id === 'k2').owner_user_guid, F);
  assert.equal(db.kplan_plans[0].guid, F);
});

test('migrateTestData: 다시 실행해도 안전하다(이미 옮긴 것은 0건)', async () => {
  const db = mkDb(); const { l1 } = fakeL1(db);
  await migrateTestData({ l1, fromGuid: T, toGuid: F });
  const again = await migrateTestData({ l1, fromGuid: T, toGuid: F });
  assert.equal(again.totals.found, 0); assert.equal(again.totals.moved, 0); assert.equal(again.done, true);
});

test('migrateTestData: dry-run은 건수만 세고 아무것도 바꾸지 않는다', async () => {
  const db = mkDb(); const { l1, calls } = fakeL1(db);
  const r = await migrateTestData({ l1, fromGuid: T, toGuid: F, dryRun: true });
  assert.equal(r.totals.found, 405 + 1 + 1); assert.equal(r.totals.moved, 0);
  assert.ok(!calls.some(c => c.startsWith('PATCH')));
  assert.equal(db.kmail_contacts.filter(x => x.owner_user_guid === T).length, 405);
});

test('migrateTestData: 하위 요청 한도를 넘으면 done=false와 next_index로 멈추고, 그 값을 startIndex로 이어서 호출하면 끝낸다', async () => {
  const db = mkDb(); const { l1 } = fakeL1(db);
  const first = await migrateTestData({ l1, fromGuid: T, toGuid: F, maxRequests: 100 });
  assert.equal(first.done, false); assert.ok(first.requests_used <= 100); assert.ok(first.next_index >= 0 && first.next_index < first.total_targets);
  let guard = 0, last = first;
  while (!last.done && guard++ < 50) last = await migrateTestData({ l1, fromGuid: T, toGuid: F, maxRequests: 100, startIndex: last.next_index });
  assert.equal(last.done, true);
  assert.equal(db.kmail_contacts.filter(x => x.owner_user_guid === T).length, 0);
});

test('migrateTestData: 예산이 대상 컬렉션 수(26)보다 작아도 반드시 끝난다(작은 예산 22, 극단적으로 6)', async () => {
  for (const budget of [22, 12, 6]) {
    const db = mkDb(); db.kcleaner_reports = Array.from({ length: 30 }, (_, i) => ({ id: 'kc' + i, user_guid: T }));   // 맨 뒤쪽 대상에도 데이터
    const { l1 } = fakeL1(db);
    let cursor = 0, calls = 0, moved = 0, r;
    do { r = await migrateTestData({ l1, fromGuid: T, toGuid: F, maxRequests: budget, startIndex: cursor }); moved += r.totals.moved; cursor = r.next_index; calls++; } while (!r.done && calls < 500);
    assert.equal(r.done, true, `예산 ${budget}에서 끝나지 않음`);
    assert.equal(moved, 405 + 1 + 1 + 30, `예산 ${budget}에서 옮긴 수`);
    assert.equal(db.kcleaner_reports.filter(x => x.user_guid === T).length, 0);
    assert.ok(calls < 500);
  }
});

test('migrateTestData: 레코드가 아주 많아도(5,000건) 예산 22로 끝난다 — 목록 읽기에 예산을 다 쓰지 않는다', async () => {
  const db = { kmail_contacts: Array.from({ length: 5000 }, (_, i) => ({ id: 'c' + i, owner_user_guid: T })) };
  const { l1 } = fakeL1(db);
  let cursor = 0, calls = 0, moved = 0, r;
  do { r = await migrateTestData({ l1, fromGuid: T, toGuid: F, maxRequests: 22, startIndex: cursor }); moved += r.totals.moved; cursor = r.next_index; calls++; } while (!r.done && calls < 1000);
  assert.equal(r.done, true); assert.equal(moved, 5000);
  assert.equal(db.kmail_contacts.filter(x => x.owner_user_guid === T).length, 0);
});

test('migrateTestData: 옮길 수 없는 레코드가 많아도 멈추거나 되풀이하지 않고, 나머지는 옮긴다', async () => {
  const db = { kmail_contacts: Array.from({ length: 300 }, (_, i) => ({ id: 'c' + i, owner_user_guid: T })) };
  const { l1 } = fakeL1(db, { failIds: ['c0', 'c1', 'c2'] });
  let cursor = 0, calls = 0, moved = 0, failed = 0, r;
  do { r = await migrateTestData({ l1, fromGuid: T, toGuid: F, maxRequests: 22, startIndex: cursor }); moved += r.totals.moved; failed += r.totals.failed; cursor = r.next_index; calls++; } while (!r.done && calls < 1000);
  assert.equal(r.done, true); assert.equal(moved, 297); assert.ok(failed >= 3);
  assert.deepEqual(db.kmail_contacts.filter(x => x.owner_user_guid === T).map(x => x.id).sort(), ['c0', 'c1', 'c2']);
});

test('migrateTestData: 한 호출은 예산을 넘지 않고, 이미 끝낸 대상은 다시 조회하지 않는다', async () => {
  const db = mkDb(); const { l1, calls } = fakeL1(db);
  const r1 = await migrateTestData({ l1, fromGuid: T, toGuid: F, maxRequests: 22 });
  assert.ok(r1.requests_used <= 22); assert.ok(calls.length <= 22);
  const n1 = calls.length; const r2 = await migrateTestData({ l1, fromGuid: T, toGuid: F, maxRequests: 22, startIndex: r1.next_index });
  const listsOfFirstTargets = calls.slice(n1).filter(c => c === 'GET /api/collections/kmail_blocklist/records').length;
  assert.equal(listsOfFirstTargets, 0, '앞에서 끝낸 대상이 다시 조회됨');
  assert.ok(r2.requests_used <= 22);
});

test('migrateTestData: dry-run도 커서로 나눠 세면 합계가 같다', async () => {
  const db = mkDb(); const { l1 } = fakeL1(db);
  const whole = await migrateTestData({ l1, fromGuid: T, toGuid: F, dryRun: true, maxRequests: 500 });
  let cursor = 0, found = 0, r, n = 0;
  do { r = await migrateTestData({ l1, fromGuid: T, toGuid: F, dryRun: true, maxRequests: 10, startIndex: cursor }); found += r.totals.found; cursor = r.next_index; n++; } while (!r.done && n < 50);
  assert.equal(found, whole.totals.found); assert.ok(n > 1);
});

test('migrateTestData: 범위를 벗어난 startIndex는 안전하게 처리한다', async () => {
  const db = mkDb(); const { l1 } = fakeL1(db);
  const r = await migrateTestData({ l1, fromGuid: T, toGuid: F, startIndex: 9999 });
  assert.equal(r.done, true); assert.equal(r.totals.found, 0);
  const r2 = await migrateTestData({ l1, fromGuid: T, toGuid: F, startIndex: -5, dryRun: true });
  assert.ok(r2.totals.found > 0);
});

test('migrateTestData: 일부 레코드가 실패해도 나머지는 옮기고, 실패는 보고한다(clean=false)', async () => {
  const db = mkDb(); const { l1 } = fakeL1(db, { failIds: ['c1'] });
  const r = await migrateTestData({ l1, fromGuid: T, toGuid: F });
  assert.equal(r.clean, false); assert.equal(r.totals.failed, 1);
  assert.equal(db.kmail_contacts.find(x => x.id === 'c1').owner_user_guid, T);
  assert.equal(db.kmail_contacts.find(x => x.id === 'c2').owner_user_guid, F);
});

test('migrateTestData: 없는 컬렉션은 건너뛰고, 같은 guid·빈 guid는 거부한다', async () => {
  const db = mkDb(); const { l1 } = fakeL1(db, { missing: ['kmail_rules', 'school_progress'] });
  const r = await migrateTestData({ l1, fromGuid: T, toGuid: F });
  assert.equal(r.results.find(x => x.collection === 'kmail_rules').skipped, 'collection-missing');
  assert.equal(r.done, true);
  await assert.rejects(() => migrateTestData({ l1, fromGuid: T, toGuid: T }));
  await assert.rejects(() => migrateTestData({ l1, fromGuid: '', toGuid: F }));
});

test('MIGRATION_TARGETS: 돈·키·기록 컬렉션은 목록에 없다', () => {
  const names = MIGRATION_TARGETS.map(t => t.c);
  for (const bad of ['blocks', 'charge_requests', 'ledger_entries', 'virtual_accounts', 'gdc_keys', 'pdv_records', 'user_llm_keys', 'user_subscriptions', 'ai_usage_log', 'kmail_send_log', 'profiles', 'tx_hash_chain', 'bridge_in', 'bridge_out']) {
    assert.ok(!names.includes(bad), bad + ' 는 옮기면 안 됩니다');
  }
  assert.equal(new Set(names).size, names.length);
});

test('mergeKmailSettings: 정식 쪽이 비었거나 기본값일 때만 채우고 mail_id는 건드리지 않는다', async () => {
  const db = { kmail_user_settings: [
    { id: 's1', owner_user_guid: T, signature_text: '푸른바다 드림', sender_display_name: '푸른', auto_reply_text: '휴가 중', auto_reply_until: '', mail_id: 'tt-test' },
    { id: 's2', owner_user_guid: F, signature_text: '', sender_display_name: '나비 K-Mail', auto_reply_text: '이미 있음', mail_id: 'a3f09c1e' },
  ] };
  const { l1 } = fakeL1(db);
  const r = await mergeKmailSettings({ l1, fromGuid: T, toGuid: F });
  assert.equal(r.merged, true); assert.deepEqual(r.fields.sort(), ['sender_display_name', 'signature_text']);
  const f = db.kmail_user_settings[1];
  assert.equal(f.signature_text, '푸른바다 드림'); assert.equal(f.sender_display_name, '푸른');
  assert.equal(f.auto_reply_text, '이미 있음'); assert.equal(f.mail_id, 'a3f09c1e');
});

test('mergeKmailSettings: 정식 계정의 설정 행이 없으면 아무것도 만들지 않는다', async () => {
  const db = { kmail_user_settings: [{ id: 's1', owner_user_guid: T, signature_text: 'x' }] };
  const { l1, calls } = fakeL1(db);
  const r = await mergeKmailSettings({ l1, fromGuid: T, toGuid: F });
  assert.equal(r.merged, false); assert.equal(r.reason, 'no-target');
  assert.ok(!calls.some(c => c.startsWith('PATCH') || c.startsWith('POST')));
});
