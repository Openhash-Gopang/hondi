// ═════════════════════════════════════════════════
// 전화번호로 프로필 찾기 — e164_hash 기준 조회 (2026-09-25)
//
// 배경(docs/SESSION_LESSONS_BIOMETRIC_E164_DEPLOYMENT_20260907, pb_hooks/main.pb.js):
//   2026-09-07부터 새 가입 계정의 profiles.e164 는 항상 빈 문자열이다("서버에 개인정보를 저장하지 않는다").
//   번호는 세 칸에만 남는다:
//     e164_hash  = HMAC-SHA256(PHONE_VERIFY_SECRET, "e164-lookup:" + e164)  (hex)   ← 정확일치 조회용
//     e164_enc   = AES-256-GCM(e164)                                                  ← SMS 재발송 등 원문이 꼭 필요할 때만
//     e164_last8 = e164 뒤 8자리 평문                                                 ← "숫자코드"(뒷 8자리) 일치 검색용
//   이전에 가입한 계정은 평문 e164 가 남아 있고 e164_hash 는 백필되어 있다.
// 그런데 worker.js 의 조회 5곳은 여전히 평문 `e164='…'` / `e164~'…'` 로만 찾아서, 새 계정은 찾지 못한다.
// (같은 문서는 "worker.js 조회 지점은 전부 e164_hash 기준으로 바뀌었다"고 적었지만 git 이력상 worker.js 에는
//  e164_hash 가 한 번도 들어간 적이 없다.)
//
// 이 모듈은 조회 조건(필터)과 8자리 매칭 판정만 만든다 — 실제 L1 호출은 worker.js 가 그대로 한다.
//   · 해시로 찾되 옛 레코드(평문만 있는 경우)도 같이 찾도록 OR 로 묶는다.
// ═════════════════════════════════════════════════

const enc = new TextEncoder();
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** pb_hooks 의 $security.hs256("e164-lookup:" + e164, secret) 와 같은 값(HMAC-SHA256, 16진수). */
export async function e164LookupHash(secret, e164) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('e164-lookup:' + e164));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 한국 휴대폰의 옛(=현재 가입 화면이 쓰는) 저장 모양. 가입 화면(auth.js COUNTRIES.KR)은 국가번호 +82 뒤에 "010"을 그대로 붙여
 * "+8201098807170"(0 이 남은 모양)을 만들고, PB 훅은 그 문자열 그대로 e164_hash 를 계산한다. Worker 는 입력을 표준형 "+821098807170"으로
 * 바꿔 조회해 왔기 때문에 해시가 영영 맞지 않았다(2026-11-16 진단: 저장된 e164_enc 를 복호화해 다시 계산하면 일치, 표준형으로는 불일치).
 * 표준형 입력이면 이 모양을, 이 모양이면 표준형을 돌려준다(둘 다 아니면 null).
 */
export function krMobileOtherForm(e164) {
  const s = String(e164 || '');
  let m = /^\+8210(\d{8})$/.exec(s); if (m) return '+82010' + m[1];
  m = /^\+82010(\d{8})$/.exec(s); if (m) return '+8210' + m[1];
  return null;
}

/** 정확일치 조회 필터: 새 계정(e164_hash) + 옛 계정(평문 e164) 모두. 한국 휴대폰은 두 가지 모양(표준형·0 이 남은 모양)을 함께 본다. */
export async function profilePhoneFilter(env, e164) {
  const other = krMobileOtherForm(e164);
  if (!other) {                                                      // 그 밖의 번호: 예전 모양 그대로
    const plain = `e164='${q(e164)}'`;
    if (!env || !env.PHONE_VERIFY_SECRET) return plain;
    return `(e164_hash='${await e164LookupHash(env.PHONE_VERIFY_SECRET, e164)}' || ${plain})`;
  }
  const forms = [e164, other];
  const plain = forms.map(f => `e164='${q(f)}'`);
  if (!env || !env.PHONE_VERIFY_SECRET) return `(${plain.join(' || ')})`;
  const hs = []; for (const f of forms) hs.push(`e164_hash='${await e164LookupHash(env.PHONE_VERIFY_SECRET, f)}'`);
  return `(${hs.concat(plain).join(' || ')})`;
}

/**
 * /friends/find 전용 조회 필터(2026-11-16): 해시 조회에 더해, 한국 휴대폰(+8210 + 8자리)은 e164_last8 + country_code=KR 일치도 허용한다.
 * 가입 시 PB 훅이 저장한 e164_hash 와 Worker 의 PHONE_VERIFY_SECRET 이 어긋나면 해시 조회는 새 계정을 전부 놓친다 —
 * 한국 010 번호는 뒤 8자리가 곧 가입자 번호 전체이므로 같은 정확일치로 볼 수 있다. 다른 조회 지점(로그인·배송)은 바꾸지 않는다.
 */
export async function friendPhoneFilter(env, e164) {
  const base = await profilePhoneFilter(env, e164);
  const m = /^\+8210(\d{8})$/.exec(String(e164 || ''));
  if (!m) return base;
  return `(${base} || (e164_last8='${m[1]}' && country_code='KR'))`;
}

/** "뒷 8자리 매칭키" 1차 후보 필터: 새 계정(e164_last8) + 옛 계정(평문 부분일치). code 는 8자리 숫자만 넘긴다. */
export function last8Filter(code) {
  const c = q(code);
  return `(e164_last8='${c}' || e164~'${c}')`;
}

/** 후보 중 뒤 8자리가 정확히 code 이고 딱 1건일 때만 그 guid, 아니면 null(0건·충돌은 자동 처리 포기). */
export function pickGuidByLast8(items, code) {
  const exact = (items || []).filter(p => {
    const last8 = p.e164_last8 ? String(p.e164_last8) : String(p.e164 || '').replace(/\D/g, '').slice(-8);
    return last8 === code;
  });
  return exact.length === 1 ? exact[0].guid : null;
}

/**
 * 연락처 일치 결과에서 "프로필 p 는 보낸 번호 중 어느 것인가"를 정한다(2026-11-16).
 * 해시 → 옛 평문 e164 → 한국 010 이면 e164_last8 순. 해시가 어긋난 새 계정(e164 빈 값)도 뒤 8자리로 이어 준다.
 */
export function numberForProfile(p, nums, hashToNum) {
  if (!p) return '';
  const byHash = hashToNum && p.e164_hash ? hashToNum.get(p.e164_hash) : '';
  if (byHash) return byHash;
  if (p.e164 && nums.includes(p.e164)) return p.e164;
  const last8 = p.e164_last8 ? String(p.e164_last8) : '';
  if (/^\d{8}$/.test(last8) && (!p.country_code || p.country_code === 'KR')) {
    const e = '+8210' + last8;
    if (nums.includes(e)) return e;
  }
  return '';
}
