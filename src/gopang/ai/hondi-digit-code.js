/**
 * hondi-digit-code.js — 혼디 숫자 코드 인코더 / 디코더
 *
 * 색상 코드(hondi-code.js)와 같은 계열의 시각 코드지만, 데이터를
 * 6색 팔레트 대신 실제 10진수 숫자(0~9)를 7세그먼트 스타일로 직접
 * 표시한다. 사람이 눈으로 읽어도 바로 숫자를 알 수 있다는 것이 색상
 * 코드 대비 장점(디버깅·수기 대조·전화 안내 등에 유리).
 *
 * 레이아웃: "혼디" 로고(완전한 형태, 색상 코드와 동일 자산) 아래에
 * 가로로 긴 10칸 숫자열을 배치한다 — hondi-7seg-guide.html의 실측
 * 검증된 참조 이미지(digits_7seg.png, 가로 10칸)와 같은 배치.
 *
 * 버전: 10칸 고정, 0000000000 ~ 9999999999 (10^10, 100억 가지)
 */

// ── 7세그먼트 패턴 (a~g), hondi-7seg-guide.html과 동일 정의 ──────
export const SEGMENT_PATTERNS = {
  0:'abcdef', 1:'bc', 2:'abged', 3:'abgcd', 4:'fgbc',
  5:'afgcd', 6:'afgecd', 7:'abc', 8:'abcdefg', 9:'abcdfg',
};
export const SEG_ORDER = ['a','b','c','d','e','f','g'];

export const DIGIT_COUNT = 10;
export const MAX_DIGIT_ID = 10n ** BigInt(DIGIT_COUNT); // 10^10 = 100억

// ── short_id(BigInt) ↔ 숫자 배열 ─────────────────────────────
export function idToDigits(id) {
  const n = BigInt(id);
  if (n < 0n || n >= MAX_DIGIT_ID) {
    throw new Error(`숫자 코드 범위 초과: 0 ~ ${(MAX_DIGIT_ID-1n)}까지만 가능합니다.`);
  }
  const s = n.toString().padStart(DIGIT_COUNT, '0');
  return s.split('').map(Number);
}

export function digitsToId(digits) {
  return BigInt(digits.join(''));
}

// ── 전화번호(휴대폰 또는 유선 지역번호) ↔ 10자리 숫자 코드 ──────
//
// 가입 시점에 "휴대폰" 또는 "지역번호(유선)" 중 하나를 선택한다는
// 전제 하에, 10칸을 다음과 같이 채운다 — 칸 수는 항상 고정 10이므로
// 스캐너는 손댈 필요 없이 그대로 재사용한다.
//
//   · 휴대폰: 맨 앞 "0"(트렁크 접두)만 빼고 "10"+가입자번호(8자리) = 10자리
//             (010-9880-7170 → 1098807170, 2026-11-15 변경. 예전 코드 "00"+8자리는 읽기만 지원)
//   · 지역번호(유선): 맨 앞 "0"(트렁크 접두) 제외한 지역번호 + 가입자번호
//             서울(02→"2", 1자리)+가입자 8자리 = 9자리 → 앞에 "0" 채워 10자리
//             그 외(031~064 → "31~64", 2자리)+가입자 7자리 = 9자리 → 앞에 "0" 채워 10자리
//             (드물게 가입자 8자리인 예외 지역은 이미 10자리라 패딩 없음)
//
// 지역번호는 서울("2")만 1자리이고 나머지는 전부 2자리(31~64)이며,
// 어떤 지역번호도 "0"으로 시작하지 않으므로, 인코딩된 10자리의 앞
// 한두 자리만 보고도 네 가지 경우가 서로 겹치지 않게 구분된다:
//   · s[0]!='0'            → 예외적 10자리 유선 (앞 2자리가 지역번호)
//   · s[0]=='0', s[1]=='0' → 휴대폰
//   · s[0]=='0', s[1]=='2' → 서울 유선
//   · s[0]=='0', s[1]∈{3,4,5,6} → 그 외 유선(2자리 지역번호)
export const VALID_AREA_CODES = [
  '2',                                   // 서울 (02) — 유일한 1자리 지역번호
  '31','32','33',                        // 경기·인천·강원
  '41','42','43','44',                   // 충남·대전·충북·세종
  '51','52','53','54','55',              // 부산·울산·대구·경북·경남
  '61','62','63','64',                   // 전남·광주·전북·제주
];

function _onlyDigits(s, label) {
  if (!/^\d+$/.test(s)) throw new Error(`${label}은 숫자만 가능합니다: "${s}"`);
  return s;
}

export function phoneToDigits({ type, areaCode, subscriberNumber }) {
  if (type === 'mobile') {
    _onlyDigits(subscriberNumber, '휴대폰 가입자번호');
    if (subscriberNumber.length !== 8) {
      throw new Error(`휴대폰 가입자번호는 8자리여야 합니다(현재 ${subscriberNumber.length}자리).`);
    }
    return ('10' + subscriberNumber).split('').map(Number);
  }

  if (type === 'landline') {
    _onlyDigits(areaCode, '지역번호');
    _onlyDigits(subscriberNumber, '가입자번호');
    if (!VALID_AREA_CODES.includes(areaCode)) {
      throw new Error(`유효하지 않은 지역번호입니다: "${areaCode}"`);
    }
    const raw = areaCode + subscriberNumber; // 트렁크 "0" 제외한 형태
    if (raw.length !== 9 && raw.length !== 10) {
      throw new Error(`지역번호+가입자번호 길이가 올바르지 않습니다(9 또는 10자리, 현재 ${raw.length}자리).`);
    }
    const padded = raw.length === 9 ? ('0' + raw) : raw;
    return padded.split('').map(Number);
  }

  throw new Error(`type은 "mobile" 또는 "landline"이어야 합니다: "${type}"`);
}

// 10자리 숫자 배열(또는 숫자 코드 문자열)을 다시 전화번호 구조로 해석.
// 스캐너가 인식한 결과(숫자 배열)를 실제 전화번호로 되돌릴 때 사용.
export function digitsToPhone(digits) {
  const s = Array.isArray(digits) ? digits.join('') : String(digits);
  if (s.length !== DIGIT_COUNT || !/^\d+$/.test(s)) {
    throw new Error(`숫자 코드는 ${DIGIT_COUNT}자리 숫자여야 합니다: "${s}"`);
  }

  // 휴대폰: "10" + 가입자번호 8자리 (010에서 앞의 0만 뺀 형태)
  if (s[0] === '1' && s[1] === '0') {
    const subscriberNumber = s.slice(2); // 8자리
    return {
      type: 'mobile', areaCode: null, subscriberNumber,
      display: `010-${subscriberNumber.slice(0,4)}-${subscriberNumber.slice(4,8)}`,
    };
  }

  // 앞자리가 "0"이 아니면: 예외적 10자리 유선(패딩 없이 지역번호 2자리 그대로)
  if (s[0] !== '0') {
    const areaCode = s.slice(0, 2);
    if (!VALID_AREA_CODES.includes(areaCode)) {
      throw new Error(`인식할 수 없는 지역번호 조합입니다: "${areaCode}"`);
    }
    const subscriberNumber = s.slice(2); // 8자리
    return {
      type: 'landline', areaCode, subscriberNumber,
      display: `0${areaCode}-${subscriberNumber.slice(0,4)}-${subscriberNumber.slice(4,8)}`,
    };
  }

  // s[0] === '0' — (예전 형식) 휴대폰 "00"+8자리, 서울 유선, 그 외 유선 중 하나
  if (s[1] === '0') {
    const subscriberNumber = s.slice(2); // 8자리
    return {
      type: 'mobile', areaCode: null, subscriberNumber,
      display: `010-${subscriberNumber.slice(0,4)}-${subscriberNumber.slice(4,8)}`,
    };
  }
  if (s[1] === '2') {
    const subscriberNumber = s.slice(2); // 8자리
    return {
      type: 'landline', areaCode: '2', subscriberNumber,
      display: `02-${subscriberNumber.slice(0,4)}-${subscriberNumber.slice(4,8)}`,
    };
  }
  const areaCode2 = s.slice(1, 3);
  if (VALID_AREA_CODES.includes(areaCode2)) {
    const subscriberNumber = s.slice(3); // 7자리
    return {
      type: 'landline', areaCode: areaCode2, subscriberNumber,
      display: `0${areaCode2}-${subscriberNumber.slice(0,3)}-${subscriberNumber.slice(3,7)}`,
    };
  }

  throw new Error(`인식할 수 없는 코드 형식입니다: "${s}"`);
}

// ── 로고("혼디" 완전한 형태) 베이스 이미지 — 색상 코드와 동일 자산 재사용.
// 이번 레이아웃은 로고 아래에 숫자열을 배치하므로(옆이 아니라), 색상
// 코드용 원본(551×335, 혼+ㄷ+ㅣ 전부 포함)을 그대로 쓴다.
export const LOGO_IMG_URL = 'data:image/png;base64,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';
export const LOGO_IMG_W = 551, LOGO_IMG_H = 335;

// ── 숫자열 그리드 치수 (가로 배치) ────────────────────────────
// "숫자열 전체 가로 폭"을 로고 캔버스 폭(551, 우측에 빈 여백 포함)이
// 아니라 "혼디" 글자가 실제로 차지하는 잉크 폭에 맞춘다 — 그래야
// 숫자열이 로고 글자와 시각적으로 나란히 정렬되어 보인다. 세로 높이는
// 이전 설계의 박스 비율(높이:폭)을 그대로 유지한 채 같은 비율로
// 줄어든다(글자 크기 자체는 인쇄 시 결정되므로, 여기서는 상대 비율만
// 맞춘다).
const LOGO_INK_X1 = 53;   // "혼디" 글자가 시작되는 x좌표(로고 이미지 기준)
const LOGO_INK_X2 = 469;  // "혼디" 글자가 끝나는 x좌표(로고 이미지 기준)
export const LOGO_INK_W = LOGO_INK_X2 - LOGO_INK_X1; // 416 — 숫자열 전체 폭을 여기 맞춤

const BOX_ASPECT = 90 / 48.4; // 이전 설계의 박스 세로:가로 비율 — 그대로 유지
export const GAP_RATIO = 0.12;       // 슬롯 폭 대비 숫자 사이 간격 비율(양쪽 합산)
export const SLOT_W = LOGO_INK_W / DIGIT_COUNT;
export const DIGIT_BOX_W = SLOT_W * (1 - GAP_RATIO);
export const DIGIT_BOX_H = DIGIT_BOX_W * BOX_ASPECT; // 폭이 줄어든 만큼 높이도 같은 비율로 축소
export const DIGIT_GAP_Y = 24;   // 로고 아래쪽과 숫자열 사이 간격

let _logoPromise = null;
function _loadLogo() {
  if (_logoPromise) return _logoPromise;
  _logoPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('숫자 코드 로고 이미지 로드 실패: ' + LOGO_IMG_URL));
    img.src = LOGO_IMG_URL;
  });
  return _logoPromise;
}

// 세그먼트 좌표 비율 — hondi-7seg-guide.html의 SEG_BOXES와 동일 기준
const SEG_BOXES = {
  a: { x1:0.20, x2:0.80, y1:0.00, y2:0.10 },
  g: { x1:0.20, x2:0.80, y1:0.45, y2:0.55 },
  d: { x1:0.20, x2:0.80, y1:0.90, y2:1.00 },
  f: { x1:0.00, x2:0.22, y1:0.08, y2:0.44 },
  b: { x1:0.78, x2:1.00, y1:0.08, y2:0.44 },
  e: { x1:0.00, x2:0.22, y1:0.56, y2:0.92 },
  c: { x1:0.78, x2:1.00, y1:0.56, y2:0.92 },
};

function _drawDigitBox(ctx, x, y, w, h, digit) {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, Math.round(w*0.03));
  ctx.strokeRect(x, y, w, h);

  const segs = SEGMENT_PATTERNS[digit];
  ctx.fillStyle = '#000000';
  for (const s of SEG_ORDER) {
    if (!segs.includes(s)) continue;
    const box = SEG_BOXES[s];
    ctx.fillRect(
      x + box.x1*w, y + box.y1*h,
      (box.x2-box.x1)*w, (box.y2-box.y1)*h,
    );
  }
}

export async function generateDigitCodeCanvas(shortId) {
  const logo = await _loadLogo();
  const digits = idToDigits(shortId);

  const PAD = 16;
  // 숫자열 폭(LOGO_INK_W)은 항상 로고 캔버스 폭보다 작으므로(로고
  // 우측 여백 제외한 실제 글자 폭 기준), 전체 캔버스 폭은 로고
  // 캔버스 폭 그대로 사용하면 된다.
  const CANVAS_W = PAD + LOGO_IMG_W + PAD;
  const CANVAS_H = PAD + LOGO_IMG_H + DIGIT_GAP_Y + DIGIT_BOX_H + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const logoX = PAD;
  ctx.drawImage(logo, logoX, PAD, LOGO_IMG_W, LOGO_IMG_H);

  // 숫자열 시작 x좌표를 로고 글자 시작 위치와 맞춤 — 숫자열 끝도
  // 자동으로 로고 글자 끝(LOGO_INK_X2)과 일치하게 된다.
  const stripX = logoX + LOGO_INK_X1;
  const stripY = PAD + LOGO_IMG_H + DIGIT_GAP_Y;
  const insetX = (SLOT_W - DIGIT_BOX_W) / 2; // 슬롯 안에서 박스를 가운데 정렬(양옆이 간격이 됨)
  digits.forEach((d, i) => {
    const slotX = stripX + i*SLOT_W;
    _drawDigitBox(ctx, slotX + insetX, stripY, DIGIT_BOX_W, DIGIT_BOX_H, d);
  });

  return canvas;
}

export async function generateDigitCodeDataURL(shortId) {
  const canvas = await generateDigitCodeCanvas(shortId);
  return canvas.toDataURL('image/png');
}
