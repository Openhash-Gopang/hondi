/** tests/friend-find-worker.test.mjs — /friends/find·/friends/settings 를 모의 L1 로 시험(네트워크 없음). 실행: node tests/friend-find-worker.test.mjs */
import crypto from 'node:crypto';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SECRET='sec';
const sign=(p)=>crypto.createHmac('sha256',SECRET).update(p).digest('hex');
const tok=(id)=>{const p=`${id}:${Date.now()+3600000}`;return p+'.'+sign(p);};
// 모의 L1
const profiles=[
 {id:'r1',guid:'g-ceo',handle:'tid-ceo',nickname:'주피터',e164:'',search_id:'',phone_findable:false},
 {id:'r2',guid:'g-hong',handle:'@11112222',nickname:'홍길동',e164:'',e164_hash:'H-hong',search_id:'gildong',phone_findable:true},
 {id:'r3',guid:'g-kim',handle:'@33334444',nickname:'김철수',e164:'',e164_hash:'H-kim',search_id:'',phone_findable:false},
];
const patches=[];
globalThis.fetch=async(url,opts={})=>{
  url=String(url);
  if(url.includes('auth-with-password')) return new Response(JSON.stringify({token:'adm'}),{status:200});
  const u=new URL(url); const f=u.searchParams.get('filter')||'';
  if(opts.method==='PATCH'){const id=url.split('/records/')[1];const p=profiles.find(x=>x.id===id);const b=JSON.parse(opts.body);patches.push(b);Object.assign(p,b);return new Response(JSON.stringify(p),{status:200});}
  let items=profiles.filter(p=>{
    let m;
    if((m=f.match(/^handle='([^']+)'$/))) return p.handle===m[1];
    if((m=f.match(/^guid='([^']+)'$/))) return p.guid===m[1];
    if(f.includes('phone_findable=true')){ const hm=f.match(/e164_hash='([^']+)'/); return p.phone_findable&&hm&&p.e164_hash===hm[1]; }
    return false;});
  return new Response(JSON.stringify({items}),{status:200});
};
const mod=await import(root+'/worker.js'); const w=mod.default;
const env={PHONE_VERIFY_SECRET:SECRET,SIMPLE_AUTH_TEST:'1',L1_ADMIN_EMAIL:'a',L1_ADMIN_PASSWORD:'b'};
const call=async(path,body)=>{const r=await w.fetch(new Request('https://x.test'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){}});return {s:r.status,j:await r.json().catch(()=>null)};};
let bad=0; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)bad++;};
const T=tok('tid-ceo');
let r=await call('/friends/find',{phone_verify_token:T,q:'@11112222'}); ok(r.s===200&&r.j.found&&r.j.user.guid==='g-hong','혼디 아이디(@8자리)로 찾기');
ok(!('e164' in r.j.user)&&!('e164_hash' in r.j.user),'결과에 번호 필드 없음');
r=await call('/friends/find',{phone_verify_token:T,q:'11112222'}); ok(r.j.found,'@ 없이도');
r=await call('/friends/find',{phone_verify_token:T,q:'99999999'}); ok(r.s===200&&r.j.found===false,'없는 아이디');
r=await call('/friends/find',{phone_verify_token:T,q:'gildong'}); ok(r.j.found===false,'직접 정한 문자열 아이디는 더 이상 검색 대상이 아님');
r=await call('/friends/find',{phone_verify_token:T,q:'ceo'}); ok(r.j.self===true,'테스트 아이디(ceo): 본인은 self');
r=await call('/friends/find',{phone_verify_token:'bad.sig',q:'x'}); ok(r.s===401||r.s===400,'토큰 무효 거부 '+r.s);
r=await call('/friends/find',{phone_verify_token:T,q:'  '}); ok(r.s===400,'빈 입력 400');
// 번호: 해시는 모의에서 직접 계산해 맞춘다
const h=async(e)=>crypto.createHmac('sha256',SECRET).update('e164-lookup:'+e).digest('hex');
profiles[1].e164_hash=await h('+821011112222'); profiles[2].e164_hash=await h('+821033334444');
r=await call('/friends/find',{phone_verify_token:T,q:'010-1111-2222'}); ok(r.j.found&&r.j.user.guid==='g-hong','번호(허용) 찾기');
r=await call('/friends/find',{phone_verify_token:T,q:'010-3333-4444'}); ok(r.j.found===false,'번호(허용 안 함)는 못 찾음');
// 설정
const U=tok('tid-ceo');
r=await call('/friends/settings',{phone_verify_token:U,action:'get'}); ok(r.j.ok&&r.j.handle==='tid-ceo'&&r.j.test_account,'설정 조회: 혼디 아이디는 서버 값');
r=await call('/friends/settings',{phone_verify_token:U,action:'set',search_id:'gildong'}); ok(r.s===400,'아이디를 직접 정하는 요청은 거부');
r=await call('/friends/settings',{phone_verify_token:U,action:'set',phone_findable:true}); ok(r.j.phone_findable===true&&r.j.handle==='tid-ceo','번호 허용만 저장, 아이디 불변');
r=await call('/auth/session-profile',{phone_verify_token:tok('tid-ceo')}); ok(r.s===200&&r.j.guid==='g-ceo'&&r.j.nickname==='주피터'&&r.j.test_account===true,'세션 프로필: 토큰 → 계정');
ok(!('e164' in r.j)&&!('e164_hash' in r.j),'세션 프로필에 번호 필드 없음');
r=await call('/auth/session-profile',{phone_verify_token:'bad.sig'}); ok(r.s===401||r.s===400,'세션 프로필: 무효 토큰 거부');
process.exit(bad?1:0);
