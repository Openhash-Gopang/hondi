import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonical, payloadHash, verifySig, verifyBothSigned, validateFields,
  SALE_VERSION, SALE_NS, sha256Hex,
} from '../../src/gopang/ai/hondi-consent-sale.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return {
    publicKeyB64u: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)),
    sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))),
  };
}
async function makePayload(creditor, debtor, overrides = {}) {
  const description_hash = await sha256Hex(overrides.description ?? '방 2개, 화장실 1개');
  return {
    v: SALE_VERSION, ns: SALE_NS, region: '부산 영도구', property_type: '단독주택',
    price: 45_000_000, description_hash, creditor_pubkey: creditor.publicKeyB64u,
    debtor_pubkey: debtor.publicKeyB64u, ts: Date.now(), ...overrides,
  };
}

test('canonical()은 필드 순서가 고정돼 항상 동일한 문자열을 낸다', async () => {
  const c = await wallet(), d = await wallet();
  const p = await makePayload(c, d, { ts: 1000 });
  const s1 = canonical(p); const s2 = canonical({ ...p });
  assert.equal(s1, s2);
  assert.ok(s1.includes('region=부산 영도구'));
});

test('양측 서명이 각자의 pubkey로 유효하면 verifyBothSigned가 true', async () => {
  const creditor = await wallet(), debtor = await wallet();
  const p = await makePayload(creditor, debtor);
  const msg = canonical(p);
  const csig = await creditor.sign(msg);
  const dsig = await debtor.sign(msg);
  assert.ok(await verifySig(creditor.publicKeyB64u, msg, csig));
  assert.ok(await verifySig(debtor.publicKeyB64u, msg, dsig));
  assert.ok(await verifyBothSigned(p, csig, dsig));
});

test('한쪽 서명이 비어있거나 상대 키로 바꿔치기하면 verifyBothSigned가 false', async () => {
  const creditor = await wallet(), debtor = await wallet(), eve = await wallet();
  const p = await makePayload(creditor, debtor);
  const msg = canonical(p);
  const csig = await creditor.sign(msg);
  const dsig = await debtor.sign(msg);
  assert.equal(await verifyBothSigned(p, csig, ''), false);
  assert.equal(await verifyBothSigned(p, csig, await eve.sign(msg)), false); // eve 서명을 debtor 자리에 끼워넣기
  assert.ok(await verifyBothSigned(p, csig, dsig)); // 정상 조합은 여전히 통과(대조군)
});

test('payload 필드가 하나라도 바뀌면(가격 변조) 기존 서명이 무효화된다', async () => {
  const creditor = await wallet(), debtor = await wallet();
  const p = await makePayload(creditor, debtor, { price: 45_000_000 });
  const msg = canonical(p);
  const csig = await creditor.sign(msg);
  const dsig = await debtor.sign(msg);
  const tampered = { ...p, price: 4_500_000 }; // 0 하나 슬쩍 뺌
  assert.equal(await verifyBothSigned(tampered, csig, dsig), false);
});

test('payloadHash는 결정적이며 내용이 다르면 달라진다', async () => {
  const c = await wallet(), d = await wallet();
  const p1 = await makePayload(c, d, { ts: 1000 });
  const p2 = await makePayload(c, d, { ts: 1000 });
  const p3 = await makePayload(c, d, { ts: 1001 });
  assert.equal(await payloadHash(p1), await payloadHash(p2));
  assert.notEqual(await payloadHash(p1), await payloadHash(p3));
});

test('validateFields — 정상 입력은 통과, 잘못된 유형·가격·지역은 거부', () => {
  assert.equal(validateFields({ region: '부산 영도구', property_type: '단독주택', price: 1000, description: '' }), null);
  assert.ok(validateFields({ region: '가', property_type: '단독주택', price: 1000 })); // 너무 짧은 지역
  assert.ok(validateFields({ region: '부산', property_type: '경매장', price: 1000 })); // 정의되지 않은 유형
  assert.ok(validateFields({ region: '부산', property_type: '단독주택', price: 0 }));  // 가격 0
  assert.ok(validateFields({ region: '부산', property_type: '단독주택', price: -5 })); // 음수
  assert.ok(validateFields({ region: '부산', property_type: '단독주택', price: 1000, description: 'x'.repeat(2001) }));
});
