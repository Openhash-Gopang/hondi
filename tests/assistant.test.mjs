import test from 'node:test';
import assert from 'node:assert/strict';
for (const f of ['case-core', 'case-sync', 'case-store', 'assistant-core', 'assistant-rules']) await import(`../${f}.js`);
const C = globalThis.CaseCore, Y = globalThis.CaseSync, A = globalThis.AssistantCore, R = globalThis.AssistantRules;
const { CaseStore, MemoryAdapter } = globalThis.CaseStore;
const NOW = '2026-11-01T00:00:00.000Z';

test('동의 범위: 기본은 L0·L1만, L2/L3는 항목별 허용, 모르는 source 거부', () => {
  assert.equal(A.normalizeEvent({ source: 'case', what: 'x' }, null, NOW).ok, true);
  assert.equal(A.normalizeEvent({ source: 'mail', what: 'x' }, null, NOW).ok, true);
  assert.equal(A.normalizeEvent({ source: 'device.app', what: 'x' }, null, NOW).code, 'NO_CONSENT');
  assert.equal(A.normalizeEvent({ source: 'device.app', what: 'x' }, { L2: ['device.app'] }, NOW).ok, true);
  assert.equal(A.normalizeEvent({ source: 'device.file', what: 'x' }, { L2: ['device.app'] }, NOW).code, 'NO_CONSENT');
  assert.equal(A.normalizeEvent({ source: 'ext.bank', what: 'x' }, { L3: [] }, NOW).code, 'NO_CONSENT');
  assert.equal(A.normalizeEvent({ source: 'ext.bank', what: 'x' }, { L3: ['ext.bank'] }, NOW).event.sensitivity, 'special');
  assert.equal(A.normalizeEvent({ source: 'zzz', what: 'x' }, null, NOW).code, 'UNKNOWN_SOURCE');
  assert.equal(A.normalizeEvent({ source: 'case' }, null, NOW).code, 'BAD_EVENT');
  assert.equal(A.normalizeEvent({ source: 'mail', what: 'x' }, { L1: false }, NOW).code, 'NO_CONSENT');   // 끄면 즉시 중단
});

test('모델 전송 마스킹: 주민번호·카드번호 가림, special 은 본문 제거', () => {
  const ev = A.normalizeEvent({ source: 'mail', what: '주민번호 900101-1234567 카드 1234-5678-9012-3456', data: { memo: '900101 1234567' } }, null, NOW).event;
  const m = A.maskForModel(ev);
  assert.ok(!JSON.stringify(m).includes('1234567') && !JSON.stringify(m).includes('9012'));
  const sp = A.normalizeEvent({ source: 'ext.health', what: '당뇨 진단', data: { dx: 'E11' }, with: '병원', refs: [{ kind: 'lab', hash: 'h' }] }, { L3: ['ext.health'] }, NOW).event;
  const ms = A.maskForModel(sp);
  assert.ok(!JSON.stringify(ms).includes('당뇨') && !JSON.stringify(ms).includes('E11') && !JSON.stringify(ms).includes('병원'));
  assert.equal(ms.sensitivity, 'special');
});

test('표현식: 결정론·미평가·허용 연산만', () => {
  const ctx = { a: 3, d: { x: '2026-11-10T00:00:00Z' } };
  assert.equal(R.evalExpr({ op: 'lt', args: [{ var: 'a' }, 5] }, ctx), true);
  assert.equal(R.evalExpr({ op: 'days_until', args: [{ var: 'd.x' }, '2026-11-01T00:00:00Z'] }, ctx), 9);
  assert.throws(() => R.evalExpr({ op: 'eq', args: [{ var: 'nope' }, 1] }, ctx), e => e.path === 'nope');
  assert.throws(() => R.evalExpr({ op: 'exec', args: [] }, ctx), /허용되지 않은 연산/);
  assert.equal(R.evalExpr({ op: 'or', args: [{ op: 'eq', args: [{ var: 'a' }, 3] }, { op: 'eq', args: [{ var: 'zz' }, 1] }] }, ctx), true);   // 참이 이미 있으면 미평가 항목은 무관
});

async function setup() {
  const pub = await Y.generateIdentity(), stranger = await Y.generateIdentity();
  const pack = await R.signPack(pub, { id: 'kr-filing', version: '1.0', domain: 'law', jurisdiction: 'KR', effective_from: '2026-01-01T00:00:00Z', publisher: { id: 'law-co' }, rules: [
    { id: 'attach-required', actions: ['court_submit'], violation_when: { op: 'lt', args: [{ var: 'attachments' }, { var: 'required_attachments' }] }, severity: 3, blocking: true, message: '필수 첨부서류가 부족합니다', cite: '민사소송규칙' },
    { id: 'deadline-near', actions: ['court_submit'], violation_when: { op: 'lte', args: [{ op: 'days_until', args: [{ var: 'due' }, { var: 'now' }] }, 1] }, severity: 2, message: '제출 기한이 임박했습니다' },
  ] });
  return { pub, stranger, pack };
}

test('규칙팩: 서명·신뢰·유효기간 검증, 변조·미신뢰·만료는 쓰지 않는다', async () => {
  const { pub, stranger, pack } = await setup();
  assert.equal((await R.packValid(pack, [pub.pub], NOW)).ok, true);
  assert.equal((await R.packValid(pack, [stranger.pub], NOW)).code, 'UNTRUSTED_PUBLISHER');
  const tampered = JSON.parse(JSON.stringify(pack)); tampered.rules[0].blocking = false;
  assert.equal((await R.packValid(tampered, [pub.pub], NOW)).code, 'BAD_SIGNATURE');
  assert.equal((await R.packValid({ ...pack, sig: undefined }, [pub.pub], NOW)).code, 'NO_SIGNATURE');
  assert.equal((await R.packValid(pack, [pub.pub], '2025-12-31T00:00:00Z')).code, 'NOT_YET_EFFECTIVE');
  const exp = await R.signPack(pub, { ...pack, effective_to: '2026-06-01T00:00:00Z' });
  assert.equal((await R.packValid(exp, [pub.pub], NOW)).code, 'EXPIRED');
  const l = await R.loadPacks([pack, tampered, exp], [pub.pub], NOW);
  assert.deepEqual([l.packs.length, l.rejected.map(r => r.code)], [1, ['BAD_SIGNATURE', 'EXPIRED']]);
});

test('Gate: 통과 / 경고 / 차단 / 규칙 없음 / 미평가 → 높은 위험이면 인간 변호사 권유(차단 아님)', async () => {
  const { pub, pack } = await setup(), { packs } = await R.loadPacks([pack], [pub.pub], NOW);
  const act = { type: 'court_submit', effect: 'external', domain: 'law', affects_life_property: true };
  const ok = await R.gate(act, { attachments: 3, required_attachments: 3, due: '2026-11-20T00:00:00Z' }, packs, NOW);
  assert.deepEqual([ok.result, ok.evaluated_count], ['PASS', 2]);
  const warn = await R.gate(act, { attachments: 3, required_attachments: 3, due: '2026-11-02T00:00:00Z' }, packs, NOW);
  assert.equal(warn.result, 'WARN');
  const block = await R.gate(act, { attachments: 1, required_attachments: 3, due: '2026-11-20T00:00:00Z' }, packs, NOW);
  assert.equal(block.result, 'BLOCK'); assert.equal(block.violations[0].cite, '민사소송규칙');
  // 값이 없어 평가 못 함 + 위험 높음 → 권유
  const adv = await R.gate(act, { due: '2026-11-20T00:00:00Z' }, packs, NOW);
  assert.equal(adv.result, 'ADVISE_HUMAN'); assert.ok(adv.unevaluated.some(u => u.missing === 'attachments'));
  // 적용 규칙 자체가 없음(다른 행위 종류/도메인) + 위험 높음 → 권유, 낮음 → 점검 안 함을 정직하게
  assert.equal((await R.gate({ type: 'sign_lease', effect: 'signature', domain: 'law' }, {}, packs, NOW)).result, 'ADVISE_HUMAN');
  assert.equal((await R.gate({ type: 'note_save', effect: 'internal', domain: 'law' }, {}, packs, NOW)).result, 'PASS_UNCHECKED');
  assert.equal((await R.gate(act, {}, [], NOW)).result, 'ADVISE_HUMAN');                              // 팩이 하나도 없어도 막지 않고 권유
  // 낮은 위험 + 미평가는 경고
  assert.equal((await R.gate({ type: 'court_submit', effect: 'draft', domain: 'law' }, { due: '2026-11-20T00:00:00Z' }, packs, NOW)).result, 'WARN');
  // 결정론: 같은 입력이면 같은 결과
  assert.deepEqual(await R.gate(act, { attachments: 1, required_attachments: 3, due: '2026-11-20T00:00:00Z' }, packs, NOW), block);
});

test('Notice: 인간 전문가 권유 문안은 특정인을 추천하지 않고 검색 선택지만 준다', async () => {
  const { pub, pack } = await setup(), { packs } = await R.loadPacks([pack], [pub.pub], NOW);
  const g = await R.gate({ type: 'court_submit', effect: 'external', domain: 'law', affects_life_property: true }, {}, packs, NOW);
  const n = R.buildNotice(g, { domain: 'law' });
  assert.match(n.text, /인간 변호사의 조언을 구하시길 권합니다/);
  assert.match(n.text, /추천하지 않습니다/);
  assert.equal(n.recommends_person, false);
  assert.deepEqual(n.actions.map(a => a.id), ['search_naviweb', 'search_web', 'continue', 'hold']);
  assert.ok(n.actions.every(a => Object.keys(a).sort().join() === 'id,label'));                       // 개인 식별자 필드 없음
  assert.match(R.buildNotice({ ...g, domain: 'tax' }, {}).text, /세무사·회계사/);
  assert.match(R.buildNotice({ result: 'PASS', evaluated_count: 2, violations: [], unevaluated: [] }, {}).text, /보장하지 않습니다/);
});

test('원장·증명: 비서 판단이 해시체인에 남고, 입력은 해시만, 변조하면 탐지', async () => {
  const { pub, pack } = await setup(), { packs } = await R.loadPacks([pack], [pub.pub], NOW);
  const sent = [];
  const store = new CaseStore(MemoryAdapter(), { now: () => NOW, endpoint: 'e', who: 'w', fetch: async (u, i) => { sent.push(i.body); return { ok: true }; } });
  const ledger = A.Ledger(store);
  const act = { type: 'court_submit', effect: 'external', domain: 'law', affects_life_property: true, ref: 'doc-1' };
  const ctx = { attachments: 1, required_attachments: 3, due: '2026-11-20T00:00:00Z', secret: '비밀 당사자명' };
  const g = await R.gate(act, ctx, packs, NOW);
  await R.attest(ledger, act, ctx, g, null, NOW);
  await R.attest(ledger, act, { ...ctx, attachments: 3 }, await R.gate(act, { ...ctx, attachments: 3 }, packs, NOW), { choice: 'continue', reason: '확인함' }, NOW);
  const es = await ledger.entries();
  assert.equal(es.length, 2); assert.equal(es[0].actor, 'assistant'); assert.equal(es[0].payload.result, 'BLOCK');
  assert.equal(es[1].payload.user_decision, 'continue');
  assert.ok(!JSON.stringify(es).includes('비밀 당사자명'));                                            // 원문 없이 해시만
  assert.equal(es[0].payload.input_hash, await C.sha256Hex(C.canonical(ctx)));                        // 나중에 원문을 내면 대조 가능
  assert.equal((await ledger.verify()).ok, true);
  assert.deepEqual(await store.flushAnchors(), { sent: 2, failed: 0, pending: 0 });
  assert.ok(!sent.join('').includes('비밀') && !sent.join('').includes('court_submit'));
  const bad = JSON.parse(JSON.stringify(es)); bad[0].payload.result = 'PASS';
  assert.equal((await C.verifyChain(bad)).ok, false);
});

test('기한 Finding: 7일·1일·당일·초과', () => {
  assert.equal(R.deadlineFinding('x', '2026-11-20T00:00:00Z', NOW), null);
  assert.deepEqual([R.deadlineFinding('x', '2026-11-08T00:00:00Z', NOW).severity, R.deadlineFinding('x', '2026-11-02T00:00:00Z', NOW).severity], [2, 3]);
  assert.equal(R.deadlineFinding('x', '2026-10-30T00:00:00Z', NOW).status, 'overdue');
});
