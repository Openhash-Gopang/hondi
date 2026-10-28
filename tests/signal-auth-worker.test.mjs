/** tests/signal-auth-worker.test.mjs — /signal/* 가 로그인 증명을 요구하고 from_guid 를 강제하는지, 모의 L1 로 시험(네트워크 없음). 실행: node tests/signal-auth-worker.test.mjs */
import crypto from 'node:crypto';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SECRET = 'sec';
const hmacHex = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('hex');
const pvt = (id) => { const p = `${id}:${Date.now() + 3600000}`; return p + '.' + hmacHex(p); };
const b64u = (buf) => Buffer.from(buf).toString('base64url');
// Ed25519 키(홍길동은 공개키가 고정된 계정, 김철수는 고정 전, 공격자는 자기 키)
const mk = async () => { const k = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']); return { priv: k.privateKey, pub: b64u(await crypto.subtle.exportKey('raw', k.publicKey)) }; };
const hongKey = await mk(), evilKey = await mk();
const sign = async (key, msg) => b64u(await crypto.subtle.sign('Ed25519', key.priv, new TextEncoder().encode(msg)));

const profiles = [
  { id: 'p1', guid: 'g-ceo', handle: 'tid-ceo', nickname: '주피터' },
  { id: 'p2', guid: 'g-hong', handle: '@11112222', nickname: '홍길동', pubkey_ed25519: hongKey.pub },
  { id: 'p3', guid: 'g-kim', handle: '@33334444', nickname: '김철수', pubkey_ed25519: '' },
];
let signals = [], seq = 0;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const u = new URL(url); const f = u.searchParams.get('filter') || ''; const method = opts.method || 'GET';
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  if (url.includes('auth-with-password')) return J({ token: 'adm' });
  if (url.includes('/collections/profiles/')) {
    let m; const items = profiles.filter(p => ((m = f.match(/^handle='([^']+)'$/)) && p.handle === m[1]) || ((m = f.match(/^guid='([^']+)'$/)) && p.guid === m[1]));
    return J({ items });
  }
  if (url.includes('/collections/webrtc_signals/records')) {
    const idm = u.pathname.match(/records\/([^/]+)$/);
    if (method === 'POST') { const r = { id: 's' + (++seq), ...JSON.parse(opts.body) }; signals.push(r); return J(r); }
    if (idm) {
      const r = signals.find(x => x.id === idm[1]);
      if (method === 'DELETE') { signals = signals.filter(x => x.id !== idm[1]); return new Response(null, { status: 204 }); }
      return r ? J(r) : J({}, 404);
    }
    let m; const items = signals.filter(r => ((m = f.match(/^to_guid='([^']+)'$/)) && r.to_guid === m[1]) || ((m = f.match(/^from_guid='([^']+)'$/)) && r.from_guid === m[1]));
    return J({ items });
  }
  return J({ items: [] });
};
const w = (await import(root + '/worker.js')).default;
const env = { PHONE_VERIFY_SECRET: SECRET, SIMPLE_AUTH_TEST: '1', GOPANG_MASTER_KEY: 'master-key-for-signal-test-1234567890', L1_ADMIN_EMAIL: 'a', L1_ADMIN_PASSWORD: 'b' };
const call = async (path, body, method = 'POST') => {
  const r = await w.fetch(new Request('https://x.test' + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return { s: r.status, j: await r.json().catch(() => null) };
};
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };
const issue = async (key, guid, svc = 'p2p-signal') => { const ts = Date.now(); return call('/auth/issue', { guid, pubkey: key.pub, signature: await sign(key, `auth-issue:${guid}:${key.pub}:${svc}:${ts}`), ts, level: 'L0', svc }); };
const offer = { sdp: 'v=0...' };

// 1) 본인 증명으로 보내기
let r = await call('/signal/send', { from_guid: 'g-ceo', to_guid: 'g-hong', type: 'offer', payload: offer, phone_verify_token: pvt('tid-ceo') });
ok(r.s === 200 && signals.length === 1 && signals[0].from_guid === 'g-ceo', '로그인 증명으로 보내면 저장된다');
// 2) 남의 guid 로 위조
r = await call('/signal/send', { from_guid: 'g-hong', to_guid: 'g-kim', type: 'offer', payload: offer, phone_verify_token: pvt('tid-ceo') });
ok(r.s === 403 && r.j.error === 'FROM_MISMATCH' && signals.length === 1, '남의 guid 를 적으면 거부(FROM_MISMATCH), 저장 안 됨');
// 3) 증명 없음
r = await call('/signal/send', { from_guid: 'g-hong', to_guid: 'g-kim', type: 'offer', payload: offer });
ok(r.s === 401 && r.j.error === 'AUTH_REQUIRED' && signals.length === 1, '증명이 없으면 거부(AUTH_REQUIRED)');
// 4) 위조된 토큰
r = await call('/signal/send', { from_guid: 'g-ceo', to_guid: 'g-kim', type: 'offer', payload: offer, phone_verify_token: 'tid-ceo:' + (Date.now() + 99999) + '.deadbeef' });
ok(r.s === 401, '서명이 틀린 토큰은 거부');
// 5) 형식
r = await call('/signal/send', { from_guid: 'g-ceo', to_guid: 'g-kim', type: 'hack', payload: offer, phone_verify_token: pvt('tid-ceo') }); ok(r.s === 400, '허용되지 않은 type 은 400');
r = await call('/signal/send', { from_guid: 'g-ceo', to_guid: "g'-kim", type: 'offer', payload: offer, phone_verify_token: pvt('tid-ceo') }); ok(r.s === 400, '이상한 guid 는 400');
r = await call('/signal/send', { from_guid: 'g-ceo', to_guid: 'g-kim', type: 'offer', payload: { sdp: 'x'.repeat(70000) }, phone_verify_token: pvt('tid-ceo') }); ok(r.s === 413, '너무 큰 신호는 413');
// 6) 지갑 서명 토큰(공개키 고정 계정)
let t = await issue(hongKey, 'g-hong'); ok(t.s === 200 && !!t.j.token, '홍길동 지갑 서명으로 p2p-signal 토큰 발급');
r = await call('/signal/send', { from_guid: 'g-hong', to_guid: 'g-ceo', type: 'answer', payload: offer, gopang_token: t.j.token });
ok(r.s === 200 && signals.some(x => x.from_guid === 'g-hong' && x.type === 'answer'), '지갑 토큰으로 본인 신호 보내기');
r = await call('/signal/send', { from_guid: 'g-ceo', to_guid: 'g-kim', type: 'offer', payload: offer, gopang_token: t.j.token });
ok(r.s === 403, '지갑 토큰으로 남의 guid 를 적으면 거부');
// 7) 공개키가 고정되지 않은 계정을 공격자 키로 사칭(/auth/issue 는 통과시키지만 신호에서는 막는다)
t = await issue(evilKey, 'g-kim'); ok(t.s === 200, '(전제) 공개키 미고정 계정은 /auth/issue 가 아무 키로나 발급');
r = await call('/signal/send', { from_guid: 'g-kim', to_guid: 'g-hong', type: 'offer', payload: offer, gopang_token: t.j.token });
ok(r.s === 403 && r.j.error === 'KEY_NOT_PINNED', '공개키 미고정 계정의 지갑 토큰은 신호에 쓸 수 없다');
// 8) 고정된 계정을 공격자 키로 발급 시도
t = await issue(evilKey, 'g-hong'); ok(t.s === 403, '고정된 계정은 다른 키로 토큰을 발급받을 수 없다(PUBKEY_MISMATCH)');
// 9) 다른 용도 토큰
t = await issue(hongKey, 'g-hong', 'other-svc');
r = await call('/signal/send', { from_guid: 'g-hong', to_guid: 'g-ceo', type: 'ice', payload: offer, gopang_token: t.j.token }); ok(r.s === 401, '다른 용도(svc) 토큰은 거부');
// 10) 조회: 본인 것만, 예전 GET 은 닫힘
r = await call('/signal/poll', { phone_verify_token: pvt('tid-ceo') });
ok(r.s === 200 && r.j.signals.length === 1 && r.j.signals.every(x => x.to_guid === 'g-ceo'), '조회는 내 앞으로 온 신호만');
r = await call('/signal/poll?guid=g-hong', null, 'GET'); ok(r.s === 405, '예전 GET ?guid= 조회는 닫힘');
r = await call('/signal/poll', {}); ok(r.s === 401, '증명 없는 조회는 거부');
// 11) 삭제: 받는 사람·보낸 사람만
signals.push({ id: 'x1', from_guid: 'g-hong', to_guid: 'g-kim', type: 'offer', payload: {} });
r = await call('/signal/delete', { id: 'x1', phone_verify_token: pvt('tid-ceo') }); ok(r.s === 403 && signals.some(x => x.id === 'x1'), '남들 사이의 신호는 지울 수 없다');
const mine = signals.find(x => x.to_guid === 'g-ceo');
r = await call('/signal/delete', { id: mine.id, phone_verify_token: pvt('tid-ceo') }); ok(r.s === 200 && !signals.some(x => x.id === mine.id), '내 앞으로 온 신호는 지울 수 있다');
r = await call('/signal/delete', { id: 'x1' }); ok(r.s === 401 && signals.some(x => x.id === 'x1'), '증명 없는 삭제는 거부');
signals.push({ id: 'x2', from_guid: 'g-ceo', to_guid: 'g-kim', type: 'ice', payload: {} }, { id: 'x3', from_guid: 'g-hong', to_guid: 'g-kim', type: 'ice', payload: {} });
r = await call('/signal/delete', { mine: true, phone_verify_token: pvt('tid-ceo') }); ok(r.s === 200 && !signals.some(x => x.id === 'x2') && signals.some(x => x.id === 'x3'), '내가 보낸 신호만 일괄 삭제');
process.exit(bad ? 1 : 0);
