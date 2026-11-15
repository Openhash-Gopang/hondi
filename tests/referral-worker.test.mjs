/** tests/referral-worker.test.mjs — /friends/match·invite-code·ref-claim 을 모의 L1·KV 로 시험(네트워크 없음). 실행: node tests/referral-worker.test.mjs */
import crypto from 'node:crypto';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SECRET='sec';
const sign=(p)=>crypto.createHmac('sha256',SECRET).update(p).digest('hex');
const tok=(e)=>{const p=`${e}:${Date.now()+3600000}`;return p+'.'+sign(p);};
const h=(e)=>crypto.createHmac('sha256',SECRET).update('e164-lookup:'+e).digest('hex');
const now=new Date().toISOString().replace('T',' ');
const old=new Date(Date.now()-10*86400000).toISOString().replace('T',' ');
const profiles=[
 {id:'r1',guid:'g-inviter',nickname:'초대자',e164_hash:h('+821011110000'),phone_findable:false,created:old},
 {id:'r2',guid:'g-new',nickname:'새가입자',e164_hash:h('+821022220000'),phone_findable:false,created:now},
 {id:'r3',guid:'g-open',nickname:'열린사람',e164_hash:h('+821033330000'),phone_findable:true,created:old},
 {id:'r4',guid:'g-closed',nickname:'닫은사람',e164_hash:h('+821044440000'),phone_findable:false,created:old},
 {id:'r5',guid:'g-old',nickname:'옛가입자',e164_hash:h('+821055550000'),phone_findable:false,created:old},
];
const mints=[];
globalThis.fetch=async(url,opts={})=>{
  url=String(url);
  if(url.includes('auth-with-password')) return new Response(JSON.stringify({token:'adm'}),{status:200});
  if(url.includes('/api/mint')){mints.push(JSON.parse(opts.body));return new Response(JSON.stringify({ok:true,amount:1000,content_hash:'x'}),{status:200});}
  const f=new URL(url).searchParams.get('filter')||'';
  let m;
  if((m=f.match(/^guid='([^']+)'$/))) return new Response(JSON.stringify({items:profiles.filter(p=>p.guid===m[1])}),{status:200});
  const hs=[...f.matchAll(/e164_hash='([^']+)'/g)].map(x=>x[1]);
  if(hs.length){ const need=f.includes('phone_findable=true'); return new Response(JSON.stringify({items:profiles.filter(p=>hs.includes(p.e164_hash)&&(!need||p.phone_findable))}),{status:200}); }
  return new Response(JSON.stringify({items:[]}),{status:200});
};
const store=new Map(); const kv={get:async k=>store.get(k)??null,put:async(k,v)=>{store.set(k,String(v));}};
const mod=await import(root+'/worker.js'); const w=mod.default;
const env={PHONE_VERIFY_SECRET:SECRET,L1_ADMIN_EMAIL:'a',L1_ADMIN_PASSWORD:'b',AI_SETUP_SEALS_KV:kv};
const call=async(path,body)=>{const r=await w.fetch(new Request('https://x.test'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){}});return {s:r.status,j:await r.json().catch(()=>null)};};
let bad=0; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)bad++;};
const INV=tok('+821011110000'), NEW=tok('+821022220000'), OLD=tok('+821055550000');
// 연락처 일치
let r=await call('/friends/match',{phone_verify_token:INV,numbers:['010-3333-0000','010-4444-0000','010-9999-0000','010-3333-0000']});
ok(r.s===200&&r.j.matches.length===1&&r.j.matches[0].e164==='+821033330000'&&r.j.matches[0].user.guid==='g-open','허용한 가입자만 일치(닫은 사람·비가입자는 구분 안 됨)');
ok(r.j.checked===3,'중복 번호 제거');
ok(!JSON.stringify(r.j).includes('e164_hash'),'응답에 해시 없음');
r=await call('/friends/match',{phone_verify_token:INV,numbers:[]}); ok(r.j.ok&&r.j.matches.length===0,'빈 목록');
r=await call('/friends/match',{phone_verify_token:'bad.sig',numbers:['01033330000']}); ok(r.s===401||r.s===400,'토큰 무효 거부');
// 초대 코드
r=await call('/friends/invite-code',{phone_verify_token:INV}); const code=r.j.code;
ok(r.j.ok&&/^[0-9a-f]{10}$/.test(code)&&r.j.link.endsWith('?ref='+code)&&r.j.text.includes(r.j.link)&&r.j.reward_gdc===1000,'초대 코드·문구');
ok(!code.includes('inviter'),'코드에 guid 노출 없음');
// 청구
r=await call('/friends/ref-claim',{phone_verify_token:INV,code}); ok(r.j.status==='self'&&mints.length===0,'본인 추천 불가');
r=await call('/friends/ref-claim',{phone_verify_token:NEW,code:'0000000000'}); ok(r.j.status==='invalid','모르는 코드');
r=await call('/friends/ref-claim',{phone_verify_token:OLD,code}); ok(r.j.status==='expired'&&mints.length===0,'오래된 계정은 보상 없음');
r=await call('/friends/ref-claim',{phone_verify_token:NEW,code}); ok(r.j.status==='granted'&&mints.length===1&&mints[0].guid==='g-inviter'&&mints[0].krw_amount===1000&&/referral_reward/.test(mints[0].memo),'신규 가입자 청구 → 추천인에게 1,000 지급');
r=await call('/friends/ref-claim',{phone_verify_token:NEW,code}); ok(r.j.status==='already'&&mints.length===1,'같은 가입자 중복 청구 불가');
// 추천인당 상한
store.set('hondi:ref_count:g-inviter','30');
profiles.push({id:'r6',guid:'g-new2',nickname:'둘째',e164_hash:h('+821066660000'),phone_findable:false,created:now});
r=await call('/friends/ref-claim',{phone_verify_token:tok('+821066660000'),code}); ok(r.j.status==='capped'&&mints.length===1,'추천인당 30명 상한');
process.exit(bad?1:0);
