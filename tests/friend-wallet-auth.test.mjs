/** tests/friend-wallet-auth.test.mjs — 문자 인증 쿠키 없이 기기 키 토큰(gopang_token)으로도 /friends/* 를 쓸 수 있는지. 실행: node tests/friend-wallet-auth.test.mjs */
import crypto from 'node:crypto';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const MASTER='master-key-for-test';
const b64u=(b)=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const gtok=(guid,svc='p2p-signal',exp=Math.floor(Date.now()/1000)+3600)=>{const p=b64u(JSON.stringify({ipv6:guid,level:'L0',svc,iat:1,exp}));return p+'.'+b64u(crypto.createHmac('sha256',MASTER).update(p).digest());};
const profiles=[
 {id:'r1',guid:'g-pinned',nickname:'김동',handle:'@98807170',pubkey_ed25519:'PK',phone_findable:true},
 {id:'r2',guid:'g-unpinned',nickname:'미고정',handle:'@11112222',pubkey_ed25519:''},
];
globalThis.fetch=async(url)=>{
  url=String(url);
  if(url.includes('auth-with-password')) return new Response(JSON.stringify({token:'adm'}),{status:200});
  const f=new URL(url).searchParams.get('filter')||''; const m=f.match(/^guid='([^']+)'$/);
  return new Response(JSON.stringify({items:m?profiles.filter(p=>p.guid===m[1]):[]}),{status:200});
};
const w=(await import(root+'/worker.js')).default;
const env={PHONE_VERIFY_SECRET:'s',GOPANG_MASTER_KEY:MASTER,L1_ADMIN_EMAIL:'a',L1_ADMIN_PASSWORD:'b'};
const call=async(path,body)=>{const r=await w.fetch(new Request('https://x.test'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){}});return {s:r.status,j:await r.json().catch(()=>null)};};
let bad=0; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)bad++;};
let r=await call('/friends/settings',{gopang_token:gtok('g-pinned'),action:'get'}); ok(r.s===200&&r.j.ok&&r.j.nickname==='김동','기기 키 토큰으로 설정 조회');
r=await call('/friends/settings',{gopang_token:gtok('g-unpinned'),action:'get'}); ok(r.s===401&&r.j.error==='KEY_NOT_PINNED','공개키 미고정 계정은 거부');
r=await call('/friends/settings',{gopang_token:gtok('g-pinned','other-svc'),action:'get'}); ok(r.s===401,'다른 용도 토큰은 거부');
r=await call('/friends/settings',{gopang_token:gtok('g-pinned','p2p-signal',1),action:'get'}); ok(r.s===401,'만료 토큰 거부');
r=await call('/friends/settings',{gopang_token:gtok('g-pinned')+'x',action:'get'}); ok(r.s===401,'서명 위조 거부');
r=await call('/friends/settings',{action:'get'}); ok(r.s===401,'증명 없으면 거부');
r=await call('/friends/invite-code',{gopang_token:gtok('g-pinned')}); ok(r.s===200&&r.j.ok&&r.j.code,'초대 코드도 기기 키 토큰으로');
process.exit(bad?1:0);
