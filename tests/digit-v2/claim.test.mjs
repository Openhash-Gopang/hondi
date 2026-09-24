import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeClaim, makeTransfer, makeRevoke, applyRecord, verifyChain, classifySerial, checkClaimPolicy,
  canonical, recordHash, GENESIS_PREV,
} from '../../src/gopang/ai/hondi-digit-claim.js';

// gopangWallet과 같은 인터페이스({publicKeyB64u, sign})를 흉내 낸 테스트 지갑
const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return {
    publicKeyB64u: b64u(raw),
    sign: async msg => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(msg))),
  };
}

test('최초 청구 → 소유자 확정, 체인 검증 통과', async () => {
  const a = await wallet();
  const c = await makeClaim(a, '48210');
  const r = await applyRecord(null, c);
  assert.ok(r.ok, r.message);
  assert.equal(r.state.owner, a.publicKeyB64u);
  assert.deepEqual((await verifyChain([c])).state.owner, a.publicKeyB64u);
});

test('같은 번호의 두 번째 청구는 거절(선점자 우선)', async () => {
  const a = await wallet(), b = await wallet();
  const first = await applyRecord(null, await makeClaim(a, '77031'));
  const second = await applyRecord(first.state, await makeClaim(b, '77031'));
  assert.equal(second.ok, false);
  assert.equal(second.code, 'ALREADY_CLAIMED');
});

test('서명 위조/내용 변조 거절', async () => {
  const a = await wallet(), m = await wallet();
  const c = await makeClaim(a, '90210');
  const tampered = { ...c, owner: m.publicKeyB64u };           // 소유자만 바꿔치기
  assert.equal((await applyRecord(null, tampered)).code, 'BAD_SIG');
  const forged = { ...c, serial: '90211' };                    // 번호 변조
  assert.equal((await applyRecord(null, forged)).code, 'BAD_SIG');
  const rehashed = { ...c, hash: 'ab'.repeat(32) };
  assert.equal((await applyRecord(null, rehashed)).code, 'BAD_HASH');
});

test('양도: 현재 소유자만 가능, 이후 새 소유자만 다음 레코드 서명', async () => {
  const a = await wallet(), b = await wallet(), x = await wallet();
  const c = await makeClaim(a, '31415');
  let st = (await applyRecord(null, c)).state;
  // 제3자 X가 양도 시도 (자신이 owner인 척)
  const evil = await makeTransfer(x, st, x.publicKeyB64u);
  assert.equal((await applyRecord(st, evil)).code, 'NOT_OWNER');
  // 정상 양도 A→B
  const t = await makeTransfer(a, st, b.publicKeyB64u);
  st = (await applyRecord(st, t)).state;
  assert.equal(st.owner, b.publicKeyB64u);
  // 이제 A는 더 이상 권한 없음
  const stale = await makeTransfer(a, st, a.publicKeyB64u);
  assert.equal((await applyRecord(st, stale)).code, 'NOT_OWNER');
  // B는 가능
  const t2 = await makeTransfer(b, st, x.publicKeyB64u);
  assert.ok((await applyRecord(st, t2)).ok);
});

test('재전송(replay)·분기(fork) 거절: prev/seq 불일치', async () => {
  const a = await wallet(), b = await wallet(), d = await wallet();
  const c = await makeClaim(a, '25252');
  let st = (await applyRecord(null, c)).state;
  const t1 = await makeTransfer(a, st, b.publicKeyB64u);
  const t1fork = await makeTransfer(a, st, d.publicKeyB64u, t1.ts + 1);   // 같은 head에서 갈라진 다른 양도
  const st2 = (await applyRecord(st, t1)).state;
  assert.equal((await applyRecord(st2, t1)).code, 'SEQ');                  // 같은 레코드 재전송: seq가 이미 소진됨
  assert.ok(['SEQ', 'PREV', 'NOT_OWNER'].includes((await applyRecord(st2, t1fork)).code));
});

test('폐기(revoke)된 번호는 재청구·양도 모두 불가 — 옛 스티커 재사용 방지', async () => {
  const a = await wallet(), b = await wallet();
  const c = await makeClaim(a, '60606');
  let st = (await applyRecord(null, c)).state;
  const rv = await makeRevoke(a, st);
  st = (await applyRecord(st, rv)).state;
  assert.equal(st.revoked, true);
  assert.equal((await applyRecord(st, await makeClaim(b, '60606'))).code, 'ALREADY_CLAIMED');
  assert.equal((await applyRecord(st, await makeTransfer(a, st, b.publicKeyB64u))).code, 'REVOKED');
});

test('verifyChain: 서버 없이 체인 전체 재생, 중간 변조 탐지', async () => {
  const a = await wallet(), b = await wallet();
  const c = await makeClaim(a, '11235');
  const s0 = (await applyRecord(null, c)).state;
  const t = await makeTransfer(a, s0, b.publicKeyB64u);
  const good = await verifyChain([c, t]);
  assert.ok(good.ok); assert.equal(good.state.owner, b.publicKeyB64u);
  const broken = await verifyChain([c, { ...t, to: a.publicKeyB64u }]);
  assert.equal(broken.ok, false); assert.equal(broken.index, 1);
});

test('시각 왜곡: 너무 오래된/미래 청구 거절(서버 수용 시)', async () => {
  const a = await wallet();
  const old = await makeClaim(a, '55501', Date.now() - 3600_000);
  assert.equal((await applyRecord(null, old)).code, 'TS_SKEW');
});

test('번호 형식: 0으로 시작/11자리/문자 거절', async () => {
  const a = await wallet();
  for (const s of ['0123', '12345678901', '12a4', '']) {
    await assert.rejects(() => makeClaim(a, s));
  }
});

test('정책 분류: 5자리 미만·반복·수열·회문·공공번호', () => {
  assert.equal(classifySerial('1004').tier, 'reserved-short');
  assert.equal(classifySerial('112').tier, 'public-safety');
  assert.equal(classifySerial('1330').tier, 'public-safety');
  assert.equal(classifySerial('77777').tier, 'reserved-premium');
  assert.equal(classifySerial('12345').tier, 'reserved-premium');
  assert.equal(classifySerial('54321').tier, 'reserved-premium');
  assert.equal(classifySerial('12321').tier, 'reserved-premium');
  assert.equal(classifySerial('50000').tier, 'reserved-premium');
  assert.equal(classifySerial('48210').tier, 'open');
  assert.equal(classifySerial('58820', { premiumList: new Set(['58820']) }).tier, 'reserved-premium');
});

test('정책: 예약 번호는 운영 권한 grant 서명이 있어야 청구 가능, 공공번호는 grant 있어도 불가', async () => {
  const user = await wallet(), other = await wallet(), authority = await wallet();
  const rec = await makeClaim(user, '1004');
  assert.equal((await checkClaimPolicy(rec)).code, 'RESERVED');
  const grantSig = await authority.sign(`hondi-digit-grant\n1004\n${user.publicKeyB64u}`);
  const grant = { serial: '1004', owner: user.publicKeyB64u, sig: grantSig };
  assert.ok((await checkClaimPolicy(rec, { grant, authorityPubKey: authority.publicKeyB64u })).ok);
  // 다른 사람이 그 grant를 가로채 써도 owner가 달라 거절
  const stolen = await makeClaim(other, '1004');
  assert.equal((await checkClaimPolicy(stolen, { grant, authorityPubKey: authority.publicKeyB64u })).code, 'RESERVED');
  // 공공번호
  const c112 = await makeClaim(user, '112');
  const g112 = { serial: '112', owner: user.publicKeyB64u, sig: await authority.sign(`hondi-digit-grant\n112\n${user.publicKeyB64u}`) };
  assert.equal((await checkClaimPolicy(c112, { grant: g112, authorityPubKey: authority.publicKeyB64u })).code, 'PUBLIC_SAFETY');
  // open 번호는 grant 불필요
  assert.ok((await checkClaimPolicy(await makeClaim(user, '48210'))).ok);
});

test('canonical 형식이 고정되어 있음(필드 순서 변경 시 서명 호환 깨짐 방지)', async () => {
  const a = await wallet();
  const c = await makeClaim(a, '48210', 1700000000000);
  const lines = canonical(c).split('\n');
  assert.deepEqual(lines.map(l => l.split('=')[0]), ['v', 'ns', 'type', 'serial', 'seq', 'prev', 'owner', 'to', 'ts']);
  assert.equal(c.prev, GENESIS_PREV);
  assert.equal(c.hash, await recordHash(c));
});
