// ============================================================
// register.js — M02 등록 모듈 (Cloudflare Worker 핸들러)
// 저장위치: gopang/src/profile2.0/register.js
// worker.js에서 인라인 통합 시 이 파일 내용을 붙여넣기
// 의존: src/auth/auth.js (makeGUID, issueJWT)
// ============================================================

// ─────────────────────────────────────────────
// 제주 읍면동 → 영문 매핑 테이블 (한림읍 파일럿 + 제주 전역)
// ─────────────────────────────────────────────
const REGION_MAP = {
  // 제주시
  '한림읍': 'hallim',   '애월읍': 'aewol',   '구좌읍': 'gujwa',
  '조천읍': 'jocheon',  '한경면': 'hangyeong','추자면': 'chuja',
  '우도면': 'udo',      '제주시': 'jeju',     '일도일동': 'ildo1',
  '이도일동': 'ido1',   '삼도일동': 'samdo1', '용담일동': 'yongdam1',
  '건입동': 'geonil',   '화북일동': 'hwabuk1','삼양일동': 'samyang1',
  '봉개동': 'bonggae',  '아라일동': 'ara1',   '오라일동': 'ora1',
  '연동': 'yeon',       '노형동': 'nohyeong', '외도일동': 'oedo1',
  '이호일동': 'iho1',   '도두일동': 'dodu1',
  // 서귀포시
  '서귀포시': 'seogwipo','남원읍': 'namwon',  '성산읍': 'seongsan',
  '표선면': 'pyoseon',  '대정읍': 'daejeong', '안덕면': 'andeok',
  '중문동': 'jungmun',  '강정동': 'gangjung',
};

// ─────────────────────────────────────────────
// 한글 → 로마자 변환 (성씨 우선 매핑 + 음절 단위)
// Revised Romanization of Korean (국립국어원 표준)
// ─────────────────────────────────────────────
const INITIAL = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const VOWEL   = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const FINAL   = ['','g','kk','ks','n','nj','nh','d','l','lg','lm','lb','ls','lt','lp','lh','m','b','bs','s','ss','ng','j','ch','k','t','p','h'];

function hangulToRoman(str) {
  let result = '';
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const offset = code - 0xAC00;
      const ini = Math.floor(offset / (21 * 28));
      const vow = Math.floor((offset % (21 * 28)) / 28);
      const fin = offset % 28;
      result += INITIAL[ini] + VOWEL[vow] + FINAL[fin];
    } else if (/[a-zA-Z0-9_]/.test(ch)) {
      result += ch.toLowerCase();
    }
    // 그 외 문자(공백, 특수문자) 제거
  }
  return result || 'user';
}

// ─────────────────────────────────────────────
// handle 생성: @{region_en}_{name_roman}
// ─────────────────────────────────────────────
function buildHandle(region, name) {
  const regionEn = REGION_MAP[region] || hangulToRoman(region) || 'jeju';
  const nameRoman = hangulToRoman(name).slice(0, 20); // 최대 20자
  return `@${regionEn}_${nameRoman}`;
}

// ─────────────────────────────────────────────
// handle 중복 확인 + suffix 채번
// Supabase UNIQUE 제약 (user_profiles.handle) 활용
// ─────────────────────────────────────────────
async function resolveHandle(baseHandle, supabaseUrl, supabaseKey) {
  // 최대 9999번 시도
  for (let i = 0; i <= 9999; i++) {
    const candidate = i === 0 ? baseHandle : `${baseHandle}_${String(i).padStart(4, '0')}`;
    const res = await fetch(
      `${supabaseUrl}/rest/v1/user_profiles?handle=eq.${encodeURIComponent(candidate)}&select=guid`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return candidate; // 사용 가능
  }
  throw new Error('HANDLE_EXHAUSTED');
}

// ─────────────────────────────────────────────
// QR SVG 생성 (순수 JS — Canvas/PNG 불가 Workers 환경 대응)
// QR 모듈: 간단한 URL QR을 SVG path로 렌더링
// ─────────────────────────────────────────────
function generateQRSVG(url, label) {
  // QR 라이브러리 없이 Workers에서 사용 가능한 방식:
  // URL을 단순 텍스트 + 외부 QR API 조합 (Google Charts QR — 공개 API)
  // 또는 순수 JS QR 라이브러리 (qrcodegen) 인라인
  // v1.0: Google Charts API 래핑 (추후 순수 JS로 교체)
  const encoded = encodeURIComponent(url);
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encoded}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="300" height="340" viewBox="0 0 300 340">
  <rect width="300" height="340" fill="#ffffff"/>
  <image href="${qrImgUrl}" x="20" y="20" width="260" height="260"/>
  <rect x="0" y="288" width="300" height="52" fill="#1D9E75"/>
  <text x="150" y="312" font-family="sans-serif" font-size="13"
        fill="#ffffff" text-anchor="middle" font-weight="bold">${label}</text>
  <text x="150" y="330" font-family="sans-serif" font-size="11"
        fill="#9FE1CB" text-anchor="middle">users.naviweb.kr</text>
</svg>`;
}

// ─────────────────────────────────────────────
// Supabase upsert 공통 함수
// ─────────────────────────────────────────────
async function upsertUserProfile(profile, supabaseUrl, supabaseKey) {
  const res = await fetch(`${supabaseUrl}/rest/v1/user_profiles`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SUPABASE_ERROR: ${res.status} ${err}`);
  }
  return await res.json();
}

// ─────────────────────────────────────────────
// POST /register-consumer — 소비자 최소 등록
// ─────────────────────────────────────────────
async function handleRegisterConsumer(request, env, corsHeaders) {
  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const { phone, name, lang = 'ko' } = body;
  if (!phone || !name) {
    return _err(400, 'MISSING_FIELD', 'phone, name 필수', corsHeaders);
  }
  if (name.trim().length < 1 || name.trim().length > 30) {
    return _err(400, 'INVALID_NAME', '이름은 1~30자', corsHeaders);
  }

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return _err(400, 'INVALID_PHONE', '전화번호 형식 오류 (7~15자리)', corsHeaders);
  }

  try {
    // 1. GUID 결정성 생성 (M01 위임)
    const guid = await makeGUID(digits);

    // 2. handle 생성 — 소비자는 지역 없이 @consumer_{name_roman}
    const baseHandle = `@consumer_${hangulToRoman(name.trim())}`;
    const SUPA_URL = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;
    const handle = await resolveHandle(baseHandle, SUPA_URL, env.SUPABASE_KEY);

    // 3. user_profiles upsert
    const now = new Date().toISOString();
    await upsertUserProfile({
      guid,
      primary_guid: guid,
      entity_type: 'individual',
      name: name.trim(),
      handle,
      native_lang: lang,
      is_public: false,
      extra: { registered_at: now, phone_hash: await sha256hex(digits) },
      created_at: now,
      updated_at: now,
    }, SUPA_URL, env.SUPABASE_KEY);

    // 4. JWT 발급 (M01 위임)
    const token = await issueJWT(
      { guid, name: name.trim(), lang, type: 'consumer' },
      env.GOPANG_MASTER_KEY
    );

    return new Response(JSON.stringify({ ok: true, token, guid, handle }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return _err(500, 'REGISTER_ERROR', e.message, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// POST /register — 사업자/기관 3-step 등록
// ─────────────────────────────────────────────
async function handleRegister(request, env, corsHeaders) {
  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const {
    phone, name, entity_type, lang = 'ko',
    region,           // 읍면동 (한글)
    // org 필드
    business_number, representative, ksic_code,
    business_hours, address,
    // institution 필드
    institution_type, parent_org, department,
    // AI 비서
    ai_active = false,
  } = body;

  if (!phone || !name || !entity_type || !region) {
    return _err(400, 'MISSING_FIELD', 'phone, name, entity_type, region 필수', corsHeaders);
  }
  if (!['org', 'institution'].includes(entity_type)) {
    return _err(400, 'INVALID_TYPE', 'entity_type: org | institution', corsHeaders);
  }

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return _err(400, 'INVALID_PHONE', '전화번호 형식 오류', corsHeaders);
  }

  try {
    const guid = await makeGUID(digits);
    const SUPA_URL = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;

    // handle 생성: @{region_en}_{name_roman}
    const baseHandle = buildHandle(region, name.trim());
    const handle = await resolveHandle(baseHandle, SUPA_URL, env.SUPABASE_KEY);

    // extra JSONB 구성
    const extra = {
      registered_at: new Date().toISOString(),
      ai_active,
    };
    if (entity_type === 'org') {
      if (business_number) extra.business_number = business_number;
      if (representative)  extra.representative  = representative;
      if (ksic_code)       extra.ksic_code       = ksic_code;
      if (business_hours)  extra.business_hours  = business_hours;
    } else {
      if (institution_type) extra.institution_type = institution_type;
      if (parent_org)       extra.parent_org       = parent_org;
      if (department)       extra.department       = department;
    }

    const now = new Date().toISOString();
    await upsertUserProfile({
      guid,
      primary_guid: guid,
      entity_type,
      name: name.trim(),
      handle,
      address: address || region,
      native_lang: lang,
      is_public: true,
      extra,
      created_at: now,
      updated_at: now,
    }, SUPA_URL, env.SUPABASE_KEY);

    const token = await issueJWT(
      { guid, name: name.trim(), lang, type: entity_type },
      env.GOPANG_MASTER_KEY
    );

    return new Response(JSON.stringify({ ok: true, token, guid, handle }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return _err(500, 'REGISTER_ERROR', e.message, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// GET /handle/check?handle=@hallim_kimmin
// ─────────────────────────────────────────────
async function handleCheckHandle(request, env, corsHeaders) {
  const url    = new URL(request.url);
  const handle = url.searchParams.get('handle');
  if (!handle) return _err(400, 'MISSING_FIELD', 'handle 파라미터 필수', corsHeaders);
  if (!handle.startsWith('@')) return _err(400, 'INVALID_HANDLE', 'handle은 @로 시작', corsHeaders);

  const SUPA_URL = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;
  const res = await fetch(
    `${SUPA_URL}/rest/v1/user_profiles?handle=eq.${encodeURIComponent(handle)}&select=guid`,
    { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } }
  );
  const rows = await res.json();
  const available = !Array.isArray(rows) || rows.length === 0;

  return new Response(JSON.stringify({ handle, available }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────
// GET /qr/:handle — QR SVG 생성 (BUG-H3: PNG 불가 → SVG)
// ─────────────────────────────────────────────
async function handleQrCode(request, env, corsHeaders) {
  const url    = new URL(request.url);
  const handle = url.pathname.replace('/qr/', '');
  if (!handle || !handle.startsWith('@')) {
    return _err(400, 'INVALID_HANDLE', 'handle은 @로 시작', corsHeaders);
  }

  // 프로필 URL
  const profileUrl = `https://users.naviweb.kr/profile.html?handle=${encodeURIComponent(handle)}`;
  const svg = generateQRSVG(profileUrl, handle);

  return new Response(svg, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400', // Cloudflare 캐시 24시간
    },
  });
}

// ─────────────────────────────────────────────
// 공통 유틸 (worker.js 기존 함수와 중복 시 제거)
// ─────────────────────────────────────────────
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function _err(status, code, message, corsHeaders) {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────
// worker.js 라우터에 추가할 스니펫
// ─────────────────────────────────────────────
/*
  // ── Profile 2.0 M02 Register ──────────────────────────────
  if (pathname === '/register-consumer' && request.method === 'POST')
    return handleRegisterConsumer(request, env, corsHeaders);
  if (pathname === '/register' && request.method === 'POST')
    return handleRegister(request, env, corsHeaders);
  if (pathname === '/handle/check')
    return handleCheckHandle(request, env, corsHeaders);
  if (pathname.startsWith('/qr/'))
    return handleQrCode(request, env, corsHeaders);
*/

export {
  handleRegisterConsumer,
  handleRegister,
  handleCheckHandle,
  handleQrCode,
  buildHandle,
  hangulToRoman,
  resolveHandle,
  REGION_MAP,
};
