/** tests/friend-find-worker.test.mjs — /friends/find·/friends/settings 를 모의 L1 로 시험(네트워크 없음). 실행: node tests/friend-find-worker.test.mjs */
import crypto from 'node:crypto';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SECRET='sec';
const sign=(p)=>crypto.createHmac('sha256',SECRET).update(p).digest('hex');
const tok=(id)=>{const p=`${id}:${Date.now()+3600000}`;return p+'.'+sign(p);};
// 모의 L1 — 토큰의 전화번호는 e164_hash 로 조회된다(profilePhoneFilter)
const h=async(e)=>crypto.createHmac('sha256',SECRET).update('e164-lookup:'+e).digest('hex');
const profiles=[
 {id:'r1',guid:'g-me',handle:'@00000000',nickname:'나',e164_hash:await h('+821000000000'),phone_findable:false},
 {id:'r2',guid:'g-hong',handle:'@11112222',nickname:'홍길동',e164_hash:await h('+821011112222'),phone_findable:true,name_findable:true},
 {id:'r3',guid:'g-kim',handle:'@33334444',nickname:'김철수',e164_hash:await h('+821033334444'),phone_findable:false,name_findable:false},
 {id:'r4',guid:'g-hong2',handle:'@55556666',nickname:'홍길동',e164_hash:await h('+821055556666'),phone_findable:false,name_findable:true},
 {id:'r5',guid:'g-lee',handle:'@77778888',nickname:'이영희',e164_hash:await h('+821077778888'),phone_findable:false,name_findable:true,mail_hidden:true},
 {id:'r6',guid:'g-park',handle:'@55556666',nickname:'박민수',e164_hash:'deadbeef'.repeat(8),e164_last8:'10556666'.slice(0,8),country_code:'KR',phone_findable:true,name_findable:false},
 {id:'r7',guid:'g-us',handle:'@US-88887777',nickname:'Sam',e164_hash:'aa'.repeat(32),e164_last8:'88887777',country_code:'US',phone_findable:true,name_findable:false},
 {id:'r8',guid:'g-kr',handle:'@88887777',nickname:'최민',e164_hash:'bb'.repeat(32),e164_last8:'88887777',country_code:'KR',phone_findable:true,name_findable:false},
 {id:'r9',guid:'g-cn',handle:'@CN-88887777',nickname:'Li',e164_hash:'cc'.repeat(32),e164_last8:'88887777',country_code:'CN',phone_findable:false,name_findable:false},
];
const mailIds=[{id:'m4',mail_id:'lee-y',owner_user_guid:'g-lee'},{id:'m1',mail_id:'gildong',owner_user_guid:'g-hong'},{id:'m2',mail_id:'me-id',owner_user_guid:'g-me'},{id:'m3',mail_id:'kim-cs',owner_user_guid:'g-kim'}];
const patches=[];
globalThis.fetch=async(url,opts={})=>{
  url=String(url);
  if(url.includes('auth-with-password')) return new Response(JSON.stringify({token:'adm'}),{status:200});
  const u=new URL(url); const f=u.searchParams.get('filter')||'';
  if(opts.method==='PATCH'){const id=url.split('/records/')[1];const p=profiles.find(x=>x.id===id);const b=JSON.parse(opts.body);patches.push(b);Object.assign(p,b);return new Response(JSON.stringify(p),{status:200});}
  if(url.includes('/kmail_user_settings/')){const m=f.match(/mail_id='([^']+)'/), g=f.match(/owner_user_guid='([^']+)'/);return new Response(JSON.stringify({items:mailIds.filter(x=>(m&&x.mail_id===m[1])||(g&&x.owner_user_guid===g[1]))}),{status:200});}
  let items=profiles.filter(p=>{
    let m;
    if((m=f.match(/^guid='([^']+)'$/))) return p.guid===m[1];
    if((m=f.match(/^nickname='([^']+)' && name_findable=true$/))) return p.nickname===m[1]&&p.name_findable===true;
    if((m=f.match(/^\(e164_last8='(\d{8})' \|\| e164~'\d{8}'\) && phone_findable=true$/))) return p.e164_last8===m[1]&&p.phone_findable===true;
    const lm=f.match(/e164_last8='(\d{8})' && country_code='KR'/);
    const hm=f.match(/e164_hash='([^']+)'/);
    const hit=(hm&&p.e164_hash===hm[1])||(lm&&p.e164_last8===lm[1]&&p.country_code==='KR');
    if(!hit) return false;
    return f.includes('phone_findable=true')?p.phone_findable:true;});
  return new Response(JSON.stringify({items}),{status:200});
};
const mod=await import(root+'/worker.js'); const w=mod.default;
const env={PHONE_VERIFY_SECRET:SECRET,L1_ADMIN_EMAIL:'a',L1_ADMIN_PASSWORD:'b'};
const call=async(path,body)=>{const r=await w.fetch(new Request('https://x.test'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){}});return {s:r.status,j:await r.json().catch(()=>null)};};
let bad=0; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)bad++;};
const T=tok('+821000000000');
let r=await call('/friends/find',{phone_verify_token:T,q:'gildong'}); ok(r.s===200&&r.j.found&&r.j.user.guid==='g-hong'&&r.j.user.mail_id==='gildong','이메일 ID로 찾기');
ok(!('e164' in r.j.user)&&!('e164_hash' in r.j.user),'결과에 번호 필드 없음');
r=await call('/friends/find',{phone_verify_token:T,q:'Gildong@naviweb.kr'}); ok(r.j.found,'대소문자·도메인 붙여도 찾음');
r=await call('/friends/find',{phone_verify_token:T,q:'nobody-x'}); ok(r.s===200&&r.j.found===false,'없는 아이디');
r=await call('/friends/find',{phone_verify_token:T,q:'@11112222'}); ok(r.j.found===false,'@8자리: 번호 찾기를 허용 안 한 사람은 못 찾음');
r=await call('/friends/find',{phone_verify_token:T,q:'홍길동'}); ok(r.j.found&&r.j.users&&r.j.users.length===2,'같은 이름이 둘이면 목록으로');
r=await call('/friends/find',{phone_verify_token:T,q:'김철수'}); ok(r.j.found===false,'이름 허용 안 한 사람은 이름으로 못 찾음');
r=await call('/friends/find',{phone_verify_token:T,q:'이영희'}); ok(r.j.found&&!r.j.users&&r.j.user.guid==='g-lee','이름 하나면 단일 결과(자동 호출 대상)');
r=await call('/friends/find',{phone_verify_token:T,q:'lee-y'}); ok(r.j.found===false,'이메일 ID 차단(mail_hidden)한 사람은 아이디로 못 찾음');
r=await call('/friends/find',{phone_verify_token:T,q:'12345678'}); ok(r.j.found===false&&!r.j.invalid,'없는 뒤 8자리는 없음');
r=await call('/friends/find',{phone_verify_token:T,q:'8888-7777'}); ok(r.j.found&&r.j.users&&r.j.users.length===2&&r.j.users.every(u=>['g-us','g-kr'].includes(u.guid)),'뒤 8자리가 같으면 국가 무관 목록(허용한 사람만)');
r=await call('/friends/find',{phone_verify_token:T,q:'@10556666'}); ok(r.j.found&&r.j.user.guid==='g-park'&&!r.j.users,'뒤 8자리 하나면 단일 결과');
r=await call('/friends/find',{phone_verify_token:T,q:'me-id'}); ok(r.j.self===true,'내 아이디는 self');
r=await call('/friends/find',{phone_verify_token:'bad.sig',q:'x'}); ok(r.s===401||r.s===400,'토큰 무효 거부 '+r.s);
r=await call('/friends/find',{phone_verify_token:T,q:'  '}); ok(r.s===400,'빈 입력 400');
r=await call('/friends/find',{phone_verify_token:T,q:'010-1111-2222'}); ok(r.j.found&&r.j.user.guid==='g-hong','번호(허용) 찾기');
r=await call('/friends/find',{phone_verify_token:T,q:'010-3333-4444'}); ok(r.j.found===false,'번호(허용 안 함)는 못 찾음');
r=await call('/friends/find',{phone_verify_token:T,q:'010-1055-6666'}); ok(r.j.found&&r.j.user.guid==='g-park','해시가 어긋나도 한국 010 번호는 뒤 8자리로 찾음');
r=await call('/friends/find',{phone_verify_token:T,q:'+1 415 555 6666'}); ok(r.j.found===false,'외국 번호에는 뒤 8자리 보조를 쓰지 않음');
r=await call('/friends/find',{phone_verify_token:T,q:'kim-cs'}); ok(r.j.found&&r.j.user.guid==='g-kim','번호 허용을 꺼도 아이디로는 찾음');
// 설정
r=await call('/friends/settings',{phone_verify_token:T,action:'get'}); ok(r.j.ok&&r.j.phone_findable===false&&r.j.name_findable===false&&r.j.mail_findable===true&&r.j.mail_id==='me-id'&&r.j.nickname==='나','설정 조회: 이름·이메일·번호 각각');
r=await call('/friends/settings',{phone_verify_token:T,action:'set',phone_findable:true}); ok(r.j.phone_findable===true,'번호 허용 저장');
r=await call('/friends/settings',{phone_verify_token:T,action:'set',name_findable:true}); ok(r.j.name_findable===true&&r.j.phone_findable===true,'이름 허용만 바꿔도 다른 항목 유지');
r=await call('/friends/settings',{phone_verify_token:T,action:'set',mail_findable:false}); ok(r.j.mail_findable===false&&profiles[0].mail_hidden===true,'이메일 ID 차단 저장');
r=await call('/friends/settings',{phone_verify_token:T,action:'set'}); ok(r.s===400,'바꿀 값 없으면 400');
process.exit(bad?1:0);

import { numberForProfile } from '../src/worker/phone-lookup.js';
test('연락처 일치: 해시가 어긋나도 한국 010 은 e164_last8 로 보낸 번호에 이어진다', () => {
  const nums = ['+821098807170', '+821011112222'];
  assert.equal(numberForProfile({ e164: '', e164_hash: 'zzz', e164_last8: '98807170', country_code: 'KR' }, nums, new Map()), '+821098807170');
  assert.equal(numberForProfile({ e164_hash: 'h1' }, nums, new Map([['h1', '+821011112222']])), '+821011112222');
  assert.equal(numberForProfile({ e164_last8: '98807170', country_code: 'US' }, nums, new Map()), '');
  assert.equal(numberForProfile({ e164_last8: '00000000', country_code: 'KR' }, nums, new Map()), '');
});

