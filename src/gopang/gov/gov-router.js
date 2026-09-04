/**
 * gov-router.js — 광역시도 정부 AC 공용 라우터 (중앙/공유 모듈)
 *
 * 2026-07-19 신설 — 원래 jeju 저장소의 jeju-router.js였던 걸 여기로
 * 이전했다(주피터 지시: "제주는 이제 여러 광역시도 중 하나일 뿐이며,
 * 도청·시청 등 추상 클래스를 상속받아 제주도청 인스턴스를 생성하는
 * 구조여야 한다. jeju의 역할을 중앙의 상위 클래스로 이전하라"). 이
 * 파일이 그 "상위 클래스"다 — jeju 저장소의 jeju-router.js는 이제
 * 이 파일을 그대로 재수출(re-export)하는 얇은 인스턴스 셋업 파일로
 * 축소됐다(gwp-report-client.js가 15개 K-서비스에 이미 쓰고 있는
 * 크로스오리진 공유모듈 패턴과 동일).
 *
 * gwp-registry.js의 다른 서비스(K-Law 등)는 sp_key 하나 → 고정 SP 파일
 * 하나를 로드하지만, 도(道) 단위 행정 도메인은 JEJU-GOV-COMMON §6에서
 * 정의한 [JEJU_CHAIN: SP-DO-000 > L2 > L3? > L4?] 문법에 따라 요청마다
 * 다른 조합의 SP를 동적으로 조립해야 한다. 이 파일이 그 조립을 담당한다
 * (2026-07-19 Phase 1에서 이미 province-agnostic하게 일반화됨 —
 * `PROVINCE_TABLES` 레지스트리에 도 하나를 등록하면 이 파일의 매칭
 * 로직·호출부는 전혀 안 고쳐도 된다).
 *
 * v1.1: JEJU-NATIONAL-SP(국가기관 트리) 추가 — JEJU-DO-SP(도청 트리)와
 * JEJU-GOV-COMMON 바로 아래의 형제 노드다(JEJU-NATIONAL-SP §0). 그래서
 * "고정 접두사"는 JEJU-GOV-COMMON까지만이고, 그 다음 DO-SP냐 NATIONAL-SP냐는
 * 매 요청마다 배타적으로 갈린다 — 두 트리를 동시에 체인하지 않는다.
 *
 * ★ 알려진 한계(2026-07-19, 의도적으로 이번 이전 작업 범위 밖) ★
 * 아래 식별자들은 여전히 "JEJU-" 접두어를 쓴다 — 이 파일이 실제로는
 * province-agnostic한데도: trace 문자열('JEJU-GOV-COMMON',
 * 'JEJU-NATIONAL-SP'), 정적 폴백 파일명('01-do/JEJU-DO-SP_v1.5.md').
 * 이걸 완전히 일반화하려면 `worker.js`의 `SP_DELEGATION_REGISTRY`/
 * `GOV_AGENCIES`가 쓰는 'jeju_do'/'jeju_national' 키, `gwp-registry.js`의
 * jeju 서비스 항목까지 같이 바꿔야 한다(이 파일 하나만 고쳐서 될 일이
 * 아님 — 여러 저장소에 걸친 문자열 일치가 깨지면 조용히 UNKNOWN_AGENCY로
 * 거부되는 사고가 난다, 이 파일 자체의 주석에 이미 그 위험이 기록돼
 * 있음). 오늘은 "중앙 이전"까지만 하고, trace 문자열 전면 일반화는
 * 별도 작업으로 분리한다 — 여러 저장소를 동시에 고쳐야 하는 작업을
 * 이미 큰 이전 작업과 한 커밋에 섞으면 문제 발생 시 원인 분리가
 * 어려워진다.
 */

// ── 2026-08-08 신설 — province별 SP 콘텐츠 저장소 분리 대비(하이브리드
// 구조: 허브(gopang)=공용 템플릿·스키마·매니페스트, 위성(도별 저장소)=
// 그 도의 institution-tier SP 본문). ★ 순서 주의 — 이 함수/헬퍼들은
// "능력"만 추가한다. 실제로 어떤 도가 위성 저장소를 쓰는지는
// PROVINCE_TABLES[도코드].repo 필드로만 결정되고, 아래 어떤 도 항목에도
// 아직 이 필드를 채우지 않았다(2026-08-08 기준). 채우는 순간 그 도의
// institution 파일 fetch가 즉시 해당 저장소로 넘어가므로, 데이터 이관
// (prompts/gov-tree/** 실제 파일 이동)이 끝나기 *전에* 채우면 프로덕션에서
// 조용히 404가 난다 — repo 필드를 채우는 커밋과 데이터 이관 완료 확인은
// 반드시 순서를 맞출 것(마이그레이션 계획서 Phase 4 참조).
const _DEFAULT_REPO = 'Openhash-Gopang/gopang';
function _rawBase(repo) {
  return `https://raw.githubusercontent.com/${repo || _DEFAULT_REPO}/main`;
}
// 지금 발화가 귀속된 도의 위성 저장소(있으면)를 반환 — 없으면 null이라
// _fetchText()가 자동으로 허브(gopang)로 폴백한다.
function _currentProvinceRepo() {
  return PROVINCE_TABLES[_currentResolvedProvinceCode]?.repo || null;
}

const _RAW = _rawBase(_DEFAULT_REPO) + '/prompts/gov-tree/';
const _RAW_ROOT = _rawBase(_DEFAULT_REPO) + '/prompts/';

// ── 과/팀(division) 단위 키워드 테이블 (2026-08-02 재구현) ────────────
// 국(局)/부서까지는 특정됐는데 그 산하 몇 개 과/팀 중 어디인지 애매한
// 경우를 위한 2단계 라우팅. 주피터 지시(합의된 설계): ①1차는 키워드
// 하드코딩 매칭 ②애매(동점)할 때만 LLM이 §3 COMPOSE를 읽는 효과를
// 내되, 실제로는 agent-common 재fetch가 아니라 이미 갖고 있는
// division/team 데이터를 후보로 준다 ③"애매함"은 최고점 동점으로 정의.
import { CITY_DIVISION_TABLE, DO_DEPT_DIVISION_TABLE,
  JEJU_AGENCY_TABLE, JEJU_ORG_TABLE, JEJU_AGENCY_DIVISION_TABLE, JEJU_ORG_DIVISION_TABLE } from './division-tables.js';
// ── §6-1~8 division(실·국·과) 지연 합성 라우팅 (2026-08-16 신설) ──────
// 70개 정책기관 "본청" 단위(policy-bodies)까지는 이미 위 -0.8) 단계에서
// 배선돼 있었다. 이 import는 그 아래 계층 — 실/국/과 561건 — 을 다룬다.
// 반드시 기관이 먼저 확정된 뒤(getDivisionsForInstitution) 그 안에서만
// 매칭한다 — 전역 검색은 절대 하지 않는다(national-division-router.js
// 상단 주석 "핵심 설계 결정" 참고, "기획조정실" 같은 부서명이 여러
// 기관에 공통으로 있어 전역 매칭은 필연적으로 충돌한다).
import { getDivisionsForInstitution, resolvePolicyDivisionLazy, resolveAssemblyCommitteeLazy, guessAssemblyCommitteeFromText } from './national-division-router.js';

// ── 고정 접두사(GOV-COMMON) + 배타적 L1 노드(DO-SP/NATIONAL-SP) 캐시 ──
// ★ 2026-07-20 수정 — 이전엔 도 하나만 담는 단일 변수였다. 발화마다
// 도가 바뀌는 지금 구조(백지화 이후)에서는 두 번째 도 질문에 첫 번째
// 도의 캐시된 내용이 잘못 나가는 버그였다 — 도코드별 Map으로 전환.
const _govCommonByProvince = new Map();
const _doSpCacheByProvince = new Map();
const _nationalSpCacheByProvince = new Map();

// repo(예: 'Openhash-Gopang/jejudo')를 넘기면 그 저장소의 prompts/gov-tree/
// 에서, 안 넘기면(대부분의 호출부) 기존처럼 허브(gopang)에서 읽는다.
async function _fetchText(path, repo = null) {
  const base = repo ? _rawBase(repo) + '/prompts/gov-tree/' : _RAW;
  const r = await fetch(base + path + '?t=' + Math.floor(Date.now() / 3600000)); // 1시간 캐시 버스팅
  if (!r.ok) throw new Error(`fetch 실패: ${path} (${r.status})`);
  return r.text();
}

// ── 매니페스트 경유 fetch (2026-07-29 신설) ────────────────────────
// 이 파일은 지금까지 GOV-COMMON-OVERLAY-TEMPLATE_v1.1.md·GOV-TREE-
// PROTOCOL_v1.0.md·SP-PROVINCE-TEMPLATE_v1.1.md·NATIONAL-SP-CORE_v1.2.md·
// NATIONAL-SP-OVERLAY-TEMPLATE_v1.0.md를 _fetchText()로 버전을 직접
// 박아 호출했다 — worker.js의 _loadGovCommonChain()이 같은 문서를
// 서버측에서 동일한 방식으로 하드코딩하고 있던 것과 정확히 같은
// "버전 박제" 버그(worker.js 쪽은 2026-07-29에 이미 정정). 지금은
// 우연히 최신본과 값이 같아 문제가 없을 뿐, 다음에 이 문서들이
// 올라가면 이 파일만 조용히 구버전을 계속 쓰게 된다. sp-catalog.json에
// 등록된 최신 파일명을 매니페스트 경유로 조회해 그 파일명으로 fetch한다.
let _manifestCache = null;
let _manifestCacheAt = 0;
const _MANIFEST_TTL_MS = 10 * 60 * 1000;
async function _fetchManifest() {
  const now = Date.now();
  if (_manifestCache && (now - _manifestCacheAt) < _MANIFEST_TTL_MS) return _manifestCache;
  const r = await fetch(_RAW_ROOT + 'sp-catalog.json?t=' + Math.floor(now / 3600000));
  if (!r.ok) throw new Error(`sp-catalog.json fetch 실패: HTTP ${r.status}`);
  _manifestCache = await r.json();
  _manifestCacheAt = now;
  return _manifestCache;
}
async function _fetchByManifestKey(key) {
  const manifest = await _fetchManifest();
  const fname = manifest[key];
  if (!fname) throw new Error(`매니페스트에 ${key} 키 없음`);
  const r = await fetch(_RAW_ROOT + fname + '?t=' + Math.floor(Date.now() / 3600000));
  if (!r.ok) throw new Error(`${key} fetch 실패: HTTP ${r.status} (${fname})`);
  return r.text();
}

// ── 시군구명 → 도코드 역매핑 (지연 로드, 세션당 1회) ────────────────
// sigungu-national-list.json(2026-07-20 신설)을 재사용 — 226개+시군구
// 명칭·소속 목록.
let _sigunguListCache = null;
async function _loadSigunguListForProvinceGuess() {
  if (_sigunguListCache) return _sigunguListCache;
  try {
    const r = await fetch('https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/'
      + 'src/gopang/gov/sigungu-national-list.json?t=' + Math.floor(Date.now() / 3600000));
    const data = await r.json();
    _sigunguListCache = data.시군구목록 || [];
  } catch (e) {
    console.warn('[gov-router] 시군구 목록 로드 실패(도 판별에 시군구명 매칭 없이 진행):', e.message);
    _sigunguListCache = [];
  }
  return _sigunguListCache;
}

// 도 이름(전체·축약형) → 내부 도코드. ★ 동명이인 충돌 위험이 있는
// 짧은 형태(예: 그냥 '광주'는 전남광주통합특별시의 구 광주광역시 ·
// 경기도 광주시 둘 다와 겹침)는 일부러 뺐다 — 그런 경우는 시군구명
// 역매핑(아래, 시군구 목록에 도코드까지 정확히 있음)에 맡긴다.
const PROVINCE_NAME_TO_CODE = {
  '제주특별자치도': 'jeju', '제주도': 'jeju', '제주': 'jeju',
  '부산광역시': 'busan', '부산': 'busan',
  '경기도': 'gyeonggi', '경기': 'gyeonggi',
  '서울특별시': 'seoul', '서울': 'seoul',
  '전남광주통합특별시': 'jeonnam-gwangju',
  // ★ 2026-07-24 수정 — "광주광역시"(사용자가 실제로 쓰는 현재 명칭)가
  // 누락돼 있었다. 짧은 '광주'는 기존 설계 의도(경기도 광주시와 충돌
  // 위험)대로 계속 배제하지만, "광주광역시"는 전체 명칭이라 경기도
  // 광주시와 겹칠 일이 없다(경기도 쪽은 "경기도 광주시"/"광주시"로만
  // 불리지 "광주광역시"로 불리지 않는다) — 안전하게 추가 가능.
  '광주광역시': 'jeonnam-gwangju',
  '대구광역시': 'daegu', '대구': 'daegu',
  '인천광역시': 'incheon', '인천': 'incheon',
  '대전광역시': 'daejeon', '대전': 'daejeon',
  '울산광역시': 'ulsan', '울산': 'ulsan',
  '세종특별자치시': 'sejong', '세종': 'sejong',
  '강원특별자치도': 'gangwon', '강원도': 'gangwon', '강원': 'gangwon',
  '충청북도': 'chungbuk', '충북': 'chungbuk',
  '충청남도': 'chungnam', '충남': 'chungnam',
  '전북특별자치도': 'jeonbuk', '전라북도': 'jeonbuk', '전북': 'jeonbuk',
  '경상북도': 'gyeongbuk', '경북': 'gyeongbuk',
  '경상남도': 'gyeongnam', '경남': 'gyeongnam',
};

// ── 일반구(법인격 없는 구) → 도코드 역매핑 (2026-07-24 신설) ────────────
// 일반구는 지방자치법상 기초자치단체가 아니라서(자치구와 달리 법인격이
// 없음) sigungu-national-list.json(기초자치단체 전용 목록)에 의도적으로
// 빠져 있다 — 그 목록에 끼워 넣으면 그 파일의 정의 자체가 흐려진다.
// 대신 이 별도의 작은 표를 둔다. 지금은 창원시 산하 5개 일반구만 채워져
// 있다(2026-07-24 진주·창원·산청군 파일럿) — 다른 도의 일반구(예: 청주시
// 상당구·성남시 분당구)가 인스턴스화되면 여기에 추가한다.
const GENERAL_WARD_TO_PROVINCE = {
  '의창구': 'gyeongnam', '성산구': 'gyeongnam', '마산합포구': 'gyeongnam',
  '마산회원구': 'gyeongnam', '진해구': 'gyeongnam',
};

function _guessProvinceFromText(text, sigunguList, emdNameIndex) {
  // ★ 2026-07-24 수정(주피터 지시 이후 부산 1단계 확대 회귀검증에서 발견) —
  // 예전엔 "도 이름"(1순위)과 "시군구명"(2순위)을 별개 우선순위로 나눠
  // 도 이름을 항상 먼저 검사했다. 그런데 "해운대구"에 대구광역시 짧은
  // 이름 '대구'가 부분문자열로 포함돼 있어서, 2순위(시군구 목록, '해운대구'
  // → 부산광역시)까지 가지도 못하고 1순위에서 대구로 오판별됐다 — 옛
  // 주석의 "짧은 이름이 긴 이름의 부분문자열인 경우는 없다"는 가정 자체가
  // 틀렸던 것이다. 이제 두 후보군을 합쳐 **가장 긴(가장 구체적인) 일치
  // 문자열이 이기도록** 단일 패스로 처리한다 — 이러면 이런 부분문자열
  // 충돌 클래스 전체가 구조적으로 해소된다(개별 예외 등록 불필요).
  const candidates = [];
  for (const [name, code] of Object.entries(PROVINCE_NAME_TO_CODE)) candidates.push({ name, code });
  if (sigunguList && sigunguList.length) {
    for (const rec of sigunguList) {
      const code = rec.이름 && PROVINCE_NAME_TO_CODE[rec.광역];
      if (code) candidates.push({ name: rec.이름, code });
    }
  }
  candidates.sort((a, b) => b.name.length - a.name.length);
  for (const { name, code } of candidates) {
    if (text.includes(name)) return code;
  }
  // 2.5순위(2026-07-24 신설) — 일반구명 역매핑. 일반구는 기초자치단체가
  // 아니라 위 목록(sigunguList)에 없으므로 별도 표에서 찾는다. 일반구
  // 이름은 자치구와 겹치지 않는 고유명이라 별도 tier로 둬도 위 충돌
  // 클래스에 해당하지 않는다(다만 향후 겹치는 사례가 생기면 위 candidates
  // 병합 방식으로 흡수할 것).
  for (const [name, code] of Object.entries(GENERAL_WARD_TO_PROVINCE)) {
    if (text.includes(name)) return code;
  }
  // 3순위(2026-07-21 신설, 버그3 수정) — 읍/면/동명 역매핑. 상위 시/군/구·
  // 도 이름 없이 읍면동만 언급해도(예: "한경면 전입신고") 판별되게 한다.
  // EMD_PATHS가 있는 도(현재 jeju)에 한해서만 가능 — 다른 도에 EMD
  // 데이터가 실사되면 자동으로 확장된다.
  if (emdNameIndex) {
    for (const [name, code] of Object.entries(emdNameIndex)) {
      if (text.includes(name)) return code;
    }
  }
  return null;
}

// ── 도코드 해석 (2026-07-20 재설계 — 백지화, 'jeju' 하드코딩 기본값
// 제거) ──────────────────────────────────────────────────────
// 주피터 지시: "제주는 전체 광역시도 중 하나일 뿐입니다. 완전히
// 걷어내고, 백지 상태에서 사용자의 발화에 대응하는 광역시도 및
// 시군구를 결정하도록 수정하십시오."
//
// 결정 순서: (1) window.HONDI_PROVINCE_CODE — 배포 시점 명시적
// 오버라이드(도별 서브도메인 등, 최우선 유지). (2) 이번 요청의 사용자
// 발화에서 도/시군구 이름을 인식해 판별 — _assembleGovSystemPromptRaw
// 시작 시점에 미리 계산해 _currentResolvedProvinceCode에 저장한다
// (이 함수 자체는 동기 함수로 유지 — 호출부가 많아 시그니처를 바꾸면
// 파급이 크다). (3) 그래도 못 정하면 'jeju' — 더 이상 "의도된
// 기본값"이 아니라 "신호 없을 때의 최후 폴백"일 뿐이다(제주가
// 특별해서가 아니라 데이터가 가장 완비된 인스턴스라 안전망으로 씀).
let _currentResolvedProvinceCode = null;
function _resolveProvinceCode() {
  if (typeof window !== 'undefined' && window.HONDI_PROVINCE_CODE) return window.HONDI_PROVINCE_CODE;
  // ★ 2026-07-21 — 'jeju' 최후 기본값 제거(주피터 지시: jeju 중심 →
  // 전국 중심 전환). #26 이후 정상 흐름은 이 지점에 도달하기 전
  // _assembleGovSystemPromptRaw의 -0.5단계에서 이미 "지역 미판별"로
  // 조기 반환하므로, 이 함수가 null을 반환해도 호출부는 안전하다.
  return _currentResolvedProvinceCode || null;
}

// ── kgov(SP-10_kpublic, 전국 공통) 동적 로더 (2026-07-05 신설) ──────
// 주피터 지시: "kgov는 전국 공통 모듈, jeju는 제주도 특화 모듈이므로
// 기능이 중복되면 안 된다. 모든 지방(제주·서울·부산 등)은 kgov를
// 상속받는다." 이에 따라 도(道) 트리는 자체 GOV-COMMON-CORE를 발명하지
// 않고, 실제 K-Public 서비스(gopang/prompts/SP-10_kpublic_*.txt)를 있는
// 그대로 상속한다.
//
// 버전을 하드코딩하지 않고 gopang/prompts/manifest.json에서 매번 최신
// 키를 조회한다 — kgov 버전이 나중에 v2.3, v2.4로 올라가도 이 코드를
// 고칠 필요가 없다(하드코딩했다면 check_stale_refs.py가 잡아내려는
// "참조가 최신 버전을 안 따라감" 문제가 그대로 재발했을 것이다).
let _kgovSp = null;
async function _loadKgovSp() {
  if (_kgovSp) return _kgovSp;
  // ★ 2026-07-19 긴급 수정 ★ — 여기서 fetch하던 'manifest.json'은
  // prompts/ 밑에 존재한 적이 없다(실사 확인: raw.githubusercontent.com
  // 실제 라이브 URL 404). 즉 이 함수는 지금까지 매 요청마다 예외를
  // 던졌고, webapp.html의 catch가 SP_FALLBACK(한 줄짜리 최소 안내문)으로
  // 조용히 대체해왔다 — 크래시가 안 보여서 지금까지 발견되지 않았을
  // 뿐, 실질적으로 kgov·overlay·tree-protocol·DO-SP 전부가 로드된 적이
  // 없었을 가능성이 높다(오늘 추가한 HUMAN-AUTHORITY-GATE-SCHEMA 포함).
  // 올바른 파일은 prompts/sp-catalog.json(CI가 매 push마다 갱신,
  // 실제 라이브 확인 완료) — 키 구조는 동일하다.
  const manifestRaw = await fetch(_RAW_ROOT + 'sp-catalog.json?t=' + Math.floor(Date.now() / 3600000));
  if (!manifestRaw.ok) throw new Error(`[Jeju] gopang sp-catalog.json fetch 실패 (${manifestRaw.status})`);
  const manifest = await manifestRaw.json();
  const fname = manifest['SP-10_kpublic'];
  if (!fname) throw new Error('[Jeju] sp-catalog.json에 SP-10_kpublic 키 없음 — kgov SP를 찾을 수 없음');
  const r = await fetch(_RAW_ROOT + fname + '?t=' + Math.floor(Date.now() / 3600000));
  if (!r.ok) throw new Error(`[Jeju] kgov SP(${fname}) fetch 실패 (${r.status})`);
  _kgovSp = await r.text();
  return _kgovSp;
}

// ── SP-COMMON-02(K-전문직 AI 공통 추론 아키텍처) 동적 로더 (2026-07-21 신설) ──
// 주피터 지시: "모든 클래스(원형)에 '인스턴스는 반드시 전문가 AI 페르소나와
// 동등한 방식으로, 동일한 태도로 사용자 요청에 응해야 한다'고 명시하십시오.
// 전문가 AI 페르소나의 상위 SP를 정부 기관 클래스의 상위 SP로 하십시오."
//
// SP_common_guardrails(=SP-COMMON-02) v3.14 changelog에 이미 이 질문이
// 기록돼 있었다 — "K-Service·공공기관 AC에도 동일 원칙이 적용돼야
// 하는가"라는 지적에, 그때는 핵심 원칙(C44)만 UNIVERSAL-common으로
// 옮기고 나머지는 EXPERT 전용(expert-session.js에서만 로드)으로 남겨
// 뒀다(실사 결과: "이 문서는 K-Service·공공기관 AC·개인 AC 경로에는
// 연결돼 있지 않음을 확인"). 오늘 그 공백을 메운다.
//
// _loadKgovSp()와 완전히 동일한 패턴 — 버전을 하드코딩하지 않고
// sp-catalog.json에서 매번 최신 키를 조회한다(60개 전문가 페르소나가
// 이미 상속하고 있는 것과 동일한 최신본을 정부기관 AC도 그대로 상속).
let _expertCommonSp = null;
async function _loadExpertCommonSp() {
  if (_expertCommonSp) return _expertCommonSp;
  const manifestRaw = await fetch(_RAW_ROOT + 'sp-catalog.json?t=' + Math.floor(Date.now() / 3600000));
  if (!manifestRaw.ok) throw new Error(`[gov-router] sp-catalog.json fetch 실패 (${manifestRaw.status})`);
  const manifest = await manifestRaw.json();
  const fname = manifest['SP_common_guardrails'];
  if (!fname) throw new Error('[gov-router] sp-catalog.json에 SP_common_guardrails 키 없음 — SP-COMMON-02를 찾을 수 없음');
  const r = await fetch(_RAW_ROOT + fname + '?t=' + Math.floor(Date.now() / 3600000));
  if (!r.ok) throw new Error(`[gov-router] SP-COMMON-02(${fname}) fetch 실패 (${r.status})`);
  _expertCommonSp = await r.text();
  return _expertCommonSp;
}

let _jejuTreeProtocol = null;
async function _loadJejuTreeProtocol() {
  if (!_jejuTreeProtocol) _jejuTreeProtocol = await _fetchByManifestKey('GOV-TREE-PROTOCOL');
  return _jejuTreeProtocol;
}

let _govCommonOverlayMasterData = null;
async function _loadGovCommonOverlayMasterData() {
  if (!_govCommonOverlayMasterData) {
    const raw = await _fetchText('00-common/overlays/gov-common-overlay-master-data.json');
    _govCommonOverlayMasterData = JSON.parse(raw).도목록;
  }
  return _govCommonOverlayMasterData;
}
function _renderGovCommonOverlay(template, rec) {
  return template
    .replaceAll('{도이름}', rec.도이름 || '')
    .replaceAll('{콜센터명}', rec.콜센터명 || '')
    .replaceAll('{콜센터번호}', rec.콜센터번호 || '')
    .replaceAll('{출자기관예시_문구}', rec.출자기관예시_문구 || '')
    .replaceAll('{행정시목록_문구}', rec.행정시목록_문구 || '')
    .replaceAll('{관할예시_문구}', rec.관할예시_문구 || '');
}

async function _loadGovCommon() {
  // 2026-07-05: GOV-COMMON-CORE(자체 발명한 "전국 공통 원칙") 폐기.
  // kgov(전국 공통, 실사용 중인 K-Public SP) + OVERLAY(도별 사실) +
  // JEJU-TREE-PROTOCOL(도 트리 전용 기술 프로토콜)로 대체 — 캐시 변수
  // (_govCommon)는 조합된 최종 문자열을 저장하므로 이 함수를 호출하는
  // 다른 코드는 전혀 수정할 필요가 없다(내부만 바뀜).
  //
  // 2026-07-19 — HUMAN-AUTHORITY-GATE-SCHEMA(G1~G19) 동적 삽입 신설.
  // 사고실험(AC-EXPERT-PARITY-THOUGHT-EXPERIMENT_2026-07-19.md)에서
  // 발견: 이 문서는 지금까지 "개별 SP 작성 시 §CAPABILITIES 뒤에
  // 수동 복붙하라"는 저작 지침으로만 존재했고, 실제 ~100개 기관 SP
  // 어디에도 반영된 적이 없었다(kgov는 인용만 함). 전문가 페르소나가
  // SP_common_guardrails를 매 호출마다 자동 합성하는 것과 동일한
  // 원칙을 적용 — 개별 SP 100개를 고치는 대신 여기 한 곳에서 kgov
  // 바로 뒤에 끼워 넣는다(kgov §준수 문서가 지시한 삽입 위치 —
  // "§CAPABILITIES 뒤" — 와 동등한 효과: 정체성/능력 정의 직후).
  const provinceCode = _resolveProvinceCode();
  if (_govCommonByProvince.has(provinceCode)) return _govCommonByProvince.get(provinceCode);
  const [kgov, expertCommonSp, gateSchema, overlayTemplate, overlayRecords, treeProtocol, agencyAcCommon] = await Promise.all([
    _loadKgovSp(),
    _loadExpertCommonSp(),
    _fetchText('08-schema/HUMAN-AUTHORITY-GATE-SCHEMA_v1_4.md'),
    _fetchByManifestKey('GOV-COMMON-OVERLAY-TEMPLATE'),
    _loadGovCommonOverlayMasterData(),
    _loadJejuTreeProtocol(),
    // ★ 2026-08-02 신설 — AGENCY-AC-COMMON(§3 NOTICE/§4 REPORT/§5
    // PDV_RECORDING/§6 META_TABLING 태그 프로토콜). 자신의 문서 헤더에
    // "상위 상속: ...JEJU-TREE-PROTOCOL → AGENCY-AC-COMMON → JEJU-DO-SP"
    // 라고 이미 정확히 이 위치를 문서화해뒀는데, 실제로 여기 삽입된 적이
    // 없었다 — gov-tree의 개별 기관 agent-common 파일 55개(SP-XXX-
    // AGENT-COMMON)가 이 문서를 대신 인용하며 태그 지시를 반복해서
    // 갖고 있었지만, 그 파일들 자체가 시민 대화 세션에서 로드되는 경로가
    // 없어(SP-Tree 배선 감사로 발견) handleGovRelay(worker.js)가 실제로
    // 처리하는 AGY_VAULT_STORE/META_TABLE_UPDATE 태그가 제주 기관에서는
    // 한 번도 발행되지 않고 있었다. 55개를 개별 로드하는 대신, 모든
    // 기관 디스패치가 공통으로 거치는 이 함수 한 곳에 정본을 fetch해
    // 넣는 것으로 도청·실국·직속기관·출자기관·시청·읍면동 전부에 동시
    // 적용한다(agent-common 개별 파일들의 §1 정체성·§2-3 COMPOSE는
    // 이미 상위 기관 SP 자체 및 이번 세션의 division/team 라우팅이
    // 각각 대체하고 있어 중복 삽입하지 않는다 — 이 문서만 필요).
    // ★ 2026-08-20 — v1.4→v1.5(공리 2: 접수 이후 심사·보완·의견제출·결재
    // 절차 신설, GOV-TASK-POST-ACCEPTANCE-REVIEW_v2_1 전 기관 공통 승격).
    fetch(_RAW_ROOT + 'AGENCY-AC-COMMON_v1.5.md?t=' + Math.floor(Date.now() / 3600000))
      .then(r => { if (!r.ok) throw new Error(`AGENCY-AC-COMMON fetch 실패: HTTP ${r.status}`); return r.text(); }),
  ]);
  const rec = overlayRecords.find(r => r.도코드 === provinceCode);
  let overlay;
  if (rec) {
    overlay = _renderGovCommonOverlay(overlayTemplate, rec);
  } else {
    // ★ 2026-07-20 — 예전엔 여기서 throw했다(오버레이 없는 도는 전부
    // 크래시). 이 세션 내내 써온 TBD 원칙대로 정직한 대체 문구로 바꿈.
    console.warn(`[gov-router] GOV-COMMON-OVERLAY 데이터 없음(도코드=${provinceCode}) — 일반 안내로 대체`);
    overlay = `[참고: 이 지역(${provinceCode})의 상세 안내(콜센터 번호 등)는 아직 준비 중입니다 — ` +
      `정부24(gov.kr) 또는 해당 지자체 대표전화로 확인해 주세요.]`;
  }
  const expertParityNotice =
    '[상위 SP 상속 선언 — 2026-07-21] 아래 SP-COMMON-02(K-전문직 AI 공통 추론 아키텍처)는 ' +
    '노무사·변호사·의사 등 60개 전문가 AI 페르소나의 상위 공통 SP다. 이 정부기관 AC의 5개 ' +
    '원형 클래스(광역시도청·실국·시군구청(기초자치단체)·읍면동사무소·국가기관 지역사무소) 전부 ' +
    '이를 동일하게 상위 SP로 상속한다 — 어느 클래스의 인스턴스든 전문가 AI 페르소나와 동등한 ' +
    '방식, 동일한 태도로 사용자 요청에 응해야 한다.';
  const result = kgov + '\n\n---\n\n' + expertParityNotice + '\n\n' + expertCommonSp +
    '\n\n---\n\n' + gateSchema + '\n\n---\n\n' + overlay + '\n\n---\n\n' + treeProtocol +
    '\n\n---\n\n' + agencyAcCommon;
  _govCommonByProvince.set(provinceCode, result);
  return result;
}

// ── L1(SP-DO-000) 로딩 — SP-PROVINCE-TEMPLATE 렌더링으로 전환 (2026-07-19) ──
// 기존엔 제주 정적 파일(JEJU-DO-SP_v1.5.md) 하나만 fetch했다. 이제
// province-master-data.json에 도코드 레코드가 있으면 템플릿을 렌더링해
// 쓰고, 레코드가 없으면(아직 온보딩 안 된 도, 또는 jeju 자신의 데이터
// 로드 실패 시) 기존 정적 파일로 폴백한다 — L2/시/국가기관 로더가 이미
// 쓰고 있는 "템플릿 우선, 정적 파일 폴백" 패턴(_fetchDeptText 등)과
// 동일 철학. jeju는 두 경로 모두 존재하므로(province-master-data.json에
// jeju 레코드 신설 완료) 정상 케이스에서는 템플릿 경로를 탄다.
let _provinceMasterData = null;
async function _loadProvinceMasterData() {
  if (!_provinceMasterData) {
    const raw = await _fetchText('01-do/templates/province-master-data.json');
    _provinceMasterData = JSON.parse(raw).도목록;
  }
  return _provinceMasterData;
}
function _renderProvinceTemplate(template, rec) {
  return template
    .replaceAll('{도이름}', rec.도이름 || '')
    .replaceAll('{도코드}', rec.도코드 || '')
    .replaceAll('{통치구조_문구}', rec.통치구조_문구 || '')
    .replaceAll('{이원화_문구}', rec.이원화_문구 || '')
    .replaceAll('{인접기관_문구}', rec.인접기관_문구 || '')
    .replaceAll('{광역출력_문구}', rec.광역출력_문구 || '')
    .replaceAll('{위임사무_문구}', rec.위임사무_문구 || '')
    .replaceAll('{하위SP_접두어}', rec.하위SP_접두어 || '')
    .replaceAll('{유의사항_추가}', rec.유의사항_추가 || '')
    // ★ 2026-08-20 추가 — SP-PROVINCE-TEMPLATE v1.2에서 신설된
    // 자리표시자. 여기 안 넣으면 렌더링 결과에 '{고유사무_문구}'
    // 리터럴 문자열이 그대로 남는다(실제로 이 버그로 한 번 걸릴 뻔함 —
    // 템플릿·데이터만 고치고 이 함수를 빠뜨리는 실수, 반드시 셋 다
    // 같이 갱신할 것).
    .replaceAll('{고유사무_문구}', rec.고유사무_문구 || '(아직 실사되지 않음 — 이 도청 고유 사무 목록은 조사 중)');
}
async function _loadDoSp() {
  const provinceCode = _resolveProvinceCode();
  if (_doSpCacheByProvince.has(provinceCode)) return _doSpCacheByProvince.get(provinceCode);
  let result;
  try {
    const [template, records] = await Promise.all([
      _fetchByManifestKey('SP-PROVINCE-TEMPLATE'),
      _loadProvinceMasterData(),
    ]);
    const rec = records.find(r => r.도코드 === provinceCode);
    if (!rec) throw new Error(`province-master-data.json에 도코드=${provinceCode} 레코드 없음`);
    result = _renderProvinceTemplate(template, rec);
  } catch (e) {
    // ★ 2026-07-21 — 예전엔 여기서 제주 정적 파일(JEJU-DO-SP_v1.5.md)로
    // 조용히 대체했다. 주피터 지시로 jeju 중심 폴백을 폐기하고, 실사
    // 안 된 도는 정직하게 "미확인"으로 안내한다(제주 조직 구조를
    // 다른 도에 잘못 투사하지 않는다).
    console.warn(`[gov-router] SP-PROVINCE-TEMPLATE 렌더링 실패(도코드=${provinceCode}, ${e.message}) — 도청 조직 정보 미확인으로 대체`);
    result = `[도청 조직 정보 — 이 지역(${provinceCode}) 미확인] 광역시도청의 구체적인 조직·부서 정보는 ` +
      `아직 실사되지 않았습니다. 정확한 안내는 정부24(gov.kr) 또는 해당 광역시도 대표전화, ` +
      `국번없이 110(정부민원안내)으로 확인해 주세요.`;
  }
  _doSpCacheByProvince.set(provinceCode, result);
  return result;
}

let _natOverlayMasterData = null;
async function _loadNatOverlayMasterData() {
  if (!_natOverlayMasterData) {
    const raw = await _fetchText('09-national/overlays/national-sp-overlay-master-data.json');
    _natOverlayMasterData = JSON.parse(raw).도목록;
  }
  return _natOverlayMasterData;
}
function _renderNatOverlay(template, rec) {
  return template.replaceAll('{도이름}', rec.도이름 || '');
}

// 구 JEJU-NATIONAL-SP §3(라우팅 테이블)·§6(레지스트리)에 해당하던 내용을
// national-agency-master-data.json에서 매번 동적으로 생성한다 — 정적
// 텍스트로 유지하다가 실제 완료 상태(28/28)와 어긋나 있었던 버그(2026-07-04
// 발견)가 구조적으로 재발하지 않도록 하는 게 목적이다.
function _renderNatCatalogSection(records, provinceCode) {
  const rows = records.filter(r => r.도코드 === provinceCode);
  const tableRows = rows.map(r =>
    `| SP-NAT-${r.domain.toUpperCase()} | ${r.지사명} | ${r.소속부처 || ''} |`
  ).join('\n');
  return (
    `## §3. 라우팅 테이블 (national-agency-master-data.json 기준, 매 요청 시 동적 생성)\n\n` +
    `| 코드 | 기관명 | 소속 |\n|---|---|---|\n${tableRows}\n\n` +
    `위 ${rows.length}개 기관 전부 개별 SP 작성이 완료된 상태다(§4 공통 폴백은 향후 신규 등록 기관을 위한 대비책으로만 유지).\n\n` +
    `## §6. 하위 SP 레지스트리\n\n` +
    `| 코드 | 상태 |\n|---|---|\n` +
    rows.map(r => `| SP-NAT-${r.domain.toUpperCase()} | ✅ 완료 |`).join('\n')
  );
}

async function _loadNationalSp() {
  const provinceCode = _resolveProvinceCode();
  if (_nationalSpCacheByProvince.has(provinceCode)) return _nationalSpCacheByProvince.get(provinceCode);
  const [core, overlayTemplate, overlayRecords, natRecords] = await Promise.all([
    _fetchByManifestKey('NATIONAL-SP-CORE'),
    _fetchByManifestKey('NATIONAL-SP-OVERLAY-TEMPLATE'),
    _loadNatOverlayMasterData(),
    _loadNatMasterData(),
  ]);
  const overlayRec = overlayRecords.find(r => r.도코드 === provinceCode);
  let overlay;
  if (overlayRec) {
    overlay = _renderNatOverlay(overlayTemplate, overlayRec);
  } else {
    // ★ 2026-07-20 — 국가기관 지사 데이터는 아직 제주만 있다(세무서·
    // 법원 등 12~15개 도 분량이 별도 후속 작업으로 남아있음). 예전엔
    // 여기서 throw했다 — 정직한 대체 문구로 바꿔 최소한 안 죽게 함.
    console.warn(`[gov-router] NATIONAL-SP-OVERLAY 데이터 없음(도코드=${provinceCode}) — 일반 안내로 대체`);
    overlay = `[참고: 이 지역(${provinceCode})의 국가기관 지사 상세 정보는 아직 준비 중입니다.]`;
  }
  const rowsForProvince = natRecords.filter(r => r.도코드 === provinceCode);
  const catalogSection = rowsForProvince.length > 0
    ? _renderNatCatalogSection(natRecords, provinceCode)
    : `## §3. 라우팅 테이블\n\n이 지역의 국가기관 지사 목록은 아직 조사되지 않았습니다 — ` +
      `정확한 관할 기관은 정부24(gov.kr) 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`;
  const result = core + '\n\n---\n\n' + overlay + '\n\n---\n\n' + catalogSection;
  _nationalSpCacheByProvince.set(provinceCode, result);
  return result;
}

// ── L2 라우팅 테이블 (JEJU-DO-SP §3-1/§3-2/§3-3과 동기화) ─────
// 각 항목: 코드, 파일 경로, 매칭 키워드. 여러 항목이 매칭되면 키워드
// 개수가 가장 많이 일치하는 쪽을 우선한다(단순 스코어링 — v1.1에서
// LLM 기반 분류로 고도화 검토).
const JEJU_L2_TABLE = [
  { code: 'SP-DO-PLAN',     file: '02-do-dept/SP-DO-PLAN_v1.1.md',
    domain: 'plan', 도코드: 'jeju',
    // ★ 2026-07-23 수정 — '취득세'/'재산세'(개별 세액 확인 트리거) 삭제
    // (100건 사고실험에서 발견, 주피터 지시). '세정'/'지방세'는 정책·제도
    // 문의로도 쓰이는 일반 용어라 남기되, 개별 세액 확인은 SP 본문 §3에서
    // 시청 세무과·재산세과로 위임하도록 이미 명시해뒀다(이중 안전장치).
    kw: ['기획조정실', '고향사랑기부', '세정', '지방세', '청년정책', '인구정책', '예산', '기획'] },
  { code: 'SP-DO-SAFETY',   file: '02-do-dept/SP-DO-SAFETY_v1.1.md',
    domain: 'safety', 도코드: 'jeju',
    kw: ['안전건강실', '재난', '태풍', '호우', '보건정책', '감염병', '예방접종', '응급의료', '안전', '재난', '보건'] },
  { code: 'SP-DO-JACHI',    file: '02-do-dept/SP-DO-JACHI_v1.1.md',
    domain: 'jachi', 도코드: 'jeju',
    kw: ['특별자치행정국', '특별자치', '자치분권', '제주특별법'] },
  { code: 'SP-DO-ECON',     file: '02-do-dept/SP-DO-ECON_v1.1.md',
    domain: 'econ', 도코드: 'jeju',
    kw: ['경제활력국', '소상공인', '자영업', '중소기업', '일자리', '정책자금', '경제'] },
  { code: 'SP-DO-INNOV',    file: '02-do-dept/SP-DO-INNOV_v1.1.md',
    domain: 'innov', 도코드: 'jeju',
    kw: ['혁신산업국', '신재생', '풍력', '태양광', '디지털', 'AI산업', '스타트업', '산업'] },
  // 2026-07-04: 도 부서 13개 전부 템플릿+데이터 방식으로 이전 완료
  // (WELFARE로 시작한 proof of concept을 나머지 12개까지 확장). domain/
  // 도코드가 있으면 static file 대신 템플릿을 렌더링한다 — file은 하위
  // 호환/디버깅용 폴백으로만 남겨둔다(데이터 레코드가 없으면 여기로 폴백).
  { code: 'SP-DO-WELFARE',  file: '02-do-dept/SP-DO-WELFARE_v1.2.md',
    domain: 'welfare', 도코드: 'jeju',
    kw: ['복지가족국', '보건복지여성국', '기초생활수급', '기초연금', '보육료', '어린이집', '장애인복지', '한부모',
         '복지', '임신', '난임', '출산', '육아', '보육', '장애인', '여성가족', '차상위계층', '부모급여'] },  // ★ 2026-08-23 '난임'·'차상위계층'·'부모급여' 추가(4~5차 사고실험 발견)
  { code: 'SP-DO-CLIMATE',  file: '02-do-dept/SP-DO-CLIMATE_v1.1.md',
    domain: 'climate', 도코드: 'jeju',
    // ★ 2026-07-23 수정 — '분리배출' 삭제(100건 사고실험에서 발견,
    // 주피터 지시). "분리배출 위반 신고"처럼 실제로는 시청 생활환경과·
    // 환경지도과 단속 소관인 요청이 이 키워드로 도청에 잘못 걸렸다.
    // 배출규정 자체를 묻는 일반 문의는 '클린하우스'/'폐기물'/'환경'으로도
    // 충분히 잡힌다.
    kw: ['기후환경국', '전기차', '탄소중립', '환경영향평가', '클린하우스', '폐기물', '환경'] },
  { code: 'SP-DO-HOUSING',  file: '02-do-dept/SP-DO-HOUSING_v1.1.md',
    domain: 'housing', 도코드: 'jeju',
    // ★ 2026-07-23 수정 — '건축허가'/'건축인허가'/'건축' 삭제(주피터 지시,
    // 건축법 제14조 사고실험에서 발견). 이 도청 실국이 실제로 하는 일은
    // 주택정책·공공임대주택 등 정책 수립이고, 개별 건축허가는 시청
    // 건축과 소관이다 — division-master-data.json의 jeju-housing/
    // architecture 레코드 처분성_문구가 이미 "개별 건축허가는 시청
    // 건축과에서 확정된다"고 스스로 명시하고 있었는데, 이 라우팅
    // 키워드 테이블만 안 고쳐져 있었다. 지역 특정 없이 "건축허가
    // 신청하고 싶어요"라고만 말하면 이 목록에 걸려 도청으로 잘못
    // 라우팅되던 버그의 근본 원인.
    kw: ['건설주택국', '공공임대주택', '주택정책', '주택'] },
  { code: 'SP-DO-TRANSPORT',file: '02-do-dept/SP-DO-TRANSPORT_v1.1.md',
    domain: 'transport', 도코드: 'jeju',
    kw: ['교통항공국', '버스', '준공영제', '교통약자', '콜택시', '공영주차장', '공항', '제2공항', '교통'] },
  { code: 'SP-DO-CULTURE',  file: '02-do-dept/SP-DO-CULTURE_v1.1.md',
    domain: 'culture', 도코드: 'jeju',
    kw: ['문화체육교육국', '생활체육', '평생교육', '평생학습', '문화예술', '체육', '도서관', '문화'] },
  { code: 'SP-DO-TOURISM',  file: '02-do-dept/SP-DO-TOURISM_v1.2.md',
    domain: 'tourism', 도코드: 'jeju',
    kw: ['관광교류국', '관광지', '숙박업', '게스트하우스', '여행업', '국제교류', '관광'] },
  { code: 'SP-DO-AGRI',     file: '02-do-dept/SP-DO-AGRI_v1.1.md',
    domain: 'agri', 도코드: 'jeju',
    kw: ['농축산식품국', '농업경영체', '공익직불금', '농산물재해보험', '축산', '농업', '농사'] },
  { code: 'SP-DO-OCEAN',    file: '02-do-dept/SP-DO-OCEAN_v1.1.md',
    domain: 'ocean', 도코드: 'jeju',
    kw: ['해양수산국', '어업면허', '마을어장', '수산업', '양식업', '어업', '수산'] },
  // ★ 2026-08-02 신설, 2026-08-21 정정 — SP-DO-COMM/GENDER/GENERAL/SPOKES
  // 4개는 JEJU-DO-SP §3-1이 2026-07-10에 "상시 조직인데 라우팅 누락"이라고
  // 이미 자체 발견·기록해뒀으나, 그 이후 실제 이 테이블 반영이 빠져
  // 있었다(1차 SP-Tree 감사로 발견). 당시엔 domain/도코드가 없어 static
  // 경로였는데, **2026-08-04에 do-dept-master-data.json에 comm/general/
  // liaison/spokes 4개 도메인 템플릿 레코드가 이미 신설됐음에도 이 테이블이
  // 갱신 안 돼 계속 static file만 쓰고 있던 버그**를 02-do-dept 공백 채우기
  // 감사(2026-08-21) 중 발견 — SP-DEPT-{COMM,GENERAL,LIAISON,SPOKES}-
  // TEMPLATE_v1.0.md가 이미 디스크에 있는데 한 번도 렌더링된 적이 없었다.
  // 이 4개만 domain/도코드를 채워 템플릿 경로로 전환한다. GENDER는
  // do-dept-master-data.json에 아직 레코드가 없어(도메인 자체 미신설)
  // static 방식을 그대로 유지 — 잘못 domain을 채우면 존재하지 않는
  // 템플릿 fetch가 실패해 조용히 static으로 폴백되긴 하지만(코드상
  // try/catch), 혼란을 막기 위해 있는 그대로 static으로 둔다.
  { code: 'SP-DO-COMM',     file: '02-do-dept/SP-DO-COMM_v1.0.md',
    domain: 'comm', 도코드: 'jeju',
    kw: ['소통청렴담당관', '대민소통', '청렴', '감사'] },
  { code: 'SP-DO-GENDER',   file: '02-do-dept/SP-DO-GENDER_v1.0.md',
    kw: ['성평등여성정책관', '성평등', '성평등정책', '성평등 정책'] },
  { code: 'SP-DO-GENERAL',  file: '02-do-dept/SP-DO-GENERAL_v1.0.md',
    domain: 'general', 도코드: 'jeju',
    kw: ['총무과', '일반서무', '문서관리', '인사지원'] },
  { code: 'SP-DO-SPOKES',   file: '02-do-dept/SP-DO-SPOKES_v1.0.md',
    domain: 'spokes', 도코드: 'jeju',
    kw: ['대변인', '도정 홍보', '도정홍보', '언론대응', '보도자료'] },
  // ★ 2026-08-03 신설 — 전수 감사로 발견된 나머지 5개 누락(한시조직/
  // 특수조직). AIRPORTSUP/AUTONOMY/BALANCE/GANGJEONG은 do-dept-master-
  // data.json에 대응 도메인 레코드가 없어(2026-08-21 확인) static 방식이
  // 맞다 — LIAISON만 위 COMM/GENERAL/SPOKES와 동일 사유로 템플릿 경로로
  // 전환.
  { code: 'SP-DO-AIRPORTSUP', file: '02-do-dept/SP-DO-AIRPORTSUP_v1.0.md',
    kw: ['공항확충지원단', '제2공항', '공항확충', '공항 확충 사업'] },
  { code: 'SP-DO-AUTONOMY',   file: '02-do-dept/SP-DO-AUTONOMY_v1.0.md',
    kw: ['특별자치제도추진단', '특별자치제도', '분권 제도', '특례 확대'] },
  { code: 'SP-DO-BALANCE',    file: '02-do-dept/SP-DO-BALANCE_v1.0.md',
    kw: ['도시균형추진단', '지역균형발전', '원도심', '읍면 격차'] },
  { code: 'SP-DO-GANGJEONG',  file: '02-do-dept/SP-DO-GANGJEONG_v1.0.md',
    kw: ['강정공동체사업추진단', '강정마을', '강정 공동체'] },
  { code: 'SP-DO-LIAISON',    file: '02-do-dept/SP-DO-LIAISON_v1.0.md',
    domain: 'liaison', 도코드: 'jeju',
    kw: ['중앙협력본부', '국비 확보', '중앙정부 협력', '국비확보'] },
];

const JEJU_CITY_TABLE = [
  { code: 'SP-CITY-JEJU',      file: '04-city/jeju/SP-CITY-JEJU_v1.1.md',
    도코드: 'jeju', 시코드: 'jejusi',
    kw: ['제주시', '제주시청'] },
  { code: 'SP-CITY-SEOGWIPO',  file: '04-city/seogwipo/SP-CITY-SEOGWIPO_v1.1.md',
    도코드: 'jeju', 시코드: 'seogwipo',
    kw: ['서귀포시', '서귀포시청'] },
];

// ── 시청 국(局) 단위 키워드 테이블 (2026-07-23 신설) ────────────────
// 도청 실·국(JEJU_L2_TABLE)과 동일 철학 — city-dept-master-data.json에
// 이미 13개 레코드(제주시 6 + 서귀포시 7)가 완결돼 있었으나
// findStaffContact()(연락처 조회)에만 쓰이고 실제 SP 조립 경로에는
// 연결이 안 돼 있었다. 이 테이블이 그 배선을 완성한다.
// ✅ 2026-07-23(2차 수정) — 아래 공백을 city-dept-master-data.json에
// 제주시 '도시건설국'(국코드 housing, 2026-07-24 이전 이름 construction) 레코드를
// 신설해 해소했다. 2026-07-24: 도청 도메인 코드('housing')와 통일하기 위해
// construction → housing으로 국코드명을 바꿨다(실제 부서 실명은 무관, 내부
// 식별자만 통일 — 시청 16개 도메인 클래스 신설과 함께 정리).
// (구 주석: "제주시에는 안전도시건설국이 아직 없다" — jejusi.go.kr 조직도
// 실사 결과 제주시 조직명은 "안전"이 빠진 "도시건설국"으로 확인됨. 교통·
// 안전 업무는 별도로 이미 있는 'safety' 국코드(안전교통국)가 담당한다.)
const JEJU_CITY_DEPT_TABLE = [
  { 국코드: 'jachi', 시코드: 'jejusi',
    // ★ 2026-07-23 수정 — '인허가'/'인사'는 지나치게 포괄적인 일반명사라
    // "건축 인허가" 같은 타 국 소관 질의까지 자치행정국으로 잘못 흡수하는
    // 버그를 유발했다(사고실험으로 발견, 주피터 지시). 자치행정과 고유
    // 업무(총무·세정·조직)를 가리키는 구체적 단어만 남긴다.
    // ★ 2026-08-22 추가(사고실험으로 발견, 사용자 지시) — '여권' 누락이
    // 근본원인이었다: emdMatch가 pdvLocationHint(가상 주소)로 성공해도,
    // "규칙 F 일반화"(발화가 EMD 사무 아니라 시청 국 소관이면 우회)는
    // 이 kw 목록으로 판단하는데 '여권'이 없어 매칭 실패 → Rule F가 발동
    // 못 하고 EMD로 그대로 확정돼버렸다(EMD는 여권 "수행 불가"인데도).
    kw: ['자치행정국', '총무과', '기획예산과', '세무과', '재산세과', '지방세', '여권', '자동차세', '재산세',
         '지방공무원경력증명', '지방공무원 경력증명'] },  // ★ 2026-08-23 '자동차세'·'재산세'·'지방공무원경력증명'(띄어쓰기 변형 포함) 추가(사고실험 발견) — 취득세 등과 동일하게 개별 세목은 시청 세무과 소관
  { 국코드: 'safety', 시코드: 'jejusi',
    kw: ['안전교통국', '안전총괄과', '교통행정과', '차량관리과', '교통', '차량등록', '주정차', '자동차등록', '자동차 등록', '자동차 말소'] },  // ★ 2026-08-23 '자동차등록'·'자동차 말소' 추가(사고실험 발견) — "자동차등록증 재발급" 등 실발화형은 '차량등록'과 어순이 달라 안 걸렸음. '자동차 등록'(띄어쓰기)도 추가
  { 국코드: 'welfare', 시코드: 'jejusi',
    // ★ 2026-07-23 수정(100건 사고실험에서 발견, 주피터 지시) — 단독
    // '복지'/'위생'은 지나치게 포괄적이라 "행정복지센터"(읍면동 사무소의
    // 공식 명칭, 복지 상담 요청이 아님)까지 이 국으로 잘못 흡수했다.
    // '기초생활수급'은 반대로 빠져있어서 실제 신청 발화가 아예 안 걸리는
    // 공백이었다 — 추가.
    kw: ['복지위생국', '주민복지과', '노인복지과', '장애인복지과', '기초생활보장과', '여성가족과', '위생관리과', '기초생활수급'] },
  { 국코드: 'econ', 시코드: 'jejusi',
    kw: ['경제일자리국', '경제소상공인과', '일자리에너지과', '마을활력과', '정보화지원과', '소상공인', '일자리', '통신판매업'] },  // ★ 2026-08-23 '통신판매업' 추가(사고실험 발견)
  { 국코드: 'culture', 시코드: 'jejusi',
    kw: ['문화관광체육국', '문화예술과', '관광진흥과', '체육진흥과', '우당도서관', '탐라도서관', '제주아트센터', '문화', '관광', '체육'] },
  { 국코드: 'climate', 시코드: 'jejusi',
    kw: ['청정환경국', '환경관리과', '환경지도과', '생활환경과', '공원녹지과', '절물생태관리소', '환경', '공원'] },
  { 국코드: 'housing', 시코드: 'jejusi',
    // ★ 2026-07-23 신설 — jejusi.go.kr 조직도 실사(복수 독립 출처 교차검증).
    // '인허가'/'건설' 같은 과도하게 포괄적인 일반명사는 넣지 않는다
    // (자치행정국·복지위생국에서 겪은 과잉일반화 재발 방지, 주피터 지시).
    kw: ['도시건설국', '도시계획과', '도시재생과', '건축과', '주택과', '상하수도과',
         '건축', '건축허가', '건축인허가', '건축신고', '도시계획', '개별공시지가', '토지이용계획', '조상 땅 찾기'] },  // ★ 2026-08-23 '개별공시지가'·'토지이용계획'·'조상 땅 찾기' 추가(사고실험 발견)
  { 국코드: 'jachi', 시코드: 'seogwipo',
    // ★ 2026-08-22 추가(사고실험으로 발견) — jejusi와 동일 사유, '여권'.
    kw: ['자치행정국', '총무과', '기획예산과', '세무과', '평생교육과', '지방세', '여권', '자동차세'] },  // ★ 2026-08-23 '자동차세' 추가(사고실험 발견)
  { 국코드: 'welfare', 시코드: 'seogwipo',
    kw: ['복지위생국', '주민복지과', '노인복지과', '장애인복지과', '여성가족과', '위생관리과', '기초생활수급'] },
  { 국코드: 'culture', 시코드: 'seogwipo',
    kw: ['문화관광체육국', '문화예술과', '관광진흥과', '체육진흥과', '예술의전당', '도서관운영사무소', '공립미술관', '문화', '관광', '체육'] },
  { 국코드: 'agrieconomy', 시코드: 'seogwipo',
    kw: ['농수축산경제국', '경제일자리과', '디지털혁신과', '친환경농정과', '감귤유통과', '해양수산과', '청정축산과', '농업', '감귤', '수산', '축산', '소상공인', '통신판매업'] },  // ★ 2026-08-23 '소상공인'·'통신판매업' 추가(사고실험 발견) — 경제일자리과가 관할
  { 국코드: 'climate', 시코드: 'seogwipo',
    kw: ['청정환경국', '기후환경과', '생활환경과', '공원녹지과', '산림휴양관리소', '환경', '공원'] },
  { 국코드: 'housing', 시코드: 'seogwipo',
    kw: ['안전도시건설국', '안전총괄과', '도시과', '건축과', '건설과', '교통행정과', '상하수도과',
         '건축', '건축허가', '건축인허가', '건축신고', '건설', '도시계획', '상하수도', '개별공시지가', '토지이용계획', '조상 땅 찾기'] },  // ★ 2026-08-23 '개별공시지가'·'토지이용계획'·'조상 땅 찾기' 추가(사고실험 발견)
  { 국코드: 'health', 시코드: 'seogwipo',
    kw: ['서귀포보건소', '보건행정과', '건강증진과', '동부보건소', '서부보건소', '보건소', '보건'] },
];

// ★ 2026-08-23 신설(정부24 사고실험 발견) — jachi 도메인의 '여권' 키워드는
// "여권 재발급/발급"(실제로 시/군/구 여권과 접수 창구, BUG-016) 용도로
// 넣은 것인데, "여권 진위 확인"·"여권 발급 이력 조회"·"여권 발급 상태
// 조회"·"여권정보증명서 발급"처럼 외교부가 중앙에서 직접 조회해주는
// 서비스까지 '여권' 한 단어로 과잉매칭했다. 이 신호 단어가 함께 있으면
// jachi의 '여권' 매칭만 무시하고(그 레코드의 다른 kw는 그대로 유효),
// 국가기관(MOFA) 판별에 기회를 넘긴다 — _EMERGENCY_FALSE_POSITIVE_WORDS와
// 동일한 "알려진 근접 오탐 문구를 먼저 걸러낸다"는 원칙.
const _JACHI_PASSPORT_LOOKUP_SIGNALS = ['진위', '발급 이력', '발급이력', '발급 상태', '발급상태', '정보증명서', '발급기록', '분실', '유효기간', '만료일', '사전알림'];  // ★ 2026-08-23 '발급기록'/'분실' 추가(4차 사고실험 발견) — "여권 발급기록 증명서", "여권 분실 신고"도 외교부 중앙 대국민서비스. '유효기간'/'만료일'/'사전알림' 추가(7차 사고실험 발견) — "여권 유효기간 만료일 사전알림 서비스"도 외교부 중앙 대국민서비스

// ── 키워드 매칭 핵심 원시함수 — 어절 경계 인식 (2026-08-23 신설,
// "근본적 정상화" — 개별 단어 화이트리스트/복합어 치환 패치 폐기) ──────
// 배경(주피터 재차 지시): BUG-025("문화재"⊃"화재")·BUG-030(여권 계열)·
// BUG-031("소비자"⊃"비자", "수입영수증"⊃"입영")이 전부 같은 근본 원인의
// 서로 다른 증상이었다 — 이 파일 전역의 키워드 매칭이 전부
// `text.includes(k)`(순수 부분 문자열 포함 검사)를 썼는데, 이건 짧은
// 키워드가 우연히 더 긴 무관한 단어에 삼켜지는 걸 원천적으로 막을 수
// 없다. 발견될 때마다 그 단어 하나만 화이트리스트에 추가하거나 복합어로
// 바꾸는 방식(BUG-031까지의 조치)은, 아직 발견 안 된 수백 개의 잠재적
// 충돌이 코드베이스 전역에 그대로 남아있고 계속 재발할 수밖에 없는
// whack-a-mole이었다.
//
// 이 함수는 그 매칭 "원시함수" 자체를 고친다: 키워드가 매칭된 지점의
// 바로 앞 글자가 한글 음절(가-힣)이면, 그 키워드가 더 긴 단어의 일부로
// 삼켜진 것으로 보고 그 위치의 매칭은 무시한다("소비자"의 "비자",
// "수입영수증"의 "입영", "문화재"의 "화재" 전부 이 규칙 하나로 걸러짐).
// 뒤쪽 글자는 검사하지 않는다 — 한국어 조사(을/를/은/는/이/가/의/에/로
// 등)가 키워드 바로 뒤에 공백 없이 자연스럽게 붙는 게 정상이라
// ("여권을", "비자는") 뒤쪽까지 막으면 오히려 정상 매칭을 깨뜨린다.
// 텍스트 안에 키워드가 여러 번 나오면, 그 중 하나라도 어절 경계를
// 지키면 매칭으로 인정한다(한 곳은 삼켜져 있어도 다른 곳은 독립된
// 단어로 쓰였을 수 있으므로).
//
// 이 함수로 교체한 뒤에는 BUG-031에서 넣었던 '비자'→'비자 발급' 등의
// 복합어 치환이 더 이상 필요 없다 — bare '비자'를 그대로 둬도 "소비자"
// 오매칭 없이 "비자 발급"/"비자를 연장"은 정상 매칭된다(아래에서 원복).
// 이건 이 구조적 수정이 진짜로 근본 원인을 없앴다는 증거이기도 하다.
//
// 응급감지(EMERGENCY_RE)는 이 함수를 쓰지 않는다 — 그건 정규식 기반이고
// (DECISION-01에서 이미 검토·기각한 대로) 생명안전 게이트는 다른 위험
// 기준이 적용돼 화이트리스트 방식을 의도적으로 유지한다. 이 함수는
// 라우팅 정확도(오분류 비용이 낮은 영역)에만 적용한다.
function _kwMatch(text, k) {
  if (!text || !k) return false;
  let idx = text.indexOf(k);
  while (idx !== -1) {
    const before = idx > 0 ? text[idx - 1] : '';
    if (!/[가-힣]/.test(before)) return true;
    idx = text.indexOf(k, idx + 1);
  }
  return false;
}

function _matchCityDept(text, 시코드) {
  for (const d of _cityDeptTable()) {
    if (d.시코드 !== 시코드) continue;
    if (d.국코드 === 'jachi' && text.includes('여권') && _JACHI_PASSPORT_LOOKUP_SIGNALS.some(s => text.includes(s))) {
      const otherKw = d.kw.filter(k => k !== '여권');
      if (otherKw.some(k => _kwMatch(text, k))) return d;
      continue; // '여권' 신호만으로는 이 레코드를 확정하지 않는다.
    }
    if (d.kw.some(k => _kwMatch(text, k))) return d;
  }
  return null;
}

// ── 시청 국(局) 계층 LLM 구제망 (2026-08-23 신설 — "근본적 정상화" 2단계) ──
// 배경(주피터 지시): BUG-024~027을 거치며 정부24 실제 민원 246건을 사고
// 실험한 결과, 매번 "제네릭(시청 일반)으로 멈춤" 사례가 나올 때마다 kw
// 하나씩 추가해왔다. 이 패턴 자체가 근본 결함의 증상이었다 — 원인을
// 추적해보니 _buildCandidatesText()(step 5 전역 LLM 안전망)는 도청 L2·
// 시청 자체·국가기관 코드만 후보로 올리고 시청 국(局) 하위부서
// (SP-CITYDEPT-*)는 애초에 후보 목록에 넣지 않았고, agency/org 계층엔
// 있는 "키워드 매칭 실패 시 LLM에게 물어보는" 안전망(_resolveInstitutionMatch)이
// city-dept 계층엔 아예 없었다. 그 결과 정부24 서비스명이 kw와 정확히
// 안 겹치면(띄어쓰기 하나만 달라도) LLM이 판단할 기회조차 없이 조용히
// 시청 일반 안내로 떨어졌다 — 새 표현이 나올 때마다 kw를 무한히 추가해야
// 했던 진짜 이유. _resolveInstitutionMatch와 동일한 패턴을 이식해 이
// 계층에도 구제망을 만든다: 키워드 완전매칭(고속경로, 지금까지 쌓아온
// kw 전부는 이 경로로 계속 유효하며 LLM 호출 없이 그대로 확정)이 실패
// 하면, 그 시의 모든 국(局) 후보를 한 번에 놓고 LLM에게 직접 고르게
// 한다. 이러면 앞으로 kw 사전에 없는 새 표현이 나와도(정부24가 서비스를
// 추가하거나 이름을 바꿔도) 코드 수정 없이 LLM이 알아서 처리한다.
function _cityDeptCandidateList(시코드) {
  return _cityDeptTable()
    .filter(d => d.시코드 === 시코드)
    .map(d => {
      const code = `SP-CITYDEPT-${시코드}-${d.국코드}`;
      const label = d.국이름 || CITY_DEPT_DEFAULT_LABEL[d.국코드] || d.국코드;
      return {
        code, name: code,
        desc: `${label}(${d.국코드}) 소관 — 관련 키워드 예시: ${d.kw.slice(0, 6).join(', ')}`,
        _dept: d,
      };
    });
}

async function _resolveCityDeptMatch(text, 시코드, classifyFn) {
  const direct = _matchCityDept(text, 시코드);
  if (direct) return direct; // 강한/명시적 키워드 매칭 — 고속경로, LLM 호출 없음(회귀 없음)
  if (!classifyFn) return null; // 하위호환 — AI 상담 불가 시 기존처럼 즉시 미확정
  const candidates = _cityDeptCandidateList(시코드);
  if (!candidates.length) return null;
  let picked;
  try {
    picked = await _classifyDivisionFallback(text, candidates, classifyFn);
  } catch (e) {
    if (e instanceof NeedsClarificationSignal) throw e;
    picked = null;
  }
  return picked ? picked._dept : null;
}

// ── 국가기관(정책기관/집행기관) ↔ 시청 국(局, jachi 등) 계층 충돌 감지
// (2026-08-23 신설, "근본적 라우팅 정상화" 재설계 1단계) ───────────────
// 배경: BUG-016류(여권) — "여권 재발급"이 한때 MOFA(외교부, 국가기관)
// 키워드에 걸려 즉시 확정됐는데, 실제로는 시/군/구 여권과 소관이었다.
// 그 개별 사례는 데이터(키워드 사전) 수정으로 이미 막았지만(MOFA에서
// '여권' 제거 + jachi kw에 '여권' 추가), 구조적 원인 — 국가기관 계층이
// 시/군/구 계층의 존재를 전혀 모른 채 매칭 즉시 return하는 것 — 은
// 그대로 남아 있었다. 앞으로 또 다른 키워드가 두 사전에 동시에 오르면
// (사전 관리 실수로) 같은 클래스의 버그가 재발한다. 이 함수는 그 재발을
// 막는 구조적 안전망이다: 국가기관 후보가 서기 전에, 같은 발화가 시청
// 국(局) 도메인에도 매칭되는지 반드시 함께 확인하게 강제한다.
function _cityDeptCollisionCandidate(text, pdvLocationHint) {
  const cityMatch = _matchCity(text, pdvLocationHint);
  if (!cityMatch) return null;
  const deptMatch = _matchCityDept(text, cityMatch.시코드);
  if (!deptMatch) return null;
  const code = `SP-CITYDEPT-${cityMatch.시코드}-${deptMatch.국코드}`;
  const matchedKw = deptMatch.kw.filter(k => _kwMatch(text, k));
  return {
    code,
    name: code,
    desc: ROUTE_DESCRIPTIONS[code] ||
      `${cityMatch.시코드} 시청 ${deptMatch.국코드} 국(局) 소관 사무 (매칭 키워드: ${matchedKw.join(', ')})`,
    _cityMatch: cityMatch,
    _deptMatch: deptMatch,
  };
}

// ── 국가기관 ↔ "지방행정 전체"(시청 국 + 도청 실·국/L2) 계층 충돌 감지 ──
// 위 함수(시청 국)만으로는 못 잡는 사례가 실측으로 확인됐다: "소상공인
// 정책자금 대출 상담하고 싶어요" → MSS(중소벤처기업부, 국가기관)
// 정책기관 키워드('소상공인 정책자금')에 걸려 즉시 확정되는데, 실제로는
// 지역 소상공인 지원은 도청 SP-DO-ECON(L2, kw에 '소상공인' 포함) 소관인
// 경우가 실무상 더 흔하다 — 시청 국 계층과 완전히 같은 클래스의 충돌이
// 도청 L2 계층에서도 발생한다. 시청 국(더 구체적)을 먼저 확인하고,
// 없으면 도청 L2까지 확인한다.
function _localGovCollisionCandidate(text, pdvLocationHint) {
  const cityDept = _cityDeptCollisionCandidate(text, pdvLocationHint);
  if (cityDept) return cityDept;
  const { best: l2Best, topScore: l2Score } = _scoreMatchTies(text, _l2Table());
  if (!l2Best || l2Score === 0) return null;
  return {
    code: l2Best.code,
    name: l2Best.name || l2Best.code,
    desc: ROUTE_DESCRIPTIONS[l2Best.code] || l2Best.desc || `${l2Best.code}(도청 실·국) 소관 사무`,
    _l2Match: l2Best,
  };
}

// ── 경남 시/군 파일럿 인스턴스 (2026-07-24 신설) ──────────────────────
// 주피터 지시: "진주·창원·산청군을 샘플로, 관련 법규를 기반으로 시 도메인을
// 작성" — 단, 시청 국코드 도메인 클래스(SP-CITYDEPT-*-TEMPLATE 16개)는
// 이미 실명 없이도 작동하도록 설계됐으므로(2026-07-24 개편), 이 키워드
// 테이블도 제주(JEJU_CITY_DEPT_TABLE)처럼 실사로 확인한 실제 국·과 이름을
// 쓰지 않는다 — 진주·창원 실사는 아직 안 했다. 대신 전국 어디서나 통하는
// 도메인 범용 어휘만 쓴다(원칙 5: 키워드 과잉일반화 금지는 지키되, "지방세"
// 처럼 구체적인 사무명은 범용이라도 안전).
//
// 지자체유형 표본 선택 근거(주피터 지시로 마산 대신 재선정, 2026-07-24):
//   - 진주시: 일반시(구 없음)
//   - 창원시: 특례시(지방자치법 특례시 조항, 인구 100만 이상) + 산하 일반구 5개
//     (의창구·성산구·마산합포구·마산회원구·진해구 — 전부 법인격 없음,
//     처분권자는 창원시장). 마산합포구·마산회원구는 2010년 마산시가
//     창원시에 통합되며 신설된 구다(구 '마산시'는 더 이상 존재하지 않음
//     — "마산시" 자체를 표본으로 쓰면 안 된다는 게 이번 재선정의 핵심).
//   - 산청군: 군(읍면 중심 구조, 광역 산업팀 존재 패턴 검증용).
const GYEONGNAM_CITY_TABLE = [
  { code: 'SP-CITY-JINJU',    file: null, 도코드: 'gyeongnam', 시코드: 'jinju',
    kw: ['진주시', '진주시청'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'changwon',
    kw: ['창원시', '창원시청'] },
  // 아래 5개는 독립된 시가 아니라 창원시 산하 일반구다 — code는 일부러
  // SP-CITY-CHANGWON을 그대로 재사용한다(법인격이 없어 자체 루트 SP가
  // 없고, 상위 창원시 루트 SP를 공유하는 것이 정확한 법적 지위 반영).
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'uichang',
    kw: ['의창구'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'seongsan',
    kw: ['성산구'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'masanhappo',
    kw: ['마산합포구'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'masanhoewon',
    kw: ['마산회원구'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'jinhae',
    kw: ['진해구'] },
  { code: 'SP-CITY-SANCHEONG', file: null, 도코드: 'gyeongnam', 시코드: 'sancheong',
    kw: ['산청군', '산청군청'] },
];

// 도메인 범용 키워드 — 실명(국·과 명칭) 없이 전국 어디서나 통하는 사무명만
// 사용한다(2026-07-24 원칙: "부서 실명은 참고 정보일 뿐 라우팅에 필수가
// 아니다"). 자치구·일반구 구분 없이 동일 키워드를 쓴다 — 처분권 소재는
// city-dept-master-data.json의 지자체유형/처분권_문구가 담당하고, 이
// 테이블은 순수하게 "이 발화가 어느 도메인 사무인가"만 판별한다.
function _makeGenericCityDeptEntries(시코드) {
  return [
    { 국코드: 'plan', 시코드, kw: ['기획예산', '중장기계획', '인구정책'] },
    // ★ 2026-08-05 — '주민등록'·'인감증명'을 제거했다(부산 해운대구 EMD
    // 실사 중 발견, 이전 세션에서도 동일하게 발견했으나 커밋되지 않고
    // 유실됐던 수정 — 이번엔 이 nationwide 공용 함수 자체를 고쳐 부산뿐
    // 아니라 이 함수를 쓰는 모든 도에 일괄 적용한다). 주민등록등초본·
    // 인감증명 발급은 SP-EMD-TEMPLATE §3의 완결 처리 업무(읍면동 민원팀
    // 소관)다 — 이 두 단어가 시청/구청 국(局) 단위 jachi 키워드에 있으면
    // §CAPABILITIES 규칙 F(시청 국 소관 사무는 읍면동 생략)가 잘못
    // 발동해 "우1동 인감증명 발급받고 싶어요" 같은 발화가 정작 처리
    // 주체인 읍면동이 아니라 구청 자치행정국으로 잘못 넘어간다.
    // JEJU_CITY_DEPT_TABLE의 jachi 항목들은 애초에 이 두 단어를 넣지
    // 않고 있었다(자치행정국·총무과·세무과 등 국 단위 고유 업무만) —
    // 이 nationwide 함수도 그 원칙에 맞춘다.
    { 국코드: 'jachi', 시코드, kw: ['지방세', '재산세과', '세무과', '자치행정', '취득세', '자동차세'] },  // ★ 2026-08-23 '자동차세' 추가(사고실험 발견)
    { 국코드: 'safety', 시코드, kw: ['재난안전', '안전총괄', '주정차 단속'] },
    { 국코드: 'welfare', 시코드, kw: ['기초생활수급', '기초연금', '장애인복지', '주민복지과', '어린이집', '보육'] },
    { 국코드: 'econ', 시코드, kw: ['소상공인', '지역경제', '전통시장', '일자리과'] },
    { 국코드: 'culture', 시코드, kw: ['문화예술과', '생활체육', '평생학습', '도서관'] },
    { 국코드: 'climate', 시코드, kw: ['생활환경과', '폐기물', '공원녹지과', '쓰레기', '분리배출'] },
    { 국코드: 'housing', 시코드,
      kw: ['건축허가', '건축인허가', '건축 인허가', '건축신고', '도시계획과', '상하수도과'] },
    { 국코드: 'transport', 시코드, kw: ['교통행정과', '시내버스', '버스 노선', '버스', '교통약자'] },
    { 국코드: 'health', 시코드, kw: ['보건소', '예방접종', '건강검진'] },
  ];
}

const GYEONGNAM_CITY_DEPT_TABLE = [
  ..._makeGenericCityDeptEntries('jinju'),
  ..._makeGenericCityDeptEntries('changwon'),
  // 5개 일반구 — 국코드 범위를 자치행정/복지/건축 3개로만 좁힌다(§3
  // 파일럿 목적상 "일반구는 처분권이 없다"는 메커니즘 검증이 핵심이고,
  // 16개 전부 채우는 건 표본의 취지를 벗어난다 — 필요해지면 그때 확장).
  ..._makeGenericCityDeptEntries('uichang').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('seongsan').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('masanhappo').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('masanhoewon').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('jinhae').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('sancheong'),
];

// ── 부산 16개 자치구·군 + 서울 25개 자치구 — 1단계 확대 (2026-07-24) ────
// 경남 파일럿과 달리 여기는 전부 자치구(+기장군 1개는 군)라 처분권 예외
// (일반구)가 없다 — 지자체유형은 전부 '자치구'/'군'로 단순하다. 시코드는
// 부산·서울 동명 자치구(중구·강서구)가 서로 충돌하지 않도록 도 접두어를
// 붙인다(busan_/seoul_). 해운대구만 예외적으로 city-dept-master-data.json에
// 국이름을 실사 데이터(2026-07-24 Research)로 채운다 — "실사+메타데이터
// 혼합" 선례(계획서 v1.1 §5 1단계 참고), 이 배선 테이블 자체는 나머지
// 40개 구·군과 동일하게 범용 도메인 어휘만 쓴다(라우팅은 실명과 무관).
const BUSAN_GU = [
  ['busan_gangseo', '강서구'], ['busan_geumjeong', '금정구'], ['busan_gijang', '기장군'],
  ['busan_nam', '남구'], ['busan_dong', '동구'], ['busan_dongnae', '동래구'],
  ['busan_busanjin', '부산진구'], ['busan_buk', '북구'], ['busan_sasang', '사상구'],
  ['busan_saha', '사하구'], ['busan_seo', '서구'], ['busan_suyeong', '수영구'],
  ['busan_yeonje', '연제구'], ['busan_yeongdo', '영도구'], ['busan_jung', '중구'],
  ['busan_haeundae', '해운대구'],
];
const SEOUL_GU = [
  ['seoul_gangnam', '강남구'], ['seoul_gangdong', '강동구'], ['seoul_gangbuk', '강북구'],
  ['seoul_gangseo', '강서구'], ['seoul_gwanak', '관악구'], ['seoul_gwangjin', '광진구'],
  ['seoul_guro', '구로구'], ['seoul_geumcheon', '금천구'], ['seoul_nowon', '노원구'],
  ['seoul_dobong', '도봉구'], ['seoul_dongdaemun', '동대문구'], ['seoul_dongjak', '동작구'],
  ['seoul_mapo', '마포구'], ['seoul_seodaemun', '서대문구'], ['seoul_seocho', '서초구'],
  ['seoul_seongdong', '성동구'], ['seoul_seongbuk', '성북구'], ['seoul_songpa', '송파구'],
  ['seoul_yangcheon', '양천구'], ['seoul_yeongdeungpo', '영등포구'], ['seoul_yongsan', '용산구'],
  ['seoul_eunpyeong', '은평구'], ['seoul_jongno', '종로구'], ['seoul_jung', '중구'],
  ['seoul_jungnang', '중랑구'],
];

function _makeMetroCityTable(도코드, guList) {
  return guList.map(([시코드, 이름]) => ({
    code: `SP-CITY-${시코드.toUpperCase()}`, file: null, 도코드, 시코드,
    kw: [이름, `${이름}청`],
  }));
}
const BUSAN_CITY_TABLE = _makeMetroCityTable('busan', BUSAN_GU);
const SEOUL_CITY_TABLE = _makeMetroCityTable('seoul', SEOUL_GU);
const BUSAN_CITY_DEPT_TABLE = BUSAN_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));
const SEOUL_CITY_DEPT_TABLE = SEOUL_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

// ══════════════════════════════════════════════════════════
// 3단계 — 나머지 12개 도 시/군/구 183개 (2026-07-24, 계획서 v1.1 §5)
// 자동 생성됨(gen_nationwide_phase3.py) — 도메인 범용 어휘만 사용,
// 실명 조직명 없음(1·2단계와 동일 원칙).
// ══════════════════════════════════════════════════════════
const CHUNGBUK_GU = [
  ['chungbuk_goesan', '괴산군'],
  ['chungbuk_danyang', '단양군'],
  ['chungbuk_boeun', '보은군'],
  ['chungbuk_yeongdong', '영동군'],
  ['chungbuk_ogcheon', '옥천군'],
  ['chungbuk_eumseong', '음성군'],
  ['chungbuk_jecheon', '제천시'],
  ['chungbuk_jeungpyeong', '증평군'],
  ['chungbuk_jincheon', '진천군'],
  ['chungbuk_cheongju', '청주시'],
  ['chungbuk_chungju', '충주시'],
];
const CHUNGBUK_CITY_TABLE = _makeMetroCityTable('chungbuk', CHUNGBUK_GU);
const CHUNGBUK_CITY_DEPT_TABLE = CHUNGBUK_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const CHUNGNAM_GU = [
  ['chungnam_gyelyong', '계룡시'],
  ['chungnam_gongju', '공주시'],
  ['chungnam_geumsan', '금산군'],
  ['chungnam_nonsan', '논산시'],
  ['chungnam_dangjin', '당진시'],
  ['chungnam_bolyeong', '보령시'],
  ['chungnam_buyeo', '부여군'],
  ['chungnam_seosan', '서산시'],
  ['chungnam_seocheon', '서천군'],
  ['chungnam_asan', '아산시'],
  ['chungnam_yesan', '예산군'],
  ['chungnam_cheonan', '천안시'],
  ['chungnam_cheongyang', '청양군'],
  ['chungnam_taean', '태안군'],
  ['chungnam_hongseong', '홍성군'],
];
const CHUNGNAM_CITY_TABLE = _makeMetroCityTable('chungnam', CHUNGNAM_GU);
const CHUNGNAM_CITY_DEPT_TABLE = CHUNGNAM_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const DAEGU_GU = [
  ['daegu_gunwi', '군위군'],
  ['daegu_nam', '남구'],
  ['daegu_dalseo', '달서구'],
  ['daegu_dalseong', '달성군'],
  ['daegu_dong', '동구'],
  ['daegu_bug', '북구'],
  ['daegu_seo', '서구'],
  ['daegu_suseong', '수성구'],
  ['daegu_jung', '중구'],
];
const DAEGU_CITY_TABLE = _makeMetroCityTable('daegu', DAEGU_GU);
const DAEGU_CITY_DEPT_TABLE = DAEGU_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const DAEJEON_GU = [
  ['daejeon_daedeog', '대덕구'],
  ['daejeon_dong', '동구'],
  ['daejeon_seo', '서구'],
  ['daejeon_yuseong', '유성구'],
  ['daejeon_jung', '중구'],
];
const DAEJEON_CITY_TABLE = _makeMetroCityTable('daejeon', DAEJEON_GU);
const DAEJEON_CITY_DEPT_TABLE = DAEJEON_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const GANGWON_GU = [
  ['gangwon_gangleung', '강릉시'],
  ['gangwon_goseong', '고성군'],
  ['gangwon_donghae', '동해시'],
  ['gangwon_samcheog', '삼척시'],
  ['gangwon_sogcho', '속초시'],
  ['gangwon_yanggu', '양구군'],
  ['gangwon_yangyang', '양양군'],
  ['gangwon_yeongwol', '영월군'],
  ['gangwon_wonju', '원주시'],
  ['gangwon_inje', '인제군'],
  ['gangwon_jeongseon', '정선군'],
  ['gangwon_cheolwon', '철원군'],
  ['gangwon_chuncheon', '춘천시'],
  ['gangwon_taebaeg', '태백시'],
  ['gangwon_pyeongchang', '평창군'],
  ['gangwon_hongcheon', '홍천군'],
  ['gangwon_hwacheon', '화천군'],
  ['gangwon_hoengseong', '횡성군'],
];
const GANGWON_CITY_TABLE = _makeMetroCityTable('gangwon', GANGWON_GU);
const GANGWON_CITY_DEPT_TABLE = GANGWON_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const GYEONGBUK_GU = [
  ['gyeongbuk_gyeongsan', '경산시'],
  ['gyeongbuk_gyeongju', '경주시'],
  ['gyeongbuk_golyeong', '고령군'],
  ['gyeongbuk_gumi', '구미시'],
  ['gyeongbuk_gimcheon', '김천시'],
  ['gyeongbuk_mungyeong', '문경시'],
  ['gyeongbuk_bonghwa', '봉화군'],
  ['gyeongbuk_sangju', '상주시'],
  ['gyeongbuk_seongju', '성주군'],
  ['gyeongbuk_andong', '안동시'],
  ['gyeongbuk_yeongdeog', '영덕군'],
  ['gyeongbuk_yeongyang', '영양군'],
  ['gyeongbuk_yeongju', '영주시'],
  ['gyeongbuk_yeongcheon', '영천시'],
  ['gyeongbuk_yecheon', '예천군'],
  ['gyeongbuk_ulleung', '울릉군'],
  ['gyeongbuk_uljin', '울진군'],
  ['gyeongbuk_uiseong', '의성군'],
  ['gyeongbuk_cheongdo', '청도군'],
  ['gyeongbuk_cheongsong', '청송군'],
  ['gyeongbuk_chilgog', '칠곡군'],
  ['gyeongbuk_pohang', '포항시'],
];
const GYEONGBUK_CITY_TABLE = _makeMetroCityTable('gyeongbuk', GYEONGBUK_GU);
const GYEONGBUK_CITY_DEPT_TABLE = GYEONGBUK_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const GYEONGGI_GU = [
  ['gyeonggi_gapyeong', '가평군'],
  ['gyeonggi_goyang', '고양시'],
  ['gyeonggi_gwacheon', '과천시'],
  ['gyeonggi_gwangmyeong', '광명시'],
  ['gyeonggi_gwangju', '광주시'],
  ['gyeonggi_guli', '구리시'],
  ['gyeonggi_gunpo', '군포시'],
  ['gyeonggi_gimpo', '김포시'],
  ['gyeonggi_namyangju', '남양주시'],
  ['gyeonggi_dongducheon', '동두천시'],
  ['gyeonggi_bucheon', '부천시'],
  ['gyeonggi_seongnam', '성남시'],
  ['gyeonggi_suwon', '수원시'],
  ['gyeonggi_siheung', '시흥시'],
  ['gyeonggi_ansan', '안산시'],
  ['gyeonggi_anseong', '안성시'],
  ['gyeonggi_anyang', '안양시'],
  ['gyeonggi_yangju', '양주시'],
  ['gyeonggi_yangpyeong', '양평군'],
  ['gyeonggi_yeoju', '여주시'],
  ['gyeonggi_yeoncheon', '연천군'],
  ['gyeonggi_osan', '오산시'],
  ['gyeonggi_yongin', '용인시'],
  ['gyeonggi_uiwang', '의왕시'],
  ['gyeonggi_uijeongbu', '의정부시'],
  ['gyeonggi_icheon', '이천시'],
  ['gyeonggi_paju', '파주시'],
  ['gyeonggi_pyeongtaeg', '평택시'],
  ['gyeonggi_pocheon', '포천시'],
  ['gyeonggi_hanam', '하남시'],
  ['gyeonggi_hwaseong', '화성시'],
];
const GYEONGGI_CITY_TABLE = _makeMetroCityTable('gyeonggi', GYEONGGI_GU);
const GYEONGGI_CITY_DEPT_TABLE = GYEONGGI_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const GYEONGNAM_PHASE3_GU = [
  ['gyeongnam_geoje', '거제시'],
  ['gyeongnam_geochang', '거창군'],
  ['gyeongnam_goseong', '고성군'],
  ['gyeongnam_gimhae', '김해시'],
  ['gyeongnam_namhae', '남해군'],
  ['gyeongnam_milyang', '밀양시'],
  ['gyeongnam_sacheon', '사천시'],
  ['gyeongnam_yangsan', '양산시'],
  ['gyeongnam_uilyeong', '의령군'],
  ['gyeongnam_changnyeong', '창녕군'],
  ['gyeongnam_tongyeong', '통영시'],
  ['gyeongnam_hadong', '하동군'],
  ['gyeongnam_haman', '함안군'],
  ['gyeongnam_hamyang', '함양군'],
  ['gyeongnam_habcheon', '합천군'],
];
const GYEONGNAM_PHASE3_CITY_TABLE = _makeMetroCityTable('gyeongnam', GYEONGNAM_PHASE3_GU);
const GYEONGNAM_PHASE3_CITY_DEPT_TABLE = GYEONGNAM_PHASE3_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const INCHEON_GU = [
  ['incheon_ganghwa', '강화군'],
  ['incheon_geomdan', '검단구'],
  ['incheon_gyeyang', '계양구'],
  ['incheon_namdong', '남동구'],
  ['incheon_michuhol', '미추홀구'],
  ['incheon_bupyeong', '부평구'],
  ['incheon_seohae', '서해구'],
  ['incheon_yeonsu', '연수구'],
  ['incheon_yeongjong', '영종구'],
  ['incheon_ongjin', '옹진군'],
  ['incheon_jemulpo', '제물포구'],
];
const INCHEON_CITY_TABLE = _makeMetroCityTable('incheon', INCHEON_GU);
const INCHEON_CITY_DEPT_TABLE = INCHEON_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const JEONBUK_GU = [
  ['jeonbuk_gochang', '고창군'],
  ['jeonbuk_gunsan', '군산시'],
  ['jeonbuk_gimje', '김제시'],
  ['jeonbuk_namwon', '남원시'],
  ['jeonbuk_muju', '무주군'],
  ['jeonbuk_buan', '부안군'],
  ['jeonbuk_sunchang', '순창군'],
  ['jeonbuk_wanju', '완주군'],
  ['jeonbuk_igsan', '익산시'],
  ['jeonbuk_imsil', '임실군'],
  ['jeonbuk_jangsu', '장수군'],
  ['jeonbuk_jeonju', '전주시'],
  ['jeonbuk_jeongeub', '정읍시'],
  ['jeonbuk_jinan', '진안군'],
];
const JEONBUK_CITY_TABLE = _makeMetroCityTable('jeonbuk', JEONBUK_GU);
const JEONBUK_CITY_DEPT_TABLE = JEONBUK_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const JEONNAM_GWANGJU_GU = [
  ['jeonnam_gwangju_gangjin', '강진군'],
  ['jeonnam_gwangju_goheung', '고흥군'],
  ['jeonnam_gwangju_gogseong', '곡성군'],
  ['jeonnam_gwangju_gwangsan', '광산구'],
  ['jeonnam_gwangju_gwangyang', '광양시'],
  ['jeonnam_gwangju_gulye', '구례군'],
  ['jeonnam_gwangju_naju', '나주시'],
  ['jeonnam_gwangju_nam', '남구'],
  ['jeonnam_gwangju_damyang', '담양군'],
  ['jeonnam_gwangju_dong', '동구'],
  ['jeonnam_gwangju_mogpo', '목포시'],
  ['jeonnam_gwangju_muan', '무안군'],
  ['jeonnam_gwangju_boseong', '보성군'],
  ['jeonnam_gwangju_bug', '북구'],
  ['jeonnam_gwangju_seo', '서구'],
  ['jeonnam_gwangju_suncheon', '순천시'],
  ['jeonnam_gwangju_sinan', '신안군'],
  ['jeonnam_gwangju_yeosu', '여수시'],
  ['jeonnam_gwangju_yeonggwang', '영광군'],
  ['jeonnam_gwangju_yeongam', '영암군'],
  ['jeonnam_gwangju_wando', '완도군'],
  ['jeonnam_gwangju_jangseong', '장성군'],
  ['jeonnam_gwangju_jangheung', '장흥군'],
  ['jeonnam_gwangju_jindo', '진도군'],
  ['jeonnam_gwangju_hampyeong', '함평군'],
  ['jeonnam_gwangju_haenam', '해남군'],
  ['jeonnam_gwangju_hwasun', '화순군'],
];
const JEONNAM_GWANGJU_CITY_TABLE = _makeMetroCityTable('jeonnam-gwangju', JEONNAM_GWANGJU_GU);
const JEONNAM_GWANGJU_CITY_DEPT_TABLE = JEONNAM_GWANGJU_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

const ULSAN_GU = [
  ['ulsan_nam', '남구'],
  ['ulsan_dong', '동구'],
  ['ulsan_bug', '북구'],
  ['ulsan_ulju', '울주군'],
  ['ulsan_jung', '중구'],
];
const ULSAN_CITY_TABLE = _makeMetroCityTable('ulsan', ULSAN_GU);
const ULSAN_CITY_DEPT_TABLE = ULSAN_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

// ── 국가기관 라우팅 테이블 (JEJU-NATIONAL-SP §3-1, 1차 배치 8개) ───
// 도청 트리(JEJU-DO-SP)와 형제 관계 — 매칭되면 DO-SP 대신 이쪽으로 간다.
// 지방세(도청)와 국세(세무서) 혼동 방지를 위해 '세금' 같은 범용어는 넣지
// 않고, 국가기관임이 분명한 고유명사만 트리거로 쓴다.
const JEJU_NATIONAL_TABLE = [
  // ★ 2026-08-02(2차 감사) — 이 표의 file: 필드를 전부 제거했다.
  // 저장소에 실존한 적이 없는 경로였다(항상 실패하는 fetch를 시도했다
  // 잡는 죽은 코드 — _fetchNatText가 이제 entry.file 부재를 정상
  // 케이스로 취급해 바로 정직한 정보없음 문구로 간다). 1차 경로는
  // national-agency-master-data.json의 template 필드 기반 렌더링이며,
  // 이 표는 domain/도코드 라우팅 키워드 원본으로만 쓰인다.
  { code: 'SP-NAT-TAX',
    domain: 'tax', 도코드: 'jeju',
    kw: ['세무서', '국세', '종합소득세', '부가가치세', '법인세', '홈택스', '사업자등록', '세금 환급금',
         '소득확인증명서', '신고사실없음', '세금 납부내역', '현금영수증', '근로장려금', '자녀장려금',
         '폐업사실증명'] },  // ★ 2026-08-23 추가(1~5차 사고실험 발견)
  { code: 'SP-NAT-COURT',
    domain: 'court', 도코드: 'jeju',
    kw: ['지방법원', '등기소', '나의사건검색', '전자소송', '등기부등본'] },
  { code: 'SP-NAT-NPS',
    domain: 'nps', 도코드: 'jeju',
    kw: ['국민연금'] },
  { code: 'SP-NAT-NHIS',
    domain: 'nhis', 도코드: 'jeju',
    kw: ['건강보험공단', '건강보험료', '건강검진', '건강보험 자격확인서', '건강보험 자격득실',
         '본인부담금 환급', '본인부담 상한액', '건강보험 EDI', '건강보험증 재발급',
         '4대 사회보험료 완납증명서', '4대사회보험', '진료받은 내역',
         '차상위 본인부담', '노인장기요양', '건강보험 연말정산'] },  // ★ 2026-08-23 추가(1~5차 사고실험 발견) — 순수 '건강보험'은 과잉매칭 우려로 안 넣고 실제 발화형 복합어만 추가
  { code: 'SP-NAT-IMMIGRATION',
    domain: 'immigration', 도코드: 'jeju',
    kw: ['출입국', '외국인청', '체류자격', '비자', '귀화', '하이코리아', '외국인등록', '외국국적동포', '국내거소'] },  // ★ 2026-08-23 추가(1·5차 사고실험 발견) — "외국인등록사실증명"·"외국국적동포 국내거소" 등. '비자' bare 유지 — _kwMatch(어절 경계 인식)로 교체돼 "소비자" 오매칭 없이 안전(BUG-031의 복합어 치환은 이제 불필요해 원복, 구조적 수정으로 대체됨)
  { code: 'SP-NAT-POST',
    domain: 'post', 도코드: 'jeju',
    kw: ['우체국', '우정청', '등기우편', '우편'] },
  { code: 'SP-NAT-POLICE',
    domain: 'police', 도코드: 'jeju',
    kw: ['지방경찰청', '국가경찰', '112', '고소장', '수사', '경찰 사건조회', '경찰 사건 조회', '사이버 범죄', '사이버범죄'] },  // ★ 2026-08-23 추가 — 처음엔 bare '경찰'을 넣었다가 "자치경찰이랑 일반경찰 차이가 뭐예요"(비교 질문) 회귀를 일으켜서, 정부24 실제 서비스명과 일치하는 복합어로 교체. '사이버 범죄'는 5차 사고실험 발견
  { code: 'SP-NAT-LABOR',
    domain: 'labor', 도코드: 'jeju',
    kw: ['근로복지공단', '산재보험', '산업재해', '고용보험', '가족돌봄휴직',
         '실업급여', '산재 요양', '생활안정자금', '보험료 완납 증명원',
         '국가기술자격', '내일배움카드'] },  // ★ 2026-08-23 추가(1~5차 사고실험 발견)
  { code: 'SP-NAT-PROSECUTION',
    domain: 'prosecution', 도코드: 'jeju',
    kw: ['검찰청', '고소장', '고발', '공소', '검사실', '검찰 사건조회', '검찰 사건 조회'] },  // ★ 2026-08-23 추가(사고실험 발견) — bare '검찰'은 정치·시사 언급과 과잉매칭 위험이 있어(police의 '경찰' 회귀와 동일 클래스 위험) 정부24 실제 서비스명과 일치하는 복합어로 대체
  { code: 'SP-NAT-COASTGUARD',
    domain: 'coastguard', 도코드: 'jeju',
    kw: ['해양경찰', '122', '해양사고', '해양레저 안전'] },
  { code: 'SP-NAT-WEATHER',
    domain: 'weather', 도코드: 'jeju',
    kw: ['기상청', '기상특보', '태풍정보', '태풍 정보', '실시간 기상'] },
  { code: 'SP-NAT-PPS',
    domain: 'pps', 도코드: 'jeju',
    kw: ['조달청', '나라장터'] },
  { code: 'SP-NAT-MMA',
    domain: 'mma', 도코드: 'jeju',
    kw: ['병무청', '징병검사', '입영'] },  // ★ 2026-08-23 bare '입영' 유지(원복) — _kwMatch(어절 경계 인식)로 교체돼 "수입영수증" 오매칭 없이 안전(BUG-031의 복합어 치환은 이제 불필요해 원복, 구조적 수정으로 대체됨)
  { code: 'SP-NAT-VETERANS',
    domain: 'veterans', 도코드: 'jeju',
    kw: ['보훈청', '국가유공자', '보훈급여', '취업지원 대상자'] },  // ★ 2026-08-23 '취업지원 대상자' 추가(사고실험 발견) — 이전에 잘못된 자매 테이블(_guessNatAgencyDomainFromText용)에 넣었던 걸 여기(JEJU_NATIONAL_TABLE, 실제 _matchNational이 쓰는 표)로 정정
  { code: 'SP-NAT-LABORREL',
    domain: 'laborrel', 도코드: 'jeju',
    kw: ['노동위원회', '부당해고'] },
  { code: 'SP-NAT-PROBATION',
    domain: 'probation', 도코드: 'jeju',
    kw: ['보호관찰', '준법지원센터', '사회봉사명령'] },
  { code: 'SP-NAT-ANIMALQUARANTINE',
    domain: 'animalquarantine', 도코드: 'jeju',
    kw: ['동물검역', '가축검역', '반려동물 검역', '반려동물 동반', '축산물 반입'] },
  { code: 'SP-NAT-HUMANQUARANTINE',
    domain: 'humanquarantine', 도코드: 'jeju',
    kw: ['검역소', '해외감염병', '해외 출국 예방접종', '검역감염병'] },
  { code: 'SP-NAT-AGROQUALITY',
    domain: 'agroquality', 도코드: 'jeju',
    kw: ['농산물품질관리원', '원산지표시', '친환경인증', '친환경 인증', 'GAP 인증'] },
  { code: 'SP-NAT-FISHQUALITY',
    domain: 'fishquality', 도코드: 'jeju',
    kw: ['수산물품질관리원', '수산물 원산지', '수산물 검사'] },
  { code: 'SP-NAT-FOODIMPORT',
    domain: 'foodimport', 도코드: 'jeju',
    kw: ['수입식품검사', '수입식품 통관'] },
  { code: 'SP-NAT-DATA',
    domain: 'data', 도코드: 'jeju',
    kw: ['공공데이터청', '공공데이터포털'] },
  { code: 'SP-NAT-RADIO',
    domain: 'radio', 도코드: 'jeju',
    kw: ['전파관리소', '무선국'] },
  { code: 'SP-NAT-ENV',
    domain: 'env', 도코드: 'jeju',
    kw: ['영산강유역환경청', '환경영향평가'] },
  { code: 'SP-NAT-LABORIMPROVE',
    domain: 'laborimprove', 도코드: 'jeju',
    kw: ['임금체불', '근로개선지도'] },
  { code: 'SP-NAT-INTERNET',
    domain: 'internet', 도코드: 'jeju',
    kw: ['스마트쉼센터', '인터넷과의존', '스마트폰과의존'] },
  { code: 'SP-NAT-AIRPORT',
    domain: 'airport', 도코드: 'jeju',
    kw: ['공항공사', '제주국제공항 운영', '항공편', '제주공항', '비행기 출발', '비행기 도착', '공항 주차장', '공항 이용', '공항 분실물'] },
  { code: 'SP-NAT-PORT',
    domain: 'port', 도코드: 'jeju',
    kw: ['해양수산청', '선박등록', '해상교통관제'] },
  // ★ 2026-07-24 신설(100건 사고실험에서 발견) — 아래 6개는 템플릿
  // (09-national/agencies/templates/SP-NAT-*-TEMPLATE_*.md)과
  // national-agency-master-data.json 레코드가 이미 완비돼 있었는데,
  // 이 라우팅 테이블에 등록이 안 돼 있어 "제주세관 통관 절차 문의"
  // 같은 정당한 질문이 전부 L2 미매칭(일반 안내)으로 떨어지고
  // 있었다 — 콘텐츠 저작은 끝났는데 배선만 누락된 사례. 키워드는
  // 이미 다른 도의 지연조회(SP-NATIONAL-LAZY)가 쓰는
  // _NAT_AGENCY_DOMAIN_KEYWORDS의 customs/bok/stat과 동일하게 맞춰
  // 일관성을 유지했다(원형-인스턴스 키워드 불일치 방지).
  { code: 'SP-NAT-CUSTOMS',
    domain: 'customs', 도코드: 'jeju',
    kw: ['세관', '관세', '통관'] },
  { code: 'SP-NAT-BOK',
    domain: 'bok', 도코드: 'jeju',
    kw: ['한국은행'] },
  { code: 'SP-NAT-STAT',
    domain: 'stat', 도코드: 'jeju',
    kw: ['통계청'] },
  { code: 'SP-NAT-FORESTRESEARCH',
    domain: 'forestresearch', 도코드: 'jeju',
    kw: ['산림과학원', '임업연구'] },
  { code: 'SP-NAT-FORESTSEED',
    domain: 'forestseed', 도코드: 'jeju',
    kw: ['산림품종관리센터', '산림용 종자', '종자검사'] },
  { code: 'SP-NAT-FORESTCOOP',
    domain: 'forestcoop', 도코드: 'jeju',
    kw: ['산림조합'] },
];

// ── 카탈로그 등록만 되고 개별 SP는 아직 없는 국가기관 (§4 공통 폴백) ──
// v1.2: 28개 전 기관 SP 작성 완료로 이 목록은 현재 비어 있다. 향후 카탈로그에
// 새 기관이 추가되고 SP가 아직 없을 때를 위해 매커니즘은 유지한다.
const CATALOG_ONLY = [];

// ── 도별 라우팅 테이블 레지스트리 (2026-07-19 전국 확장 Phase 1) ────────
// province-master-data.json(도 단위 SP)과 같은 원칙을 L2(실·국)/시/국가기관
// 라우팅 테이블에도 적용한다 — 다른 도가 추가될 때 GYEONGGI_L2_TABLE 등을
// 새로 선언하고 여기 레지스트리에 키만 추가하면 된다(이 파일의 매칭
// 로직·호출부는 전혀 안 고쳐도 됨).
//
// 2026-07-19 확인 — do-dept-master-data.json에는 이미 gyeonggi(13개)·
// busan(13개) 부서 인스턴스(연락처 등 마스터데이터)가 존재한다. 그런데
// **그건 이 레지스트리와 다른 것**이다 — 여기 필요한 건 "어떤 키워드가
// 어느 부서로 라우팅되는가"이고, 그건 도마다 실사로 조사해야 하는
// 별개 데이터(Phase 2)다. do-dept-master-data.json에 레코드가 있다고
// 자동으로 라우팅 가능한 건 아니다 — 실사 없이 jeju의 키워드를 그대로
// 복붙해 gyeonggi/busan을 "작동하는 것처럼" 보이게 하지 않는다(허위
// 데이터를 실사로 위장하는 것보다, 미등록 상태를 정직하게 유지하는
// 게 낫다는 이 프로젝트의 반복된 원칙 — TBD 마커 관행과 동일).

// ── 부산 L2 라우팅 테이블 (2026-07-20 실사) ─────────────────────
// 원형 도메인 16개 중 부산이 실제로 보유한 16개 전부 채움(health/family/
// sports 포함 — 부산은 이 3개가 제주와 달리 별도 국으로 분리돼 있음).
// 근거: do-dept-master-data.json 부산 레코드(나무위키 2026-07-10 + 공식
// 조직도 검색결과 2026-07-20 재검증) — 실 이름이 불확실한 econ/culture는
// 안정적인 과 이름 위주로 키워드를 구성했다(§비고 참고, 확정 아님).
const BUSAN_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'busan', file: null,
    // ★ 2026-07-24 수정 — '취득세'/'재산세' 삭제(제주 SP-DO-PLAN에서
    // 이미 같은 이유로 제거한 것과 동일 — 개별 세액 확인은 도청이 아니라
    // 시/군/구 세무과 소관인데, 이 두 키워드가 도청 기획조정실로 잘못
    // 흡수했다). '지방세'/'세정'은 정책·제도 문의로도 쓰이는 일반 용어라
    // 남긴다.
    kw: ['고향사랑기부', '지방세', '세정', '예산', '기획조정실'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'busan', file: null,
    kw: ['시민안전실', '재난', '태풍', '호우', '자연재난', '사회재난', '원자력안전', '특별사법경찰'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'busan', file: null,
    kw: ['자치분권', '협치행정', '통합민원'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'busan', file: null,
    kw: ['투자유치', '중소기업', '소상공인', '자영업', '일자리', '신용보증재단', '경제진흥원'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'busan', file: null,
    kw: ['인공지능', '빅데이터', '바이오헬스', '연구개발', '미래기술', '스타트업'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'busan', file: null,
    kw: ['기초생활수급', '기초연금', '장애인복지', '노인복지', '돌봄복지'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'busan', file: null,
    kw: ['건강정책', '보건위생', '감염병', '예방접종', '건강검진', '보건'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'busan', file: null,
    kw: ['여성가족', '임신', '출산', '보육', '어린이집', '아동청소년', '아동수당'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'busan', file: null,
    kw: ['녹색환경정책실', '기후대기', '자원순환', '분리배출', '폐기물',
         '산림녹지', '공원운영', '하천관리', '수질개선'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'busan', file: null,
    kw: ['건축주택국', '건축허가', '건축정책', '주택정책', '도시디자인'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'busan', file: null,
    kw: ['도시철도', '지하철', '버스운영', '택시운수', '물류정책', '공공교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'busan', file: null,
    kw: ['문화예술', '문화유산', '영상콘텐츠', '도서관'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'busan', file: null,
    kw: ['체육정책', '생활체육', '체육시설', '전국체전'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'busan', file: null,
    kw: ['관광마이스', '관광정책', '해양레저관광', '국제협력', '숙박업', '여행업'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'busan', file: null,
    kw: ['농축산유통', '축산', '농업'] },
  { code: 'SP-DO-OCEAN', domain: 'ocean', 도코드: 'busan', file: null,
    kw: ['해운항만', '수산정책', '수산진흥', '어업', '수산업', '양식업'] },
];

// ── 부산 출자출연기관(org) — 파일럿 1호 (2026-08-04) ──────────────────
// ★ 2026-08-04 신설 — directCode 도(道) 하드코딩 버그 수정(같은 세션)의
// 실사용 검증을 위한 최소 파일럿. PROVINCE_TABLES.busan에 이제까지
// org 필드 자체가 없어서(§ jeju 키에만 있었음), 설령 K-Search가 부산
// 기관 프로필을 정확히 찾아 directCode를 반환해도 이 배열이 없으면
// _findEntryAcrossProvinces가 여전히 못 찾는다 — 코드 수정과 실제
// 콘텐츠(SP 파일+이 테이블 엔트리) 양쪽이 다 있어야 완주한다.
// 부산교통공사(BTC) 1건만 우선 등록 — SP-ORG-BUSANTRANSIT_v1.0.md
// 참조(지방공기업법 제49조 근거, 2026-08-04 웹서치 확인).
const BUSAN_ORG_TABLE = [
  { code: 'SP-ORG-BUSANTRANSIT', name: '부산교통공사(BTC)',
    desc: '당신은 **부산교통공사(BTC)**를 대표하는 AI 레이어다. 주요 소관: 부산 도시철도 1~4호선 건설·운영, 도시교통 발전·시민복리 증진 관련 부대사업',
    kw: ['부산교통공사', '부산 도시철도', '부산 지하철', '휴메트로', '도시철도 1호선', '도시철도 2호선', '도시철도 3호선', '도시철도 4호선'],
    file: '07-org/SP-ORG-BUSANTRANSIT_v1.0.md' },
  { code: "SP-ORG-BEPA", name: "부산경제진흥원", desc: "당신은 **부산경제진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 중소기업·소상공인 경영지원", kw: ["부산경제진흥원", "부산 중소기업 지원"], file: "07-org/SP-ORG-BEPA_v1.0.md" },
  { code: "SP-ORG-BSCF", name: "부산문화재단", desc: "당신은 **부산문화재단**을(를) 대표하는 AI 레이어다. 주요 소관: 문화예술 진흥·지원사업", kw: ["부산문화재단", "부산 문화예술 지원"], file: "07-org/SP-ORG-BSCF_v1.0.md" },
  { code: "SP-ORG-BSCULTUREHALL", name: "부산문화회관", desc: "당신은 **부산문화회관**을(를) 대표하는 AI 레이어다. 주요 소관: 문화예술 공연·전시시설 운영", kw: ["부산문화회관", "부산 공연장"], file: "07-org/SP-ORG-BSCULTUREHALL_v1.0.md" },
  { code: "SP-ORG-BSSSO", name: "부산광역시사회서비스원", desc: "당신은 **부산광역시사회서비스원**을(를) 대표하는 AI 레이어다. 주요 소관: 사회서비스 제공(재가돌봄·아이돌봄 등)", kw: ["부산광역시사회서비스원", "부산 사회서비스"], file: "07-org/SP-ORG-BSSSO_v1.0.md" },
  { code: "SP-ORG-BSCGF", name: "부산신용보증재단", desc: "당신은 **부산신용보증재단**을(를) 대표하는 AI 레이어다. 주요 소관: 소상공인·중소기업 신용보증", kw: ["부산신용보증재단", "부산 신용보증"], file: "07-org/SP-ORG-BSCGF_v1.0.md" },
  { code: "SP-ORG-BSWOMEN", name: "부산여성가족과 평생교육진흥원", desc: "당신은 **부산여성가족과 평생교육진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 양성평등·가족·청소년 지원사업, 평생교육", kw: ["부산여성가족과평생교육진흥원", "부산 여성가족", "부산 가정폭력 상담"], file: "07-org/SP-ORG-BSWOMEN_v1.0.md" },
  { code: "SP-ORG-BSMED", name: "부산의료원", desc: "당신은 **부산의료원**을(를) 대표하는 AI 레이어다. 주요 소관: 지역 공공의료(진료·응급의료·공공보건사업)", kw: ["부산의료원", "부산 공공의료"], file: "07-org/SP-ORG-BSMED_v1.0.md" },
  { code: "SP-ORG-BIPA", name: "부산정보산업진흥원", desc: "당신은 **부산정보산업진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 지식정보산업(IT·소프트웨어) 육성·지원", kw: ["부산정보산업진흥원", "부산 IT 지원", "BIPA"], file: "07-org/SP-ORG-BIPA_v1.0.md" },
  { code: "SP-ORG-BTP", name: "부산테크노파크", desc: "당신은 **부산테크노파크**을(를) 대표하는 AI 레이어다. 주요 소관: 지역 산업기술 지원·기업지원", kw: ["부산테크노파크", "부산 기업지원", "BTP"], file: "07-org/SP-ORG-BTP_v1.0.md" },
  { code: "SP-ORG-ASIADCC", name: "아시아드CC(주)", desc: "당신은 **아시아드CC(주)**을(를) 대표하는 AI 레이어다. 주요 소관: 관광·컨벤션·전시 시설 운영", kw: ["아시아드CC", "아시아드 골프장"], file: "07-org/SP-ORG-ASIADCC_v1.0.md" },
  { code: "SP-ORG-BCC", name: "영화의전당", desc: "당신은 **영화의전당**을(를) 대표하는 AI 레이어다. 주요 소관: 문화예술(영화) 공연·전시시설 운영", kw: ["영화의전당", "부산국제영화제 상영관", "BIFF 상영관"], file: "07-org/SP-ORG-BCC_v1.0.md" },
  { code: "SP-ORG-BSDESIGN", name: "부산디자인진흥원", desc: "당신은 **부산디자인진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 디자인산업 육성·지원", kw: ["부산디자인진흥원", "부산 디자인 지원"], file: "07-org/SP-ORG-BSDESIGN_v1.0.md" },
  { code: "SP-ORG-BSSTEP", name: "부산과학기술고등교육진흥원", desc: "당신은 **부산과학기술고등교육진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 지역 과학기술·고등교육 진흥 정책연구", kw: ["부산과학기술고등교육진흥원", "부산 과학기술 진흥"], file: "07-org/SP-ORG-BSSTEP_v1.0.md" },
  { code: "SP-ORG-BDI", name: "부산연구원", desc: "당신은 **부산연구원**을(를) 대표하는 AI 레이어다. 주요 소관: 부산 지역 정책연구", kw: ["부산연구원", "부산 정책연구", "BDI"], file: "07-org/SP-ORG-BDI_v1.0.md" },
  { code: "SP-ORG-BGCF", name: "부산광역시글로벌도시재단", desc: "당신은 **부산광역시글로벌도시재단**을(를) 대표하는 AI 레이어다. 주요 소관: 자매도시 국제교류, 공공외교, 외국인 지원", kw: ["부산광역시글로벌도시재단", "부산 자매도시", "부산 국제교류재단", "BGCF"], file: "07-org/SP-ORG-BGCF_v1.0.md" },
  { code: "SP-ORG-BTIP", name: "부산기술창업투자원", desc: "당신은 **부산기술창업투자원**을(를) 대표하는 AI 레이어다. 주요 소관: 기술창업기업 투자·육성 지원사업", kw: ["부산기술창업투자원", "부산 창업투자"], file: "07-org/SP-ORG-BTIP_v1.0.md" },
];


// ── 서울 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 서울이 보유한 14개(agri/ocean 없음 — 도심형 광역시라
// 정상적 공백) 채움. 근거: org.seoul.go.kr 공식 조직도(2026-07-20) +
// news.seoul.go.kr 2026년 부서별 주요업무계획 + opengov.seoul.go.kr
// 업무추진비 공개문서. 산하과 상세는 다수 도메인에서 TBD로 남아있어
// 안정적인 국/실/본부 단위 키워드 위주로 구성(§비고 참고).
// ==== SEOUL_ORG_TABLE (2026-08-14, 전국 확대 배치) ====
const SEOUL_ORG_TABLE = [
  { code: "SP-ORG-SEOULMED", name: "서울의료원", desc: "당신은 **서울의료원**을(를) 대표하는 AI 레이어다. 주요 소관: 지역 공공의료(진료·응급의료·공공보건사업)", kw: ["서울의료원", "서울 공공의료"], file: "07-org/SP-ORG-SEOULMED_v1.0.md" },
  { code: "SP-ORG-SDI", name: "서울연구원", desc: "당신은 **서울연구원**을(를) 대표하는 AI 레이어다. 주요 소관: 서울시 지역 정책연구", kw: ["서울연구원", "서울 정책연구", "SDI"], file: "07-org/SP-ORG-SDI_v1.0.md" },
  { code: "SP-ORG-SBA", name: "서울경제진흥원", desc: "당신은 **서울경제진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 중소기업·소상공인·스타트업 지원사업", kw: ["서울경제진흥원", "서울 창업 지원", "SBA"], file: "07-org/SP-ORG-SBA_v1.0.md" },
  { code: "SP-ORG-SEOULCGF", name: "서울신용보증재단", desc: "당신은 **서울신용보증재단**을(를) 대표하는 AI 레이어다. 주요 소관: 소상공인·중소기업 신용보증", kw: ["서울신용보증재단", "서울 신용보증"], file: "07-org/SP-ORG-SEOULCGF_v1.0.md" },
  { code: "SP-ORG-SEJONGPAC", name: "세종문화회관", desc: "당신은 **세종문화회관**을(를) 대표하는 AI 레이어다. 주요 소관: 공연·전시시설 운영, 문화예술 프로그램", kw: ["세종문화회관", "서울 공연장"], file: "07-org/SP-ORG-SEJONGPAC_v1.0.md" },
  { code: "SP-ORG-SWFF", name: "서울시여성가족재단", desc: "당신은 **서울시여성가족재단**을(를) 대표하는 AI 레이어다. 주요 소관: 양성평등·가족·청소년 지원사업", kw: ["서울시여성가족재단", "서울 여성가족", "서울 가정폭력 상담"], file: "07-org/SP-ORG-SWFF_v1.0.md" },
  { code: "SP-ORG-SWF", name: "서울시복지재단", desc: "당신은 **서울시복지재단**을(를) 대표하는 AI 레이어다. 주요 소관: 사회복지 정책연구·지원사업", kw: ["서울시복지재단", "서울 복지 지원"], file: "07-org/SP-ORG-SWF_v1.0.md" },
  { code: "SP-ORG-SFAC", name: "서울문화재단", desc: "당신은 **서울문화재단**을(를) 대표하는 AI 레이어다. 주요 소관: 문화예술 진흥·지원사업", kw: ["서울문화재단", "서울 문화예술 지원", "SFAC"], file: "07-org/SP-ORG-SFAC_v1.0.md" },
  { code: "SP-ORG-SPO", name: "서울시립교향악단", desc: "당신은 **서울시립교향악단**을(를) 대표하는 AI 레이어다. 주요 소관: 오케스트라 공연·음악교육 사업", kw: ["서울시립교향악단", "SPO 공연"], file: "07-org/SP-ORG-SPO_v1.0.md" },
  { code: "SP-ORG-SDF", name: "서울디자인재단", desc: "당신은 **서울디자인재단**을(를) 대표하는 AI 레이어다. 주요 소관: 디자인산업 육성·지원, DDP 운영", kw: ["서울디자인재단", "DDP", "동대문디자인플라자"], file: "07-org/SP-ORG-SDF_v1.0.md" },
  { code: "SP-ORG-SEOULSCHOL", name: "서울장학재단", desc: "당신은 **서울장학재단**을(를) 대표하는 AI 레이어다. 주요 소관: 장학금 지원사업", kw: ["서울장학재단", "서울 장학금"], file: "07-org/SP-ORG-SEOULSCHOL_v1.0.md" },
  { code: "SP-ORG-SILE", name: "서울특별시평생교육진흥원", desc: "당신은 **서울특별시평생교육진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 평생교육 진흥사업", kw: ["서울특별시평생교육진흥원", "서울 평생교육"], file: "07-org/SP-ORG-SILE_v1.0.md" },
  { code: "SP-ORG-SEOUL50PLUS", name: "서울특별시50플러스재단", desc: "당신은 **서울특별시50플러스재단**을(를) 대표하는 AI 레이어다. 주요 소관: 50+세대(장년층) 일자리·교육·복지 지원", kw: ["서울특별시50플러스재단", "50플러스", "서울 장년층 일자리"], file: "07-org/SP-ORG-SEOUL50PLUS_v1.0.md" },
  { code: "SP-ORG-SEOULAI", name: "서울에이아이재단", desc: "당신은 **서울에이아이재단**을(를) 대표하는 AI 레이어다. 주요 소관: AI산업 육성·지원", kw: ["서울에이아이재단", "서울 AI 지원"], file: "07-org/SP-ORG-SEOULAI_v1.0.md" },
  { code: "SP-ORG-DASAN120", name: "120다산콜재단", desc: "당신은 **120다산콜재단**을(를) 대표하는 AI 레이어다. 주요 소관: 서울시 행정·생활정보 통합상담(120다산콜센터) 운영", kw: ["120다산콜재단", "다산콜센터", "서울시 민원상담"], file: "07-org/SP-ORG-DASAN120_v1.0.md" },
  { code: "SP-ORG-SEOULTOURISM", name: "서울관광재단", desc: "당신은 **서울관광재단**을(를) 대표하는 AI 레이어다. 주요 소관: 관광 마케팅·프로모션, MICE 지원", kw: ["서울관광재단", "서울 관광 마케팅", "MICE 지원"], file: "07-org/SP-ORG-SEOULTOURISM_v1.0.md" },
  { code: "SP-ORG-SEOULINVEST", name: "서울투자진흥재단", desc: "당신은 **서울투자진흥재단**을(를) 대표하는 AI 레이어다. 주요 소관: 외국인 투자유치·기업 투자지원", kw: ["서울투자진흥재단", "서울 투자유치"], file: "07-org/SP-ORG-SEOULINVEST_v1.0.md" },
];

const SEOUL_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'seoul', file: null,
    // ★ 2026-07-24 수정 — 부산과 동일한 이유로 '취득세'/'재산세' 삭제.
    kw: ['지방세', '예산', '기획조정실', '정책기획관'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'seoul', file: null,
    kw: ['재난안전실', '재난', '안전관리'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'seoul', file: null,
    kw: ['행정국', '총무', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'seoul', file: null,
    kw: ['경제실', '소상공인', '중소기업', '민생노동', '일자리'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'seoul', file: null,
    kw: ['디지털도시', '스마트시티', '정보화'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'seoul', file: null,
    kw: ['복지실', '복지정책', '장애인복지', '기초생활수급', '기초연금'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'seoul', file: null,
    kw: ['시민건강국', '식품정책', '정신건강', '보건', '감염병', '건강증진', '응급의료'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'seoul', file: null,
    kw: ['여성가족실', '저출생', '여성정책', '가족정책', '보육', '아동돌봄', '출산'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'seoul', file: null,
    kw: ['기후환경본부', '기후환경', '대기질', '미세먼지', '탄소중립'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'seoul', file: null,
    kw: ['주택실', '주택정책', '전략주택공급', '공동주택', '재건축'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'seoul', file: null,
    kw: ['교통실', '대중교통', '버스', '지하철', '따릉이'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'seoul', file: null,
    kw: ['문화본부', '문화정책', '문화예술', '도서관', '박물관'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'seoul', file: null,
    kw: ['관광체육국', '관광', '관광정책', '마이스'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'seoul', file: null,
    kw: ['체육진흥', '생활체육', '체육시설'] },
];


// ── 인천 L2 라우팅 테이블 ⚠️ 전부 "예정(안)" ─────────────────────
// 2026-07-03 발표된 조직개편안(2026-08 시행 예정, 시의회 심의 중) 기준.
// 아직 발효 전이라 실사용 전 8월 조례 통과 여부 재확인 필수. 신설/개편이
// 보도로 확인된 8개 도메인만 채움 — 나머지 도메인은 이번 개편 보도에
// 언급이 없어 전혀 조사되지 않았다(레코드 없음, 허위로 채우지 않음).
const INCHEON_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'incheon', file: null,
    kw: ['정책조정국', 'ABC+E', '미래기획', '콘텐츠산업', '투자유치'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'incheon', file: null,
    kw: ['기후에너지국', '탄소중립', '에너지전환'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'incheon', file: null,
    kw: ['교통정책국', '철도도로국', '대중교통', '철도', '도로'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'incheon', file: null,
    kw: ['미래산업본부', '첨단산업', '바이오산업'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'incheon', file: null,
    kw: ['경제국', '민생경제'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'incheon', file: null,
    kw: ['보건복지국', '통합돌봄국', '기초생활수급', '기초연금', '돌봄'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'incheon', file: null,
    kw: ['여성가족국', '여성가족', '임신', '출산', '보육'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'incheon', file: null,
    kw: ['도시계획국', '도시균형국', '원도심혁신국', '제물포', '문학', '부평'] },
];


// ── 대전 L2 라우팅 테이블 (2026-07-20 최초 실사, 확인된 것만) ────────
// 원형 도메인 중 부서명까지 확인된 10개만 채움. 근거 대부분이 2026년 1월
// 인사 명단(전임 시장 체제)이라, 2026-06-03 지방선거로 취임한 신임
// 시장(민선 9기)의 조직개편 여부는 미확인 — 재검증 주기 짧게 가져갈 것.
const DAEJEON_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'daejeon', file: null,
    kw: ['기획조정실', '예산편성', '정책개발'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'daejeon', file: null,
    kw: ['시민안전실', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'daejeon', file: null,
    kw: ['행정자치국', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'daejeon', file: null,
    kw: ['경제국', '기업지원국', '기업자금', '창업', '투자유치'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'daejeon', file: null,
    kw: ['미래전략산업실', '전략산업'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'daejeon', file: null,
    kw: ['복지국', '기초생활수급', '기초연금', '장애인복지', '노인복지'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'daejeon', file: null,
    kw: ['체육건강국', '보건', '건강'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'daejeon', file: null,
    kw: ['체육건강국', '체육', '생활체육'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'daejeon', file: null,
    kw: ['문화예술관광국', '문화예술'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'daejeon', file: null,
    kw: ['관광'] },
];


// ── 울산 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 울산이 보유한 13개(family/agri/ocean 없음) 채움.
// 근거: ulsan.go.kr 공식 조직도(실국사업소 목록) — 다른 도와 달리 최근
// 개편 보도를 못 찾아 비교적 안정적인 상태로 판단(재검증 급하지 않음).
const ULSAN_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'ulsan', file: null,
    kw: ['기획조정실', '기획', '예산'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'ulsan', file: null,
    kw: ['시민안전실', '자연재난', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'ulsan', file: null,
    kw: ['행정국', '자치행정', '세정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'ulsan', file: null,
    kw: ['경제산업실', '경제정책', '기업지원', '기업투자'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'ulsan', file: null,
    kw: ['AI수도추진본부', '인공지능', 'AI'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'ulsan', file: null,
    kw: ['복지보훈여성국', '복지정책', '장애인복지', '기초생활수급', '기초연금', '보훈', '여성',
         '임신', '출산', '보육'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'ulsan', file: null,
    kw: ['시민건강국', '시민건강', '감염병', '보건'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'ulsan', file: null,
    kw: ['환경국', '환경정책', '녹지정원'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'ulsan', file: null,
    kw: ['건설주택국', '주택', '건설'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'ulsan', file: null,
    kw: ['교통국', '버스택시', '광역트램', '대중교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'ulsan', file: null,
    kw: ['문화관광체육국', '문화예술', '태화강국가정원'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'ulsan', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'ulsan', file: null,
    kw: ['체육', '생활체육'] },
];


// ── 세종 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 세종이 보유한 12개(innov/family/health/ocean 없음)
// 채움. 근거: sejong.go.kr 공식 조직도. 세종은 단층제(시·군·구 없음)라
// city/national 테이블 개념 자체가 다른 도와 다르게 설계돼야 할 수 있음
// (PHASE C에서 검토 필요).
const SEJONG_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'sejong', file: null,
    kw: ['기획조정실', '기획', '예산'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'sejong', file: null,
    kw: ['시민안전실', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'sejong', file: null,
    kw: ['자치행정국', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'sejong', file: null,
    kw: ['경제산업국', '경제', '산업', '투자유치'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'sejong', file: null,
    kw: ['보건복지국', '기초생활수급', '기초연금', '보건', '복지', '임신', '출산', '보육'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'sejong', file: null,
    kw: ['환경녹지국', '환경', '녹지'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'sejong', file: null,
    kw: ['도시주택국', '주택', '건축'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'sejong', file: null,
    kw: ['교통국', '대중교통', 'BRT'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'sejong', file: null,
    kw: ['문화체육관광국', '문화'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'sejong', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'sejong', file: null,
    kw: ['체육', '생활체육'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'sejong', file: null,
    kw: ['도농상생국', '농업', '농촌'] },
];


// ── 충북 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 충북이 보유한 14개(health/ocean 없음) 채움. 근거:
// chungbuk.go.kr 공식 조직도. family는 국이 아니라 도지사 직속 '관'
// (양성평등가족정책관) — 조직 규모가 작아도 라우팅 코드는 동일하게 부여.
const CHUNGBUK_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'chungbuk', file: null,
    kw: ['기획관리실', '인구청년정책', '법무혁신'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'chungbuk', file: null,
    kw: ['재난안전실', '사회재난', '자연재난', '재난'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'chungbuk', file: null,
    kw: ['행정국'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'chungbuk', file: null,
    kw: ['경제통상국', '경제기업', '일자리정책', '소상공인', '에너지', '국제통상'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'chungbuk', file: null,
    kw: ['신성장산업국', '바이오산업', '방사광가속기', '과학기술'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'chungbuk', file: null,
    kw: ['보건복지국', '기초생활수급', '기초연금', '보건', '복지'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'chungbuk', file: null,
    kw: ['양성평등가족정책관', '여성가족', '임신', '출산', '보육'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'chungbuk', file: null,
    kw: ['농정국', '농업정책', '스마트농산', '농식품유통', '축수산', '동물방역'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'chungbuk', file: null,
    kw: ['환경산림국', '환경', '산림'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'chungbuk', file: null,
    kw: ['균형건설국', '주택', '건설'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'chungbuk', file: null,
    kw: ['균형건설국', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'chungbuk', file: null,
    kw: ['문화체육관광국', '문화'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'chungbuk', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'chungbuk', file: null,
    kw: ['체육'] },
];


// ── 충남 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 충남이 보유한 15개(health 없음) 채움. 근거:
// chungnam.go.kr 공식 조직도. 자치안전실(jachi+safety)·산업경제실
// (econ+innov)처럼 인접 도메인 2개를 한 실에 담는 패턴이 특징적이다.
const CHUNGNAM_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'chungnam', file: null,
    kw: ['기획조정실', '데이터담당관', '고등교육정책'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'chungnam', file: null,
    kw: ['자치안전실', '안전정책', '사회재난', '자연재난', '재난'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'chungnam', file: null,
    kw: ['자치안전실', '자치행정', '새마을공동체', '세정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'chungnam', file: null,
    kw: ['산업경제실', '경제정책', '일자리기업지원', '산업입지'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'chungnam', file: null,
    kw: ['산업경제실', '미래산업', '산업육성', '탄소중립경제'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'chungnam', file: null,
    kw: ['복지보건국', '복지보육', '경로보훈', '장애인복지', '보건정책', '감염병', '건강증진'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'chungnam', file: null,
    kw: ['여성가족정책관', '여성가족', '임신', '출산', '보육'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'chungnam', file: null,
    kw: ['농림축산국', '농업', '축산'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'chungnam', file: null,
    kw: ['기후환경국', '기후', '환경'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'chungnam', file: null,
    kw: ['건설교통국', '주택', '건설'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'chungnam', file: null,
    kw: ['건설교통국', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'chungnam', file: null,
    kw: ['문화체육관광국', '문화정책', '문화유산'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'chungnam', file: null,
    kw: ['관광진흥', '관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'chungnam', file: null,
    kw: ['체육진흥', '체육'] },
  { code: 'SP-DO-OCEAN', domain: 'ocean', 도코드: 'chungnam', file: null,
    kw: ['해양수산국', '해양', '수산', '어업'] },
];


// ── 전북 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 전부 채운 첫 사례. welfare/family/health가 전부
// 복지여성보건국 하나를 가리킨다. econ(기업유치지원실 매핑)은 불확실 —
// 재확인 필요. 근거: jeonbuk.go.kr 공식 조직도 + 2026년 하반기 인사 발령.
const JEONBUK_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'jeonbuk', file: null,
    kw: ['기획조정실', '인구청년정책', '법무행정'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'jeonbuk', file: null,
    kw: ['도민안전실', '재난', '특별사법경찰', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'jeonbuk', file: null,
    kw: ['자치행정국', '자치행정', '세정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'jeonbuk', file: null,
    kw: ['기업유치지원실', '투자유치', '기업지원'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'jeonbuk', file: null,
    kw: ['미래산업국', '이차전지', '탄소산업'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'jeonbuk', file: null,
    kw: ['복지여성보건국', '기초생활수급', '기초연금', '복지'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'jeonbuk', file: null,
    kw: ['복지여성보건국', '여성가족', '임신', '출산', '보육'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'jeonbuk', file: null,
    kw: ['복지여성보건국', '보건', '건강'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'jeonbuk', file: null,
    kw: ['농생명축산식품국', '스마트농산', '동물방역', '농업'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'jeonbuk', file: null,
    kw: ['환경녹지국', '환경', '녹지'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'jeonbuk', file: null,
    kw: ['건설교통국', '주택건축', '토지정보'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'jeonbuk', file: null,
    kw: ['건설교통국', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'jeonbuk', file: null,
    kw: ['문화체육관광국', '문화산업', '유산관리'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'jeonbuk', file: null,
    kw: ['관광산업', '관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'jeonbuk', file: null,
    kw: ['체육정책', '체육'] },
  { code: 'SP-DO-OCEAN', domain: 'ocean', 도코드: 'jeonbuk', file: null,
    kw: ['새만금해양수산국', '새만금', '해양항만', '수산'] },
];


// ── 경북 L2 라우팅 테이블 ⚠️ 조직개편 중으로 신뢰도 낮음 ───────────
// 검색 중 서로 다른 시점의 조직도 스냅샷 3개가 충돌(family/innov/safety
// 담당 부서명이 스냅샷마다 다름) — 3선 이철우 도지사(민선 9기) 취임과
// 함께 실제 개편이 진행 중인 것으로 보인다. 최신으로 보이는 조합을
// 채택했으나 다른 도보다 신뢰도가 명확히 낮다 — 최우선 재검증 대상.
const GYEONGBUK_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'gyeongbuk', file: null,
    kw: ['기획조정실'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'gyeongbuk', file: null,
    kw: ['재난안전실', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'gyeongbuk', file: null,
    kw: ['자치행정국', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'gyeongbuk', file: null,
    kw: ['경제통상국', '경제산업', '일자리'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'gyeongbuk', file: null,
    kw: ['메타AI과학국', '메타버스', '과학산업', 'AI'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'gyeongbuk', file: null,
    kw: ['복지건강국', '기초생활수급', '기초연금', '보건', '복지'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'gyeongbuk', file: null,
    kw: ['저출생극복본부', '여성아동', '출산', '보육', '임신'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'gyeongbuk', file: null,
    kw: ['농축산유통국', '농업', '축산'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'gyeongbuk', file: null,
    kw: ['기후환경국', '환경산림', '산림', '환경'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'gyeongbuk', file: null,
    kw: ['건설도시국', '주택', '건설'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'gyeongbuk', file: null,
    kw: ['건설도시국', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'gyeongbuk', file: null,
    kw: ['문화관광체육국', '문화'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'gyeongbuk', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'gyeongbuk', file: null,
    kw: ['체육'] },
];


// ── 경남 L2 라우팅 테이블 ⚠️ 조직도 스냅샷 불일치, 신뢰도 낮음 ────────
// 경북과 동일한 문제 — 검색 중 서로 다른 시점의 조직도 스냅샷이 충돌
// (교통/균형발전/산업경제 부서명이 스냅샷마다 다름). 공식 '조직도' 메뉴
// 페이지 기준을 우선 채택했으나 다른 도보다 신뢰도 낮음 — 재검증 권장.
const GYEONGNAM_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'gyeongnam', file: null,
    kw: ['기획조정실'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'gyeongnam', file: null,
    kw: ['재난안전건설본부', '도민안전본부', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'gyeongnam', file: null,
    kw: ['자치행정국', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'gyeongnam', file: null,
    kw: ['일자리경제국', '경제통상', '경제기업'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'gyeongnam', file: null,
    kw: ['산업혁신국', '산업정책', '산업통상'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'gyeongnam', file: null,
    kw: ['복지보건국', '기초생활수급', '기초연금', '보건', '복지'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'gyeongnam', file: null,
    kw: ['여성가족아동국', '여성가족', '아동청소년', '임신', '출산', '보육'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'gyeongnam', file: null,
    kw: ['농정국', '농업정책', '농업'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'gyeongnam', file: null,
    kw: ['환경산림국', '기후환경산림', '환경', '산림'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'gyeongnam', file: null,
    kw: ['도시주택국', '주택'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'gyeongnam', file: null,
    kw: ['도시교통국', '물류공항철도', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'gyeongnam', file: null,
    kw: ['문화관광체육국', '문화'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'gyeongnam', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'gyeongnam', file: null,
    kw: ['체육'] },
  { code: 'SP-DO-OCEAN', domain: 'ocean', 도코드: 'gyeongnam', file: null,
    kw: ['해양수산국', '해양', '수산', '어업'] },
];

// ── 도청 국(局) 범용 도메인 키워드 (2026-07-24 신설) ──────────────────
// 시청 계층의 _makeGenericCityDeptEntries와 동일 원칙 — 실사로 확인된
// 실명이 없는 도메인도 이 범용 키워드로 즉시 라우팅 가능하다. 이미 실명
// 키워드가 있는 도메인(예: 충북 jachi의 '행정국')과 병행해도 무해하다
// (여러 kw 배열이 같은 domain+도코드로 매칭되면 먼저 매칭된 것을 쓰므로,
// 아래 함수는 항상 그 도의 L2_TABLE 배열 뒤쪽에 "빠진 도메인만" 이어붙인다).
function _makeGenericL2Entries(도코드, domains) {
  const KW = {
    plan: ['기획조정실', '예산담당관', '인구정책'],
    safety: ['재난안전실', '자연재난', '사회재난'],
    jachi: ['자치행정국', '지방세', '세정과'],
    econ: ['경제정책국', '일자리정책', '중소기업'],
    innov: ['산업혁신국', '과학기술', '신성장산업'],
    welfare: ['복지정책국', '기초생활보장', '장애인복지'],
    climate: ['환경정책국', '기후변화', '대기환경'],
    housing: ['건설주택국', '도시계획', '주택정책'],
    transport: ['교통정책국', '대중교통', '광역교통'],
    culture: ['문화체육국', '문화예술', '생활체육'],
    sports: ['체육진흥과', '전문체육'],
    tourism: ['관광정책과', '관광진흥', '관광자원'],
    // 2026-07-25 추가(주피터 지시) — 99건 사고실험 A범주에서 "우리 농장
    // 작물 재배 컨설팅을 받고 싶어"가 매칭 실패했다. EXPERT_REGISTRY 60개
    // 안에 농업 전문가 자격이 없어 새 페르소나를 만들려 했으나, 실제
    // 내용(SP 원문) 없이 등록만 하는 건 지어내는 것이라 하지 않는다 —
    // 대신 이미 존재하는 도청 농정과(agri) 도메인이 실제로 이 업무를
    // 담당하므로(오늘 완비한 도청 실국 체계), 여기 키워드를 보강해
    // 연결한다.
    agri: ['농정국', '농업정책', '축산', '작물 재배', '농업 기술 지도', '농가 컨설팅'],
    ocean: ['해양수산국', '수산업', '어업'],
    health: ['보건정책과', '질병예방', '건강증진'],
    family: ['여성가족과', '보육정책', '양성평등'],
  };
  return domains.map(domain => ({
    code: `SP-DO-${domain.toUpperCase()}`, domain, 도코드, file: null, kw: KW[domain],
  }));
}
const FULL16_DOMAINS = ['plan', 'safety', 'jachi', 'econ', 'innov', 'welfare', 'climate',
  'housing', 'transport', 'culture', 'sports', 'tourism', 'agri', 'ocean', 'health', 'family'];

// ── 2026-07-24 — 기존 도들의 빈 도메인 채우기(주피터 지시: "도청 실국
// 나머지 완비"를 시청과 동일하게 실사 없이 즉시 완비) ──
// 제주는 제외한다 — sports/health/family가 "없는 게 아니라 의도적으로
// 다른 도메인에 통합"된 실제 조직 구조이기 때문(§0 헤더 주석 참고).
SEOUL_L2_TABLE.push(..._makeGenericL2Entries('seoul', ['agri', 'ocean']));
INCHEON_L2_TABLE.push(..._makeGenericL2Entries('incheon',
  ['safety', 'jachi', 'culture', 'sports', 'tourism', 'agri', 'ocean', 'health']));
DAEJEON_L2_TABLE.push(..._makeGenericL2Entries('daejeon',
  ['climate', 'housing', 'transport', 'agri', 'ocean', 'family']));
ULSAN_L2_TABLE.push(..._makeGenericL2Entries('ulsan', ['agri', 'ocean', 'family']));
SEJONG_L2_TABLE.push(..._makeGenericL2Entries('sejong', ['innov', 'ocean', 'health', 'family']));
CHUNGBUK_L2_TABLE.push(..._makeGenericL2Entries('chungbuk', ['ocean', 'health']));
CHUNGNAM_L2_TABLE.push(..._makeGenericL2Entries('chungnam', ['health']));
GYEONGBUK_L2_TABLE.push(..._makeGenericL2Entries('gyeongbuk', ['ocean', 'health']));
GYEONGNAM_L2_TABLE.push(..._makeGenericL2Entries('gyeongnam', ['health']));

// ── 경기도 — do-dept-master-data.json에 13개 도메인 실사 데이터가 이미
// 있었는데 라우팅 테이블(L2_TABLE) 자체가 없어서 죽어있었다(2026-07-24
// 발견). 실제 부서명(gg.go.kr 확인분)을 키워드로 써서 살리고, 미확인
// 3개 도메인(sports/health/family)은 범용 키워드로 채운다.
// ==== GYEONGGI_ORG_TABLE (2026-08-14, 전국 확대 배치) ====
const GYEONGGI_ORG_TABLE = [
  { code: "SP-ORG-GGDJTP", name: "경기대진테크노파크", desc: "당신은 **경기대진테크노파크**을(를) 대표하는 AI 레이어다. 주요 소관: 지역 산업기술 지원·기업지원", kw: ["경기대진테크노파크", "포천 기업지원", "북부권 산업기술"], file: "07-org/SP-ORG-GGDJTP_v1.0.md" },
  { code: "SP-ORG-GGSTEP", name: "경기도경제과학진흥원", desc: "당신은 **경기도경제과학진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 중소기업·소상공인 경영지원, 과학기술 진흥", kw: ["경기도경제과학진흥원", "경기도 중소기업 지원", "경과원"], file: "07-org/SP-ORG-GGSTEP_v1.0.md" },
  { code: "SP-ORG-GGMED", name: "경기도의료원", desc: "당신은 **경기도의료원**을(를) 대표하는 AI 레이어다. 주요 소관: 지역 공공의료(진료·응급의료·공공보건사업)", kw: ["경기도의료원", "공공의료", "경기 의료원"], file: "07-org/SP-ORG-GGMED_v1.0.md" },
  { code: "SP-ORG-GGJOB", name: "경기도일자리재단", desc: "당신은 **경기도일자리재단**을(를) 대표하는 AI 레이어다. 주요 소관: 고용·일자리 지원사업", kw: ["경기도일자리재단", "경기 일자리", "취업지원"], file: "07-org/SP-ORG-GGJOB_v1.0.md" },
  { code: "SP-ORG-GGFUTURE", name: "경기도미래세대재단", desc: "당신은 **경기도미래세대재단**을(를) 대표하는 AI 레이어다. 주요 소관: 청소년·미래세대 지원사업", kw: ["경기도미래세대재단", "경기 청소년 지원"], file: "07-org/SP-ORG-GGFUTURE_v1.0.md" },
  { code: "SP-ORG-GGLIFE", name: "경기도평생교육진흥원", desc: "당신은 **경기도평생교육진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 평생교육 진흥사업", kw: ["경기도평생교육진흥원", "경기 평생교육"], file: "07-org/SP-ORG-GGLIFE_v1.0.md" },
  { code: "SP-ORG-GGCULTURE", name: "경기문화재단", desc: "당신은 **경기문화재단**을(를) 대표하는 AI 레이어다. 주요 소관: 문화예술 진흥·지원사업", kw: ["경기문화재단", "경기 문화예술 지원"], file: "07-org/SP-ORG-GGCULTURE_v1.0.md" },
  { code: "SP-ORG-GGWELFARE", name: "경기복지재단", desc: "당신은 **경기복지재단**을(를) 대표하는 AI 레이어다. 주요 소관: 사회복지 정책연구·지원사업", kw: ["경기복지재단", "경기 복지 지원"], file: "07-org/SP-ORG-GGWELFARE_v1.0.md" },
  { code: "SP-ORG-GGCGF", name: "경기신용보증재단", desc: "당신은 **경기신용보증재단**을(를) 대표하는 AI 레이어다. 주요 소관: 소상공인·중소기업 신용보증", kw: ["경기신용보증재단", "경기 신용보증"], file: "07-org/SP-ORG-GGCGF_v1.0.md" },
  { code: "SP-ORG-GGRI", name: "경기연구원", desc: "당신은 **경기연구원**을(를) 대표하는 AI 레이어다. 주요 소관: 경기도 지역 정책연구", kw: ["경기연구원", "경기 정책연구"], file: "07-org/SP-ORG-GGRI_v1.0.md" },
  { code: "SP-ORG-GGCONTENT", name: "경기콘텐츠진흥원", desc: "당신은 **경기콘텐츠진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 콘텐츠산업(IT·문화콘텐츠) 육성·지원", kw: ["경기콘텐츠진흥원", "경기 콘텐츠 지원", "게임 콘텐츠 지원"], file: "07-org/SP-ORG-GGCONTENT_v1.0.md" },
  { code: "SP-ORG-GGTP", name: "경기테크노파크", desc: "당신은 **경기테크노파크**을(를) 대표하는 AI 레이어다. 주요 소관: 지역 산업기술 지원·기업지원", kw: ["경기테크노파크", "경기 기업지원"], file: "07-org/SP-ORG-GGTP_v1.0.md" },
  { code: "SP-ORG-GGAGRI", name: "경기도 농수산진흥원", desc: "당신은 **경기도 농수산진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 농수산물 유통·판로지원", kw: ["경기도 농수산진흥원", "경기 농산물 유통", "경기 직거래장터"], file: "07-org/SP-ORG-GGAGRI_v1.0.md" },
  { code: "SP-ORG-GGSSO", name: "경기도사회서비스원", desc: "당신은 **경기도사회서비스원**을(를) 대표하는 AI 레이어다. 주요 소관: 사회서비스 제공(재가돌봄·아이돌봄 등)", kw: ["경기도사회서비스원", "경기 사회서비스"], file: "07-org/SP-ORG-GGSSO_v1.0.md" },
  { code: "SP-ORG-GGMARKET", name: "경기도시장상권진흥원", desc: "당신은 **경기도시장상권진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 전통시장·상권 활성화 지원", kw: ["경기도시장상권진흥원", "경기 전통시장 지원", "경기 상권"], file: "07-org/SP-ORG-GGMARKET_v1.0.md" },
  { code: "SP-ORG-GGWOMEN", name: "경기도여성가족재단", desc: "당신은 **경기도여성가족재단**을(를) 대표하는 AI 레이어다. 주요 소관: 양성평등·가족·청소년 지원사업", kw: ["경기도여성가족재단", "경기 여성가족", "경기 가정폭력 상담"], file: "07-org/SP-ORG-GGWOMEN_v1.0.md" },
  { code: "SP-ORG-GGARTCENTER", name: "경기아트센터", desc: "당신은 **경기아트센터**을(를) 대표하는 AI 레이어다. 주요 소관: 문화예술 공연·전시시설 운영", kw: ["경기아트센터", "경기도 공연장"], file: "07-org/SP-ORG-GGARTCENTER_v1.0.md" },
  { code: "SP-ORG-GGACE", name: "차세대융합기술연구원", desc: "당신은 **차세대융합기술연구원**을(를) 대표하는 AI 레이어다. 주요 소관: 경기도 지역 정책연구·융합기술 연구", kw: ["차세대융합기술연구원", "경기 융합기술"], file: "07-org/SP-ORG-GGACE_v1.0.md" },
  { code: "SP-ORG-GGKOREA", name: "코리아경기도주식회사", desc: "당신은 **코리아경기도주식회사**을(를) 대표하는 AI 레이어다. 주요 소관: 지자체 출자 주식회사 사업", kw: ["코리아경기도주식회사"], file: "07-org/SP-ORG-GGKOREA_v1.0.md" },
  { code: "SP-ORG-KOCEF", name: "한국도자재단", desc: "당신은 **한국도자재단**을(를) 대표하는 AI 레이어다. 주요 소관: 문화예술(도자·공예) 진흥·지원사업", kw: ["한국도자재단", "경기 도자기 축제", "이천 도자기"], file: "07-org/SP-ORG-KOCEF_v1.0.md" },
  { code: "SP-ORG-GGSE", name: "경기도사회적경제원", desc: "당신은 **경기도사회적경제원**을(를) 대표하는 AI 레이어다. 주요 소관: 사회적경제(협동조합·사회적기업) 지원", kw: ["경기도사회적경제원", "경기 사회적기업 지원", "경기 협동조합"], file: "07-org/SP-ORG-GGSE_v1.0.md" },
  { code: "SP-ORG-GGEEA", name: "경기환경에너지진흥원", desc: "당신은 **경기환경에너지진흥원**을(를) 대표하는 AI 레이어다. 주요 소관: 환경·에너지 산업 지원, 신재생에너지 보급", kw: ["경기환경에너지진흥원", "경기 환경 지원", "경기 신재생에너지"], file: "07-org/SP-ORG-GGEEA_v1.0.md" },
  { code: "SP-ORG-GGWCST", name: "경기도수원월드컵경기장관리재단", desc: "당신은 **경기도수원월드컵경기장관리재단**을(를) 대표하는 AI 레이어다. 주요 소관: 수원월드컵경기장·부대시설 운영·대관", kw: ["경기도수원월드컵경기장관리재단", "수원월드컵경기장", "빅버드"], file: "07-org/SP-ORG-GGWCST_v1.0.md" },
];

const GYEONGGI_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'gyeonggi', file: null,
    kw: ['기획조정실', '정책기획관', '예산담당관', '인구정책담당관'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'gyeonggi', file: null,
    kw: ['안전관리실', '안전기획과', '사회재난과', '자연재난과'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'gyeonggi', file: null,
    kw: ['자치행정국', '세정과', '조세정의과', '자산관리과'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'gyeonggi', file: null,
    kw: ['경제실', '일자리경제정책과', '지역금융과'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'gyeonggi', file: null,
    kw: ['미래성장산업국'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'gyeonggi', file: null,
    kw: ['복지국', '복지정책과', '노인복지과', '장애인복지과'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'gyeonggi', file: null,
    kw: ['기후환경에너지국'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'gyeonggi', file: null,
    kw: ['도시주택실', '주택정책과', '건축정책과', '도시재생과'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'gyeonggi', file: null,
    kw: ['교통국', '버스정책과', '광역교통정책과'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'gyeonggi', file: null,
    kw: ['문화체육관광국', '문화정책과'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'gyeonggi', file: null,
    kw: ['관광정책', '관광진흥'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'gyeonggi', file: null,
    kw: ['농수산생명과학국', '농업정책'] },
  { code: 'SP-DO-OCEAN', domain: 'ocean', 도코드: 'gyeonggi', file: null,
    kw: ['해양수산', '수산업'] },
  ..._makeGenericL2Entries('gyeonggi', ['sports', 'health', 'family']),
];

// ── 강원·대구·전남광주통합 — 도청 실국 실사 자체가 전혀 착수되지
// 않았던 3개 도(2026-07-24 시청 롤아웃 중 발견). 시청과 동일 원칙으로
// 16개 도메인 전부 범용 키워드+기본 라벨로 즉시 완비한다.
// ==== DAEGU_ORG_TABLE (daegu, 2026-08-14 전국 확대 배치) ====
const DAEGU_ORG_TABLE = [
  { code: "SP-ORG-DGMISC1", name: "(주)엑스코", desc: "당신은 **(주)엑스코**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["(주)엑스코"], file: "07-org/SP-ORG-DGMISC1_v1.0.md" },
  { code: "SP-ORG-DGMED", name: "대구의료원", desc: "당신은 **대구의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["대구의료원"], file: "07-org/SP-ORG-DGMED_v1.0.md" },
  { code: "SP-ORG-DGCGF", name: "대구신용보증재단", desc: "당신은 **대구신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["대구신용보증재단"], file: "07-org/SP-ORG-DGCGF_v1.0.md" },
  { code: "SP-ORG-DGTP", name: "대구테크노파크", desc: "당신은 **대구테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["대구테크노파크"], file: "07-org/SP-ORG-DGTP_v1.0.md" },
  { code: "SP-ORG-DGINNO", name: "재단법인 대구디지털혁신진흥원", desc: "당신은 **재단법인 대구디지털혁신진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 대구디지털혁신진흥원", "대구디지털혁신진흥원"], file: "07-org/SP-ORG-DGINNO_v1.0.md" },
  { code: "SP-ORG-DGMISC2", name: "재단법인 대구문화예술진흥원", desc: "당신은 **재단법인 대구문화예술진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["재단법인 대구문화예술진흥원", "대구문화예술진흥원"], file: "07-org/SP-ORG-DGMISC2_v1.0.md" },
  { code: "SP-ORG-DGRI", name: "재단법인 대구정책연구원", desc: "당신은 **재단법인 대구정책연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 대구정책연구원", "대구정책연구원"], file: "07-org/SP-ORG-DGRI_v1.0.md" },
  { code: "SP-ORG-DGSSO", name: "대구광역시 행복진흥사회서비스원", desc: "당신은 **대구광역시 행복진흥사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["대구광역시 행복진흥사회서비스원"], file: "07-org/SP-ORG-DGSSO_v1.0.md" },
];

// ==== INCHEON_ORG_TABLE (incheon, 2026-08-14 전국 확대 배치) ====
const INCHEON_ORG_TABLE = [
  { code: "SP-ORG-ICSMARTCITY", name: "인천스마트시티(주)", desc: "당신은 **인천스마트시티(주)**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["인천스마트시티(주)"], file: "07-org/SP-ORG-ICSMARTCITY_v1.0.md" },
  { code: "SP-ORG-ICMISC1", name: "인천종합에너지(주)", desc: "당신은 **인천종합에너지(주)**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["인천종합에너지(주)"], file: "07-org/SP-ORG-ICMISC1_v1.0.md" },
  { code: "SP-ORG-ICMED", name: "인천광역시의료원", desc: "당신은 **인천광역시의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["인천광역시의료원"], file: "07-org/SP-ORG-ICMED_v1.0.md" },
  { code: "SP-ORG-ICRI", name: "인천연구원", desc: "당신은 **인천연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["인천연구원"], file: "07-org/SP-ORG-ICRI_v1.0.md" },
  { code: "SP-ORG-ICCGF", name: "인천신용보증재단", desc: "당신은 **인천신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["인천신용보증재단"], file: "07-org/SP-ORG-ICCGF_v1.0.md" },
  { code: "SP-ORG-ICTP", name: "재단법인 인천테크노파크", desc: "당신은 **재단법인 인천테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 인천테크노파크", "인천테크노파크"], file: "07-org/SP-ORG-ICTP_v1.0.md" },
  { code: "SP-ORG-ICCF", name: "인천문화재단", desc: "당신은 **인천문화재단**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["인천문화재단"], file: "07-org/SP-ORG-ICCF_v1.0.md" },
  { code: "SP-ORG-ICGLOBAL", name: "인천글로벌캠퍼스운영재단", desc: "당신은 **인천글로벌캠퍼스운영재단**을(를) 대표하는 AI 레이어다. 소관 유형: INTLEXCHANGE", kw: ["인천글로벌캠퍼스운영재단"], file: "07-org/SP-ORG-ICGLOBAL_v1.0.md" },
  { code: "SP-ORG-ICWOMEN", name: "재단법인 인천광역시 여성가족재단", desc: "당신은 **재단법인 인천광역시 여성가족재단**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["재단법인 인천광역시 여성가족재단", "인천광역시 여성가족재단"], file: "07-org/SP-ORG-ICWOMEN_v1.0.md" },
  { code: "SP-ORG-ICLIFE", name: "재단법인 인천인재평생교육진흥원", desc: "당신은 **재단법인 인천인재평생교육진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["재단법인 인천인재평생교육진흥원", "인천인재평생교육진흥원"], file: "07-org/SP-ORG-ICLIFE_v1.0.md" },
  { code: "SP-ORG-ICSSO", name: "재단법인 인천광역시 사회서비스원", desc: "당신은 **재단법인 인천광역시 사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["재단법인 인천광역시 사회서비스원", "인천광역시 사회서비스원"], file: "07-org/SP-ORG-ICSSO_v1.0.md" },
];

// ==== JEONNAM_GWANGJU_ORG_TABLE (jeonnam-gwangju, 2026-08-14 전국 확대 배치) ====
const JEONNAM_GWANGJU_ORG_TABLE = [
  { code: "SP-ORG-GJMISC1", name: "한국씨이에스(주)", desc: "당신은 **한국씨이에스(주)**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["한국씨이에스(주)"], file: "07-org/SP-ORG-GJMISC1_v1.0.md" },
  { code: "SP-ORG-GJJOB", name: "광주광역시 경제진흥상생일자리재단", desc: "당신은 **광주광역시 경제진흥상생일자리재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["광주광역시 경제진흥상생일자리재단"], file: "07-org/SP-ORG-GJJOB_v1.0.md" },
  { code: "SP-ORG-GJMOBILITY", name: "재단법인 광주미래차모빌리티진흥원", desc: "당신은 **재단법인 광주미래차모빌리티진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 광주미래차모빌리티진흥원", "광주미래차모빌리티진흥원"], file: "07-org/SP-ORG-GJMOBILITY_v1.0.md" },
  { code: "SP-ORG-GJENV", name: "광주광역시 기후에너지진흥원", desc: "당신은 **광주광역시 기후에너지진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["광주광역시 기후에너지진흥원"], file: "07-org/SP-ORG-GJENV_v1.0.md" },
  { code: "SP-ORG-GJDESIGN", name: "재단법인 광주디자인진흥원", desc: "당신은 **재단법인 광주디자인진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 광주디자인진흥원", "광주디자인진흥원"], file: "07-org/SP-ORG-GJDESIGN_v1.0.md" },
  { code: "SP-ORG-GJCF", name: "광주광역시광주문화재단", desc: "당신은 **광주광역시광주문화재단**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["광주광역시광주문화재단"], file: "07-org/SP-ORG-GJCF_v1.0.md" },
  { code: "SP-ORG-GJCGF", name: "광주신용보증재단", desc: "당신은 **광주신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["광주신용보증재단"], file: "07-org/SP-ORG-GJCGF_v1.0.md" },
  { code: "SP-ORG-GJWOMEN", name: "재단법인 광주광역시 여성가족재단", desc: "당신은 **재단법인 광주광역시 여성가족재단**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["재단법인 광주광역시 여성가족재단", "광주광역시 여성가족재단"], file: "07-org/SP-ORG-GJWOMEN_v1.0.md" },
  { code: "SP-ORG-GJGLOBAL", name: "재단법인 글로벌광주방송재단", desc: "당신은 **재단법인 글로벌광주방송재단**을(를) 대표하는 AI 레이어다. 소관 유형: INTLEXCHANGE", kw: ["재단법인 글로벌광주방송재단", "글로벌광주방송재단"], file: "07-org/SP-ORG-GJGLOBAL_v1.0.md" },
  { code: "SP-ORG-GJIPA", name: "광주정보문화산업진흥원", desc: "당신은 **광주정보문화산업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["광주정보문화산업진흥원"], file: "07-org/SP-ORG-GJIPA_v1.0.md" },
  { code: "SP-ORG-GJTP", name: "광주테크노파크", desc: "당신은 **광주테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["광주테크노파크"], file: "07-org/SP-ORG-GJTP_v1.0.md" },
  { code: "SP-ORG-GJLIFE", name: "재단법인 광주광역시인재평생교육진흥원", desc: "당신은 **재단법인 광주광역시인재평생교육진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["재단법인 광주광역시인재평생교육진흥원", "광주광역시인재평생교육진흥원"], file: "07-org/SP-ORG-GJLIFE_v1.0.md" },
  { code: "SP-ORG-GJSSO", name: "재단법인 광주광역시 사회서비스원", desc: "당신은 **재단법인 광주광역시 사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["재단법인 광주광역시 사회서비스원", "광주광역시 사회서비스원"], file: "07-org/SP-ORG-GJSSO_v1.0.md" },
  { code: "SP-ORG-GJRI", name: "재단법인 광주연구원", desc: "당신은 **재단법인 광주연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 광주연구원", "광주연구원"], file: "07-org/SP-ORG-GJRI_v1.0.md" },
  { code: "SP-ORG-JNMED", name: "전라남도순천의료원", desc: "당신은 **전라남도순천의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["전라남도순천의료원"], file: "07-org/SP-ORG-JNMED_v1.0.md" },
  { code: "SP-ORG-JNMARKET2", name: "재단법인 남도장터", desc: "당신은 **재단법인 남도장터**을(를) 대표하는 AI 레이어다. 소관 유형: AGRIFOOD", kw: ["재단법인 남도장터", "남도장터"], file: "07-org/SP-ORG-JNMARKET2_v1.0.md" },
  { code: "SP-ORG-JNRI", name: "재단법인 전남연구원", desc: "당신은 **재단법인 전남연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 전남연구원", "전남연구원"], file: "07-org/SP-ORG-JNRI_v1.0.md" },
  { code: "SP-ORG-JNHONAM", name: "재단법인 한국학 호남진흥원", desc: "당신은 **재단법인 한국학 호남진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["재단법인 한국학 호남진흥원", "한국학 호남진흥원"], file: "07-org/SP-ORG-JNHONAM_v1.0.md" },
  { code: "SP-ORG-JNMEDX2", name: "전라남도강진의료원", desc: "당신은 **전라남도강진의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["전라남도강진의료원"], file: "07-org/SP-ORG-JNMEDX2_v1.0.md" },
  { code: "SP-ORG-JNCGF", name: "전남신용보증재단", desc: "당신은 **전남신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["전남신용보증재단"], file: "07-org/SP-ORG-JNCGF_v1.0.md" },
  { code: "SP-ORG-JNIPA", name: "재단법인 전남바이오산업진흥원", desc: "당신은 **재단법인 전남바이오산업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 전남바이오산업진흥원", "전남바이오산업진흥원"], file: "07-org/SP-ORG-JNIPA_v1.0.md" },
  { code: "SP-ORG-JNTP", name: "전남테크노파크", desc: "당신은 **전남테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["전남테크노파크"], file: "07-org/SP-ORG-JNTP_v1.0.md" },
  { code: "SP-ORG-JNBIZ", name: "재단법인 전라남도중소기업진흥원", desc: "당신은 **재단법인 전라남도중소기업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 전라남도중소기업진흥원", "전라남도중소기업진흥원"], file: "07-org/SP-ORG-JNBIZ_v1.0.md" },
  { code: "SP-ORG-JNIPAX2", name: "전남정보문화산업진흥원", desc: "당신은 **전남정보문화산업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["전남정보문화산업진흥원"], file: "07-org/SP-ORG-JNIPAX2_v1.0.md" },
  { code: "SP-ORG-JNMEMORIAL", name: "명량대첩기념사업회", desc: "당신은 **명량대첩기념사업회**을(를) 대표하는 AI 레이어다. 소관 유형: PEACEFOUNDATION", kw: ["명량대첩기념사업회"], file: "07-org/SP-ORG-JNMEMORIAL_v1.0.md" },
  { code: "SP-ORG-JNWOMEN", name: "재단법인 전남여성가족재단", desc: "당신은 **재단법인 전남여성가족재단**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["재단법인 전남여성가족재단", "전남여성가족재단"], file: "07-org/SP-ORG-JNWOMEN_v1.0.md" },
  { code: "SP-ORG-JNLIFE", name: "재단법인 전남인재평생교육진흥원", desc: "당신은 **재단법인 전남인재평생교육진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["재단법인 전남인재평생교육진흥원", "전남인재평생교육진흥원"], file: "07-org/SP-ORG-JNLIFE_v1.0.md" },
  { code: "SP-ORG-JNYOUTH", name: "전라남도청소년미래재단", desc: "당신은 **전라남도청소년미래재단**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["전라남도청소년미래재단"], file: "07-org/SP-ORG-JNYOUTH_v1.0.md" },
  { code: "SP-ORG-JNCF", name: "재단법인 전라남도문화재단", desc: "당신은 **재단법인 전라남도문화재단**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["재단법인 전라남도문화재단", "전라남도문화재단"], file: "07-org/SP-ORG-JNCF_v1.0.md" },
  { code: "SP-ORG-JNRIX2", name: "녹색에너지연구원", desc: "당신은 **녹색에너지연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["녹색에너지연구원"], file: "07-org/SP-ORG-JNRIX2_v1.0.md" },
  { code: "SP-ORG-JNIPAX3", name: "전라남도 환경산업진흥원", desc: "당신은 **전라남도 환경산업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["전라남도 환경산업진흥원"], file: "07-org/SP-ORG-JNIPAX3_v1.0.md" },
  { code: "SP-ORG-JNFOODFEST", name: "재단법인 남도음식문화큰잔치", desc: "당신은 **재단법인 남도음식문화큰잔치**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["재단법인 남도음식문화큰잔치", "남도음식문화큰잔치"], file: "07-org/SP-ORG-JNFOODFEST_v1.0.md" },
  { code: "SP-ORG-JNSCHOL", name: "남도장학회", desc: "당신은 **남도장학회**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["남도장학회"], file: "07-org/SP-ORG-JNSCHOL_v1.0.md" },
  { code: "SP-ORG-JNTOURISM", name: "재단법인 전라남도관광재단", desc: "당신은 **재단법인 전라남도관광재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 전라남도관광재단", "전라남도관광재단"], file: "07-org/SP-ORG-JNTOURISM_v1.0.md" },
  { code: "SP-ORG-JNSSO", name: "재단법인 전라남도사회서비스원", desc: "당신은 **재단법인 전라남도사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["재단법인 전라남도사회서비스원", "전라남도사회서비스원"], file: "07-org/SP-ORG-JNSSO_v1.0.md" },
];

// ==== DAEJEON_ORG_TABLE (daejeon, 2026-08-14 전국 확대 배치) ====
const DAEJEON_ORG_TABLE = [
  { code: "SP-ORG-DJINVEST", name: "대전투자금융 주식회사", desc: "당신은 **대전투자금융 주식회사**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["대전투자금융 주식회사"], file: "07-org/SP-ORG-DJINVEST_v1.0.md" },
  { code: "SP-ORG-DJBEA", name: "재단법인 대전일자리경제진흥원", desc: "당신은 **재단법인 대전일자리경제진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 대전일자리경제진흥원", "대전일자리경제진흥원"], file: "07-org/SP-ORG-DJBEA_v1.0.md" },
  { code: "SP-ORG-DJCF", name: "대전고암미술문화재단", desc: "당신은 **대전고암미술문화재단**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["대전고암미술문화재단"], file: "07-org/SP-ORG-DJCF_v1.0.md" },
  { code: "SP-ORG-DJIPA", name: "정보문화산업진흥원", desc: "당신은 **정보문화산업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["정보문화산업진흥원"], file: "07-org/SP-ORG-DJIPA_v1.0.md" },
  { code: "SP-ORG-DJCFX2", name: "대전문화재단", desc: "당신은 **대전문화재단**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["대전문화재단"], file: "07-org/SP-ORG-DJCFX2_v1.0.md" },
  { code: "SP-ORG-DJRI", name: "재단법인 대전연구원", desc: "당신은 **재단법인 대전연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 대전연구원", "대전연구원"], file: "07-org/SP-ORG-DJRI_v1.0.md" },
  { code: "SP-ORG-DJSSO", name: "재단법인 대전광역시 사회서비스원", desc: "당신은 **재단법인 대전광역시 사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["재단법인 대전광역시 사회서비스원", "대전광역시 사회서비스원"], file: "07-org/SP-ORG-DJSSO_v1.0.md" },
  { code: "SP-ORG-DJCGF", name: "대전신용보증재단", desc: "당신은 **대전신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["대전신용보증재단"], file: "07-org/SP-ORG-DJCGF_v1.0.md" },
  { code: "SP-ORG-DJMISC1", name: "재단법인 대전청년내일재단", desc: "당신은 **재단법인 대전청년내일재단**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["재단법인 대전청년내일재단", "대전청년내일재단"], file: "07-org/SP-ORG-DJMISC1_v1.0.md" },
  { code: "SP-ORG-DJTP", name: "대전테크노파크", desc: "당신은 **대전테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["대전테크노파크"], file: "07-org/SP-ORG-DJTP_v1.0.md" },
  { code: "SP-ORG-DJLIFE", name: "대전평생교육진흥원", desc: "당신은 **대전평생교육진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["대전평생교육진흥원"], file: "07-org/SP-ORG-DJLIFE_v1.0.md" },
  { code: "SP-ORG-DJHYO", name: "재단법인 한국효문화진흥원", desc: "당신은 **재단법인 한국효문화진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["재단법인 한국효문화진흥원", "한국효문화진흥원"], file: "07-org/SP-ORG-DJHYO_v1.0.md" },
  { code: "SP-ORG-DJDESIGN", name: "재단법인 대전디자인진흥원", desc: "당신은 **재단법인 대전디자인진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 대전디자인진흥원", "대전디자인진흥원"], file: "07-org/SP-ORG-DJDESIGN_v1.0.md" },
  { code: "SP-ORG-DJIPAX2", name: "재단법인 대전과학산업진흥원", desc: "당신은 **재단법인 대전과학산업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 대전과학산업진흥원", "대전과학산업진흥원"], file: "07-org/SP-ORG-DJIPAX2_v1.0.md" },
];

// ==== SEJONG_ORG_TABLE (sejong, 2026-08-14 전국 확대 배치) ====
const SEJONG_ORG_TABLE = [
  { code: "SP-ORG-SJAGRICORP", name: "농업회사법인세종로컬푸드(주)", desc: "당신은 **농업회사법인세종로컬푸드(주)**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["농업회사법인세종로컬푸드(주)"], file: "07-org/SP-ORG-SJAGRICORP_v1.0.md" },
  { code: "SP-ORG-SJMISC1", name: "주식회사 세종스마트그린", desc: "당신은 **주식회사 세종스마트그린**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["주식회사 세종스마트그린"], file: "07-org/SP-ORG-SJMISC1_v1.0.md" },
  { code: "SP-ORG-SJVENTURE", name: "세종벤처밸리산업단지 주식회사", desc: "당신은 **세종벤처밸리산업단지 주식회사**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["세종벤처밸리산업단지 주식회사"], file: "07-org/SP-ORG-SJVENTURE_v1.0.md" },
  { code: "SP-ORG-SJCGF", name: "세종신용보증재단", desc: "당신은 **세종신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["세종신용보증재단"], file: "07-org/SP-ORG-SJCGF_v1.0.md" },
  { code: "SP-ORG-SJTOURISM", name: "재단법인 세종시문화관광재단", desc: "당신은 **재단법인 세종시문화관광재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 세종시문화관광재단", "세종시문화관광재단"], file: "07-org/SP-ORG-SJTOURISM_v1.0.md" },
  { code: "SP-ORG-SJSSO", name: "재단법인 세종특별자치시 사회서비스원", desc: "당신은 **재단법인 세종특별자치시 사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["재단법인 세종특별자치시 사회서비스원", "세종특별자치시 사회서비스원"], file: "07-org/SP-ORG-SJSSO_v1.0.md" },
  { code: "SP-ORG-SJTP", name: "재단법인 세종테크노파크", desc: "당신은 **재단법인 세종테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 세종테크노파크", "세종테크노파크"], file: "07-org/SP-ORG-SJTP_v1.0.md" },
  { code: "SP-ORG-SJBEA", name: "재단법인 세종일자리경제진흥원", desc: "당신은 **재단법인 세종일자리경제진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 세종일자리경제진흥원", "세종일자리경제진흥원"], file: "07-org/SP-ORG-SJBEA_v1.0.md" },
  { code: "SP-ORG-SJRI", name: "재단법인 세종연구원", desc: "당신은 **재단법인 세종연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 세종연구원", "세종연구원"], file: "07-org/SP-ORG-SJRI_v1.0.md" },
];

// ==== GANGWON_ORG_TABLE (gangwon, 2026-08-14 전국 확대 배치) ====
const GANGWON_ORG_TABLE = [
  { code: "SP-ORG-GWWATER", name: "(주)강원심층수", desc: "당신은 **(주)강원심층수**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["(주)강원심층수"], file: "07-org/SP-ORG-GWWATER_v1.0.md" },
  { code: "SP-ORG-GWMISC1", name: "주식회사 강원중도개발공사", desc: "당신은 **주식회사 강원중도개발공사**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["주식회사 강원중도개발공사"], file: "07-org/SP-ORG-GWMISC1_v1.0.md" },
  { code: "SP-ORG-GWWIND", name: "태백가덕산풍력발전 주식회사", desc: "당신은 **태백가덕산풍력발전 주식회사**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["태백가덕산풍력발전 주식회사"], file: "07-org/SP-ORG-GWWIND_v1.0.md" },
  { code: "SP-ORG-GWMISC2", name: "주식회사 강원수출", desc: "당신은 **주식회사 강원수출**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["주식회사 강원수출"], file: "07-org/SP-ORG-GWMISC2_v1.0.md" },
  { code: "SP-ORG-GWCGF", name: "강원신용보증재단", desc: "당신은 **강원신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["강원신용보증재단"], file: "07-org/SP-ORG-GWCGF_v1.0.md" },
  { code: "SP-ORG-GWCF", name: "강원문화재단", desc: "당신은 **강원문화재단**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["강원문화재단"], file: "07-org/SP-ORG-GWCF_v1.0.md" },
  { code: "SP-ORG-GWBEA", name: "재단법인 강원특별자치도경제진흥원", desc: "당신은 **재단법인 강원특별자치도경제진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 강원특별자치도경제진흥원", "강원특별자치도경제진흥원"], file: "07-org/SP-ORG-GWBEA_v1.0.md" },
  { code: "SP-ORG-GWTALENT", name: "재단법인 강원인재원", desc: "당신은 **재단법인 강원인재원**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["재단법인 강원인재원", "강원인재원"], file: "07-org/SP-ORG-GWTALENT_v1.0.md" },
  { code: "SP-ORG-GWRI", name: "한국기후변화연구원", desc: "당신은 **한국기후변화연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["한국기후변화연구원"], file: "07-org/SP-ORG-GWRI_v1.0.md" },
  { code: "SP-ORG-GWRIX2", name: "스크립스코리아항체연구원", desc: "당신은 **스크립스코리아항체연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["스크립스코리아항체연구원"], file: "07-org/SP-ORG-GWRIX2_v1.0.md" },
  { code: "SP-ORG-GWWOMENTRAIN", name: "한국여성수련원", desc: "당신은 **한국여성수련원**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["한국여성수련원"], file: "07-org/SP-ORG-GWWOMENTRAIN_v1.0.md" },
  { code: "SP-ORG-GWRIX3", name: "강원연구원", desc: "당신은 **강원연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["강원연구원"], file: "07-org/SP-ORG-GWRIX3_v1.0.md" },
  { code: "SP-ORG-GWTP", name: "강원테크노파크", desc: "당신은 **강원테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["강원테크노파크"], file: "07-org/SP-ORG-GWTP_v1.0.md" },
  { code: "SP-ORG-GWMED", name: "강원특별자치도원주의료원", desc: "당신은 **강원특별자치도원주의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["강원특별자치도원주의료원"], file: "07-org/SP-ORG-GWMED_v1.0.md" },
  { code: "SP-ORG-GWMEDX2", name: "강원특별자치도강릉의료원", desc: "당신은 **강원특별자치도강릉의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["강원특별자치도강릉의료원"], file: "07-org/SP-ORG-GWMEDX2_v1.0.md" },
  { code: "SP-ORG-GWMEDX3", name: "강원특별자치도속초의료원", desc: "당신은 **강원특별자치도속초의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["강원특별자치도속초의료원"], file: "07-org/SP-ORG-GWMEDX3_v1.0.md" },
  { code: "SP-ORG-GWMEDX4", name: "강원특별자치도삼척의료원", desc: "당신은 **강원특별자치도삼척의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["강원특별자치도삼척의료원"], file: "07-org/SP-ORG-GWMEDX4_v1.0.md" },
  { code: "SP-ORG-GWMEDX5", name: "강원특별자치도영월의료원", desc: "당신은 **강원특별자치도영월의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["강원특별자치도영월의료원"], file: "07-org/SP-ORG-GWMEDX5_v1.0.md" },
  { code: "SP-ORG-GWDESIGN", name: "재단법인 강원디자인진흥원", desc: "당신은 **재단법인 강원디자인진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 강원디자인진흥원", "강원디자인진흥원"], file: "07-org/SP-ORG-GWDESIGN_v1.0.md" },
  { code: "SP-ORG-GWINNOCITY", name: "재단법인 강원혁신도시발전지원센터", desc: "당신은 **재단법인 강원혁신도시발전지원센터**을(를) 대표하는 AI 레이어다. 소관 유형: URBANCOMMUNITY", kw: ["재단법인 강원혁신도시발전지원센터", "강원혁신도시발전지원센터"], file: "07-org/SP-ORG-GWINNOCITY_v1.0.md" },
  { code: "SP-ORG-GWRIX4", name: "재단법인 강원역사문화연구원", desc: "당신은 **재단법인 강원역사문화연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 강원역사문화연구원", "강원역사문화연구원"], file: "07-org/SP-ORG-GWRIX4_v1.0.md" },
  { code: "SP-ORG-GWMEMORIAL", name: "재단법인 2018평창기념재단", desc: "당신은 **재단법인 2018평창기념재단**을(를) 대표하는 AI 레이어다. 소관 유형: PEACEFOUNDATION", kw: ["재단법인 2018평창기념재단", "2018평창기념재단"], file: "07-org/SP-ORG-GWMEMORIAL_v1.0.md" },
  { code: "SP-ORG-GWSSO", name: "재단법인 강원특별자치도 사회서비스원", desc: "당신은 **재단법인 강원특별자치도 사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["재단법인 강원특별자치도 사회서비스원", "강원특별자치도 사회서비스원"], file: "07-org/SP-ORG-GWSSO_v1.0.md" },
  { code: "SP-ORG-GWTOURISM", name: "재단법인 강원관광재단", desc: "당신은 **재단법인 강원관광재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 강원관광재단", "강원관광재단"], file: "07-org/SP-ORG-GWTOURISM_v1.0.md" },
];

// ==== GYEONGBUK_ORG_TABLE (gyeongbuk, 2026-08-14 전국 확대 배치) ====
const GYEONGBUK_ORG_TABLE = [
  { code: "SP-ORG-GBMISC1", name: "경북통상(주)", desc: "당신은 **경북통상(주)**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["경북통상(주)"], file: "07-org/SP-ORG-GBMISC1_v1.0.md" },
  { code: "SP-ORG-GBMED", name: "경상북도포항의료원", desc: "당신은 **경상북도포항의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["경상북도포항의료원"], file: "07-org/SP-ORG-GBMED_v1.0.md" },
  { code: "SP-ORG-GBMEDX2", name: "경상북도김천의료원", desc: "당신은 **경상북도김천의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["경상북도김천의료원"], file: "07-org/SP-ORG-GBMEDX2_v1.0.md" },
  { code: "SP-ORG-GBMEDX3", name: "경상북도안동의료원", desc: "당신은 **경상북도안동의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["경상북도안동의료원"], file: "07-org/SP-ORG-GBMEDX3_v1.0.md" },
  { code: "SP-ORG-GBTP", name: "경북테크노파크", desc: "당신은 **경북테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["경북테크노파크"], file: "07-org/SP-ORG-GBTP_v1.0.md" },
  { code: "SP-ORG-GBRI", name: "경북바이오산업연구원", desc: "당신은 **경북바이오산업연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["경북바이오산업연구원"], file: "07-org/SP-ORG-GBRI_v1.0.md" },
  { code: "SP-ORG-GBBEA", name: "경상북도경제진흥원", desc: "당신은 **경상북도경제진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["경상북도경제진흥원"], file: "07-org/SP-ORG-GBBEA_v1.0.md" },
  { code: "SP-ORG-GBCGF", name: "경북신용보증재단", desc: "당신은 **경북신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["경북신용보증재단"], file: "07-org/SP-ORG-GBCGF_v1.0.md" },
  { code: "SP-ORG-GBKOREANOLOGY", name: "한국국학진흥원", desc: "당신은 **한국국학진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["한국국학진흥원"], file: "07-org/SP-ORG-GBKOREANOLOGY_v1.0.md" },
  { code: "SP-ORG-GBCF", name: "경북문화재단", desc: "당신은 **경북문화재단**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["경북문화재단"], file: "07-org/SP-ORG-GBCF_v1.0.md" },
  { code: "SP-ORG-GBENV", name: "경상북도환경연수원", desc: "당신은 **경상북도환경연수원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["경상북도환경연수원"], file: "07-org/SP-ORG-GBENV_v1.0.md" },
  { code: "SP-ORG-GBHAPPY", name: "경북행복재단", desc: "당신은 **경북행복재단**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["경북행복재단"], file: "07-org/SP-ORG-GBHAPPY_v1.0.md" },
  { code: "SP-ORG-GBWOMEN", name: "경북여성정책개발원", desc: "당신은 **경북여성정책개발원**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["경북여성정책개발원"], file: "07-org/SP-ORG-GBWOMEN_v1.0.md" },
  { code: "SP-ORG-GBMISC2", name: "재단법인 경상북도인재평생교육재단", desc: "당신은 **재단법인 경상북도인재평생교육재단**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["재단법인 경상북도인재평생교육재단", "경상북도인재평생교육재단"], file: "07-org/SP-ORG-GBMISC2_v1.0.md" },
  { code: "SP-ORG-GBDOKDO", name: "재단법인 독도재단", desc: "당신은 **재단법인 독도재단**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["재단법인 독도재단", "독도재단"], file: "07-org/SP-ORG-GBDOKDO_v1.0.md" },
  { code: "SP-ORG-GBAGRI", name: "경상북도 농식품유통교육진흥원", desc: "당신은 **경상북도 농식품유통교육진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: AGRIFOOD", kw: ["경상북도 농식품유통교육진흥원"], file: "07-org/SP-ORG-GBAGRI_v1.0.md" },
  { code: "SP-ORG-GBSAEMAUL", name: "재단법인 새마을재단", desc: "당신은 **재단법인 새마을재단**을(를) 대표하는 AI 레이어다. 소관 유형: URBANCOMMUNITY", kw: ["재단법인 새마을재단", "새마을재단"], file: "07-org/SP-ORG-GBSAEMAUL_v1.0.md" },
  { code: "SP-ORG-GBVETERAN", name: "재단법인 경상북도호국보훈재단", desc: "당신은 **재단법인 경상북도호국보훈재단**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["재단법인 경상북도호국보훈재단", "경상북도호국보훈재단"], file: "07-org/SP-ORG-GBVETERAN_v1.0.md" },
  { code: "SP-ORG-GBRIX2", name: "재단법인 경북연구원", desc: "당신은 **재단법인 경북연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 경북연구원", "경북연구원"], file: "07-org/SP-ORG-GBRIX2_v1.0.md" },
];

// ==== GYEONGNAM_ORG_TABLE (gyeongnam, 2026-08-14 전국 확대 배치) ====
const GYEONGNAM_ORG_TABLE = [
  { code: "SP-ORG-GNMISC1", name: "(주)경남무역", desc: "당신은 **(주)경남무역**을(를) 대표하는 AI 레이어다. 소관 유형: PUBENT", kw: ["(주)경남무역"], file: "07-org/SP-ORG-GNMISC1_v1.0.md" },
  { code: "SP-ORG-GNFUTURE", name: "재단법인 경상남도미래세대재단", desc: "당신은 **재단법인 경상남도미래세대재단**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["재단법인 경상남도미래세대재단", "경상남도미래세대재단"], file: "07-org/SP-ORG-GNFUTURE_v1.0.md" },
  { code: "SP-ORG-GNCGF", name: "경남신용보증재단", desc: "당신은 **경남신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["경남신용보증재단"], file: "07-org/SP-ORG-GNCGF_v1.0.md" },
  { code: "SP-ORG-GNRI", name: "재단법인 경남연구원", desc: "당신은 **재단법인 경남연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 경남연구원", "경남연구원"], file: "07-org/SP-ORG-GNRI_v1.0.md" },
  { code: "SP-ORG-GNTP", name: "경남테크노파크", desc: "당신은 **경남테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["경남테크노파크"], file: "07-org/SP-ORG-GNTP_v1.0.md" },
  { code: "SP-ORG-GNROBOT", name: "경남로봇랜드재단", desc: "당신은 **경남로봇랜드재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["경남로봇랜드재단"], file: "07-org/SP-ORG-GNROBOT_v1.0.md" },
  { code: "SP-ORG-GNENV", name: "재단법인 경상남도환경재단", desc: "당신은 **재단법인 경상남도환경재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 경상남도환경재단", "경상남도환경재단"], file: "07-org/SP-ORG-GNENV_v1.0.md" },
  { code: "SP-ORG-GNMISC2", name: "경남문화예술진흥원", desc: "당신은 **경남문화예술진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["경남문화예술진흥원"], file: "07-org/SP-ORG-GNMISC2_v1.0.md" },
  { code: "SP-ORG-GNMED", name: "경상남도마산의료원", desc: "당신은 **경상남도마산의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["경상남도마산의료원"], file: "07-org/SP-ORG-GNMED_v1.0.md" },
  { code: "SP-ORG-GNRIX2", name: "재단법인 경남항노화연구원", desc: "당신은 **재단법인 경남항노화연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 경남항노화연구원", "경남항노화연구원"], file: "07-org/SP-ORG-GNRIX2_v1.0.md" },
  { code: "SP-ORG-GNSCHOL", name: "경상남도장학회", desc: "당신은 **경상남도장학회**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["경상남도장학회"], file: "07-org/SP-ORG-GNSCHOL_v1.0.md" },
  { code: "SP-ORG-GNSSO", name: "재단법인 경상남도 사회서비스원", desc: "당신은 **재단법인 경상남도 사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["재단법인 경상남도 사회서비스원", "경상남도 사회서비스원"], file: "07-org/SP-ORG-GNSSO_v1.0.md" },
  { code: "SP-ORG-GNTOURISM", name: "재단법인 경상남도 관광재단", desc: "당신은 **재단법인 경상남도 관광재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 경상남도 관광재단", "경상남도 관광재단"], file: "07-org/SP-ORG-GNTOURISM_v1.0.md" },
  { code: "SP-ORG-GNWOMEN", name: "재단법인 경상남도 여성가족재단", desc: "당신은 **재단법인 경상남도 여성가족재단**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["재단법인 경상남도 여성가족재단", "경상남도 여성가족재단"], file: "07-org/SP-ORG-GNWOMEN_v1.0.md" },
  { code: "SP-ORG-GNBEA", name: "재단법인 경상남도 투자경제진흥원", desc: "당신은 **재단법인 경상남도 투자경제진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 경상남도 투자경제진흥원", "경상남도 투자경제진흥원"], file: "07-org/SP-ORG-GNBEA_v1.0.md" },
  { code: "SP-ORG-GNLIFE", name: "재단법인 경상남도인재평생교육진흥원", desc: "당신은 **재단법인 경상남도인재평생교육진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["재단법인 경상남도인재평생교육진흥원", "경상남도인재평생교육진흥원"], file: "07-org/SP-ORG-GNLIFE_v1.0.md" },
];

// ==== ULSAN_ORG_TABLE (ulsan, 2026-08-14 전국 확대 배치) ====
const ULSAN_ORG_TABLE = [
  { code: "SP-ORG-USJOB", name: "재단법인 울산경제일자리진흥원", desc: "당신은 **재단법인 울산경제일자리진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 울산경제일자리진흥원", "울산경제일자리진흥원"], file: "07-org/SP-ORG-USJOB_v1.0.md" },
  { code: "SP-ORG-USRI", name: "재단법인 울산연구원", desc: "당신은 **재단법인 울산연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 울산연구원", "울산연구원"], file: "07-org/SP-ORG-USRI_v1.0.md" },
  { code: "SP-ORG-USCGF", name: "울산신용보증재단", desc: "당신은 **울산신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["울산신용보증재단"], file: "07-org/SP-ORG-USCGF_v1.0.md" },
  { code: "SP-ORG-USTP", name: "울산테크노파크", desc: "당신은 **울산테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["울산테크노파크"], file: "07-org/SP-ORG-USTP_v1.0.md" },
  { code: "SP-ORG-USSSO", name: "재단법인 울산광역시 복지가족진흥사회서비스원", desc: "당신은 **재단법인 울산광역시 복지가족진흥사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["재단법인 울산광역시 복지가족진흥사회서비스원", "울산광역시 복지가족진흥사회서비스원"], file: "07-org/SP-ORG-USSSO_v1.0.md" },
  { code: "SP-ORG-USIPA", name: "울산정보산업진흥원", desc: "당신은 **울산정보산업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["울산정보산업진흥원"], file: "07-org/SP-ORG-USIPA_v1.0.md" },
  { code: "SP-ORG-USTOURISM", name: "재단법인 울산문화관광재단", desc: "당신은 **재단법인 울산문화관광재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 울산문화관광재단", "울산문화관광재단"], file: "07-org/SP-ORG-USTOURISM_v1.0.md" },
];

// ==== CHUNGBUK_ORG_TABLE (chungbuk, 2026-08-14 전국 확대 배치) ====
const CHUNGBUK_ORG_TABLE = [
  { code: "SP-ORG-CBCF", name: "충북문화재단", desc: "당신은 **충북문화재단**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["충북문화재단"], file: "07-org/SP-ORG-CBCF_v1.0.md" },
  { code: "SP-ORG-CBRI", name: "재단법인 충청북도역사문화연구원", desc: "당신은 **재단법인 충청북도역사문화연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["재단법인 충청북도역사문화연구원", "충청북도역사문화연구원"], file: "07-org/SP-ORG-CBRI_v1.0.md" },
  { code: "SP-ORG-CBRIX2", name: "충북연구원", desc: "당신은 **충북연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["충북연구원"], file: "07-org/SP-ORG-CBRIX2_v1.0.md" },
  { code: "SP-ORG-CBCGF", name: "충북신용보증재단", desc: "당신은 **충북신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["충북신용보증재단"], file: "07-org/SP-ORG-CBCGF_v1.0.md" },
  { code: "SP-ORG-CBLIFE", name: "재단법인 충북인재평생교육진흥원", desc: "당신은 **재단법인 충북인재평생교육진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["재단법인 충북인재평생교육진흥원", "충북인재평생교육진흥원"], file: "07-org/SP-ORG-CBLIFE_v1.0.md" },
  { code: "SP-ORG-CBBIZ", name: "충청북도기업진흥원", desc: "당신은 **충청북도기업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["충청북도기업진흥원"], file: "07-org/SP-ORG-CBBIZ_v1.0.md" },
  { code: "SP-ORG-CBMISC1", name: "재단법인 충북과학기술혁신원", desc: "당신은 **재단법인 충북과학기술혁신원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 충북과학기술혁신원", "충북과학기술혁신원"], file: "07-org/SP-ORG-CBMISC1_v1.0.md" },
  { code: "SP-ORG-CBMED", name: "충청북도 청주의료원", desc: "당신은 **충청북도 청주의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["충청북도 청주의료원"], file: "07-org/SP-ORG-CBMED_v1.0.md" },
  { code: "SP-ORG-CBMEDX2", name: "충청북도 충주의료원", desc: "당신은 **충청북도 충주의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["충청북도 충주의료원"], file: "07-org/SP-ORG-CBMEDX2_v1.0.md" },
  { code: "SP-ORG-CBDORM", name: "충북학사", desc: "당신은 **충북학사**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["충북학사"], file: "07-org/SP-ORG-CBDORM_v1.0.md" },
  { code: "SP-ORG-CBMISC2", name: "충북여성재단", desc: "당신은 **충북여성재단**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["충북여성재단"], file: "07-org/SP-ORG-CBMISC2_v1.0.md" },
  { code: "SP-ORG-CBTP", name: "충북테크노파크", desc: "당신은 **충북테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["충북테크노파크"], file: "07-org/SP-ORG-CBTP_v1.0.md" },
  { code: "SP-ORG-CBBIO", name: "재단법인오송바이오진흥재단", desc: "당신은 **재단법인오송바이오진흥재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인오송바이오진흥재단", "오송바이오진흥재단"], file: "07-org/SP-ORG-CBBIO_v1.0.md" },
  { code: "SP-ORG-CBSSO", name: "충청북도사회서비스원", desc: "당신은 **충청북도사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["충청북도사회서비스원"], file: "07-org/SP-ORG-CBSSO_v1.0.md" },
];

// ==== CHUNGNAM_ORG_TABLE (chungnam, 2026-08-14 전국 확대 배치) ====
const CHUNGNAM_ORG_TABLE = [
  { code: "SP-ORG-CNRI", name: "충남연구원", desc: "당신은 **충남연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["충남연구원"], file: "07-org/SP-ORG-CNRI_v1.0.md" },
  { code: "SP-ORG-CNRIX2", name: "충남역사문화연구원", desc: "당신은 **충남역사문화연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["충남역사문화연구원"], file: "07-org/SP-ORG-CNRIX2_v1.0.md" },
  { code: "SP-ORG-CNBEA", name: "재단법인 충남경제진흥원", desc: "당신은 **재단법인 충남경제진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 충남경제진흥원", "충남경제진흥원"], file: "07-org/SP-ORG-CNBEA_v1.0.md" },
  { code: "SP-ORG-CNCONTENT", name: "재단법인 충남콘텐츠진흥원", desc: "당신은 **재단법인 충남콘텐츠진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["재단법인 충남콘텐츠진흥원", "충남콘텐츠진흥원"], file: "07-org/SP-ORG-CNCONTENT_v1.0.md" },
  { code: "SP-ORG-CNCGF", name: "충남신용보증재단", desc: "당신은 **충남신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["충남신용보증재단"], file: "07-org/SP-ORG-CNCGF_v1.0.md" },
  { code: "SP-ORG-CNTOURISM", name: "재단법인 충남문화관광재단", desc: "당신은 **재단법인 충남문화관광재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 충남문화관광재단", "충남문화관광재단"], file: "07-org/SP-ORG-CNTOURISM_v1.0.md" },
  { code: "SP-ORG-CNLIFE", name: "재단법인 충남평생교육진흥원", desc: "당신은 **재단법인 충남평생교육진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["재단법인 충남평생교육진흥원", "충남평생교육진흥원"], file: "07-org/SP-ORG-CNLIFE_v1.0.md" },
  { code: "SP-ORG-CNMED", name: "천안의료원", desc: "당신은 **천안의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["천안의료원"], file: "07-org/SP-ORG-CNMED_v1.0.md" },
  { code: "SP-ORG-CNMEDX2", name: "공주의료원", desc: "당신은 **공주의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["공주의료원"], file: "07-org/SP-ORG-CNMEDX2_v1.0.md" },
  { code: "SP-ORG-CNMEDX3", name: "서산의료원", desc: "당신은 **서산의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["서산의료원"], file: "07-org/SP-ORG-CNMEDX3_v1.0.md" },
  { code: "SP-ORG-CNMEDX4", name: "홍성의료원", desc: "당신은 **홍성의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["홍성의료원"], file: "07-org/SP-ORG-CNMEDX4_v1.0.md" },
  { code: "SP-ORG-CNTP", name: "충남테크노파크", desc: "당신은 **충남테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["충남테크노파크"], file: "07-org/SP-ORG-CNTP_v1.0.md" },
  { code: "SP-ORG-CNSSO", name: "충남사회서비스원", desc: "당신은 **충남사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["충남사회서비스원"], file: "07-org/SP-ORG-CNSSO_v1.0.md" },
  { code: "SP-ORG-CNCONFUCIAN", name: "재단법인 한국유교문화진흥원", desc: "당신은 **재단법인 한국유교문화진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["재단법인 한국유교문화진흥원", "한국유교문화진흥원"], file: "07-org/SP-ORG-CNCONFUCIAN_v1.0.md" },
];

// ==== JEONBUK_ORG_TABLE (jeonbuk, 2026-08-14 전국 확대 배치) ====
const JEONBUK_ORG_TABLE = [
  { code: "SP-ORG-JBRI", name: "전북연구원", desc: "당신은 **전북연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["전북연구원"], file: "07-org/SP-ORG-JBRI_v1.0.md" },
  { code: "SP-ORG-JBMISC1", name: "재단법인 전북특별자치도평생교육장학진흥원", desc: "당신은 **재단법인 전북특별자치도평생교육장학진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: LIFELONGEDU", kw: ["재단법인 전북특별자치도평생교육장학진흥원", "전북특별자치도평생교육장학진흥원"], file: "07-org/SP-ORG-JBMISC1_v1.0.md" },
  { code: "SP-ORG-JBCGF", name: "전북신용보증재단", desc: "당신은 **전북신용보증재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["전북신용보증재단"], file: "07-org/SP-ORG-JBCGF_v1.0.md" },
  { code: "SP-ORG-JBBEA", name: "재단법인 전북특별자치도경제통상진흥원", desc: "당신은 **재단법인 전북특별자치도경제통상진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 전북특별자치도경제통상진흥원", "전북특별자치도경제통상진흥원"], file: "07-org/SP-ORG-JBBEA_v1.0.md" },
  { code: "SP-ORG-JBTP", name: "전북테크노파크", desc: "당신은 **전북테크노파크**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["전북테크노파크"], file: "07-org/SP-ORG-JBTP_v1.0.md" },
  { code: "SP-ORG-JBAUTOTECH", name: "자동차융합기술원", desc: "당신은 **자동차융합기술원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["자동차융합기술원"], file: "07-org/SP-ORG-JBAUTOTECH_v1.0.md" },
  { code: "SP-ORG-JBRIX2", name: "에코융합섬유연구원", desc: "당신은 **에코융합섬유연구원**을(를) 대표하는 AI 레이어다. 소관 유형: RESEARCH", kw: ["에코융합섬유연구원"], file: "07-org/SP-ORG-JBRIX2_v1.0.md" },
  { code: "SP-ORG-JBWOMEN", name: "재단법인 전북여성가족재단", desc: "당신은 **재단법인 전북여성가족재단**을(를) 대표하는 AI 레이어다. 소관 유형: WOMENFAMILY", kw: ["재단법인 전북여성가족재단", "전북여성가족재단"], file: "07-org/SP-ORG-JBWOMEN_v1.0.md" },
  { code: "SP-ORG-JBIPA", name: "재단법인 전북바이오융합산업진흥원", desc: "당신은 **재단법인 전북바이오융합산업진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 전북바이오융합산업진흥원", "전북바이오융합산업진흥원"], file: "07-org/SP-ORG-JBIPA_v1.0.md" },
  { code: "SP-ORG-JBMED", name: "전북특별자치도 남원의료원", desc: "당신은 **전북특별자치도 남원의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["전북특별자치도 남원의료원"], file: "07-org/SP-ORG-JBMED_v1.0.md" },
  { code: "SP-ORG-JBMEDX2", name: "전북특별자치도 군산의료원", desc: "당신은 **전북특별자치도 군산의료원**을(를) 대표하는 AI 레이어다. 소관 유형: MEDICAL", kw: ["전북특별자치도 군산의료원"], file: "07-org/SP-ORG-JBMEDX2_v1.0.md" },
  { code: "SP-ORG-JBINTL", name: "재단법인 전북국제협력진흥원", desc: "당신은 **재단법인 전북국제협력진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 전북국제협력진흥원", "전북국제협력진흥원"], file: "07-org/SP-ORG-JBINTL_v1.0.md" },
  { code: "SP-ORG-JBTOURISM", name: "재단법인 전북특별자치도문화관광재단", desc: "당신은 **재단법인 전북특별자치도문화관광재단**을(를) 대표하는 AI 레이어다. 소관 유형: ECONIND", kw: ["재단법인 전북특별자치도문화관광재단", "전북특별자치도문화관광재단"], file: "07-org/SP-ORG-JBTOURISM_v1.0.md" },
  { code: "SP-ORG-JBCONTENT", name: "재단법인 전북특별자치도콘텐츠융합진흥원", desc: "당신은 **재단법인 전북특별자치도콘텐츠융합진흥원**을(를) 대표하는 AI 레이어다. 소관 유형: CULTUREARTS", kw: ["재단법인 전북특별자치도콘텐츠융합진흥원", "전북특별자치도콘텐츠융합진흥원"], file: "07-org/SP-ORG-JBCONTENT_v1.0.md" },
  { code: "SP-ORG-JBSSO", name: "재단법인 전북특별자치도 사회서비스원", desc: "당신은 **재단법인 전북특별자치도 사회서비스원**을(를) 대표하는 AI 레이어다. 소관 유형: WELFARE", kw: ["재단법인 전북특별자치도 사회서비스원", "전북특별자치도 사회서비스원"], file: "07-org/SP-ORG-JBSSO_v1.0.md" },
];

const GANGWON_L2_TABLE = _makeGenericL2Entries('gangwon', FULL16_DOMAINS);
const DAEGU_L2_TABLE = _makeGenericL2Entries('daegu', FULL16_DOMAINS);
const JEONNAM_GWANGJU_L2_TABLE = _makeGenericL2Entries('jeonnam-gwangju', FULL16_DOMAINS);

// ── 국가기관 지사 확대(1차, 2026-07-24) — police만 선별 확대 ──────────
// 주피터 지시: "관할구역이 도 경계와 거의 일치하는 기관만 선별적으로
// 정적 확대". 국가기관은 도청/시청과 달리 관할구역이 행정구역과 안 맞는
// 경우가 많아(세무서는 지방국세청 관할, 법원은 지방법원 관할구역 등)
// 기본 라벨 방식이 위험하다 — 잘못된 관할 기관을 안내할 수 있다. police는
// 예외적으로 2026-07 웹검색 확인 결과 대부분 도와 1:1 대응한다(경기·
// 전남광주통합만 예외 — 미포함). 다른 18개 도메인은 이번 배치에서
// 손대지 않는다(각각 별도 검증 필요 — SP-NATIONAL-LAZY가 계속 안전망).
const POLICE_PROVINCES = ['seoul', 'busan', 'daegu', 'incheon', 'daejeon', 'ulsan',
  'sejong', 'gangwon', 'chungbuk', 'chungnam', 'jeonbuk', 'gyeongbuk', 'gyeongnam'];
function _makePoliceEntry(도코드) {
  return { code: 'SP-NAT-POLICE', domain: 'police', 도코드, file: null,
    kw: ['경찰청', '112', '고소장', '수사', '지구대', '파출소'] };
}

const PROVINCE_TABLES = {
  jeju: {
    // ★ repo 필드는 아직 비워둔다 — prompts/gov-tree/01-do,
    // 02-do-dept(+divisions), 03-do-agency(+divisions), 04-city,
    // 07-org(+divisions)의 제주 267건이 Openhash-Gopang/jejudo로 실제
    // 이관 완료된 뒤, 아래 한 줄을 추가하는 PR로 전환한다(마이그레이션
    // 계획서 Phase 4). 지금 추가하면 파일이 아직 gopang에만 있으므로
    // 프로덕션에서 404가 난다.
    // repo: 'Openhash-Gopang/jejudo',
    l2: JEJU_L2_TABLE, city: JEJU_CITY_TABLE, national: JEJU_NATIONAL_TABLE, citydept: JEJU_CITY_DEPT_TABLE,
    // 2026-08-02 추가 — 직속기관(03-do-agency)/출자출연기관(07-org)은
    // 지금까지 _resolveProvinceCode() === 'jeju' 문자열 비교로 가드를
    // 걸었었다(임시방편). l2/city/national과 동일하게 PROVINCE_TABLES에
    // 편입해 다른 도 확장 시 이 도만 값을 채우면 되도록 정리한다 —
    // 다른 도는 아래에서 agency/org 필드 자체를 안 적어도 accessor의
    // `|| []` 폴백으로 안전하게 빈 배열이 된다(l2/national과 동일 패턴).
    agency: JEJU_AGENCY_TABLE, org: JEJU_ORG_TABLE,
    agencyDivision: JEJU_AGENCY_DIVISION_TABLE, orgDivision: JEJU_ORG_DIVISION_TABLE },
  // 2026-07-24 — 1단계 확대: 부산 16개 자치구·군 + 서울 25개 자치구
  // 메타데이터 등록 완료(계획서 v1.1 §5). L2는 v1.0부터 이미 실사 완료 상태.
  busan: { l2: BUSAN_L2_TABLE, city: BUSAN_CITY_TABLE, national: [_makePoliceEntry('busan')], citydept: BUSAN_CITY_DEPT_TABLE,
    // 2026-08-04 신설 — 부산 파일럿 org tier 1호(부산교통공사). 위
    // BUSAN_ORG_TABLE 정의부 주석 참조.
    org: BUSAN_ORG_TABLE },
  seoul: { l2: SEOUL_L2_TABLE, city: SEOUL_CITY_TABLE, national: [_makePoliceEntry('seoul')], citydept: SEOUL_CITY_DEPT_TABLE,
    // 2026-08-14 추가 — 서울 출자·출연기관(07-org) 전국 확대 배치 17건.
    org: SEOUL_ORG_TABLE },
  // 2026-07-24 — 3단계: 나머지 12개 도 시/군/구 183개 전수 메타데이터
  // 등록 완료(계획서 v1.1 §5). L2가 이미 있던 8개 도는 city/citydept만
  // 채우고, L2가 아예 없던 4개 도(경기·강원·대구·전남광주통합)는 항목
  // 자체를 새로 만들되 l2/national은 정직하게 빈 배열로 남긴다(도청
  // 실국 실사는 별도 작업 — 이 배치는 시/군/구 계층만 다룬다).
  incheon: { l2: INCHEON_L2_TABLE, city: INCHEON_CITY_TABLE, national: [_makePoliceEntry('incheon')], citydept: INCHEON_CITY_DEPT_TABLE,
    org: INCHEON_ORG_TABLE },  // ⚠️ 2026-08 시행 예정(안)
  daejeon: { l2: DAEJEON_L2_TABLE, city: DAEJEON_CITY_TABLE, national: [_makePoliceEntry('daejeon')], citydept: DAEJEON_CITY_DEPT_TABLE,
    org: DAEJEON_ORG_TABLE },
  ulsan: { l2: ULSAN_L2_TABLE, city: ULSAN_CITY_TABLE, national: [_makePoliceEntry('ulsan')], citydept: ULSAN_CITY_DEPT_TABLE,
    org: ULSAN_ORG_TABLE },
  sejong: { l2: SEJONG_L2_TABLE, city: [], national: [_makePoliceEntry('sejong')], citydept: [],
    org: SEJONG_ORG_TABLE },  // 단층제라 시청 계층 자체가 해당 없음
  chungbuk: { l2: CHUNGBUK_L2_TABLE, city: CHUNGBUK_CITY_TABLE, national: [_makePoliceEntry('chungbuk')], citydept: CHUNGBUK_CITY_DEPT_TABLE,
    org: CHUNGBUK_ORG_TABLE },
  chungnam: { l2: CHUNGNAM_L2_TABLE, city: CHUNGNAM_CITY_TABLE, national: [_makePoliceEntry('chungnam')], citydept: CHUNGNAM_CITY_DEPT_TABLE,
    org: CHUNGNAM_ORG_TABLE },
  jeonbuk: { l2: JEONBUK_L2_TABLE, city: JEONBUK_CITY_TABLE, national: [_makePoliceEntry('jeonbuk')], citydept: JEONBUK_CITY_DEPT_TABLE,
    org: JEONBUK_ORG_TABLE },
  gyeongbuk: { l2: GYEONGBUK_L2_TABLE, city: GYEONGBUK_CITY_TABLE, national: [_makePoliceEntry('gyeongbuk')], citydept: GYEONGBUK_CITY_DEPT_TABLE,
    org: GYEONGBUK_ORG_TABLE },  // ⚠️ L2 조직개편 중, 신뢰도 낮음
  // 2026-07-24 — 진주·창원(+5개 일반구)·산청군 파일럿(2단계) + 나머지 15개
  // 시/군(3단계)을 합친다.
  gyeongnam: { l2: GYEONGNAM_L2_TABLE,
    city: [...GYEONGNAM_CITY_TABLE, ...GYEONGNAM_PHASE3_CITY_TABLE],
    national: [_makePoliceEntry('gyeongnam')],
    citydept: [...GYEONGNAM_CITY_DEPT_TABLE, ...GYEONGNAM_PHASE3_CITY_DEPT_TABLE],
    org: GYEONGNAM_ORG_TABLE },  // ⚠️ L2는 스냅샷 불일치, 신뢰도 낮음
  // ★ 2026-07-24 신설 — 이 4개 도는 도청 실국(L2) 실사가 이전엔 전혀
  // 없었다(PROVINCE_TABLES 항목 자체가 없었음). 시청과 동일 원칙으로
  // 실명 없이도 즉시 작동하는 범용 도메인 키워드+기본 라벨로 16/16 채운다
  // — 경기도는 do-dept-master-data.json에 이미 있던 13개 실사 데이터를
  // 살려 실명 키워드를 우선 쓰고, 나머지 3개(sports/health/family)만 범용.
  gyeonggi: { l2: GYEONGGI_L2_TABLE, city: GYEONGGI_CITY_TABLE, national: [], citydept: GYEONGGI_CITY_DEPT_TABLE,
    // 2026-08-14 추가 — 경기 출자·출연기관(07-org) 전국 확대 배치 23건.
    org: GYEONGGI_ORG_TABLE },
  gangwon: { l2: GANGWON_L2_TABLE, city: GANGWON_CITY_TABLE, national: [_makePoliceEntry('gangwon')], citydept: GANGWON_CITY_DEPT_TABLE,
    org: GANGWON_ORG_TABLE },
  daegu: { l2: DAEGU_L2_TABLE, city: DAEGU_CITY_TABLE, national: [_makePoliceEntry('daegu')], citydept: DAEGU_CITY_DEPT_TABLE,
    org: DAEGU_ORG_TABLE },
  'jeonnam-gwangju': { l2: JEONNAM_GWANGJU_L2_TABLE, city: JEONNAM_GWANGJU_CITY_TABLE, national: [], citydept: JEONNAM_GWANGJU_CITY_DEPT_TABLE,
    org: JEONNAM_GWANGJU_ORG_TABLE },
};
function _l2Table() { return PROVINCE_TABLES[_resolveProvinceCode()]?.l2 || []; }
function _cityTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.city || []; }
function _nationalTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.national || []; }
function _cityDeptTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.citydept || []; }
function _agencyTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.agency || []; }
function _orgTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.org || []; }
function _agencyDivisionTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.agencyDivision || []; }
function _orgDivisionTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.orgDivision || []; }

// ── directCode(K-Search 엔티티 매칭 확정 경로) 전용 — 도 무관 코드 탐색 ──
// ★ 2026-08-04 신설 — 버그 수정. directCode 처리부(§ -0.9)가 지금까지
// tier마다 `_currentResolvedProvinceCode = 'jeju'`를 무조건 하드코딩해서,
// K-Search가 제주 밖 기관을 정확히 찾아 directCode(예:
// 'city-dept:haeundae-jachi')를 반환해도 JEJU_CITY_DEPT_TABLE에서만
// 찾다가 못 찾고 조용히 텍스트-추측 폴백으로 떨어지는 구조적 결함이
// 있었다(주피터 2026-08-04 지시로 발견 — "AC는 지방 정부 영역이면
// 관할 행정기관을 호출한다"는 원칙 자체는 맞는데, directCode 1차 경로가
// 제주 밖에서 구조적으로 죽어있었다).
//
// gwp-registry.js가 넘기는 directCode(=프로필의 entity_subtype)는 도
// 정보를 안 담고 있으므로(예: 'AGRITECH', 'jejusi-jachi' — 도 접두어
// 없음), 프로필 스키마·기존 267건 entity_subtype 값을 재시딩하지 않고
// 고치는 가장 안전한 방법은 "코드가 어느 도 테이블에 실제로 있는지"를
// PROVINCE_TABLES 전체에서 찾아 그 도로 확정하는 것이다 — 코드 유일성은
// 이미 각 시딩 스크립트가 도별로 고유하게 부여한다고 전제한다(부여
// 규칙 자체가 깨지면 이 함수가 아니라 시딩 규칙을 고쳐야 한다).
//
// tableKey: PROVINCE_TABLES의 하위 키('l2'|'city'|'citydept'|'agency'|
// 'org'|'agencyDivision'|'orgDivision'). predicate: (entry) => boolean.
// 반환: { provinceCode, entry } | null. 여러 도에서 동시에 매칭되면(코드
// 유일성 가정이 깨진 경우) 첫 매칭을 쓰고 콘솔에 경고를 남긴다 — 조용히
// 삼키지 않는다.
function _findEntryAcrossProvinces(tableKey, predicate) {
  const matches = [];
  for (const [provinceCode, tables] of Object.entries(PROVINCE_TABLES)) {
    const table = tables[tableKey] || [];
    const entry = table.find(predicate);
    if (entry) matches.push({ provinceCode, entry });
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.warn(
      `[gov-router] directCode 코드 충돌 — tableKey=${tableKey}가 ` +
      `${matches.length}개 도(${matches.map(m => m.provinceCode).join(', ')})에서 ` +
      `동시에 매칭됨. 첫 번째(${matches[0].provinceCode})를 사용하지만, ` +
      `시딩 스크립트의 코드 유일성 부여 규칙을 점검할 것.`
    );
  }
  return matches[0];
}

function _matchNational(text) {
  return _scoreMatch(text, _nationalTable());
}

// ── L2Department 원형(canonical) 키워드 (2026-07-21 신설) ────────────
// 주피터 지시: "도청 등의 원형 클래스를 먼저 구현하고, 제주도청 등의
// 인스턴스를 사전에 혹은 실시간으로 조합해야 합니다." — 지금까지 L2
// 매칭은 도별 실사 테이블(JEJU_L2_TABLE 등)에만 의존해서, 실사 안 된
// 도(강원 등)는 도청 업무 자체를 전혀 판별하지 못했다(사고실험에서
// 확인). 이 원형 키워드는 실사 여부와 무관하게 최소한의 도메인
// 판별("이건 ○○ 관련 업무입니다")까지는 가능하게 하는 안전망이다 —
// 특정 부서명·연락처까지 확정하지는 않는다(실사 데이터가 있을 때만
// 가능한 일이라 정직하게 구분).
//
// 근거: 실사 완료된 12개 도의 L2 테이블을 실측 분석해, 2개 이상 도에서
// 공통으로 쓰인 어휘만 채택(도 하나만의 조직명은 배제). plan 도메인의
// 세정 관련 어휘(지방세/취득세/재산세/세정)는 govType 가드(#27)의
// 발견과 동일한 이유로 의도적으로 제외했다 — 원형에 넣으면 GENERAL
// 도에서 도청 오판정을 원형 단계부터 재생산하게 된다.
const L2_CANONICAL_KEYWORDS = {
  plan: ['기획조정실', '예산', '기획'],
  safety: ['재난', '안전', '태풍', '호우'],
  jachi: ['자치행정', '자치분권'],
  econ: ['소상공인', '일자리', '투자유치', '중소기업', '자영업'],
  innov: ['스타트업', '인공지능', '바이오산업'],
  welfare: ['기초생활수급', '기초연금', '장애인복지'],
  climate: ['환경', '탄소중립', '산림'],
  housing: ['주택', '건설'],
  transport: ['교통', '대중교통', '버스', '지하철'],
  culture: ['문화예술', '문화', '도서관'],
  tourism: ['관광', '숙박업', '여행업'],
  agri: ['농업', '축산'],
  ocean: ['어업', '수산', '해양'],
  health: ['보건', '감염병'],
  family: ['출산', '보육', '임신', '여성가족'],
  sports: ['체육', '생활체육'],
};
const _L2_DOMAIN_LABEL_KO = {
  plan: '기획·예산', safety: '안전·재난', jachi: '자치행정', econ: '경제·소상공인',
  innov: '혁신산업', welfare: '복지', climate: '환경·기후', housing: '주택·건설',
  transport: '교통', culture: '문화', tourism: '관광', agri: '농업·축산',
  ocean: '해양수산', health: '보건', family: '여성가족', sports: '체육',
};
function _matchL2Canonical(text) {
  for (const [domain, kws] of Object.entries(L2_CANONICAL_KEYWORDS)) {
    if (kws.some(k => _kwMatch(text, k))) return domain;
  }
  return null;
}
function _renderL2CanonicalFallback(domain) {
  const label = _L2_DOMAIN_LABEL_KO[domain] || domain;
  return `[실국 원형 매칭 — 이 지역 실사 전] '${label}' 관련 업무로 보입니다. ` +
    `담당 부서·연락처는 아직 실사되지 않아 구체적으로 안내하기 어렵습니다 — ` +
    `정부24(gov.kr), 해당 광역시도 대표전화, 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`;
}
function _matchCatalogOnly(text) {
  for (const c of CATALOG_ONLY) {
    if (c.kw.some(k => _kwMatch(text, k))) return c;
  }
  return null;
}
function _renderCatalogFallback(c) {
  return `[JEJU-NATIONAL-SP §4 공통 폴백]\n` +
    `${c.name}은(는) ${c.ministry}의 제주 지역 사무소로, 아직 이 SP가 상세 안내를 갖추지 못했습니다. ` +
    `${c.brief}을(를) 담당하며, 정확한 절차는 해당 기관 홈페이지 또는 정부24(gov.kr)에서 확인하시는 것을 권장합니다.`;
}

// ── LLM 기반 분류 폴백 (v1.2 신설) ──────────────────────────────
// 키워드 매칭은 빠르지만 "청년 월세 지원 있어요?"처럼 용건만 있고 고유
//명사가 없는 자연어, "자치경찰이랑 일반경찰 차이가 뭐예요" 같은 비교·설명
// 질문에는 원천적으로 약하다(사고실험에서 확인됨). 정규식을 계속 추가하는
// 두더지 잡기 대신, 키워드 매칭이 전부 실패했을 때만 LLM 자체에게 "이 43개
// 코드 중 뭐가 맞는지, 또는 특정 기관 없이 답할 수 있는 질문인지" 분류를
// 맡긴다 — 비용은 매칭 실패 시에만 발생(정상 케이스는 기존처럼 무료·즉시).
const ROUTE_DESCRIPTIONS = {
  'SP-DO-PLAN': '기획조정실 [지방세는 여기, 국세는 SP-NAT-TAX]',
  'SP-DO-SAFETY': '도민안전건강실(안전건강실)',
  'SP-DO-JACHI': '특별자치행정국 [제도 설명용 — 실제 자치경찰 사무는 SP-AGY-POLICE]',
  'SP-DO-ECON': '경제활력국',
  'SP-DO-INNOV': '혁신산업국',
  'SP-DO-WELFARE': '복지가족국(구 보건복지여성국)',
  'SP-DO-CLIMATE': '기후환경국',
  'SP-DO-HOUSING': '건설주택국',
  'SP-DO-TRANSPORT': '교통항공국',
  'SP-DO-CULTURE': '문화체육교육국',
  'SP-DO-TOURISM': '관광교류국',
  'SP-DO-AGRI': '농축산식품국',
  'SP-DO-OCEAN': '해양수산국',
  // 2026-08-02 신설 — L2 키워드 매칭에만 있고 여기 없으면 LLM 분류
  // 폴백이 절대 이 코드를 고르지 못한다.
  'SP-DO-COMM': '소통청렴담당관 [대민소통, 청렴·감사]',
  'SP-DO-GENDER': '성평등여성정책관 [성평등·여성정책 — 복지가족국의 가족·아동·보육과는 별도]',
  'SP-DO-GENERAL': '총무과 [일반서무·문서관리·인사지원 실무 — 기획조정실 인사정책과는 별도]',
  'SP-DO-SPOKES': '대변인 [공보·언론대응·도정 홍보]',
  'SP-DO-HEALTH': '보건 담당 [2026-07-20 신설 — 제주는 SP-DO-SAFETY에 통합, 별도 분리된 도만 이 코드 사용]',
  'SP-DO-FAMILY': '여성가족 담당 [2026-07-20 신설 — 제주는 SP-DO-WELFARE에 통합, 별도 분리된 도만 이 코드 사용]',
  'SP-DO-SPORTS': '체육 담당 [2026-07-20 신설 — 제주는 SP-DO-CULTURE에 통합, 별도 분리된 도만 이 코드 사용]',
  'SP-NAT-TAX': '제주세무서(국세청) [국세 — 지방세 아님]',
  'SP-NAT-COURT': '제주지방법원(법원행정처(사법부)) [실제 재판 절차 — K-Law(AI 판결 시뮬레이션)와 다름]',
  'SP-NAT-NPS': '국민연금공단 제주지역본부(보건복지부)',
  'SP-NAT-NHIS': '국민건강보험공단 제주지사(보건복지부)',
  'SP-NAT-IMMIGRATION': '제주출입국·외국인청(법무부)',
  'SP-NAT-POST': '제주지방우정청(우정사업본부(과학기술정보통신부))',
  'SP-NAT-POLICE': '제주지방경찰청(경찰청(국가경찰)) [국가경찰 — 형사·수사 전반]',
  'SP-NAT-LABOR': '근로복지공단 제주지사(고용노동부)',
  'SP-NAT-PROSECUTION': '제주지방검찰청(법무부(대검찰청)) [검찰 — 공소·기소. 경찰과 다름]',
  'SP-NAT-COASTGUARD': '제주해양경찰서(해양경찰청)',
  'SP-NAT-WEATHER': '제주지방기상청(기상청)',
  'SP-NAT-PPS': '제주지방조달청(조달청)',
  'SP-NAT-MMA': '제주지방병무청(병무청)',
  'SP-NAT-VETERANS': '제주보훈청(국가보훈부)',
  'SP-NAT-LABORREL': '제주지방노동위원회(고용노동부)',
  'SP-NAT-PROBATION': '제주준법지원센터(법무부(범죄예방정책국))',
  'SP-NAT-ANIMALQUARANTINE': '농림축산검역본부 제주지역본부(농림축산식품부)',
  'SP-NAT-HUMANQUARANTINE': '국립제주검역소(질병관리청)',
  'SP-NAT-AGROQUALITY': '국립농산물품질관리원 제주지원(농림축산식품부)',
  'SP-NAT-FISHQUALITY': '국립수산물품질관리원 제주지원(해양수산부)',
  'SP-NAT-FOODIMPORT': '광주지방식품의약품안전청 제주수입식품검사소(식품의약품안전처)',
  'SP-NAT-DATA': '호남지방데이터청 제주사무소(국가데이터처)',
  'SP-NAT-RADIO': '제주전파관리소(과학기술정보통신부)',
  'SP-NAT-ENV': '영산강유역환경청 제주주재사무실(기후에너지환경부)',
  'SP-NAT-LABORIMPROVE': '광주지방고용노동청 제주근로개선지도센터(고용노동부)',
  'SP-NAT-INTERNET': '한국지능정보사회진흥원 제주스마트쉼센터(과학기술정보통신부/행정안전부)',
  'SP-NAT-AIRPORT': '한국공항공사 제주공항(국토교통부 산하 공기업)',
  'SP-NAT-PORT': '제주지방해양수산청(해양수산부)',
  // ★ 2026-07-24 신설(100건 사고실험에서 발견) — JEJU_NATIONAL_TABLE에
  // 같이 추가한 6개 기관. LLM 분류 폴백(_classifyFallback)이 여기 없는
  // 코드는 무조건 무시하므로(ROUTE_DESCRIPTIONS[code] 존재 확인), 이걸
  // 안 하면 라우팅 테이블에 넣어도 LLM 폴백 경로에서는 여전히 인식 못 함.
  'SP-NAT-CUSTOMS': '제주세관(관세청)',
  'SP-NAT-BOK': '한국은행 제주본부(중앙은행)',
  'SP-NAT-STAT': '통계청 제주사무소(통계청)',
  'SP-NAT-FORESTRESEARCH': '난대·아열대산림연구소(산림청 국립산림과학원)',
  'SP-NAT-FORESTSEED': '국립산림품종관리센터 제주지소(산림청)',
  'SP-NAT-FORESTCOOP': '산림조합중앙회 제주지역본부(국가기관 아님 — 임업인 출자 협동조합)',
  'SP-CITY-JEJU': '제주시청',
  'SP-CITY-SEOGWIPO': '서귀포시청',
  'SP-SIGUNGU-LAZY': '시군구(기초자치단체) 관할 업무 — 텍스트에 정적 테이블에 없는 특정 시/군/구 이름이 언급되고 그 지자체 소관 업무(복지·안전·민원·환경 등) 문의로 보이는 경우 [2026-07-20 신설 — 지연 초기화]',
  'SP-NATIONAL-LAZY': '국가기관 지사(세무서·법원·검찰청·경찰청·건강보험공단 등 19개 핵심 기관) 관할 업무 — 정적 국가기관 테이블이 비어 있는 도(제주 외)에서 국가기관성 키워드가 언급된 경우 [2026-07-20 신설 — 지연 초기화]',
  // ★ 2026-08-22 신설(사용자 지시 — 두 번째 근본결함 수정) — 주민등록
  // 등초본·인감증명·가족관계증명서·전입신고 등은 읍면동 민원팀이 직접
  // 처리하는 사무인데(05-emd/templates/SP-TEAM-CIVIL-TEMPLATE_v2.1.md
  // §3), EMD는 발화·pdvLocationHint에 구체적 읍면동 이름이 리터럴로
  // 있을 때만 결정론적으로 매칭된다(_matchEmd) — 그 외엔 이 코드 자체가
  // 여태 후보로 존재한 적이 없어 classifyFn이 "정답이 후보에 없다"고
  // 정직하게 NONE을 내는 게 실측 확인됐다(2026-08-22). 위치 확보(Fix
  // 1)가 실패한 극소수 경우를 위한 안전망 — 선택되면 부서 후보 선택이
  // 아니라 "거주 읍면동을 되묻는" 질문으로 처리된다(assembleGovSystemPrompt
  // 참조).
  'SP-EMD-LAZY': '읍면동(주민센터) 민원팀 직접 처리 사무 — 주민등록등초본·인감증명서·가족관계증명서·전입신고 등 즉시발급형 제증명 발급으로 보이는데, 어느 읍면동인지 아직 모르는 경우',
  'SP-POLICY-LAZY': '중앙부처·청·위원회 본청(법무부·교육부·감사원·공정거래위원회 등 70개, 도별 지사가 없는 전국 단일 정책기관) 관할 업무 — 개별 신청·민원이 아니라 부처 본청 차원의 정책·제도·인허가·신고 업무로 보이는 경우 [2026-08-02 신설 — 지연 초기화]',
};

function _findTableEntry(code) {
  return _nationalTable().find(e => e.code === code)
    || _l2Table().find(e => e.code === code)
    || _cityTable().find(e => e.code === code)
    || null;
}

function _isNationalCode(code) {
  return _nationalTable().some(e => e.code === code);
}

// classifyFn: async (text, candidatesText) => 'SP-XXX-YYY' | 'NONE' | null
// webapp.html이 실제 LLM 호출로 구현해서 주입한다(라우터 자체는 네트워크 호출을
// 안 한다 — 기존 구조 유지). 주입 안 하면 그냥 기존처럼 무매칭으로 끝난다.
// ── candidatesText province-aware 필터링 (2026-07-24 신설, 전국 인스턴스
// 롤아웃 계획 0단계) ─────────────────────────────────────────────
// 이전엔 ROUTE_DESCRIPTIONS의 모든 코드(제주 전용 정적 인스턴스 포함)를
// 도 구분 없이 LLM에게 후보로 통째로 보여줬다. 국가기관 지사가 지금은
// 제주만 정적 인스턴스가 있는 구조라, 비제주 사용자 질문에 LLM이
// SP-NAT-TAX 같은 제주 전용 코드를 골라도 _findTableEntry가 조용히 못
// 찾아 실패하고(SP-NATIONAL-LAZY를 골랐어야 정답) 일반 안내로 떨어지는
// 문제가 있었다. 전국 인스턴스화가 진행될수록(15개 도 추가) 이 문제의
// 발생 빈도가 함께 커지므로, 데이터를 채우기 전에 먼저 후보 목록 자체를
// "이 도에서 실제로 존재하는 코드"로만 한정한다.
function _buildCandidatesText() {
  const provinceCode = _resolveProvinceCode();
  const registryEntry = PROVINCE_REGISTRY[provinceCode];
  const codes = new Set();

  // 실사된 도청 실국·시청·국가기관 코드만 후보에 넣는다(빈 배열이면
  // 아무것도 안 들어가고, 대신 아래에서 LAZY 코드가 그 자리를 메운다).
  for (const e of _l2Table()) codes.add(e.code);
  for (const e of _cityTable()) codes.add(e.code);
  for (const e of _nationalTable()) codes.add(e.code);

  // 국가기관 정적 인스턴스가 부분적이거나 없는 도(현재 제주만 근접
  // 종합 커버리지)는 SP-NATIONAL-LAZY도 항상 후보에 얹는다 — 매칭된
  // 실제 코드(예: police)와 안 겹치는 다른 국가기관 질문(세무서·법원 등)은
  // 여전히 LAZY가 받아야 하기 때문이다. 2026-07-24 police 선별 확대 이전엔
  // "table.length === 0"이 "제주 외 전부"와 우연히 같은 뜻이었지만, 이제
  // 부분 커버리지(예: 부산=police 1개만)가 생기면서 그 등가관계가 깨졌다
  // — 도코드 자체로 직접 판단하도록 고친다(제주만 예외).
  if (provinceCode !== 'jeju') codes.add('SP-NATIONAL-LAZY');

  // 시군구(기초자치단체) 지연조회는 GENERAL 도에서만 의미가 있다
  // (SPECIAL_AUTONOMOUS인 제주는 기초자치단체 자체가 없음).
  if (registryEntry?.govType === 'GENERAL') codes.add('SP-SIGUNGU-LAZY');

  // 중앙부처 정책기관(policy-bodies)은 도별 지사가 없는 전국 단일 SP라
  // SP-NATIONAL-LAZY와 달리 도 구분 없이 항상 후보에 얹는다(제주 포함).
  codes.add('SP-POLICY-LAZY');

  // ★ 2026-08-22 신설 — EMD(읍면동) 민원팀 소관 사무를 위치 미확보
  // 상태에서도 후보로 보여준다(근본결함 수정 — 상세 근거는 ROUTE_
  // DESCRIPTIONS['SP-EMD-LAZY'] 주석 참조).
  codes.add('SP-EMD-LAZY');

  return [...codes]
    .filter(code => ROUTE_DESCRIPTIONS[code])
    .map(code => `${code}: ${ROUTE_DESCRIPTIONS[code]}`)
    .join('\n');
}

// ── 사용자 재질문(K-Intent 되묻기) 신호 (2026-08-21 신설, 사용자 지시) ──
// 배경: classifyFn이 항상 코드 하나 또는 NONE만 강제로 골라야 했다 —
// "애매하니 사용자에게 되물어라"는 제3의 선택지가 프로토콜에 아예
// 없었다(스모크테스트로 실측: SAFETY/JTP/CHILDMEAL이 확신 없이
// SP-AGY-BOHWAN을 찍었는데도 사용자에게는 아무 표시 없이 그 부서
// SP가 그대로 로드됨). classifyFn이 'CLARIFY:codeA,codeB' 형식으로
// 답하면(호출부 프롬프트에 이 형식을 안내해야 함 — pages/regional-
// gov.html의 _govClassifyFn 참조) 아래에서 이 예외를 던지고,
// assembleGovSystemPrompt 최상위에서 캐치해 needsClarification 필드로
// 반환한다 — 호출부(채팅 UI)가 이걸 보면 SP를 조립하는 대신 사용자에게
// 직접 되묻는 질문을 보여줘야 한다.
class NeedsClarificationSignal extends Error {
  constructor(options) {
    super('NEEDS_CLARIFICATION');
    this.options = options; // [{code, name}, ...] — 최소 2개
  }
}
// ★ 2026-08-22 신설 — 부서 A/B 중 선택이 아니라 "위치를 몰라서 못
// 고른다"는 다른 종류의 불확실성. 자유형 질문(예: "어느 읍면동에
// 사시나요?")이라 옵션 목록이 없다 — NeedsClarificationSignal과 구분.
class NeedsLocationSignal extends Error {
  constructor(question) {
    super('NEEDS_LOCATION');
    this.question = question;
  }
}
function _parseClarifySignal(code) {
  if (typeof code !== 'string' || !code.startsWith('CLARIFY:')) return null;
  const codes = code.slice(8).split(',').map(c => c.trim()).filter(Boolean);
  return codes.length >= 2 ? codes : null;
}

async function _classifyFallback(text, classifyFn) {
  if (!classifyFn) return null;
  const candidatesText = _buildCandidatesText();
  try {
    const code = await classifyFn(text, candidatesText);
    const clarifyCodes = _parseClarifySignal(code);
    if (clarifyCodes) {
      const options = clarifyCodes
        .filter(c => ROUTE_DESCRIPTIONS[c])
        .map(c => ({ code: c, name: ROUTE_DESCRIPTIONS[c].split(' — ')[0] || c }));
      if (options.length >= 2) throw new NeedsClarificationSignal(options);
    }
    if (!code || code === 'NONE' || !ROUTE_DESCRIPTIONS[code]) return null;
    return code;
  } catch (e) {
    if (e instanceof NeedsClarificationSignal) throw e;
    console.warn('[Jeju] LLM 분류 폴백 실패:', e.message);
    return null;
  }
}

// ── 시청 과(division) 전국 공용 원형 (2026-08-21 신설, 2026-08-22 재복원
// 2회차 — #523에 이어 #525도 이 인근 로직을 고쳐 병합하면서 같은 방식
// 으로 유실됨. GOV-TASK-904-GAP 04-city 과 단위 원형화) ─────────────
// ★★★ 병렬 세션 충돌 경고 ★★★ 이 블록은 최근 두 차례(#523, #525) 다른
// 세션이 인근의 L2/division 매칭 로직을 손대면서 조용히 삭제됐다.
// 재발 방지를 위해 이 블록을 건드리는 세션은 병합 직전 반드시
// `grep -c GENERIC_CITY_DIVISION_TAXONOMY src/gopang/gov/gov-router.js`
// 로 생존을 확인할 것 — 0이 나오면 병합 전 반드시 복구.
//
// CITY_DIVISION_TABLE은 아직 제주(jejusi/seogwipo) 전용 실사 테이블이다
// (위 CITY_DIVISION_TABLE import 주석 참고). 비제주 시/군/구는 과 단위
// 라우팅 자체가 없어 국(局) 단위 응답에서 멈췄다 — 이 테이블은 국코드별로
// "전국 어디나 존재하는 과 단위 보편 업무"만 제네릭 원형으로 등록해,
// 시코드에 상관없이 매칭되게 한다. 제주(jejusi/seogwipo)는 이미 실사
// 데이터가 있으므로 _matchCityDivision에서 원천적으로 제외한다.
//
// 도메인 추가 시 이 taxonomy에 항목만 늘리면 된다 — 검증 없이 대량으로
// 채우지 말 것(주피터 지시 원칙: 하나씩 웹검색·실제 SP 원본 대조 후 추가).
const GENERIC_CITY_DIVISION_TAXONOMY = {
  jachi: [
    {
      subCode: 'TAX', name: '세무과(신고납부형 지방세)',
      kw: ['취득세', '등록면허세', '지방소득세', '신고납부', '세무과',
        '지방세 이의신청', '과세전적부심사'],
      file: '04-city/templates/divisions/SP-CITYDIV-JACHI-TAX-TEMPLATE_v1.0.md',
    },
  ],
  welfare: [
    {
      subCode: 'BASICLIVELIHOOD', name: '기초생활보장과',
      kw: ['기초생활보장', '생계급여', '의료급여', '주거급여', '교육급여',
        '기초생활수급', '부양의무자'],
      file: '04-city/templates/divisions/SP-CITYDIV-WELFARE-BASICLIVELIHOOD-TEMPLATE_v1.0.md',
    },
  ],
  climate: [
    {
      // ★ 위임 여부 TBD — 템플릿 파일 §LEGAL-BASIS 참고.
      subCode: 'ENVMGMT', name: '환경관리과(대기·수질 배출시설 신고)',
      kw: ['대기배출시설', '배출시설 설치신고', '대기오염', '수질오염',
        '환경관리과', '배출시설 신고'],
      file: '04-city/templates/divisions/SP-CITYDIV-CLIMATE-ENVMGMT-TEMPLATE_v1.0.md',
    },
  ],
  culture: [
    {
      subCode: 'LIBRARY', name: '공공도서관',
      kw: ['도서관', '도서 대출', '도서 반납', '상호대차', '자료실',
        '도서관 회원가입', '도서 예약'],
      file: '04-city/templates/divisions/SP-CITYDIV-CULTURE-LIBRARY-TEMPLATE_v1.0.md',
    },
  ],
  housing: [
    {
      // ★ 국코드 주의 — jejusi division 데이터는 'urbanconstruction',
      // seogwipo/04-city 표준은 'housing'. 이 원형은 표준을 따름.
      subCode: 'BUILDING', name: '건축과(건축허가·사용승인)',
      kw: ['건축허가', '건축신고', '사용승인', '준공검사', '건축과',
        '건축물 안전점검', '대수선'],
      file: '04-city/templates/divisions/SP-CITYDIV-URBANCONSTRUCTION-BUILDING-TEMPLATE_v1.0.md',
    },
  ],
  health: [
    {
      subCode: 'ADMIN', name: '보건행정과(의료기관 개설신고)',
      kw: ['의료기관 개설신고', '의원 개설', '보건행정과', '보건소 행정',
        '의료기관 인허가'],
      file: '04-city/templates/divisions/SP-CITYDIV-HEALTH-ADMIN-TEMPLATE_v1.0.md',
    },
  ],
  safety: [
    {
      // ★ 원본이 겸하던 차고지증명제(제주 특유)는 제외 — 자동차 이전
      // 등록(자동차관리법, 전국 공통)만 등록한다. 템플릿 §LEGAL-BASIS 참고.
      subCode: 'VEHICLE', name: '차량관리과(자동차 이전등록)',
      kw: ['자동차 이전등록', '자동차 등록', '차량관리과', '자동차 명의이전',
        '자동차등록 이전'],
      file: '04-city/templates/divisions/SP-CITYDIV-SAFETY-VEHICLE-TEMPLATE_v1.0.md',
    },
    {
      // ★ 시/군/구 "등록"만 다룸 — 시내버스·택시 "면허"는 도청(시·도지사)
      // 소관 별개 계층. 템플릿 §LEGAL-BASIS 참고.
      subCode: 'TRAFFIC', name: '교통행정과(여객자동차운송사업 등록)',
      kw: ['여객자동차운송사업 등록', '운송사업 등록', '교통행정과',
        '전세버스 등록', '교통안전시설물'],
      file: '04-city/templates/divisions/SP-CITYDIV-SAFETY-TRAFFIC-TEMPLATE_v1.0.md',
    },
  ],
  econ: [
    {
      // ★ 법률이 아닌 행정지침(행안부 마을기업 육성사업 시행지침) 근거
      // — 템플릿 §LEGAL-BASIS 참고. econ 국의 다른 하위 업무(SMB/
      // INFOSUPPORT/JOBENERGY)는 전부 지원사업형(공모·심사, GOV_TASK
      // 파이프라인 없음)이라 이번 배선에서 제외 — VILLAGE만 등록.
      subCode: 'VILLAGE', name: '마을활력과(마을기업 지정)',
      kw: ['마을기업 지정', '마을기업', '마을활력과', '마을기업 신청'],
      file: '04-city/templates/divisions/SP-CITYDIV-ECON-VILLAGE-TEMPLATE_v1.0.md',
    },
  ],
  agrieconomy: [
    {
      // ★ 같은 국의 감귤(CITRUS)·수산(FISHERY)·친환경농업(ECOFARM)은
      // 제주 특화 산업이라 제외 — 축산업만 전국 보편이라 등록.
      subCode: 'LIVESTOCK', name: '축산과(축산업 허가·가축분뇨 신고)',
      kw: ['가축사육업 허가', '축산업 등록', '가축분뇨 배출시설', '축산과',
        '가축사육업 등록'],
      file: '04-city/templates/divisions/SP-CITYDIV-AGRIECONOMY-LIVESTOCK-TEMPLATE_v1.0.md',
    },
  ],
  // 다른 도메인은 개별 검증 후 순차 추가 예정.
};

function _makeGenericCityDivisionEntries() {
  const out = [];
  for (const [국코드, list] of Object.entries(GENERIC_CITY_DIVISION_TAXONOMY)) {
    for (const item of list) {
      out.push({
        code: `SP-CITYDIV-GENERIC-${국코드.toUpperCase()}-${item.subCode}`,
        국코드, 시코드: null, // 시코드 무관 — 전국 어디나 매칭 후보
        name: item.name, desc: item.name,
        kw: item.kw, file: item.file, generic: true,
      });
    }
  }
  return out;
}
const GENERIC_CITY_DIVISION_TABLE = _makeGenericCityDivisionEntries();

// ── 과/팀(division) 2단계 매칭 + LLM 폴백 (2026-08-02 재구현) ──────────
// 국/부서(예: climate)까지 이미 확정된 상태에서, 그 산하 과/팀 중
// 어디인지 키워드로 우선 판단한다. topScore===0(매칭 자체 없음)이면
// "세부 과 없음"이지 애매함이 아니므로 null(국 단위 응답으로 충분).
// tied.length>=2(동점)일 때만 진짜 애매함으로 보고 호출부가 LLM 폴백
// 여부를 결정한다.
function _matchCityDivision(text, 국코드, 시코드) {
  const realTable = CITY_DIVISION_TABLE.filter(e => e.국코드 === 국코드 && e.시코드 === 시코드);
  // 제주(jejusi/seogwipo)는 실사 데이터가 이미 있으므로 제네릭 원형을
  // 섞지 않는다 — 비제주 시/군/구에 한해서만 제네릭 후보를 추가한다.
  const isJeju = 시코드 === 'jejusi' || 시코드 === 'seogwipo';
  const genericTable = isJeju ? [] : GENERIC_CITY_DIVISION_TABLE.filter(e => e.국코드 === 국코드);
  const table = [...realTable, ...genericTable];
  return _scoreMatchTies(text, table);
}

function _matchDoDeptDivision(text, domain) {
  const table = DO_DEPT_DIVISION_TABLE.filter(e => e.domain === domain);
  return _scoreMatchTies(text, table);
}

// candidates: _scoreMatchTies().tied — 이미 동점으로 좁혀진 후보만 준다
// (agent-common 전체를 다시 fetch하지 않고, 이미 갖고 있는 division
// 데이터의 desc를 그대로 후보 설명으로 재사용).
function _buildDivisionCandidatesText(candidates) {
  return candidates.map(c => `${c.code}: ${c.name} — ${c.desc}`).join('\n');
}

// classifyFn 시그니처는 _classifyFallback과 동일: async (text, candidatesText) => code|'NONE'|null.
// 반환값은 candidates 중 하나의 code, 또는 확정 못 하면 null(호출부가 국/부서
// 단위 응답으로 안전하게 폴백해야 함 — 잘못된 과를 단정하지 않는다).
async function _classifyDivisionFallback(text, candidates, classifyFn) {
  if (!classifyFn || !candidates || candidates.length === 0) return null;
  const candidatesText = _buildDivisionCandidatesText(candidates);
  try {
    const code = await classifyFn(text, candidatesText);
    const clarifyCodes = _parseClarifySignal(code);
    if (clarifyCodes) {
      const options = clarifyCodes
        .map(c => candidates.find(cand => cand.code === c))
        .filter(Boolean)
        .map(cand => ({ code: cand.code, name: cand.name || cand.code }));
      if (options.length >= 2) throw new NeedsClarificationSignal(options);
    }
    if (!code || code === 'NONE') return null;
    return candidates.find(c => c.code === code) || null;
  } catch (e) {
    if (e instanceof NeedsClarificationSignal) throw e;
    console.warn('[gov-router] division LLM 분류 폴백 실패:', e.message);
    return null;
  }
}

// 시청 국(局) 매칭 이후 호출하는 단일 진입점 — cityDeptMatch(국코드/시코드)와
// 원문을 받아 과/팀까지 특정을 시도한다. 반환값은 division 테이블 항목
// 또는 null(세부 과 없음/애매하고 LLM도 확정 못함 — 국 단위로 충분).
async function _resolveCityDivision(text, cityDeptMatch, classifyFn) {
  if (!cityDeptMatch) return null;
  const { best, topScore, tied } = _matchCityDivision(text, cityDeptMatch.국코드, cityDeptMatch.시코드);
  if (topScore === 0) return null; // 세부 과 매칭 없음 — 애매함이 아니라 그냥 미특정
  if (tied.length === 1) return best; // 단독 최고점 — 키워드 매칭으로 충분히 확정
  return _classifyDivisionFallback(text, tied, classifyFn); // 동점 — LLM 폴백
}

// 도청 실국(L2) 매칭 이후 호출하는 동일 패턴의 진입점 (domain 기준).
async function _resolveDoDeptDivision(text, divMatch, classifyFn) {
  if (!divMatch) return null;
  const { best, topScore, tied } = _matchDoDeptDivision(text, divMatch.domain);
  if (topScore === 0) return null;
  if (tied.length === 1) return best;
  return _classifyDivisionFallback(text, tied, classifyFn);
}

// ── 읍면동 팀(05-emd) 2단계 매칭 + LLM 폴백 (2026-08-02 신설) ──────────
// city/do-dept division과 동일한 사각지대이자 동일한 해법. team-master-
// data.json에 43개 읍면동 × 팀 184개 인스턴스가 이미 있고 5종 팀 원형
// 템플릿(SP-TEAM-{GENERAL|CIVIL|WELFARE|OUTREACH|INDUSTRY}-TEMPLATE_v2.1.md)
// 도 다 작성돼 있었지만, gov-router.js 어디에도 이걸 로드하는 코드가
// 없었다. 읍면동 확정 이후 그 안의 팀 중 더 구체적으로 일치하는 게
// 있으면 위 division 패턴과 동일하게(키워드 우선, 동점만 LLM) 판단한다.
let _teamMasterData = null;
async function _loadTeamMasterData() {
  if (_teamMasterData) return _teamMasterData;
  const raw = await _fetchText('05-emd/templates/team-master-data.json');
  _teamMasterData = JSON.parse(raw).팀목록;
  return _teamMasterData;
}

function _matchEmdTeam(text, teamRecords, emdCode) {
  const table = teamRecords
    .filter(r => r.emd_code === emdCode)
    .map(r => ({ code: r.team_code, name: r.팀이름, desc: r.입력_문구 || r.팀이름, kw: [r.팀이름], _rec: r }));
  return _scoreMatchTies(text, table);
}

// candidates: _scoreMatchTies().tied — division과 동일하게 이미 갖고
// 있는 팀 데이터(입력_문구)를 그대로 후보 설명으로 재사용한다.
async function _classifyTeamFallback(text, candidates, classifyFn) {
  if (!classifyFn || !candidates || candidates.length === 0) return null;
  const candidatesText = candidates.map(c => `${c.code}: ${c.name} — ${c.desc}`).join('\n');
  try {
    const code = await classifyFn(text, candidatesText);
    if (!code || code === 'NONE') return null;
    return candidates.find(c => c.code === code) || null;
  } catch (e) {
    console.warn('[gov-router] 팀 LLM 분류 폴백 실패:', e.message);
    return null;
  }
}

// 읍면동 매칭 이후 호출하는 단일 진입점 — division 계층의
// _resolveCityDivision/_resolveDoDeptDivision과 동일한 인터페이스.
async function _resolveEmdTeam(text, emdRec, classifyFn) {
  if (!emdRec) return null;
  try {
    const teamRecords = await _loadTeamMasterData();
    const { best, topScore, tied } = _matchEmdTeam(text, teamRecords, emdRec.emd_code);
    if (topScore === 0) return null; // 세부 팀 매칭 없음 — 애매함이 아니라 그냥 미특정
    let picked = tied.length === 1 ? best : await _classifyTeamFallback(text, tied, classifyFn);
    if (!picked) return null;
    return picked._rec;
  } catch (e) {
    console.warn(`[gov-router] 읍면동 팀 매칭 실패(emd_code=${emdRec.emd_code}): ${e.message} — 읍면동 응답만 사용`);
    return null;
  }
}

// ── TBD 리터럴 폴백 안전망 (2026-08-05 신설) ────────────────────
// 실사로 발견된 패턴: 마스터데이터에 "값이 없다"는 뜻으로 빈 문자열/
// undefined가 아니라 리터럴 문자열 "TBD"가 저장된 레코드가 있다.
// `rec.field || 'TBD — 재검증 필요'`는 falsy만 걸러내므로 "TBD"라는
// 3글자가 그대로 통과해 사용자 화면에 정제 안 된 채 노출된다(최초
// 발견: EMD team 콜센터번호 184건 중 179건, HANDOFF_2026-08-05 §1-3).
// 이 헬퍼가 falsy·리터럴 "TBD"(공백 트림 후 대소문자 무관 일치) 둘 다
// 폴백 대상으로 취급한다 — 값이 실제로 "TBD"라는 문자열을 담고 있어야
// 하는 정당한 케이스는 없으므로(사람이 읽는 안내문에 "TBD"라는 영문
// 약어를 그대로 노출할 이유가 없다) 안전하게 일반화할 수 있다.
function _fallbackIfTbd(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'string' && value.trim().toUpperCase() === 'TBD') return fallback;
  return value;
}

function _renderTeamTemplate(template, teamRec, emdRec) {
  return template
    .replaceAll('{읍면동명}', emdRec.읍면동명 || teamRec.읍면동이름 || '')
    .replaceAll('{읍면동구분}', emdRec.읍면동구분 || '')
    .replaceAll('{행정시명}', emdRec.행정시명 || teamRec.시이름 || '')
    .replaceAll('{emd_short_code}', emdRec.emd_short_code || teamRec.emd_short_code || '')
    .replaceAll('{주력산업}', emdRec.주력산업 || '')
    .replaceAll('{콜센터명}', teamRec.콜센터명 || '제주콜센터')
    .replaceAll('{콜센터번호}', _fallbackIfTbd(teamRec.콜센터번호, 'TBD — 재검증 필요'))
    .replaceAll('{콜센터운영시간}', teamRec.콜센터운영시간 || emdRec.운영시간 || '평일 09:00~18:00')
    // 구 SP-TEAM-TEMPLATE_v1.0(팀 단독 범용 템플릿)만 쓰는 필드 —
    // v2.1 5종 원형은 안 쓰지만 폴백 상황을 대비해 같이 치환해둔다.
    .replaceAll('{팀이름}', teamRec.팀이름 || '')
    .replaceAll('{입력_문구}', teamRec.입력_문구 || '')
    .replaceAll('{출력_문구}', teamRec.출력_문구 || '')
    .replaceAll('{읍면동이름}', emdRec.읍면동명 || teamRec.읍면동이름 || '')
    .replaceAll('{GOV_COMMON}', 'JEJU-GOV-COMMON')
    .replaceAll('{DO_ROOT_SP}', 'SP-DO-000')
    .replaceAll('{CITY_ROOT_SP}', '')
    .replaceAll('{EMD_ROOT_SP}', `SP-EMD-${emdRec.읍면동명 || ''}`);
}

async function _fetchEmdTeamText(teamRec, emdRec) {
  try {
    const templateFile = teamRec.template || 'SP-TEAM-TEMPLATE_v1.0.md';
    const template = await _fetchText(`05-emd/templates/${templateFile}`);
    return {
      text: _renderTeamTemplate(template, teamRec, emdRec),
      code: `SP-TEAM-${emdRec.읍면동명}-${teamRec.팀이름}`,
    };
  } catch (e) {
    console.warn(`[gov-router] 팀 템플릿 로드 실패(${teamRec.template}): ${e.message} — 읍면동 응답만 사용`);
    return null;
  }
}

// ── 03-do-agency(직속기관)/07-org(출자출연기관) 라우팅 (2026-08-02 신설) ──
// 지금까지 이 두 계층은 top-level SP는 있는데 진입 경로 자체가 없었다
// (city/do-dept와 달리 라우팅 테이블 부재). city/do-dept와 동일한
// "기관 매칭 → 과/팀 매칭(동점만 LLM)" 2단 구조를 그대로 적용한다.
// 우선순위: 도청 실국(L2) 매칭이 실패한 뒤, 국가기관/카탈로그보다는
// 먼저 시도한다 — "농업기술원"처럼 직속기관명이 실국 키워드보다 훨씬
// 구체적인 신호이기 때문(일반명사 위주인 L2 키워드에 밀려 오분류될
// 위험을 줄인다).
//
// ── 위치 기반 동점 해소 (2026-08-02, 주피터 지적으로 추가) ─────────
// 최초 구현은 스모크테스트를 전부 "농업기술원 기술보급과" 식으로
// 기관명을 직접 부르는 발화로만 짰다 — 실제 시민은 기관명을 특정하지
// 않고 "의료원 진료 예약하고 싶어요"처럼 말할 가능성이 높고, 혼디는
// 그럴 때 PDV 위치/발화 지명으로 관할 기관(제주의료원 vs 서귀포의료원
// 같은 시별 이원화 기관)을 특정할 수 있어야 한다는 지적을 받았다.
// _resolveInstitutionMatch가 그 경로다: 동점이면서 두 후보가 서로
// 다른 시코드를 갖고 있으면(=지리적으로 이원화된 기관), city/do-dept가
// 이미 쓰는 _matchCity(text, pdvLocationHint)로 먼저 결정론적으로
// 좁힌다(LLM 호출도, 비용도 없음) — 그래도 못 좁히면(위치 정보 자체가
// 없거나 시코드가 없는 순수 내용적 동점) 그때만 LLM로 넘긴다.
async function _resolveInstitutionMatch(text, table, pdvLocationHint, classifyFn) {
  const { best, topScore, tied } = _scoreMatchTies(text, table);
  if (topScore === 0) {
    // ★ 2026-08-04 신설 — kw 리터럴 매칭이 전부 실패해도 조용히 포기하지
    // 않는다. "지하철 타다가 물건 놓고 내렸는데 어디다 물어봐요"처럼 kw
    // 목록에 없는 자연어 표현은 이전엔 여기서 바로 null을 반환해 완전히
    // 새는 사각지대였다 — do-dept/city/national용 LLM 폴백(_classifyFallback)은
    // ROUTE_DESCRIPTIONS에 SP-ORG-*/SP-AGY-* 코드가 아예 없어 org/agency
    // 계층을 커버 못 했고, 이 함수 자체의 LLM 폴백(_classifyDivisionFallback)은
    // "동점 후보 중 고르기" 전용이라 완전 매칭 실패는 구제하지 않았다
    // (docs/GOVTREE_NATIONWIDE_EXPANSION_LESSONS_v1_0.md 참조).
    // table 전체(desc 포함)를 후보로 LLM 분류를 한 번 더 시도한다 —
    // _classifyDivisionFallback은 candidates가 {code,name,desc}만 있으면
    // 되므로 agency/org table을 그대로 재사용할 수 있다.
    //
    // ★ 2026-08-21 추가(스모크테스트 실측 결함 대응, 사용자 지시) — 위
    // table(agency 또는 org 하나)만 후보로 주면, 진짜 정답이 L2(도청
    // 실·국)에 있어도 classifyFn은 "이 중에 골라라"는 질문만 받아 없는
    // 정답 대신 가장 비슷한 오답을 고른다(실측: SAFETY/JTP/CHILDMEAL이
    // 전부 SP-AGY-BOHWAN으로 오확정 — classifyFn이 진짜로 호출됐는데도
    // 후보 목록 자체에 정답이 없었음). L2 1등 후보(있으면)를 같은
    // candidates 목록에 얹어 classifyFn이 계층을 넘나들어 고를 수 있게
    // 한다 — 이제 classifyFn이 둘 다 그럴듯하다고 보면(CLARIFY 신호)
    // 아래에서 NeedsClarificationSignal이 그대로 위로 던져진다(여기서
    // 삼키지 않음 — 이게 핵심: 예전엔 애매하면 조용히 오답을 골랐지만,
    // 이제 애매하면 사용자에게 되묻는다).
    const l2BestForZero = _scoreMatchTies(text, _l2Table()).best;
    const zeroTable = l2BestForZero && !table.includes(l2BestForZero)
      ? [...table, { ...l2BestForZero, name: l2BestForZero.code, desc: ROUTE_DESCRIPTIONS[l2BestForZero.code] || l2BestForZero.domain || '' }]
      : table;
    return _classifyDivisionFallback(text, zeroTable, classifyFn);
  }
  if (tied.length === 1 && topScore >= 2) return best;
  if (tied.length === 1 && topScore === 1) {
    // ★ 2026-08-21 신설(스모크테스트 실측 결함 대응) — 키워드 1개짜리
    // 약한 매칭은 우연한 오버랩일 위험이 크다(실측: "어린이집을 새로
    // 운영하려고… 급식 관련해서 신고할 데가"가 도서관과 우연히 겹쳐
    // SP-AGY-LIBRARY로 조용히 확정된 사례, "어린이집 보육료 지원"이
    // SP-DO-WELFARE(L2) 대신 도서관으로 샌 사례 — classifyFn 호출 0회로
    // K-Intent 개입 기회조차 없었음). 같은 계층(agency/org) 후보뿐 아니라
    // L2(도청 실·국) 1등 후보도 함께 넣어 진짜 정답이 계층을 넘나드는
    // 경우까지 구제한다. classifyFn이 없으면(하위호환) 기존처럼 즉시 확정.
    if (!classifyFn) {
      // ★ 2026-08-30 수정 — LLM 없다고 그냥 포기하지 않는다. L2가 이
      // 1키워드짜리 약한 매칭보다 명백히 강하면(topScore 더 높음) 이
      // 약한 우연 매칭을 확정하지 않는다 — 결정론적으로 판단 가능한
      // 경우까지 "classifyFn 없음"을 핑계로 원래 버그(위 주석의 "어린이집
      // 보육료 지원" 사례)를 재현하지 않기 위함. null을 반환해 이
      // agency/org 매칭 자체를 무효화하면, 호출부가 자연히 뒤쪽의 정상
      // L2 매칭 경로(_scoreMatch+_fetchDeptText, agency 전용 렌더링과
      // 다름)로 폴백한다 — 여기서 L2 엔트리를 직접 반환하면 agency 전용
      // 조합 함수에 잘못된 모양의 데이터가 들어가는 위험이 있어 피한다.
      // 강도가 같거나 L2가 없으면 기존처럼 best(약한 매칭) 그대로 확정
      // — 회귀 없음.
      const l2ForWeak = _scoreMatchTies(text, _l2Table());
      return (l2ForWeak.best && l2ForWeak.topScore > topScore) ? null : best;
    }
    const l2Best = _scoreMatchTies(text, _l2Table()).best;
    const extendedTable = l2Best && !table.includes(l2Best)
      ? [...table, { ...l2Best, name: l2Best.code, desc: ROUTE_DESCRIPTIONS[l2Best.code] || l2Best.domain || '' }]
      : table;
    // ★ 2026-08-21 수정 — 예전엔 .catch(() => null)로 실패를 전부
    // 삼켜서 NeedsClarificationSignal(되묻기 신호)까지 조용히 사라지고
    // best(약한 매칭)로 폴백해버렸다. 되묻기 신호는 그대로 위로
    // 던지고, 그 밖의 진짜 실패(네트워크 오류 등)만 삼킨다.
    let picked;
    try {
      picked = await _classifyDivisionFallback(text, extendedTable, classifyFn);
    } catch (e) {
      if (e instanceof NeedsClarificationSignal) throw e;
      picked = null;
    }
    return picked || best;
  }
  if (tied.every(e => e.시코드)) {
    // 진짜 동점 — 시코드가 있는 지리적 이원화 기관쌍이면 위치로 먼저 시도.
    const cityMatch = _matchCity(text, pdvLocationHint);
    if (cityMatch) {
      const locMatch = tied.find(e => e.시코드 === cityMatch.시코드);
      if (locMatch) return locMatch;
    }
  }
  // 위치로도 못 좁혔으면(위치 정보 없음/시코드 없는 순수 내용 동점) LLM 폴백.
  // _classifyDivisionFallback은 {code,name,desc} 형태만 있으면 되므로
  // institution 후보에도 그대로 재사용 가능.
  return _classifyDivisionFallback(text, tied, classifyFn);
}
async function _fetchAgencyText(match) {
  return _fetchText(match.file, _currentProvinceRepo());
}
async function _fetchOrgText(match) {
  return _fetchText(match.file, _currentProvinceRepo());
}
async function _resolveDoAgencyDivision(text, agyMatch, classifyFn) {
  if (!agyMatch) return null;
  const table = _agencyDivisionTable().filter(e => e.institution === agyMatch.code);
  const { best, topScore, tied } = _scoreMatchTies(text, table);
  if (topScore === 0) return null;
  if (tied.length === 1) return best;
  return _classifyDivisionFallback(text, tied, classifyFn);
}
async function _resolveOrgDivision(text, orgMatch, classifyFn) {
  if (!orgMatch) return null;
  const table = _orgDivisionTable().filter(e => e.institution === orgMatch.code);
  const { best, topScore, tied } = _scoreMatchTies(text, table);
  if (topScore === 0) return null;
  if (tied.length === 1) return best;
  return _classifyDivisionFallback(text, tied, classifyFn);
}

// ── EMD 데이터 로드 (한림 + 나머지 42개 병합) ───────────────────
// 2026-07-19 Phase 1 — L2/CITY/NATIONAL과 동일하게 도별 경로 레지스트리로
// 감쌌다. 지금은 jeju 값만 있고, 캐시 키도 provinceCode로 분리해뒀다 —
// 나중에 다른 도의 읍면동 데이터가 추가되면 이 함수 자체는 안 고치고
// EMD_PATHS에 키만 추가하면 된다.
const EMD_PATHS = {
  jeju: { master: '05-emd/emd-master-data.json', extra: ['05-emd/hallim/hallim-data.json'] },
  // 2026-08-05 신설 — 부산 파일럿 첫 EMD 데이터(해운대구 18개 행정동).
  // 위 리팩터(_loadEmdRecordsForProvince/_findEmdEntryAcrossProvinces) 덕에
  // 이 키를 추가하는 것만으로 directCode·자연어 매칭 양쪽 다 자동 인식된다.
  busan: { master: '05-emd/emd-master-data-busan.json' },
};

// ── 도 클래스/인스턴스 레지스트리 (2026-07-21 신설) ──────────────
// 주피터 지시: "제주도는 8개 광역시도 중 하나일 뿐입니다. 도청 등의
// 원형 클래스를 먼저 구현하고, 제주도청 등의 인스턴스를 조합해야
// 합니다." — 이 레지스트리가 그 첫 단계다. PROVINCE_TABLES·EMD_PATHS를
// 수기로 다시 베끼지 않고 거기서 그대로 계산한다(이중 관리 시 실사
// 현황이 어긋나는 사고를 구조적으로 막기 위함) — 새 도의 실사가
// 끝나 PROVINCE_TABLES/EMD_PATHS에 반영되면 이 레지스트리는 재계산
// 없이 자동으로 최신 상태가 된다.
//
// govType: 'SPECIAL_AUTONOMOUS'(제주 — 기초자치단체 없음, 도가 세정
// 등을 직할) | 'GENERAL'(그 외 — 시군구가 기초자치단체로 존재).
// 재산세 등 세정 라우팅이 이 필드로 분기해야 한다(제주 규칙을 다른
// 도에 그대로 투사하면 안 됨 — 사고실험에서 확인된 문제).
const SPECIAL_AUTONOMOUS_PROVINCES = new Set(['jeju']);

function _computeProvinceRegistry() {
  const registry = {};
  for (const [name, code] of Object.entries(PROVINCE_NAME_TO_CODE)) {
    if (registry[code]) continue; // 도별로 한 번만 계산(이름은 여러 개, 코드는 하나)
    const t = PROVINCE_TABLES[code] || { l2: [], city: [], national: [] };
    registry[code] = {
      govType: SPECIAL_AUTONOMOUS_PROVINCES.has(code) ? 'SPECIAL_AUTONOMOUS' : 'GENERAL',
      dataStatus: {
        province: '01-do/templates/province-master-data.json' /* 별도 레코드 없으면 호출부(_loadDoSp)가 폴백 처리 */,
        l2: t.l2.length > 0 ? 'available' : 'none',
        city: t.city.length > 0 ? 'available' : 'none',
        national: t.national.length > 0 ? 'available' : 'none',
        emd: EMD_PATHS[code] ? 'available' : 'none',
      },
    };
  }
  return registry;
}
// EMD_PATHS 선언 직후에 즉시 계산 — 아래에서 참조하는 모든 테이블이
// 이 시점에 이미 선언·초기화돼 있어야 한다(모듈 로드 순서 의존).
const PROVINCE_REGISTRY = _computeProvinceRegistry();

// ── 읍면동명 → 도코드 역색인 (2026-07-21 신설, 버그3 수정) ─────────
// EMD_PATHS에 등록된 도(현재 jeju)의 읍면동 마스터 데이터를 전부 읽어
// {읍면동명: 도코드} 평면 색인을 만든다 — _guessProvinceFromText의
// 3순위 판별원. 세션당 1회만 로드(모듈 전역 캐시).
let _emdNameToProvinceIndex = null;
async function _loadEmdNameToProvinceIndex() {
  if (_emdNameToProvinceIndex) return _emdNameToProvinceIndex;
  const index = {};
  for (const [provinceCode, paths] of Object.entries(EMD_PATHS)) {
    try {
      const [masterRaw, ...extraRaws] = await Promise.all([
        _fetchText(paths.master),
        ...(paths.extra || []).map(p => _fetchText(p)),
      ]);
      const master = JSON.parse(masterRaw);
      const extras = extraRaws.map(r => JSON.parse(r));
      for (const rec of [...master.읍면동목록, ...extras]) {
        if (rec.읍면동명 && !index[rec.읍면동명]) index[rec.읍면동명] = provinceCode;
        // ★ 2026-07-24 수정(100건 사고실험에서 발견) — 관할리(里) 이름도
        // 같이 색인한다. _matchEmd()는 리 이름까지 인식하는데, 그보다
        // 앞 단계인 이 도 판별 색인은 읍면동명만 넣고 있어서 "한림리
        // 전입신고"처럼 리 이름만 언급하고 상위 읍 이름·"제주" 언급이
        // 전혀 없으면 도 판별 자체가 실패해 "지역 미판별"로 조기
        // 반환되는 버그였다 — _matchEmd에 도달하기도 전에 걸러짐.
        // ★ 2026-08-05 — _matchEmd와 동일하게 관할구역목록(v1.3 신규
        // 필드) 우선, 관할리목록(구 필드)은 폴백으로 유지.
        for (const ri of rec.관할구역목록 || rec.관할리목록 || []) {
          const riName = ri.split('(')[0].trim();
          if (riName && !index[riName]) index[riName] = provinceCode;
        }
      }
    } catch (e) {
      console.warn(`[gov-router] EMD 이름 역색인 로드 실패(${provinceCode}): ${e.message}`);
    }
  }
  _emdNameToProvinceIndex = index;
  return index;
}

const _emdRecordsByProvince = {};
// ★ 2026-08-05 리팩터 — provinceCode를 인자로 받는 버전을 별도로 뽑아냈다.
// 기존 _loadEmdRecords()는 "이미 도가 확정된 상황"(자연어 흐름, 팀/도메인
// 매칭 등)에서만 맞는 함수였다 — directCode 자체만으로는 아직 도를 모르는
// 경우(§ 'emd'/'team' tier 핸들러) 이 함수 하나로는 도를 특정할 수 없어서
// 'jeju' 하드코딩이 남아있었다. l2/city/agency/org가 이미 쓰는
// _findEntryAcrossProvinces 패턴과 동일한 목적으로 _findEmdEntryAcrossProvinces를
// 새로 추가했다(EMD 데이터는 PROVINCE_TABLES가 아니라 비동기 JSON 로더라서
// 그 함수를 그대로 재사용할 수 없어 별도로 구현).
async function _loadEmdRecordsForProvince(provinceCode) {
  if (_emdRecordsByProvince[provinceCode]) return _emdRecordsByProvince[provinceCode];
  const paths = EMD_PATHS[provinceCode];
  if (!paths) { _emdRecordsByProvince[provinceCode] = []; return []; }
  // ★ 2026-08-05 — _findEmdEntryAcrossProvinces가 이제 EMD_PATHS에 등록된
  // 모든 도를 순회하므로, 한 도의 마스터데이터 파일이 fetch 실패·JSON
  // 손상 등으로 문제가 생겨도 다른 도·다른 tier 라우팅까지 함께 죽으면
  // 안 된다 — _loadEmdNameToProvinceIndex()와 동일한 try/catch 방어 원칙.
  try {
    const [masterRaw, ...extraRaws] = await Promise.all([
      _fetchText(paths.master),
      ...(paths.extra || []).map(p => _fetchText(p)),
    ]);
    const master = JSON.parse(masterRaw);
    const extras = extraRaws.map(r => JSON.parse(r));
    _emdRecordsByProvince[provinceCode] = [...(master.읍면동목록 || []), ...extras];
  } catch (e) {
    console.warn(`[gov-router] EMD 마스터데이터 로드 실패(${provinceCode}): ${e.message}`);
    _emdRecordsByProvince[provinceCode] = [];
  }
  return _emdRecordsByProvince[provinceCode];
}

async function _loadEmdRecords() {
  return _loadEmdRecordsForProvince(_resolveProvinceCode());
}

// EMD_PATHS에 등록된 모든 도를 순회하며 predicate에 맞는 레코드를 찾는다.
// _findEntryAcrossProvinces와 동일한 반환 형태({ provinceCode, entry } | null)
// 및 동일한 "코드 충돌 시 첫 매칭 + 경고" 원칙을 따른다.
async function _findEmdEntryAcrossProvinces(predicate) {
  const matches = [];
  for (const provinceCode of Object.keys(EMD_PATHS)) {
    const records = await _loadEmdRecordsForProvince(provinceCode);
    const entry = records.find(predicate);
    if (entry) matches.push({ provinceCode, entry });
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.warn(
      `[gov-router] EMD directCode 코드 충돌 — ${matches.length}개 도(` +
      `${matches.map(m => m.provinceCode).join(', ')})에서 동시에 매칭됨. ` +
      `첫 번째(${matches[0].provinceCode})를 사용하지만, 시딩 스크립트의 ` +
      `코드 유일성 부여 규칙을 점검할 것.`
    );
  }
  return matches[0];
}

// ── 텍스트에서 읍면동 매칭 ──────────────────────────────────────
// 1) 읍면동명 직접 언급, 2) 관할구역목록(구 관할리목록)에 있는 리·법정동
// 이름 언급 순으로 확인. ★ 2026-08-05 — v1.3 스키마의 관할구역목록을
// 우선 사용하고 구 스키마 관할리목록은 폴백으로만 남긴다(둘 다 있으면
// 동일 내용이므로 무관, 신규 도 레코드가 관할리목록 없이 관할구역목록만
// 가질 수 있어 폴백이 없으면 리/동 이름 매칭이 조용히 안 됨).
function _matchEmd(text, records) {
  for (const rec of records) {
    if (text.includes(rec.읍면동명)) return rec;
  }
  for (const rec of records) {
    for (const ri of rec.관할구역목록 || rec.관할리목록 || []) {
      const riName = ri.split('(')[0].trim(); // "한림리(한림1리·...)" → "한림리"
      if (riName && text.includes(riName)) return rec;
    }
  }
  return null;
}

// ★ 2026-07-23 수정(주피터 지시 — 건축법 제14조 사고실험) — pdvLocationHint
// 인자 추가. 기존엔 emdMatch(_matchEmd)만 힌트를 봤고 이 함수는 text만
// 봐서, "서귀포시 동홍동" 같은 PDV 위치가 있어도 발화 자체에 지역명이
// 없으면("건축 인허가 신청하고 싶어요") 행정시를 특정 못 하고 놓쳤다
// — _matchEmd와 동일한 우선순위(발화 우선, 없으면 힌트)로 통일한다.
// ★ 2026-07-24 수정(100건 사고실험에서 발견) — 반환값에 _matchedViaTextItself
// 플래그 추가(원본 테이블 항목을 얕은 복사해 새 필드만 얹음 — 공유 상수
// 테이블 자체는 변경하지 않는다). 발화 자체에 시 이름이 있는 경우와
// PDV 힌트로만 시가 특정된 경우를 호출부가 구분할 수 있어야, "힌트로만
// 시가 잡혔고 더 구체적인 도메인 매칭 기회가 남아있으면 그걸 먼저
// 시도한다"는 판단이 가능해진다(아래 stage 2 참고).
function _matchCity(text, pdvLocationHint) {
  for (const c of _cityTable()) {
    if (c.kw.some(k => _kwMatch(text, k))) return { ...c, _matchedViaTextItself: true };
  }
  if (pdvLocationHint) {
    for (const c of _cityTable()) {
      if (c.kw.some(k => _kwMatch(pdvLocationHint, k))) return { ...c, _matchedViaTextItself: false };
    }
  }
  return null;
}

// ── AdministrativeCity(행정시) 이름 기반 조회 (2026-07-21 신설) ──────
// 주피터 지시: "클래스와 인스턴스 관계를 명확히 규정하십시오(광역시도,
// 시군구, 읍면동, 국가기관 지역 사무소)." — 행정시(AdministrativeCity,
// 자치권 없음, SPECIAL_AUTONOMOUS 도에만 존재·현재는 제주 유일)와
// 시군구청(MunicipalGovernment, 자치권 있음, GENERAL 도의 기초자치
// 단체·sigungu-national-list.json 기반)은 서로 다른 클래스인데, EMD
// 매칭 코드가 "_cityTable()[0]/[1]" 배열 인덱스로 "행정시는 정확히
// 2개, 순서는 제주시가 먼저"라고 암묵 가정하고 있었다 — 다른
// SPECIAL_AUTONOMOUS 도가 추가되거나 순서가 다르면 조용히 잘못된
// 행정시를 반환할 구조였다. 이름으로 조회하도록 일반화한다.
function _findCityByName(cityName) {
  return _cityTable().find(c => c.kw.includes(cityName)) || null;
}


// ── gov-tree(04-city-dept·05-emd) 인스턴스 지연 저작 — 클라이언트측
// 안전한 fetch (2026-08-05, GOV_TREE_LAZY_INSTANCING_DESIGN_v1_0.md 구현) ──
// resolveSigunguDept()와 동일한 설계 원칙(§8-1 결정: AC 태그 경유 대신
// gov-router.js가 worker.js를 직접 fetch — LLM이 태그를 정확히 내는 데
// 의존하는 추가 실패 지점을 만들지 않는다). 비밀키 없음, 실패해도 예외를
// 던지지 않고 null/조용한 무시로 대체 — 이 기능이 죽어도 기존 라우팅에
// 영향 없다(§5-2 "PocketBase 우선, 실패 시 기존 JSON 경로로 폴백" 원칙).

// STUB/MISSING 판정(§3) — city-dept는 국이름·산하과목록 유무, emd는
// 청사주소·대표전화·TBD 표기 유무로 기계적으로 판별한다. 사람이 눈으로
// "이건 스텁이다"를 판단하던 걸(이번 세션 내내 `_비고`에 수기로 남기던
// 방식) 코드로 명문화 — SP-Author 자동 트리거의 전제조건이라 사람 판단에
// 맡길 수 없다.
function _classifyCityDeptInstance(rec) {
  if (!rec) return 'MISSING';
  if (!rec.국이름) return 'STUB';
  if (!rec.산하과목록) return 'STUB';
  return 'REAL';
}
function _classifyEmdInstance(rec) {
  if (!rec) return 'MISSING';
  if (!rec.청사주소 || !rec.대표전화) return 'STUB';
  // ★ 무인발급기위치는 부가정보다 — 이것만 TBD라고 REAL 레코드 전체를
  // STUB으로 낮추면 이번 세션에 실사한 43개 동 전부가(전부
  // 무인발급기위치=TBD 상태) 불필요하게 재저작 대상이 된다. 핵심 필드
  // (청사주소)에 TBD가 남아있을 때만 STUB으로 낮춘다.
  if (rec.청사주소.includes('TBD')) return 'STUB';
  return 'REAL';
}

// PocketBase(L1)에 이미 실시간 저작된 인스턴스가 있는지 조회한다(§5-1
// 조회 엔드포인트, worker.js handleGovTreeInstanceLookup). 있으면
// {generated_content, status}를 반환, 없거나 실패하면 null — 호출부는
// null이면 기존 JSON 경로로 그대로 넘어가면 된다(하위호환 100%).
async function _fetchGovTreeInstancePocketBase(govTreeKey) {
  try {
    const { tier, 도코드, 시코드, 국코드, 읍면동명 } = govTreeKey;
    const params = new URLSearchParams({ tier, 도코드: 도코드 || '', 시코드: 시코드 || '' });
    if (국코드) params.set('국코드', 국코드);
    if (읍면동명) params.set('읍면동명', 읍면동명);
    const res = await fetch(`${SIGUNGU_RESOLVE_ORIGIN}/gov-tree-instance/lookup?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.found || !data?.generated_content) return null;
    return data;
  } catch (e) {
    console.warn('[gov-router] _fetchGovTreeInstancePocketBase 실패(무시, JSON 경로로 계속):', e?.message);
    return null;
  }
}

// STUB/MISSING을 만났을 때 백그라운드로 큐잉 신호를 쏜다(§4-1). 응답을
// 절대 기다리게 하지 않는다 — await하지 않고 fire-and-forget, 실패해도
// 콘솔 경고만 남긴다. 지금 이 사용자에게는 이미 STUB 내용으로 즉답이
// 나갔거나 나갈 예정이므로(§DRAFT_REQUEST risk_tier=low 원칙), 이 신호는
// "다음 사용자부터는 더 나은 답을 받게" 하기 위한 것뿐이다.
function _reportGovTreeInstanceMiss(govTreeKey, taskText) {
  try {
    const { tier, 도코드, 시코드, 국코드, 읍면동명 } = govTreeKey;
    const institution = [도코드, 시코드, 국코드 || 읍면동명].filter(Boolean).join(' ');
    fetch(`${SIGUNGU_RESOLVE_ORIGIN}/sp-author/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_type: 'gov_tree_instance',
        signal_source: 'gov_tree_instance_miss',
        institution,
        task: (taskText || '').slice(0, 500),
        tier_hint: tier,
        risk_tier: 'low',
        gov_tree_key: govTreeKey,
      }),
    }).catch((e) => console.warn('[gov-router] _reportGovTreeInstanceMiss 전송 실패(무시):', e?.message));
  } catch (e) {
    console.warn('[gov-router] _reportGovTreeInstanceMiss 준비 실패(무시):', e?.message);
  }
}

// ── 시군구 지연 초기화 — 클라이언트측(브라우저) 안전한 fetch (2026-07-20) ──
// ⚠️ 비밀키 없음 — worker.js(hondi-proxy)의 /gov/sigungu-dept-resolve를
// 호출할 뿐이다. 실패해도(네트워크 오류·CORS 등) 예외를 던지지 않고 안전한
// 기본 문구로 대체 — 이 기능이 죽어도 기존 라우팅에 영향 없음.
const SIGUNGU_RESOLVE_ORIGIN = 'https://hondi-proxy.tensor-city.workers.dev';

// SSE(text/event-stream) 응답을 파싱해 progress 이벤트마다 onProgress를
// 호출하고, done 이벤트의 payload를 최종 결과로 반환한다.
async function _consumeSigunguSSE(bodyStream, onProgress) {
  const reader = bodyStream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!chunk.startsWith('data:')) continue;
      let payload;
      try { payload = JSON.parse(chunk.slice(5).trim()); } catch { continue; }
      if (payload.status === 'progress') {
        if (typeof onProgress === 'function') {
          try { onProgress(payload); } catch (e) { console.warn('[gov-router] onProgress 콜백 실패(무시):', e?.message); }
        }
      } else if (payload.status === 'done') {
        result = payload;
      }
    }
  }
  return result;
}

// onProgress(선택) — worker.js가 SSE로 매초 진행상황을 보내면 payload
// ({status:'progress', elapsed, message})를 그대로 넘겨받는 콜백(2026-07-21
// 신설, 주피터 지시: "매 초마다 진행 상황을 알려주고, 정확한 답을
// 제출하는 것"). worker.js가 구버전(단일 JSON) 응답을 주더라도
// Content-Type으로 분기해 안전하게 처리한다.
async function resolveSigunguDept(cityGuess, domain, onProgress) {
  try {
    const url = `${SIGUNGU_RESOLVE_ORIGIN}/gov/sigungu-dept-resolve?city=${encodeURIComponent(cityGuess)}&domain=${encodeURIComponent(domain)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && res.body) {
      const streamed = await _consumeSigunguSSE(res.body, onProgress);
      if (streamed) return streamed;
      throw new Error('SSE 스트림이 done 이벤트 없이 종료됨');
    }
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('[gov-router] resolveSigunguDept 실패, 기본 문구로 대체:', e?.message);
    return {
      text: `${cityGuess} 관련 문의는 해당 시군구 대표전화 또는 정부24(gov.kr)로 확인해 주세요.`,
      verified: false, source: 'error_fallback',
    };
  }
}

// ── 시군구 지연 초기화용 휴리스틱 (2026-07-20 신설) ──────────────
// ★ 정밀하지 않음 — "정읍시가 아니라 정읍시가"처럼 실제 지명이 아닌
// 문자열도 걸릴 수 있다. KOSIS 리졸버와 동일하게 "일단 v1으로 배선하고
// 실사용 로그(sigungu_dept_resolve_log)가 쌓이면 정교화"하는 전략을 쓴다
// — 오탐이 나도 결과 자체가 "확인 안 됨" 톤이라 사용자에게 해를 끼치지
// 않는다(_renderFallback 참고).
const _SIGUNGU_FALSE_POSITIVE_WORDS = [
  '필요시', '동시', '당시', '임시', '수시', '즉시', '항시',
  // ★ 2026-07-21 추가 — 8개 광역시·특별시 이름이 [가-힣]{2,4}(시|군|구)
  // 정규식에 걸려 시/군/구로 오인되던 버그(50개 사고실험 A7 등에서 실증
  // — "서울시 소상공인 지원 문의"가 SEOUL_L2_TABLE의 SP-DO-ECON 정밀
  // 매칭 대신 시군구 지연초기화로 잘못 빠졌었다).
  '서울시', '부산시', '대구시', '인천시', '광주시', '대전시', '울산시', '세종시',
];
function _guessSigunguNameFrom(src) {
  if (!src) return null;
  const pattern = /([가-힣]{2,4}(?:시|군|구))/g;
  let m;
  while ((m = pattern.exec(src)) !== null) {
    const candidate = m[1];
    if (_SIGUNGU_FALSE_POSITIVE_WORDS.includes(candidate)) continue;
    // ★ 2026-07-24 추가(주피터 지시 — 도청 실국 완비 작업 중 발견) — 도
    // 정식 명칭 자체가 길게 "…특별시"/"…광역시"로 끝나는 경우(예:
    // "전남광주통합특별시"), 정규식이 그 뒷부분 일부만 잘라 시/군/구로
    // 오인할 수 있다("합특별시" 등). 후보가 실제로 텍스트에 존재하는
    // 공식 도 이름의 일부(접미사)라면 시군구 후보에서 제외한다 — 8개
    // 광역시 짧은 이름 전용이던 기존 예외 목록을 모든 도로 일반화.
    const isPartOfProvinceName = Object.keys(PROVINCE_NAME_TO_CODE)
      .some(name => name.length > candidate.length && name.endsWith(candidate) && src.includes(name));
    if (isPartOfProvinceName) continue;
    return candidate;
  }
  return null;
}
// ★ 2026-07-21 수정 — pdvLocationHint도 함께 본다(발화에 없으면 PDV로
// 폴백, 도 판별과 동일한 우선순위). 사용자가 "세무서 문의"처럼 지역
// 언급 없이 말해도, AC가 이미 아는 위치(GPS/PDV)로 시/군을 특정한다.
function _guessSigunguName(text, pdvLocationHint) {
  return _guessSigunguNameFrom(text) || _guessSigunguNameFrom(pdvLocationHint);
}

const _SIGUNGU_DOMAIN_KEYWORDS = {
  welfare: ['복지', '기초생활수급', '기초연금'],
  family: ['여성가족', '보육', '어린이집', '임신', '출산'],
  health: ['보건소', '예방접종', '건강검진', '감염병'],
  safety: ['재난', '안전', '화재'],
  // ★ 2026-07-24 추가(100건 사고실험에서 발견) — '여권'이 국가기관 19개
  // 도메인·시군구 15개 도메인 어디에도 없어서, LLM이 올바르게
  // "시군구 소관"(한국 여권은 출입국청이 아니라 시/군/구 여권과 발급)으로
  // 분류해도 도메인 추출 단계에서 실패해 안내가 끊기는 문제였다.
  // ★ 2026-08-23 수정(사고실험 중 발견) — '주민등록'/'인감'을 제거했다.
  // 2026-08-05에 자매 테이블 _makeGenericCityDeptEntries(jachi)에서 이미
  // 똑같은 이유로 제거된 단어들인데(그 커밋 사유 참고), 이 SIGUNGU-LAZY용
  // 테이블에는 그 교훈이 반영 안 돼 있었다 — BUG-016/022/023과 동일한
  // "같은 교훈이 자매 테이블에 따로 반영돼야 하는데 누락" 패턴. 주민등록
  // 등초본·인감증명 발급은 SP-EMD-TEMPLATE §3 소관(읍면동)이라, 이 두
  // 단어가 jachi(시군구 자치행정과)에 남아있으면 SIGUNGU-LAZY가 잘못
  // 시청/구청으로 확정해버린다.
  jachi: ['민원', '자치행정', '여권'],
  // ★ 2026-07-24 추가(100건 사고실험에서 발견) — '폐업'이 어느 도메인에도
  // 없어서 "폐업 신고하려고요"를 LLM이 SP-SIGUNGU-LAZY로 정확히 분류해도
  // 도메인을 못 뽑아 최종적으로 실패했다. 폐업 신고는 지방세(사업자
  // 등록말소)·인허가(영업신고 반납) 등 시군구 세무·경제 부서 소관이라
  // econ에 추가한다.
  econ: ['일자리', '소상공인', '지역경제', '전통시장', '폐업'],
  climate: ['환경', '쓰레기', '재활용', '분리배출'],
  housing: ['건축', '주택', '도시계획'],
  // ★ 2026-07-24 추가(주피터 지시로 재확인 — 100건 사고실험 항목3) —
  // '자동차등록'/'차량등록'/'반려동물등록'이 어느 시군구 도메인에도
  // 없었다. 제주는 정적 테이블(JEJU_CITY_DEPT_TABLE의 safety 도메인)에
  // '차량등록' 키워드가 있어 이 문제를 안 겪었지만, 정적 테이블이 없는
  // 비제주 지역은 SIGUNGU-LAZY 지연조회 자체가 발동을 못 해 "수원시
  // 자동차 등록하려고요" 같은 정당한 요청이 전부 놓쳤다. 차량등록은
  // 제주에서도 safety(교통행정) 소관이라 같은 도메인에 맞춘다.
  transport: ['버스', '교통', '도로', '자동차등록', '자동차 등록', '차량등록', '차량 등록', '차량말소', '번호판'],
  // ★ 2026-07-24 추가 — '반려동물등록'은 기존 15개 도메인 중 어디에도
  // 안 맞는 새 카테고리라(동물보호법상 시군구 소관이지만 복지/보건/환경
  // 어느 것과도 딱 맞지 않음), 가장 가까운 climate(환경·생활)에 더하지
  // 않고 정직하게 새 도메인을 하나 신설한다 — 억지로 기존 도메인에
  // 끼워넣으면 SP-SIGUNGU-LAZY가 엉뚱한 부서로 조회할 위험이 있다.
  animal: ['반려동물등록', '반려동물 등록', '동물등록', '동물 등록', '유기동물', '동물보호'],
  culture: ['문화', '도서관', '축제'],
  tourism: ['관광'],
  sports: ['체육', '생활체육'],
  agri: ['농정', '농업', '축산'],
  ocean: ['수산', '어업'],
  plan: ['기획', '예산', '지방세', '취득세', '재산세', '자동차세', '세정'],  // ★ 2026-08-23 '자동차세' 추가(사고실험 발견)
};
function _guessDomainFromText(text) {
  for (const [domain, kws] of Object.entries(_SIGUNGU_DOMAIN_KEYWORDS)) {
    if (kws.some(k => _kwMatch(text, k))) return domain;
  }
  return null;
}

// ── 국가기관 지연 초기화 — 클라이언트측(브라우저) 안전한 fetch (2026-07-20) ──
// ⚠️ 비밀키 없음 — worker.js(hondi-proxy)의 /gov/national-agency-resolve를
// 호출할 뿐이다(SIGUNGU_RESOLVE_ORIGIN과 동일 Worker 재사용). 실패해도
// 예외를 던지지 않고 안전한 기본 문구로 대체 — 이 기능이 죽어도 기존
// 라우팅에 영향 없음(시군구 리졸버와 완전히 동일한 안전 철학).
// onProgress(선택, 2026-07-21 신설) — worker.js가 SSE로 매초 진행상황을
// 보내면 그대로 넘겨받는 콜백. SSE 파싱은 _consumeSigunguSSE(범용 —
// "sigungu" 전용이 아니라 이 프로젝트의 모든 지연조립 리졸버가 쓰는
// data: 라인 프로토콜 파서)를 그대로 재사용한다.
// cityHint(선택, 2026-07-21 신설) — 시/군까지 특정되면 worker.js가 그
// 시/군 관할 지사만 골라 검색한다(도 전체엔 세무서가 여럿이라 시/군
// 없이는 정답을 하나로 좁힐 수 없다 — 실제 배포 재현으로 확인된 문제).
async function resolveNationalAgencyLazy(provinceCode, provinceName, domain, onProgress, cityHint) {
  try {
    const url = `${SIGUNGU_RESOLVE_ORIGIN}/gov/national-agency-resolve?domain=${encodeURIComponent(domain)}&province=${encodeURIComponent(provinceCode)}&provinceName=${encodeURIComponent(provinceName)}` +
      (cityHint ? `&city=${encodeURIComponent(cityHint)}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && res.body) {
      const streamed = await _consumeSigunguSSE(res.body, onProgress);
      if (streamed) return streamed;
      throw new Error('SSE 스트림이 done 이벤트 없이 종료됨');
    }
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('[gov-router] resolveNationalAgencyLazy 실패, 기본 문구로 대체:', e?.message);
    return {
      text: `${provinceName} 관련 국가기관 지사 문의는 정부24(gov.kr) 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`,
      verified: false, source: 'error_fallback',
    };
  }
}

// 도코드 → 정식 도이름 역매핑(PROVINCE_NAME_TO_CODE에서 각 코드별 가장
// 긴(정식) 이름만 뽑아 구성 — worker.js provinceName 파라미터용).
const PROVINCE_CODE_TO_NAME = {};
for (const [name, code] of Object.entries(PROVINCE_NAME_TO_CODE)) {
  if (!PROVINCE_CODE_TO_NAME[code] || name.length > PROVINCE_CODE_TO_NAME[code].length) {
    PROVINCE_CODE_TO_NAME[code] = name;
  }
}
function _provinceCodeToName(code) {
  return PROVINCE_CODE_TO_NAME[code] || code;
}

// ── 국가기관 지연 초기화용 도메인 휴리스틱 (2026-07-20 신설) ──────
// worker.js NAT_AGENCY_COMMON_PATTERNS/NAT_AGENCY_LABEL_KO의 19개 도메인과
// 1:1 대응. 시군구 휴리스틱과 동일하게 "일단 v1으로 배선하고 실사용 로그
// (national_agency_resolve_log)가 쌓이면 정교화"하는 전략을 쓴다.
// 2026-07-24 확장(국가기관 100건 사고실험에서 발견) — 이 사전은 예전엔
// JEJU_NATIONAL_TABLE(제주 실사 키워드)보다 좁아서, 제주에서는 인식되는
// 자연스러운 표현("112", "태풍정보" 등)이 다른 도에서는 LAZY조차 못 타고
// 조용히 실패했다. 두 사전을 합치고(기존 항목은 유지), 예전엔 아예
// 없던 15개 도메인(laborrel·검역·품질관리·산림 계열 등)도 추가해
// 최소한 LAZY 안전망은 전국 어디서나 동일하게 타도록 한다.
const _NAT_AGENCY_DOMAIN_KEYWORDS = {
  tax: ['세무서', '국세', '부가세', '소득세', '법인세', '세무', '종합소득세', '부가가치세', '홈택스'],
  // ★ 2026-08-17 수정 — 원래 있던 단독 '법원'·'재판'은 지나치게 포괄적인
  // 부분 문자열이라, 법원행정처(NCA)·헌법재판소사무처(CONSTCOURT)·
  // 법원공무원교육원(COTI)·사법정책연구원(JPRI)·대법원(SUPREMECOURT) 등
  // policy-bodies 5개의 정식 명칭·트리거와 매번 충돌해 -0.8) 게이트를
  // 통째로 건너뛰게 만들었다(전수 감사로 발견, live-policy-body-
  // collision-audit.mjs 참고). '지방법원'처럼 이미 구체적인 지사 실행
  // 키워드만으로도 진짜 지사 민원(관할 확인 등)은 그대로 커버되므로,
  // 단독 '법원'·'재판'은 제거하고 구체어만 남긴다.
  court: ['소송', '판결', '민사', '형사', '지방법원', '관할 법원', '등기소', '나의사건검색', '전자소송', '등기부등본'],
  // ★ 2026-08-30 순서 수정 — _guessNatAgencyDomainFromText는 테이블
  // 순서대로 훑다 첫 매칭 도메인을 반환하는데, prosecution의 '수사'는
  // 경찰·검찰 둘 다 쓰는 일반 동사라 police가 뒤에 있으면 "강원 경찰청
  // 수사 문의"처럼 '경찰청'을 명시했는데도 '수사'에 먼저 걸려 prosecution
  // 으로 오분류됐다(national-police-expansion.test.mjs로 발견). police의
  // 키워드는 '경찰청'처럼 구체적 기관명이라 순서를 앞으로 옮겨, 명시적
  // 기관명이 일반 동사보다 우선하도록 한다. 기관명 없이 '수사'만 있는
  // 텍스트는 여전히 prosecution으로 정상 매칭됨(police 키워드가 없으므로).
  police: ['지방경찰청', '경찰청', '국가경찰', '112', '고소장', '지구대', '파출소', '경찰서'],
  prosecution: ['검찰', '공소', '수사', '검찰청', '고소장', '고발', '검사실'],
  labor: ['근로복지공단', '산재', '산업재해', '산재보험'],
  laborimprove: ['근로개선', '고용노동청', '근로감독', '임금체불', '근로개선지도'],
  laborrel: ['노동위원회', '부당해고'],
  nhis: ['건강보험공단', '국민건강보험', '건강보험료', '건강검진'],
  nps: ['국민연금공단', '국민연금'],
  immigration: ['출입국', '비자', '외국인등록', '체류자격', '외국인청', '귀화', '하이코리아'],  // ★ 2026-08-23 bare '비자' 유지(원복) — _kwMatch 구조적 수정으로 대체(BUG-031)
  post: ['우정청', '우체국', '우편', '등기우편'],
  mma: ['병무청', '징병', '입영', '병역', '징병검사', '신체검사'],  // ★ 2026-08-23 bare '입영' 유지(원복) — _kwMatch 구조적 수정으로 대체(BUG-031)
  customs: ['세관', '관세', '통관'],
  // ★ 2026-08-17 수정 — 단독 '보훈'이 국가보훈부(MPVA) 정식 명칭과 매번
  // 충돌해 -0.8) 게이트를 건너뛰게 만들었다(전수 감사로 발견). '보훈청'·
  // '보훈급여'로도 지사(보훈지청) 실행형 민원은 그대로 잡힌다.
  veterans: ['보훈청', '국가유공자', '보훈급여', '취업지원 대상자'],  // ★ 2026-08-23 '취업지원 대상자' 추가(사고실험 발견)
  weather: ['지방기상청', '기상특보', '기상청', '태풍정보', '태풍 정보', '실시간 기상'],
  coastguard: ['해양경찰', '해경', '122', '해양사고', '해양레저 안전'],
  port: ['해양수산청', '항만', '선박등록'],
  probation: ['준법지원센터', '보호관찰', '사회봉사명령'],
  bok: ['한국은행', '화폐교환', '화폐 교환'],
  stat: ['통계청'],
  pps: ['조달청', '나라장터'],
  animalquarantine: ['동물검역', '가축검역', '반려동물 검역', '반려동물 동반', '축산물 반입'],
  humanquarantine: ['검역소', '해외감염병', '해외 출국 예방접종', '검역감염병'],
  agroquality: ['농산물품질관리원', '원산지표시', '친환경인증', '친환경 인증', 'GAP 인증'],
  fishquality: ['수산물품질관리원', '수산물 원산지', '수산물 검사'],
  foodimport: ['수입식품검사', '수입식품 통관'],
  data: ['공공데이터청', '공공데이터포털'],
  radio: ['전파관리소', '무선국'],
  env: ['환경영향평가', '환경청'],
  internet: ['스마트쉼센터', '인터넷과의존', '스마트폰과의존'],
  airport: ['공항공사', '항공편', '공항 주차장', '공항 이용', '공항 분실물'],
  forestresearch: ['산림과학원', '임업연구'],
  forestseed: ['산림품종관리센터', '산림용 종자', '종자검사'],
  forestcoop: ['산림조합'],
};
function _guessNatAgencyDomainFromText(text) {
  for (const [domain, kws] of Object.entries(_NAT_AGENCY_DOMAIN_KEYWORDS)) {
    if (kws.some(k => _kwMatch(text, k))) return domain;
  }
  return null;
}

// ── 2026-08-08 신설 — 제주 외 15개 도 전체에 국가기관 지사 34개 도메인
// 키워드 매칭 일반화 ──────────────────────────────────────────────
// 지금까지는 police(그것도 경기·전남광주통합 제외)만 _makePoliceEntry로
// 등록돼 있어서, 나머지 33개 도메인은 이 도들의 PROVINCE_TABLES.national에
// 아예 항목이 없었다 — _guessNatAgencyDomainFromText가 도메인을 알아채도
// alreadyCovered=false라 매번 resolveNationalAgencyLazy(Serper 실시간
// 검색)로 넘어갔고, 그 결과가 종종 틀렸다(예: 대전·세종·경북·경기·대구의
// coastguard 질의가 전부 무관한 "완도해양경찰서"로 잘못 매칭된 사례
// 실측 확인, 2026-08-08). _NAT_AGENCY_DOMAIN_KEYWORDS(위, 34개 도메인 —
// JEJU_NATIONAL_TABLE과 완전히 동일한 도메인 커버리지)를 그대로 재사용해
// 도 전체에 매칭 항목을 채운다.
//
// ★ 중요 — 이 항목들은 라우팅(매칭)만 담당하고 실제 응답 콘텐츠는
// 담당하지 않는다. _fetchNatText()가 national-agency-master-data.json에서
// domain+도코드로 레코드를 찾는데, 지금은 제주 34건만 있고 나머지 도는
// 레코드가 없다 — 그러면 _NAT_NO_INFO_FALLBACK의 정직한 "[정보 없음] ...
// 정부24(gov.kr) 또는 110" 문구로 안전하게 폴백한다. 즉 이 커밋은
// "틀린 추측이 나갈 가능성을 원천 차단"하는 안전조치이지, 아직 실제
// 지사명을 채우는 작업(별도 후속 커밋)이 아니다.
//
// police는 경기·전남광주통합에서 의도적으로 제외돼 있었다(2026-07
// 실사 — 이 두 도는 지방경찰청이 도 전체 1곳이 아니라 경기남부/경기
// 북부처럼 하위 분할돼 있어 "도 1곳" 모델이 안 맞음). 그 제외 이유는
// 이 정적 경로에는 적용되지 않는다 — 레코드가 없으면 어차피 정직한
// 정보없음으로 가지, 틀린 특정 지사를 찍어 말하지 않는다(라이브서치가
// 정확히 이 실수를 했다 — 실측 로그에서 경기가 "경기남부경찰청"으로
// 단정적으로 나왔는데 북부 사용자에게는 틀린 답이다). 그래서 34개
// 도메인 전부를 예외 없이 균일하게 적용한다.
function _makeGenericNationalEntries(도코드) {
  return Object.entries(_NAT_AGENCY_DOMAIN_KEYWORDS).map(([domain, kw]) => ({
    code: `SP-NAT-${domain.toUpperCase()}`, domain, 도코드, kw,
  }));
}
for (const _genCode of ['busan', 'seoul', 'incheon', 'daejeon', 'ulsan', 'sejong',
  'chungbuk', 'chungnam', 'jeonbuk', 'gyeongbuk', 'gyeongnam', 'gyeonggi',
  'gangwon', 'daegu', 'jeonnam-gwangju']) {
  PROVINCE_TABLES[_genCode].national = _makeGenericNationalEntries(_genCode);
}

// ── 중앙부처 정책기관(policy-bodies) 지연 초기화 (2026-08-02 신설) ──
// 09-national/agencies/templates/(위 19~34개 국가기관 '지사'형 도메인)와
// 별개 계층이다 — policy-bodies는 도별 지사가 없는 전국 단일 부처·청·
// 위원회 70개(법무부·교육부·감사원 등)로, province 파라미터 없이 정적
// SP 파일 하나만 그대로 fetch하면 된다(서버 왕복 불필요). 키워드는
// 위 _NAT_AGENCY_DOMAIN_KEYWORDS와 겹치는 집행기관성 용어(예: '입영',
// '세무서')를 의도적으로 피했다 — 이미 그쪽이 먼저 매칭되므로 그쪽이
// 지사(집행) 계층을, 이쪽은 본청·정책 계층을 맡는 역할 분담이다.
// ★ 2026-08-03/04 수정 — NTS/KCS/MMA/PPS/PROSECUTION(국세청·관세청·
// 병무청·조달청·검찰청, 8/3 1차 수정) + SUPREMECOURT/MPVA/KMA/COTI/NCA
// (대법원·국가보훈부·기상청·법원공무원교육원·법원행정처, 8/4 2차 수정)
// 총 10개 기관은 원래 등록돼 있던 키워드가 전부(또는 일부) 아래
// _NAT_AGENCY_DOMAIN_KEYWORDS와 부분 문자열로 겹쳐서('판결문 등본
// 발급'이 court 도메인의 '판결'을 포함하는 식) 우선순위 가드(지사
// 우선)에 항상 걸려 본청 SP에 텍스트 매칭으로는 영원히 도달할 수
// 없었다. 1차 수정(8/3) 때는 "policy-bodies와 agencies 양쪽에 동명
// 기관이 있는 7개"만 의심하고 그중 5개만 고쳤는데, live-policy-bodies-
// smoketest.mjs를 실제로 실행해보니 그 가정 자체가 틀렸다 — agencies
// 지사가 없는 기관이라도 34개 지사 도메인 중 아무 키워드와 우연히
// 겹치면 똑같이 막힌다는 걸 실측으로 확인(대법원↔court, 국가보훈부
// ↔veterans, 기상청↔weather 등은 지사 파일 자체가 아예 없는데도 걸림).
// 그래서 8/4에는 70개 전부를 34개 지사 도메인 전체와 파이썬으로 전수
// 대조해 "FULLY BLOCKED"(모든 키워드가 겹침) 5건을 추가로 찾아 고쳤다.
// 혼디 제1원칙 — K-Search로 기관을 정확히 특정해 호출한다 — 를 검증
// 없이 "설계상 이래야 한다"만으로 판단하면 이런 실측 전까지 못 잡는
// 결함이 남는다는 교훈. 각 기관에 지사와 절대 안 겹치는 진짜 정책·
// 본청 수준 키워드를 하나씩 추가했다(예: 대법원 '사법제도 개선 의견
// 제출'은 court 도메인의 '판결·재판·소송' 등 실행형 키워드와 무관한
// 사법행정 정책 수준 발화). 기존 키워드는 그대로 남겨뒀다 — 그쪽은
// 여전히(의도대로) 지사가 우선 처리한다.
const _POLICY_BODY_DOMAIN_KEYWORDS = {
  MOJ: ['법무부', '출입국 체류기간', '체류기간 연장', '출입국관리', '인권옹호', '벌과금'],  // ★ 2026-08-23 '벌과금' 추가(5차 사고실험 발견)
  FSC: ['금융위원회', '온라인투자연계금융업', 'P2P 대출업 등록', '금융기관 인가'],
  FTC: ['공정거래위원회', '불공정거래행위', '납품단가 후려치기', '부당 공동행위 신고'],
  MOEL: ['고용노동부', '임금체불 진정', '근로기준법 위반 신고'],
  MOHW: ['보건복지부', '기초생활수급자 신청', '기초생활보장'],
  NTS: ['국세청', '종합소득세 신고', '부가가치세 신고', '홈택스 신고', '세법 해석 사전답변 신청'],
  KCS: ['관세청', '관세 신고', '수입물품 통관 신고', '품목분류 사전심사 신청'],
  ACRC: ['국민권익위원회', '국민신문고', '부패신고'],
  BAI: ['감사원', '공익감사청구서'],
  CIO: ['고위공직자범죄수사처', '공수처', '고위공직자 비리 제보', '고위공직자 비리'],
  CONSTCOURT: ['헌법재판소', '헌법소원', '위헌법률심판'],
  NHRCK: ['국가인권위원회', '인권위 진정', '차별 진정', '차별을 당'],
  PIPC: ['개인정보보호위원회', '개인정보 유출 신고', '개인정보 유출', '개인정보'],
  KASA: ['우주항공청', '우주기술 연구개발 지원사업', '우주기술'],
  ASSEMBLY: ['국민동의청원'],
  SUPREMECOURT: ['대법원', '판결문 등본 발급', '사법제도 개선 의견 제출'],
  NIS: ['국가정보원', '국정원', '산업기술 유출 제보', '기술 유출'],  // ★ 2026-08-23 수정 — bare '산업기술'을 제거했다(09-national/qgov 배선 작업 중 발견). 한국산업기술기획평가원(KEIT2)·한국환경산업기술원(KEITI)·한국산업기술진흥원(KIAT2) 등 실제 기관명에 '산업기술'이 포함돼 있어, 이 발화들이 전부 국가정보원으로 오탐되고 있었다(policy-body 매칭은 plain text.includes()라 부분 문자열도 걸림). 기존 '산업기술 유출 제보'·'기술 유출'은 이미 구체적 행위형이라 안전 — 그대로 유지.
  NEC: ['중앙선거관리위원회', '선거관리위원회', '정당 후원회 등록'],
  NSSC: ['원자력안전위원회', '방사선 발생장치 사용 허가'],
  NABO: ['국회예산정책처', '예산 소요 추계'],
  NARS: ['국회입법조사처', '입법조사 회답'],
  MOE: ['교육부', '해외 학점 인정 신청', '학점인정'],
  // ★ 2026-08-22 수정(사용자 실측 지적) — '여권'/'여권 재발급'/'여권 발급
  // 신청' 키워드를 제거했다. 이 함수(_guessPolicyBodyFromText)는 완전히
  // 결정론적이라 classifyFn(K-Intent)을 아예 거치지 않고 즉시 확정한다
  // — 그런데 한국 여권은 외교부 본청이 아니라 시/군/구 여권과가 발급
  // 한다(이미 _SIGUNGU_DOMAIN_KEYWORDS.jachi에 '여권'이 등록돼 있어
  // 코드 스스로 이 사실을 알고 있었다 — 2026-07-24 주석 참조). 이 표에
  // '여권'이 남아있던 탓에 실제로는 K-Intent가 개입할 기회조차 없이
  // "여권 재발급 어디로 가나요" 같은 발화가 조용히 MOFA로 확정되고
  // 있었다(2026-08-21 실측 스모크테스트, K-Intent 호출 0회로 확인).
  MOFA: ['외교부', '여권 진위', '여권정보증명서', '여권 발급 이력', '여권발급이력', '여권 발급 상태', '여권발급상태',
    '여권 발급기록', '여권발급기록', '여권 분실', '여권 유효기간', '여권 만료일', '여권 사전알림'],  // ★ 2026-08-23 추가(4·7차 사고실험 발견)
  UNIKOREA: ['통일부', '북한이탈주민 정착지원'],
  MND: ['국방부', '예비군 훈련 연기', '예비군'],  // ★ 2026-08-23 '예비군' 추가(사고실험 발견) — "예비군훈련 필증"
  MOIS: ['행정안전부', '재난안전특별교부세'],
  MAFRA: ['농림축산식품부', '축사 신축 정책자금'],
  MCST: ['문화체육관광부', '문화예술 지원사업 신청'],
  MPVA: ['국가보훈부', '국가유공자 등록 신청', '제대군인 지원정책 개선 건의'],
  MSIT: ['과학기술정보통신부', '정보통신 R&D 지원사업'],
  MSS: ['중소벤처기업부', '소상공인 정책자금'],
  KDCA: ['질병관리청', '감염병 의심 신고', '감염병'],
  KFS: ['산림청', '소나무재선충병'],
  KHS: ['국가유산청', '출토 유물 신고', '매장문화재 발견 신고', '유물 발견'],
  MFDS: ['식품의약품안전처', '수입식품 안전성 검사', '수입식품'],
  KMA: ['기상청', '기상특보 오보', '장기예보 정확도 관련 문의'],
  RDA: ['농촌진흥청', '병해충 진단'],
  POLICE: ['경찰청', '차량 도난 신고'],
  MMA: ['병무청 본청', '병무행정 제도 개선 건의'],
  MOCEE: ['기후에너지환경부', '대기오염물질'],
  BMTC: ['방송미디어통신위원회', '방송 심의 신고', '홈쇼핑 광고 신고'],
  MOLELEG: ['법제처', '조례안 법제 심사'],
  MPM: ['인사혁신처', '공무원 경력경쟁채용시험'],
  NFA: ['소방청 본청', '소방시설 완공 점검'],
  PSS: ['대통령경호처', '경호구역 촬영 협조', '경호구역'],
  MOF: ['해양수산부', '어업허가 갱신'],
  MOLIT: ['국토교통부', '재건축 정비사업 인허가'],
  MOTIE: ['산업통상부', '원산지증명서 발급'],
  MOGEF: ['성평등가족부', '직장 내 성희롱 신고', '성희롱'],
  DAPA: ['방위사업청', '방위산업체 지정 신청', '방위산업체'],
  KCG: ['해양경찰청', '해양 구조 요청', '선박 침수 신고'],
  OKA: ['재외동포청', '재외동포체류자격 등록'],
  PPS: ['조달청', '나라장터', '공공조달 정책 개선 건의'],
  PRESOFFICE: ['대통령비서실', '국민제안'],
  PROSECUTION: ['검찰청', '고소장 접수', '범죄피해자 보호정책 건의'],
  NSC: ['국가안보실', '안보 정책 건의서'],
  OPC: ['국무조정실', '규제개선 건의'],
  COTI: ['법원공무원교육원', '법원공무원 실무 교육과정', '법원공무원', '사법행정직 연수과정 문의'],
  JPRI: ['사법정책연구원', '재판제도 연구용역', '재판제도'],
  JRTI: ['사법연수원', '사법연수생'],
  NAACC: ['행정중심복합도시건설청', '세종시 아파트 특별공급'],
  NAFI: ['국회미래연구원', '미래 정책 연구 자문'],
  NANET: ['국회도서관', '학위논문 원문 복사'],
  NAS: ['국회사무처', '국정감사 자료 제출 요청'],
  NCA: ['법원행정처', '법원 시설물 촬영 협조', '사법행정 예산 편성 문의'],
  NDA: ['국가데이터처', '공공데이터 개방 신청'],
  SDIA: ['새만금개발청', '새만금산업단지 입주'],
  KIPO: ['지식재산처', '특허 출원'],
  MOFE: ['재정경제부', '세제 개편'],
  OBS: ['기획예산처', '공공기관 예산 편성 의견'],
};

// ── 정책기관 "고유명칭" 충돌 예외(2026-08-17) — 행위 서술형 충돌과
// 구분해서 명칭 매칭일 때만 지사 우선 가드를 건너뛴다. 위 court/
// veterans처럼 지사 사전 쪽을 고치지 않고, 정책기관 쪽에서 "이 문구가
// 있으면 명칭 매칭으로 간주"만 좁게 허용 — MOEL의 '임금체불 진정' 같은
// 행위 서술형 충돌에는 전혀 영향 없음(policyBodyGuess가 CIO/KMA가
// 아니면 이 화이트리스트는 아예 안 쓰인다).
const _POLICY_BODY_NAME_COLLISION_EXEMPT = {
  CIO: ['고위공직자범죄수사처'],
  KMA: ['기상청'],
};

const _POLICY_BODY_NAME_KO = {
  MOJ: '법무부',
  FSC: '금융위원회',
  FTC: '공정거래위원회',
  MOEL: '고용노동부',
  MOHW: '보건복지부',
  NTS: '국세청',
  KCS: '관세청',
  ACRC: '국민권익위원회',
  BAI: '감사원',
  CIO: '고위공직자범죄수사처',
  CONSTCOURT: '헌법재판소',
  NHRCK: '국가인권위원회',
  PIPC: '개인정보보호위원회',
  KASA: '우주항공청',
  ASSEMBLY: '국회',
  SUPREMECOURT: '법원(대법원)',
  NIS: '국가정보원',
  NEC: '중앙선거관리위원회',
  NSSC: '원자력안전위원회',
  NABO: '국회예산정책처',
  NARS: '국회입법조사처',
  MOE: '교육부',
  MOFA: '외교부',
  UNIKOREA: '통일부',
  MND: '국방부',
  MOIS: '행정안전부',
  MAFRA: '농림축산식품부',
  MCST: '문화체육관광부',
  MPVA: '국가보훈부',
  MSIT: '과학기술정보통신부',
  MSS: '중소벤처기업부',
  KDCA: '질병관리청',
  KFS: '산림청',
  KHS: '국가유산청',
  MFDS: '식품의약품안전처',
  KMA: '기상청',
  RDA: '농촌진흥청',
  POLICE: '경찰청',
  MMA: '병무청',
  MOCEE: '기후에너지환경부',
  BMTC: '방송미디어통신위원회',
  MOLELEG: '법제처',
  MPM: '인사혁신처',
  NFA: '소방청',
  PSS: '대통령경호처',
  MOF: '해양수산부',
  MOLIT: '국토교통부',
  MOTIE: '산업통상부',
  MOGEF: '성평등가족부',
  DAPA: '방위사업청',
  KCG: '해양경찰청',
  OKA: '재외동포청',
  PPS: '조달청',
  PRESOFFICE: '대통령비서실',
  PROSECUTION: '검찰청',
  NSC: '국가안보실',
  OPC: '국무조정실',
  COTI: '법원공무원교육원',
  JPRI: '사법정책연구원',
  JRTI: '사법연수원',
  NAACC: '행정중심복합도시건설청',
  NAFI: '국회미래연구원',
  NANET: '국회도서관',
  NAS: '국회사무처',
  NCA: '법원행정처',
  NDA: '국가데이터처',
  SDIA: '새만금개발청',
  KIPO: '지식재산처',
  MOFE: '재정경제부',
  OBS: '기획예산처',
};

function _guessPolicyBodyFromText(text) {
  for (const [code, kws] of Object.entries(_POLICY_BODY_DOMAIN_KEYWORDS)) {
    if (kws.some(k => _kwMatch(text, k))) return code;
  }
  return null;
}

// ── 국가 공기업(enterprises) 매칭 (2026-08-23 신설) ──────────────────
// ★ 구조적 결함 발견 및 수정: 09-national/enterprises(29개 공기업 SP)가
// gov-router.js 어디에도 fetch되지 않고, sp-catalog.json을 만드는
// tools/build_manifest.py도 이 폴더를 스캔 대상에서 제외하고 있었다 —
// 즉 이 29개 SP는 콘텐츠는 있지만 실제로는 어떤 사용자에게도 도달할
// 수 없는 완전한 죽은 콘텐츠였다(policy-bodies/agencies와 달리 배선
// 자체가 처음부터 없었음). GOV-TASK-904-GAP 감사(REQUIRED_DOCUMENTS_
// REGISTRY 배선 여부)를 진행하기 전에 이 결함을 먼저 고친다 — 배선이
// 안 된 파일에 GOV_TASK 섹션을 추가해봐야 아무도 볼 수 없다.
//
// policy-bodies와 동일한 패턴(도별 지사 없는 전국 단일 SP → 키워드
// 매칭 + 지연 fetch)을 그대로 복제한다. 충돌 위험을 최소화하기 위해
// 키워드는 원칙적으로 기관의 공식 명칭(고유명사)만 쓰고, 시민이 실제
// 자주 쓰는 약칭(한전·코레일·LH·수자원공사 등) 몇 개만 개별 확인 후
// 추가했다(기존 _POLICY_BODY_DOMAIN_KEYWORDS·_NAT_AGENCY_DOMAIN_
// KEYWORDS·L2_CANONICAL_KEYWORDS 전체와 대조해 겹치는 항목 없음을
// 확인함, 2026-08-23).
const _ENTERPRISE_DOMAIN_KEYWORDS = {
  EWP: ['한국동서발전'],
  EX: ['한국도로공사', '도로공사'],
  GKL: ['그랜드코리아레저'],
  HUG: ['주택도시보증공사', 'HUG'],
  IIAC: ['인천국제공항공사'],
  JDC: ['제주국제자유도시개발센터'],
  KAC: ['한국공항공사'],
  KDN: ['한전KDN', '한전케이디엔'],
  KEPCOENG: ['한국전력기술'],
  KEPCOKPS: ['한전KPS', '한전케이피에스'],
  KEPCO: ['한국전력공사', '한전'],
  KHNP: ['한국수력원자력', '한수원'],
  KL: ['강원랜드'],
  KNOC: ['한국석유공사'],
  KODIT: ['한국지역난방공사', '지역난방공사'],
  KOEM: ['해양환경공단'],
  KOEN: ['한국남동발전'],
  KOGAS: ['한국가스공사'],
  KOGAT: ['한국가스기술공사'],
  KOMIPO: ['한국중부발전'],
  KOMIR: ['한국광해광업공단'],
  KOMSCO: ['한국조폐공사'],
  KORAIL: ['한국철도공사', '코레일'],
  KOSPO: ['한국남부발전'],
  KRA: ['한국마사회'],
  KWATER: ['한국수자원공사', '수자원공사'],
  LH: ['한국토지주택공사', 'LH공사'],
  REB: ['한국부동산원'],
  SR: ['에스알(SR)', 'SR고속열차', '에스알열차'],
  WP: ['한국서부발전'],
};
const _ENTERPRISE_NAME_KO = {
  EWP: '한국동서발전', EX: '한국도로공사', GKL: '그랜드코리아레저', HUG: '주택도시보증공사',
  IIAC: '인천국제공항공사', JDC: '제주국제자유도시개발센터', KAC: '한국공항공사', KDN: '한전KDN',
  KEPCOENG: '한국전력기술', KEPCOKPS: '한전KPS', KEPCO: '한국전력공사', KHNP: '한국수력원자력',
  KL: '강원랜드', KNOC: '한국석유공사', KODIT: '한국지역난방공사', KOEM: '해양환경공단',
  KOEN: '한국남동발전', KOGAS: '한국가스공사', KOGAT: '한국가스기술공사', KOMIPO: '한국중부발전',
  KOMIR: '한국광해광업공단', KOMSCO: '한국조폐공사', KORAIL: '한국철도공사', KOSPO: '한국남부발전',
  KRA: '한국마사회', KWATER: '한국수자원공사', LH: '한국토지주택공사', REB: '한국부동산원',
  SR: '에스알(SR)', WP: '한국서부발전',
};
function _guessEnterpriseFromText(text) {
  for (const [code, kws] of Object.entries(_ENTERPRISE_DOMAIN_KEYWORDS)) {
    if (kws.some(k => text.includes(k))) return code;
  }
  return null;
}
const _enterpriseSpCache = new Map();
async function resolveEnterpriseLazy(code, onProgress) {
  if (_enterpriseSpCache.has(code)) {
    return { text: _enterpriseSpCache.get(code), source: 'cache' };
  }
  try {
    onProgress?.({ stage: 'enterprise-fetch', code });
    const text = await _fetchText(`09-national/enterprises/SP-NAT-ENT-${code}_v1.1.md`);
    _enterpriseSpCache.set(code, text);
    return { text, source: 'fetched' };
  } catch (e) {
    console.warn('[gov-router] resolveEnterpriseLazy 실패, 기본 문구로 대체:', e?.message);
    const label = _ENTERPRISE_NAME_KO[code] || code;
    return {
      text: `[정보 없음] ${label} 관련 SP를 지금 불러오지 못했습니다 — 정부24(gov.kr) 또는 해당 기관 공식 홈페이지를 확인해 주세요.`,
      source: 'fallback',
    };
  }
}

// ── 준정부기관(qgov) 매칭 (2026-08-23 신설) ──────────────────────────
// enterprises와 동일한 구조적 결함(09-national/qgov 58개가 gov-router.js
// 어디에도 배선돼 있지 않던 것)을 같은 세션에서 이어서 수정한다. 패턴은
// enterprises와 동일(전국 단일 SP → 키워드 매칭 + 지연 fetch).
//
// ★ 계층 중복 주의 — NHIS(국민건강보험공단)·NPS(국민연금공단)·
// KCOMWEL(근로복지공단)은 09-national/agencies에도 동일 기관의 "지사"
// SP가 이미 존재한다(도메인 nhis/nps/labor). 이건 오류가 아니라
// police·court·prosecution 등에서 이미 쓰이던 policy-bodies(본청) vs
// agencies(지사) 공존 패턴과 동일하다 — 아래 enterpriseGuess와 같은
// _natAgencyHit 가드를 그대로 적용해 지사 쪽이 우선하도록 둔다(이
// 기관들의 qgov 파일은 실행형 발화에서는 사실상 안 쓰이고, 정책·본청
// 수준 발화에서만 도달하게 됨 — 의도된 동작).
const _QGOV_DOMAIN_KEYWORDS = {
  AT: ['한국농수산식품유통공사'],
  GEPS: ['공무원연금공단'],
  HF: ['한국주택금융공사'],
  HIRA: ['건강보험심사평가원'],
  HRDKOREA: ['한국산업인력공단'],
  KALIS: ['국토안전관리원'],
  KAMCO: ['한국자산관리공사'],
  KCA2: ['한국소비자원'],
  KCA3: ['한국방송통신전파진흥원'],
  KCOMWEL: ['근로복지공단'],
  KDIC: ['예금보험공사'],
  KEA3: ['한국에너지공단'],
  KEAD: ['한국장애인고용공단'],
  KECO: ['한국환경공단'],
  KEIS: ['한국고용정보원'],
  KEIT2: ['한국산업기술기획평가원'],
  KEITI: ['한국환경산업기술원'],
  KESCO: ['한국전기안전공사'],
  KGS: ['한국가스안전공사'],
  KIAT2: ['한국산업기술진흥원'],
  KICOX: ['한국산업단지공단'],
  KISA: ['한국인터넷진흥원'],
  KNPS: ['국립공원공단'],
  KOAGI: ['한국수목원정원관리원'],
  KODIT3: ['신용보증기금'],
  KODIT4: ['기술보증기금'],
  KOELSA: ['한국승강기안전공단'],
  KOFIA2: ['한국재정정보원'],
  KOFOWI: ['한국산림복지진흥원'],
  KOICA2: ['한국국제협력단'],
  KOMSA2: ['한국해양교통안전공단'],
  KORAD: ['한국원자력환경공단'],
  KOSAF: ['한국장학재단'],
  KOSHA2: ['한국산업안전보건공단'],
  KOSMES: ['중소벤처기업진흥공단'],
  KOSSA: ['한국사회보장정보원'],
  KOTRA2: ['대한무역투자진흥공사', 'KOTRA'],
  KOTSA2: ['한국교통안전공단'],
  KPETRO: ['한국석유관리원'],
  KPX2: ['한국전력거래소'],
  KRAJ: ['한국법무보호복지공단'],
  KRC2: ['한국농어촌공사'],
  KR: ['국가철도공단'],
  KSPO: ['국민체육진흥공단'],
  KSURE: ['한국무역보험공사'],
  KTO: ['한국관광공사'],
  KVMC2: ['한국보훈복지의료공단'],
  LX2: ['한국국토정보공사'],
  NHIS: ['국민건강보험공단'],
  NIA2: ['한국지능정보사회진흥원'],
  NIE: ['국립생태원'],
  NPS: ['국민연금공단'],
  NRF: ['한국연구재단'],
  POSTFIN2: ['우체국금융개발원'],
  POSTLOG2: ['우체국물류지원단'],
  QIA3: ['축산물품질평가원'],
  SEMAS: ['소상공인시장진흥공단'],
  TS: ['한국도로교통공단'],
};
const _QGOV_NAME_KO = {
  AT: '한국농수산식품유통공사', GEPS: '공무원연금공단', HF: '한국주택금융공사', HIRA: '건강보험심사평가원',
  HRDKOREA: '한국산업인력공단', KALIS: '국토안전관리원', KAMCO: '한국자산관리공사', KCA2: '한국소비자원',
  KCA3: '한국방송통신전파진흥원', KCOMWEL: '근로복지공단', KDIC: '예금보험공사', KEA3: '한국에너지공단',
  KEAD: '한국장애인고용공단', KECO: '한국환경공단', KEIS: '한국고용정보원', KEIT2: '한국산업기술기획평가원',
  KEITI: '한국환경산업기술원', KESCO: '한국전기안전공사', KGS: '한국가스안전공사', KIAT2: '한국산업기술진흥원',
  KICOX: '한국산업단지공단', KISA: '한국인터넷진흥원', KNPS: '국립공원공단', KOAGI: '한국수목원정원관리원',
  KODIT3: '신용보증기금', KODIT4: '기술보증기금', KOELSA: '한국승강기안전공단', KOFIA2: '한국재정정보원',
  KOFOWI: '한국산림복지진흥원', KOICA2: '한국국제협력단', KOMSA2: '한국해양교통안전공단', KORAD: '한국원자력환경공단',
  KOSAF: '한국장학재단', KOSHA2: '한국산업안전보건공단', KOSMES: '중소벤처기업진흥공단', KOSSA: '한국사회보장정보원',
  KOTRA2: '대한무역투자진흥공사', KOTSA2: '한국교통안전공단', KPETRO: '한국석유관리원', KPX2: '한국전력거래소',
  KRAJ: '한국법무보호복지공단', KRC2: '한국농어촌공사', KR: '국가철도공단', KSPO: '국민체육진흥공단',
  KSURE: '한국무역보험공사', KTO: '한국관광공사', KVMC2: '한국보훈복지의료공단', LX2: '한국국토정보공사',
  NHIS: '국민건강보험공단', NIA2: '한국지능정보사회진흥원', NIE: '국립생태원', NPS: '국민연금공단',
  NRF: '한국연구재단', POSTFIN2: '(재)우체국금융개발원', POSTLOG2: '(재)우체국물류지원단',
  QIA3: '축산물품질평가원', SEMAS: '소상공인시장진흥공단', TS: '한국도로교통공단',
};
const _OTHER_DOMAIN_KEYWORDS = {
  ACC: ['국립아시아문화전당재단'],
  ADD: ['국방과학연구소'],
  AKS: ['한국학중앙연구원'],
  APCC: ['아시아태평양경제협력체 기후센터'],
  APFC: ['농업정책보험금융원'],
  AQIS2: ['가축위생방역지원본부'],
  ARIRANGTV: ['국제방송교류재단'],
  ARKO: ['한국문화예술위원회'],
  AURI: ['건축공간연구원'],
  BPA: ['부산항만공사'],
  BSNUH: ['분당서울대학교병원'],
  BSSM: ['국립부산과학관'],
  CBNUH: ['충북대학교병원'],
  CNUH2: ['전남대학교병원'],
  CNUH: ['충남대학교병원'],
  CSSA: ['양육비이행관리원'],
  DEC: ['재단법인 장애인기업종합지원센터'],
  DGMIF: ['대구경북첨단의료산업진흥재단'],
  DGSM: ['국립대구과학관'],
  DTAQ: ['국방기술품질원'],
  EPIS: ['농림수산식품교육문화정보원'],
  FIST: ['농림식품기술기획평가원'],
  FKVJF: ['(재)일제강제동원피해자지원재단'],
  FOODCLUSTER: ['한국식품산업클러스터진흥원'],
  FSI: ['식품안전정보원'],
  GADC: ['가덕도신공항건설공단'],
  GJSM: ['국립광주과학관'],
  GKA: ['(재)예술경영지원센터'],
  GNUDH: ['강릉원주대학교치과병원'],
  GRAC: ['게임물관리위원회'],
  GSNUH: ['경상국립대학교병원'],
  GUKAK: ['국악방송'],
  HANSIK: ['한식진흥원'],
  HMC: ['주택관리공단'],
  HONAM: ['국립호남권생물자원관'],
  IBK: ['중소기업은행'],
  IBS: ['기초과학연구원'],
  ICTPA: ['인천항만공사'],
  IHM: ['독립기념관'],
  INNOPOLIS: ['연구개발특구진흥재단'],
  ITKC: ['한국고전번역원'],
  JBNUH: ['전북대학교병원'],
  JEJUUH: ['제주대학교병원'],
  KAHPA: ['(재)축산환경관리원'],
  KAIA: ['국토교통과학기술진흥원'],
  KANGWONUH: ['강원대학교병원'],
  KATO2: ['한국마약퇴치운동본부'],
  KATRI: ['항공안전기술원'],
  KAWF: ['한국예술인복지재단'],
  KCARBON: ['한국탄소산업진흥원'],
  KCC2: ['한국저작권위원회'],
  KCDF: ['한국공예디자인문화진흥원'],
  KCGPTC: ['한국도박문제예방치유원'],
  KCIA: ['한국관세정보원'],
  KCII: ['한국문화정보원'],
  KCOPA: ['한국저작권보호원'],
  KCPC: ['한국문화진흥주식회사'],
  KCTI: ['한국문화관광연구원'],
  KCWU: ['건설근로자공제회'],
  KDB: ['한국산업은행'],
  KDF: ['민주화운동기념사업회'],
  KDI: ['한국개발연구원'],
  KDRA: ['전국재해구호협회'],
  KEA2: ['한국에너지정보문화재단'],
  KECO2: ['한국환경보전원'],
  KEDI: ['한국교육개발원'],
  KEEI: ['에너지경제연구원'],
  KEF2: ['재단법인 한국에너지재단'],
  KEI: ['한국환경연구원'],
  KERIS: ['한국교육학술정보원'],
  KETEP: ['한국에너지기술평가원'],
  KEXIM: ['한국수출입은행'],
  KFCI: ['한국식품안전관리인증원'],
  KFERI: ['한국치산기술협회'],
  KFI: ['한국소방산업기술원'],
  KFSP: ['한국생명존중희망재단'],
  KF: ['한국국제교류재단'],
  KHEPI: ['한국건강증진개발원'],
  KHF: ['국가유산진흥원'],
  KHIDI: ['한국보건산업진흥원'],
  KHOA2: ['한국해양조사협회'],
  KHPLE: ['한국보건의료인국가시험원'],
  KICCE2: ['한국영유아보육·교육진흥원'],
  KICET: ['한국세라믹기술원'],
  KICE: ['한국교육과정평가원'],
  KICJ: ['한국형사·법무정책연구원'],
  KICT2: ['건설기술교육원'],
  KIC: ['한국투자공사'],
  KIDA: ['한국국방연구원'],
  KIDP: ['한국디자인진흥원'],
  KIDS: ['한국의약품안전관리원'],
  KIEP: ['대외경제정책연구원'],
  KIET: ['산업연구원'],
  KIGEPE: ['한국양성평등교육진흥원'],
  KIHASA: ['한국보건사회연구원'],
  KIHF: ['한국건강가정진흥원'],
  KIIP: ['한국지식재산연구원'],
  KIMST2: ['해양수산과학기술진흥원'],
  KINAC: ['한국원자력통제기술원'],
  KIND: ['한국해외인프라·도시개발지원공사'],
  KINFA: ['서민금융진흥원'],
  KINGS: ['한국전력국제원자력대학원대학교'],
  KINS: ['한국원자력안전기술원'],
  KINU: ['통일연구원'],
  KIOST: ['한국해양과학기술원'],
  KIPA2: ['한국발명진흥회'],
  KIPA: ['한국행정연구원'],
  KIPF: ['한국조세재정연구원'],
  KIPI: ['한국특허정보원'],
  KIPSO: ['한국특허전략개발원'],
  KIPS: ['한국특허기술진흥원'],
  KIRAMS: ['한국원자력의학원'],
  KIRIA: ['한국로봇산업진흥원'],
  KISDI: ['정보통신정책연구원'],
  KISED: ['창업진흥원'],
  KISTEP: ['한국과학기술기획평가원'],
  KJOBWORLD: ['한국잡월드'],
  KL88: ['88관광개발'],
  KLA2: ['한국항로표지기술원'],
  KLAC: ['대한법률구조공단'],
  KLI2: ['한국고용노동연구원'],
  KLI: ['한국노동연구원'],
  KLRI: ['한국법제연구원'],
  KLSC: ['정부법무공단'],
  KMIPA: ['한국기상산업기술원'],
  KMI: ['한국해양수산개발원'],
  KMRB: ['영상물등급위원회'],
  KMRI: ['한국해양수산연구원'],
  KNB: ['국립발레단'],
  KNCSW: ['한국사회복지협의회'],
  KNUDH: ['경북대학교치과병원'],
  KNUH: ['경북대학교병원'],
  KOAT: ['한국농업기술진흥원'],
  KOBACO: ['한국방송광고진흥공사'],
  KOBC: ['한국해양진흥공사'],
  KOCCA: ['한국콘텐츠진흥원'],
  KOCEMA: ['재단법인 대한건설기계안전관리원'],
  KOCOAL: ['대한석탄공사'],
  KODATA: ['한국데이터산업진흥원'],
  KODA: ['재단법인 한국장기조직기증원'],
  KODDI: ['한국장애인개발원'],
  KODIT2: ['한국중소벤처기업유통원'],
  KOFAC2: ['한국문화예술교육진흥원'],
  KOFAC: ['한국과학창의재단'],
  KOFAIR: ['한국공정거래조정원'],
  KOFA: ['한국영상자료원'],
  KOFFA: ['한국어촌어항공단'],
  KOFIC: ['영화진흥위원회'],
  KOFIH: ['한국국제보건의료재단'],
  KOFONS: ['한국원자력안전재단'],
  KOFPI: ['한국임업진흥원'],
  KOFRS: ['한국수산자원공단'],
  KOFTA: ['한국등산·트레킹지원센터'],
  KOHI: ['한국보건복지인재원'],
  KOHMI: ['(재)한국보건의료정보원'],
  KOIHA: ['의료기관평가인증원'],
  KOIPA: ['한국지식재산보호원'],
  KOITA: ['과학기술사업화진흥원'],
  KOMIDI: ['한국의료기기안전정보원'],
  KOMUF: ['국립박물관문화재단'],
  KONANO: ['한국나노기술원'],
  KOPSA: ['한국제품안전관리원'],
  KORDI2: ['한국노인인력개발원'],
  KOREATECH: ['한국기술교육대학교'],
  KOREG: ['신용보증재단중앙회'],
  KOROIS: ['한국원산지정보원'],
  KOSAF2: ['한국사학진흥재단'],
  KOSBI: ['중소벤처기업연구원'],
  KOSEA: ['한국사회적기업진흥원'],
  KOSSWA: ['재단법인 한국자활복지개발원'],
  KOSTATINFO: ['(재)한국통계정보원'],
  KOSTATPROMO: ['(재)한국통계진흥원'],
  KOTI: ['한국교통연구원'],
  KOTSA: ['자동차손해배상진흥원'],
  KOWACO2: ['한국수자원조사기술원'],
  KPBA: ['한국우편사업진흥원'],
  KPC2: ['대한장애인체육회'],
  KPF: ['한국언론진흥재단'],
  KPIPA: ['한국출판문화산업진흥원'],
  KPTB: ['재단법인 한국공공조직은행'],
  KRC: ['대한적십자사'],
  KREI: ['한국농촌경제연구원'],
  KRIHS: ['국토연구원'],
  KRIVET: ['한국직업능력연구원'],
  KSD: ['한국예탁결제원'],
  KSIF: ['세종학당재단'],
  KSOC: ['대한체육회'],
  KSPO2: ['한국체육산업개발(주)'],
  KTL: ['한국산업기술시험원'],
  KVIC: ['한국벤처투자'],
  KWDI: ['한국여성정책연구원'],
  KWHRI: ['한국여성인권진흥원'],
  KWMF: ['전쟁기념사업회'],
  KWQC: ['한국물기술인증원'],
  KWWA: ['한국상하수도협회'],
  KYCI: ['한국청소년상담복지개발원'],
  KYWA: ['한국청소년활동진흥원'],
  K: ['한국의료분쟁조정중재원'],
  LTIKOREA: ['한국문학번역원'],
  MABIK: ['국립해양생물자원관'],
  MND2: ['국방전직교육원'],
  NAMU: ['국립농업박물관'],
  NAM: ['국립항공박물관'],
  NCC: ['국립암센터'],
  NEAHF: ['동북아역사재단'],
  NECA: ['한국보건의료연구원'],
  NEXTMODEL: ['차세대수치예보모델개발사업단'],
  NIBP: ['국가생명윤리정책원'],
  NICE2: ['국가아동권리보장원'],
  NIKOM: ['한국한의약진흥원'],
  NILE: ['국가평생교육진흥원'],
  NIMM: ['국립인천해양박물관'],
  NIPA2: ['정보통신산업진흥원'],
  NKRF: ['북한이탈주민지원재단'],
  NMC: ['국립중앙의료원'],
  NMM: ['국립해양박물관'],
  NMSM: ['국립해양과학관'],
  NNIBR: ['국립낙동강생물자원관'],
  NODONG: ['노사발전재단'],
  NYPI: ['한국청소년정책연구원'],
  OKCC: ['재외동포협력센터'],
  OSONG: ['오송첨단의료산업진흥재단'],
  PBS: ['(주)공영홈쇼핑'],
  PNUDH: ['부산대학교치과병원'],
  PNUH: ['부산대학교병원'],
  POLYTECH: ['학교법인한국폴리텍'],
  QIA2: ['국제식물검역인증원'],
  SAC: ['예술의전당'],
  SEC: ['스포츠윤리센터'],
  SMGC: ['새만금개발공사'],
  SNKA: ['(사)남북교류협력지원협회'],
  SNUDH: ['서울대학교치과병원'],
  SNUH: ['서울대학교병원'],
  SPACEIC: ['공간정보산업진흥원'],
  STA: ['무역안보관리원'],
  STEPI: ['과학기술정책연구원'],
  SUDOKWON: ['수도권매립지관리공사'],
  TIPA: ['중소기업기술정보진흥원'],
  TPCS: ['사립학교교직원연금공단'],
  TPF: ['태권도진흥재단'],
  UPA: ['울산항만공사'],
  WISET: ['한국여성과학기술인육성재단'],
  YGPA: ['여수광양항만공사'],
};
const _OTHER_NAME_KO = {
  ACC: '국립아시아문화전당재단',
  ADD: '국방과학연구소',
  AKS: '한국학중앙연구원',
  APCC: '아시아태평양경제협력체 기후센터',
  APFC: '농업정책보험금융원',
  AQIS2: '가축위생방역지원본부',
  ARIRANGTV: '국제방송교류재단',
  ARKO: '한국문화예술위원회',
  AURI: '건축공간연구원',
  BPA: '부산항만공사',
  BSNUH: '분당서울대학교병원',
  BSSM: '국립부산과학관',
  CBNUH: '충북대학교병원',
  CNUH2: '전남대학교병원',
  CNUH: '충남대학교병원',
  CSSA: '양육비이행관리원',
  DEC: '재단법인 장애인기업종합지원센터',
  DGMIF: '대구경북첨단의료산업진흥재단',
  DGSM: '국립대구과학관',
  DTAQ: '국방기술품질원',
  EPIS: '농림수산식품교육문화정보원',
  FIST: '농림식품기술기획평가원',
  FKVJF: '(재)일제강제동원피해자지원재단',
  FOODCLUSTER: '한국식품산업클러스터진흥원',
  FSI: '식품안전정보원',
  GADC: '가덕도신공항건설공단',
  GJSM: '국립광주과학관',
  GKA: '(재)예술경영지원센터',
  GNUDH: '강릉원주대학교치과병원',
  GRAC: '게임물관리위원회',
  GSNUH: '경상국립대학교병원',
  GUKAK: '국악방송',
  HANSIK: '한식진흥원',
  HMC: '주택관리공단',
  HONAM: '국립호남권생물자원관',
  IBK: '중소기업은행',
  IBS: '기초과학연구원',
  ICTPA: '인천항만공사',
  IHM: '독립기념관',
  INNOPOLIS: '연구개발특구진흥재단',
  ITKC: '한국고전번역원',
  JBNUH: '전북대학교병원',
  JEJUUH: '제주대학교병원',
  KAHPA: '(재)축산환경관리원',
  KAIA: '국토교통과학기술진흥원',
  KANGWONUH: '강원대학교병원',
  KATO2: '한국마약퇴치운동본부',
  KATRI: '항공안전기술원',
  KAWF: '한국예술인복지재단',
  KCARBON: '한국탄소산업진흥원',
  KCC2: '한국저작권위원회',
  KCDF: '한국공예디자인문화진흥원',
  KCGPTC: '한국도박문제예방치유원',
  KCIA: '한국관세정보원',
  KCII: '한국문화정보원',
  KCOPA: '한국저작권보호원',
  KCPC: '한국문화진흥주식회사',
  KCTI: '한국문화관광연구원',
  KCWU: '건설근로자공제회',
  KDB: '한국산업은행',
  KDF: '민주화운동기념사업회',
  KDI: '한국개발연구원',
  KDRA: '전국재해구호협회',
  KEA2: '한국에너지정보문화재단',
  KECO2: '한국환경보전원',
  KEDI: '한국교육개발원',
  KEEI: '에너지경제연구원',
  KEF2: '재단법인 한국에너지재단',
  KEI: '한국환경연구원',
  KERIS: '한국교육학술정보원',
  KETEP: '한국에너지기술평가원',
  KEXIM: '한국수출입은행',
  KFCI: '한국식품안전관리인증원',
  KFERI: '한국치산기술협회',
  KFI: '한국소방산업기술원',
  KFSP: '한국생명존중희망재단',
  KF: '한국국제교류재단',
  KHEPI: '한국건강증진개발원',
  KHF: '국가유산진흥원',
  KHIDI: '한국보건산업진흥원',
  KHOA2: '한국해양조사협회',
  KHPLE: '한국보건의료인국가시험원',
  KICCE2: '한국영유아보육·교육진흥원',
  KICET: '한국세라믹기술원',
  KICE: '한국교육과정평가원',
  KICJ: '한국형사·법무정책연구원',
  KICT2: '건설기술교육원',
  KIC: '한국투자공사',
  KIDA: '한국국방연구원',
  KIDP: '한국디자인진흥원',
  KIDS: '한국의약품안전관리원',
  KIEP: '대외경제정책연구원',
  KIET: '산업연구원',
  KIGEPE: '한국양성평등교육진흥원',
  KIHASA: '한국보건사회연구원',
  KIHF: '한국건강가정진흥원',
  KIIP: '한국지식재산연구원',
  KIMST2: '해양수산과학기술진흥원',
  KINAC: '한국원자력통제기술원',
  KIND: '한국해외인프라·도시개발지원공사',
  KINFA: '서민금융진흥원',
  KINGS: '한국전력국제원자력대학원대학교',
  KINS: '한국원자력안전기술원',
  KINU: '통일연구원',
  KIOST: '한국해양과학기술원',
  KIPA2: '한국발명진흥회',
  KIPA: '한국행정연구원',
  KIPF: '한국조세재정연구원',
  KIPI: '한국특허정보원',
  KIPSO: '한국특허전략개발원',
  KIPS: '한국특허기술진흥원',
  KIRAMS: '한국원자력의학원',
  KIRIA: '한국로봇산업진흥원',
  KISDI: '정보통신정책연구원',
  KISED: '창업진흥원',
  KISTEP: '한국과학기술기획평가원',
  KJOBWORLD: '한국잡월드',
  KL88: '88관광개발',
  KLA2: '한국항로표지기술원',
  KLAC: '대한법률구조공단',
  KLI2: '한국고용노동연구원',
  KLI: '한국노동연구원',
  KLRI: '한국법제연구원',
  KLSC: '정부법무공단',
  KMIPA: '한국기상산업기술원',
  KMI: '한국해양수산개발원',
  KMRB: '영상물등급위원회',
  KMRI: '한국해양수산연구원',
  KNB: '국립발레단',
  KNCSW: '한국사회복지협의회',
  KNUDH: '경북대학교치과병원',
  KNUH: '경북대학교병원',
  KOAT: '한국농업기술진흥원',
  KOBACO: '한국방송광고진흥공사',
  KOBC: '한국해양진흥공사',
  KOCCA: '한국콘텐츠진흥원',
  KOCEMA: '재단법인 대한건설기계안전관리원',
  KOCOAL: '대한석탄공사',
  KODATA: '한국데이터산업진흥원',
  KODA: '재단법인 한국장기조직기증원',
  KODDI: '한국장애인개발원',
  KODIT2: '한국중소벤처기업유통원',
  KOFAC2: '한국문화예술교육진흥원',
  KOFAC: '한국과학창의재단',
  KOFAIR: '한국공정거래조정원',
  KOFA: '한국영상자료원',
  KOFFA: '한국어촌어항공단',
  KOFIC: '영화진흥위원회',
  KOFIH: '한국국제보건의료재단',
  KOFONS: '한국원자력안전재단',
  KOFPI: '한국임업진흥원',
  KOFRS: '한국수산자원공단',
  KOFTA: '한국등산·트레킹지원센터',
  KOHI: '한국보건복지인재원',
  KOHMI: '(재)한국보건의료정보원',
  KOIHA: '의료기관평가인증원',
  KOIPA: '한국지식재산보호원',
  KOITA: '과학기술사업화진흥원',
  KOMIDI: '한국의료기기안전정보원',
  KOMUF: '국립박물관문화재단',
  KONANO: '한국나노기술원',
  KOPSA: '한국제품안전관리원',
  KORDI2: '한국노인인력개발원',
  KOREATECH: '한국기술교육대학교',
  KOREG: '신용보증재단중앙회',
  KOROIS: '한국원산지정보원',
  KOSAF2: '한국사학진흥재단',
  KOSBI: '중소벤처기업연구원',
  KOSEA: '한국사회적기업진흥원',
  KOSSWA: '재단법인 한국자활복지개발원',
  KOSTATINFO: '(재)한국통계정보원',
  KOSTATPROMO: '(재)한국통계진흥원',
  KOTI: '한국교통연구원',
  KOTSA: '자동차손해배상진흥원',
  KOWACO2: '한국수자원조사기술원',
  KPBA: '한국우편사업진흥원',
  KPC2: '대한장애인체육회',
  KPF: '한국언론진흥재단',
  KPIPA: '한국출판문화산업진흥원',
  KPTB: '재단법인 한국공공조직은행',
  KRC: '대한적십자사',
  KREI: '한국농촌경제연구원',
  KRIHS: '국토연구원',
  KRIVET: '한국직업능력연구원',
  KSD: '한국예탁결제원',
  KSIF: '세종학당재단',
  KSOC: '대한체육회',
  KSPO2: '한국체육산업개발(주)',
  KTL: '한국산업기술시험원',
  KVIC: '한국벤처투자',
  KWDI: '한국여성정책연구원',
  KWHRI: '한국여성인권진흥원',
  KWMF: '전쟁기념사업회',
  KWQC: '한국물기술인증원',
  KWWA: '한국상하수도협회',
  KYCI: '한국청소년상담복지개발원',
  KYWA: '한국청소년활동진흥원',
  K: '한국의료분쟁조정중재원',
  LTIKOREA: '한국문학번역원',
  MABIK: '국립해양생물자원관',
  MND2: '국방전직교육원',
  NAMU: '국립농업박물관',
  NAM: '국립항공박물관',
  NCC: '국립암센터',
  NEAHF: '동북아역사재단',
  NECA: '한국보건의료연구원',
  NEXTMODEL: '차세대수치예보모델개발사업단',
  NIBP: '국가생명윤리정책원',
  NICE2: '국가아동권리보장원',
  NIKOM: '한국한의약진흥원',
  NILE: '국가평생교육진흥원',
  NIMM: '국립인천해양박물관',
  NIPA2: '정보통신산업진흥원',
  NKRF: '북한이탈주민지원재단',
  NMC: '국립중앙의료원',
  NMM: '국립해양박물관',
  NMSM: '국립해양과학관',
  NNIBR: '국립낙동강생물자원관',
  NODONG: '노사발전재단',
  NYPI: '한국청소년정책연구원',
  OKCC: '재외동포협력센터',
  OSONG: '오송첨단의료산업진흥재단',
  PBS: '(주)공영홈쇼핑',
  PNUDH: '부산대학교치과병원',
  PNUH: '부산대학교병원',
  POLYTECH: '학교법인한국폴리텍',
  QIA2: '국제식물검역인증원',
  SAC: '예술의전당',
  SEC: '스포츠윤리센터',
  SMGC: '새만금개발공사',
  SNKA: '(사)남북교류협력지원협회',
  SNUDH: '서울대학교치과병원',
  SNUH: '서울대학교병원',
  SPACEIC: '공간정보산업진흥원',
  STA: '무역안보관리원',
  STEPI: '과학기술정책연구원',
  SUDOKWON: '수도권매립지관리공사',
  TIPA: '중소기업기술정보진흥원',
  TPCS: '사립학교교직원연금공단',
  TPF: '태권도진흥재단',
  UPA: '울산항만공사',
  WISET: '한국여성과학기술인육성재단',
  YGPA: '여수광양항만공사',
};
function _guessOtherFromText(text) {
  for (const [code, kws] of Object.entries(_OTHER_DOMAIN_KEYWORDS)) {
    if (kws.some(k => text.includes(k))) return code;
  }
  return null;
}
const _otherSpCache = new Map();
async function resolveOtherLazy(code, onProgress) {
  if (_otherSpCache.has(code)) {
    return { text: _otherSpCache.get(code), source: 'cache' };
  }
  try {
    onProgress?.({ stage: 'other-fetch', code });
    const text = await _fetchText(`09-national/other/SP-NAT-OTHER-${code}_v1.1.md`);
    _otherSpCache.set(code, text);
    return { text, source: 'fetched' };
  } catch (e) {
    console.warn('[gov-router] resolveOtherLazy 실패, 기본 문구로 대체:', e?.message);
    const label = _OTHER_NAME_KO[code] || code;
    return {
      text: `[정보 없음] ${label} 관련 SP를 지금 불러오지 못했습니다 — 정부24(gov.kr) 또는 해당 기관 공식 홈페이지를 확인해 주세요.`,
      source: 'fallback',
    };
  }
}

function _guessQgovFromText(text) {
  for (const [code, kws] of Object.entries(_QGOV_DOMAIN_KEYWORDS)) {
    if (kws.some(k => text.includes(k))) return code;
  }
  return null;
}
const _qgovSpCache = new Map();
async function resolveQgovLazy(code, onProgress) {
  if (_qgovSpCache.has(code)) {
    return { text: _qgovSpCache.get(code), source: 'cache' };
  }
  try {
    onProgress?.({ stage: 'qgov-fetch', code });
    const text = await _fetchText(`09-national/qgov/SP-NAT-QGOV-${code}_v1.2.md`);
    _qgovSpCache.set(code, text);
    return { text, source: 'fetched' };
  } catch (e) {
    console.warn('[gov-router] resolveQgovLazy 실패, 기본 문구로 대체:', e?.message);
    const label = _QGOV_NAME_KO[code] || code;
    return {
      text: `[정보 없음] ${label} 관련 SP를 지금 불러오지 못했습니다 — 정부24(gov.kr) 또는 해당 기관 공식 홈페이지를 확인해 주세요.`,
      source: 'fallback',
    };
  }
}

const _policyBodySpCache = new Map();
async function resolvePolicyBodyLazy(code, onProgress) {
  if (_policyBodySpCache.has(code)) {
    return { text: _policyBodySpCache.get(code), source: 'cache' };
  }
  try {
    onProgress?.({ stage: 'policy-body-fetch', code });
    const text = await _fetchText(`09-national/policy-bodies/SP-NAT-POLICY-${code}_v1.1.md`);
    _policyBodySpCache.set(code, text);
    return { text, source: 'fetched' };
  } catch (e) {
    console.warn('[gov-router] resolvePolicyBodyLazy 실패, 기본 문구로 대체:', e?.message);
    const label = _POLICY_BODY_NAME_KO[code] || code;
    return {
      text: `${label} 관련 문의는 정부24(gov.kr) 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`,
      source: 'error_fallback',
    };
  }
}
// ── §6-1~8 division(실·국·과) 매칭 헬퍼 (2026-08-16 신설) ────────────
// 기관코드가 이미 확정된 뒤에만 호출한다(전역 검색 금지 원칙,
// national-division-router.js 참고). 동점(_scoreMatchTies)이거나 매칭
// 자체가 없으면 null을 반환해 호출부가 기존 resolvePolicyBodyLazy(본청)
// 폴백을 그대로 타도록 한다 — 새 실패 모드를 만들지 않는다.
async function _tryDivisionMatch(기관코드, text, onProgress) {
  try {
    const divisions = await getDivisionsForInstitution(기관코드, _fetchText);
    if (!divisions.length) return null;
    const { best, topScore, tied } = _scoreMatchTies(text, divisions);
    if (!best || topScore === 0 || tied.length > 1) return null; // 무매칭/동점은 폴백
    onProgress?.({ stage: 'policy-division-match', 기관코드, 부서코드: best.부서코드 });
    const resolved = await resolvePolicyDivisionLazy(기관코드, best.부서코드, _fetchText, onProgress);
    if (!resolved) return null;
    return { text: resolved.text, source: resolved.source, 부서코드: best.부서코드, name: best.name };
  } catch (e) {
    console.warn('[gov-router] _tryDivisionMatch 실패, 본청으로 폴백:', 기관코드, e?.message);
    return null;
  }
}
// 필드를 실제 라우팅 분기에 처음 연결하는 지점. SPECIAL_AUTONOMOUS(제주)
// 는 기초자치단체가 없어 세정이 도청 직할이 맞지만, GENERAL(그 외 전부)
// 은 세정이 시군구 소관이다 — 이 구분 없이 jeju L2 키워드를 그대로
// 복붙한 도(busan·seoul)의 실사 데이터가 사고실험에서 확인됐다.
const _MUNICIPAL_TAX_KEYWORDS = ['지방세', '취득세', '재산세', '자동차세', '세정'];  // ★ 2026-08-23 '자동차세' 추가(사고실험 발견)
function _isMunicipalTaxOnlyMatch(text, entry) {
  if (!entry || entry.code !== 'SP-DO-PLAN') return false;
  const matchedKw = entry.kw.filter(k => _kwMatch(text, k));
  if (matchedKw.length === 0) return false;
  return matchedKw.every(k => _MUNICIPAL_TAX_KEYWORDS.includes(k));
}

// ── 동점 감지 확장판 (2026-08-02) ────────────────────────────────
// 기존 _scoreMatch는 최고점 1개만 돌려줘서 "1등과 2등이 접전이었는지"
// 정보가 없었다. _scoreMatchTies가 그 정보(topScore, 동점 후보 전체)를
// 추가로 반환하고, _scoreMatch는 이제 이 함수의 얇은 래퍼로 남아 기존
// 호출부(도청 L2·시청 국 단위 등) 전부 하위호환된다 — 동작 변화 없음.
function _scoreMatchTies(text, table) {
  let bestScore = 0;
  let tied = [];
  for (const entry of table) {
    const score = entry.kw.filter(k => _kwMatch(text, k)).length;
    if (score === 0) continue;
    if (score > bestScore) { bestScore = score; tied = [entry]; }
    else if (score === bestScore) { tied.push(entry); }
  }
  return { best: tied[0] || null, topScore: bestScore, tied };
}

function _scoreMatch(text, table) {
  return _scoreMatchTies(text, table).best;
}

// ── SP-EMD-TEMPLATE 렌더링 (변수 치환) ──────────────────────────
// ★ 2026-08-04(v1.3 대응) — 부산 파일럿 중 이 템플릿이 제주 행정시
// 이원구조(제주시/서귀포시)에 구조적으로 결합돼 있던 걸 발견해 템플릿을
// 전국 일반화했다. 신규 변수(상위기관명·상위기관구분·관할구역구분·
// 관할구역목록·상수도소관기관·통합콜센터명·통합콜센터번호)를 추가하되,
// 구 필드(행정시명·관할리목록)도 rec에 남아있는 한 폴백으로 계속 지원한다
// — emd-master-data.json 43건은 2026-08-04에 신규 필드까지 이미 소급
// 반영됐지만, 향후 다른 도 레코드가 구 스키마로 들어올 가능성을 대비.
function _renderEmdTemplate(template, rec) {
  const teamRows = (rec.팀구성 || [])
    .map(t => `| ${t.팀} | ${t.업무} |`).join('\n');
  const linkedRows = (rec.접수전용업무 || [])
    .filter(x => x)
    .map(x => `| ${x.업무영역} | ${x.실질처리주체} | ${x.연결SP || '-'} |`).join('\n');

  const 상위기관명 = _fallbackIfTbd(rec.상위기관명, null) || rec.행정시명 || 'TBD — 재검증 필요';
  const 상위기관구분 = _fallbackIfTbd(rec.상위기관구분, null) || (rec.행정시명 ? '행정시' : 'TBD — 재검증 필요');
  const 관할구역구분 = rec.관할구역구분 || (['읍', '면'].includes(rec.읍면동구분) ? '법정리' : '법정동');
  const 관할구역목록 = (rec.관할구역목록 || rec.관할리목록 || []);

  return template
    .replaceAll('{읍면동명}', rec.읍면동명)
    .replaceAll('{상위기관명}', 상위기관명)
    .replaceAll('{상위기관구분}', 상위기관구분)
    .replaceAll('{행정시명}', 상위기관명) // 구 버전 템플릿(v1.2 이하) 호환용
    .replaceAll('{읍면동구분}', rec.읍면동구분)
    .replaceAll('{관할구역구분}', 관할구역구분)
    .replaceAll('{청사주소}', _fallbackIfTbd(rec.청사주소, 'TBD — 재검증 필요'))
    .replaceAll('{대표전화}', _fallbackIfTbd(rec.대표전화, 'TBD — 재검증 필요'))
    .replaceAll('{운영시간}', rec.운영시간 || '평일 09:00~18:00 (점심 12:00~13:00), 무인민원발급기 24시간')
    .replaceAll('{관할구역목록}', 관할구역목록.join(', '))
    .replaceAll('{관할리목록}', 관할구역목록.join(', ')) // 구 버전 템플릿 호환용
    .replaceAll('{주력산업}', rec.주력산업 || '')
    .replaceAll('{상수도소관기관}', _fallbackIfTbd(rec.상수도소관기관, 'TBD — 재검증 필요'))
    .replaceAll('{통합콜센터명}', _fallbackIfTbd(rec.통합콜센터명, 'TBD — 재검증 필요'))
    .replaceAll('{통합콜센터번호}', _fallbackIfTbd(rec.통합콜센터번호, 'TBD — 재검증 필요'))
    .replaceAll('{무인발급기위치}', _fallbackIfTbd(rec.무인발급기위치, 'TBD — 재검증 필요'))
    .replaceAll('{특이사항}', rec.특이사항 || '')
    + (teamRows ? `\n\n### 렌더링된 팀 구성\n| 팀 | 업무 |\n|---|---|\n${teamRows}` : '')
    + (linkedRows ? `\n\n### 렌더링된 연계 업무\n| 업무영역 | 실질 처리 주체 | 연결 SP |\n|---|---|---|\n${linkedRows}` : '');
}

// ── 도(道) 부서 템플릿 렌더링 (2026-07-04, EMD 템플릿과 동일 패턴) ──
// JEJU_L2_TABLE(또는 도별 테이블) 항목에 domain/도코드가 있으면 템플릿+데이터로 렌더링하고,
// 없으면(아직 이전 안 된 나머지 12개 부서) 기존 static file을 그대로
// fetch한다 — 한 번에 다 바꾸지 않고 부서 단위로 점진 이전하기 위함.
let _deptMasterData = null;
async function _loadDeptMasterData() {
  if (_deptMasterData) return _deptMasterData;
  const raw = await _fetchText('02-do-dept/templates/do-dept-master-data.json');
  _deptMasterData = JSON.parse(raw).부서목록;
  return _deptMasterData;
}

// 2026-07-19 신설 — city-dept는 지금까지 do-dept와 달리 별도 로더가 없었다
// (템플릿 렌더링 경로 자체가 아직 do-dept만큼 이전 안 됨). G18
// (STAFF_REVIEW_GATE) 연락처 조회에는 필요해서 최소한으로 추가.
let _cityDeptMasterData = null;
async function _loadCityDeptMasterData() {
  if (_cityDeptMasterData) return _cityDeptMasterData;
  const raw = await _fetchText('04-city/templates/city-dept-master-data.json');
  _cityDeptMasterData = JSON.parse(raw).국목록;
  return _cityDeptMasterData;
}

// ── G18(STAFF_REVIEW_GATE) 연락처 조회 (2026-07-19 신설) ──────────────
// LLM이 [STAFF_REVIEW_GATE: handler_code=...] 태그에 채워 넣는 값은
// 도메인 코드(welfare)·부서 한글명(복지가족국)·SP 코드(SP-DO-WELFARE)
// 중 무엇이든 될 수 있다 — 아직 이 셋을 하나로 강제하는 프롬프트 지시가
// 없으므로(§CAPABILITIES 뒤 삽입 문구가 예시를 안 줌), 셋 다 느슨하게
// 매칭한다. 매칭 실패 시 null — 호출부가 일반 안내 문구로 폴백해야 함.
export async function findStaffContact(handlerCode) {
  if (!handlerCode) return null;
  const norm = String(handlerCode).trim().toLowerCase();
  const hit = (...candidates) => candidates.some(c => {
    if (!c) return false;
    const cs = String(c).toLowerCase();
    return norm.includes(cs) || cs.includes(norm);
  });

  const [deptRecords, cityRecords, emdRecords] = await Promise.all([
    _loadDeptMasterData().catch(() => []),
    _loadCityDeptMasterData().catch(() => []),
    _loadEmdRecords().catch(() => []),
  ]);

  // 1순위 — 정확한 trace 코드 형식(resolveHandlerCodeFromTrace가 넘겨주는 값).
  // SP-DO-{DOMAIN}: 접두어 제거 후 domain과 대소문자 무관 정확히 일치.
  const doMatch = /^SP-DO-([A-Z]+)$/.exec(String(handlerCode).toUpperCase());
  if (doMatch) {
    const dept = deptRecords.find(r => String(r.domain || '').toUpperCase() === doMatch[1]);
    if (dept) return { name: dept.부서명, phone: dept.콜센터번호, hours: dept.콜센터운영시간 };
  }
  // SP-EMD-{읍면동명}: 접두어 제거 후 읍면동명과 정확히 일치.
  const emdMatch1 = /^SP-EMD-(.+)$/.exec(String(handlerCode));
  if (emdMatch1) {
    const emd = emdRecords.find(r => r.읍면동명 === emdMatch1[1]);
    if (emd) return { name: emd.읍면동명, phone: emd.대표전화, hours: emd.운영시간 };
  }
  // SP-CITY-{JEJU|SEOGWIPO}: 시코드로 city-dept 레코드 중 아무 국이나(대표
  // 연락처 성격) 우선 매칭 — city-dept-master-data.json은 국 단위라
  // "시 전체 대표 연락처"가 별도로 없으면 첫 매칭 국으로 폴백.
  const cityMatch1 = /^SP-CITY-(JEJU|SEOGWIPO)$/.exec(String(handlerCode).toUpperCase());
  if (cityMatch1) {
    const cityCodeMap = { JEJU: 'jejusi', SEOGWIPO: 'seogwipo' };
    const city = cityRecords.find(r => r.시코드 === cityCodeMap[cityMatch1[1]]);
    if (city) return { name: `${city.시이름 || ''} ${city.국이름 || ''}`.trim(), phone: city.콜센터번호, hours: city.콜센터운영시간 };
  }

  // 2순위 — LLM이 자유 서술한 값(한글 부서명 등) 대비 느슨한 매칭 폴백.
  const dept = deptRecords.find(r => hit(r.domain, r.부서명, `SP-DO-${String(r.domain || '').toUpperCase()}`));
  if (dept) return { name: dept.부서명, phone: dept.콜센터번호, hours: dept.콜센터운영시간 };

  const city = cityRecords.find(r => hit(r.국이름, r.시이름));
  if (city) return { name: `${city.시이름 || ''} ${city.국이름 || ''}`.trim(), phone: city.콜센터번호, hours: city.콜센터운영시간 };

  const emd = emdRecords.find(r => hit(r.읍면동명));
  if (emd) return { name: emd.읍면동명, phone: emd.대표전화, hours: emd.운영시간 };

  return null;
}

// 도청 국(局) 기본 라벨 — 2026-07-24 신설(주피터 지시: 시청 계층 원칙을
// 도청에도 확장). CITY_DEPT_DEFAULT_LABEL과 동일 철학 — 실사로 확인된
// 실명이 없어도 이 라벨로 즉시 응답 가능하다.
const DEPT_DEFAULT_LABEL = {
  plan: '기획(조정)담당부서', safety: '안전관리담당부서', jachi: '자치행정담당부서',
  econ: '경제정책담당부서', innov: '산업혁신담당부서', welfare: '복지정책담당부서',
  climate: '환경정책담당부서', housing: '건설주택담당부서', transport: '교통정책담당부서',
  culture: '문화체육담당부서', sports: '체육담당부서', tourism: '관광정책담당부서',
  agri: '농정담당부서', ocean: '해양수산담당부서', health: '보건정책담당부서',
  family: '여성가족담당부서',
};

function _renderDeptTemplate(template, rec, domain) {
  const 부서명 = rec.부서명 || DEPT_DEFAULT_LABEL[domain] || '담당부서';
  return template
    .replaceAll('{도이름}', rec.도이름 || '')
    .replaceAll('{부서명}', 부서명)
    .replaceAll('{구명칭_문구}', rec.구명칭_문구 || '')
    .replaceAll('{산하과목록}', rec.산하과목록 || '(정식 명칭 확인 중 — 도청 콜센터로 확인 권장)')
    .replaceAll('{콜센터명}', rec.콜센터명 || '')
    .replaceAll('{콜센터번호}', rec.콜센터번호 || '')
    .replaceAll('{콜센터운영시간}', rec.콜센터운영시간 || '')
    // 2026-07-04 추가: §3 산하 출자·출연기관명 파라미터화(4개 도메인만 해당,
    // 나머지 도메인 템플릿엔 해당 자리표시자 자체가 없어 replaceAll이 무해하게 no-op)
    .replaceAll('{평생교육기관명}', rec.평생교육기관명 || '')
    .replaceAll('{신용보증기관명}', rec.신용보증기관명 || '')
    .replaceAll('{일자리기관명}', rec.일자리기관명 || '')
    .replaceAll('{경제진흥기관명}', rec.경제진흥기관명 || '')
    .replaceAll('{에너지공기업명}', rec.에너지공기업명 || '')
    .replaceAll('{관광공사명}', rec.관광공사명 || '')
    .replaceAll('{GOV_COMMON}', 'JEJU-GOV-COMMON')
    .replaceAll('{DO_ROOT_SP}', 'SP-DO-000');
}

// ── 인허가류 사무 프로토콜 강제삽입 (2026-07-23 신설) ────────────────
// 주피터 지시(건축법 제14조 건축신고 사고실험): 부서 SP 본문이
// PERMIT-CRITERIA-PROTOCOL을 참조하는 문구를 빠뜨려도 적용되도록,
// 강제 지점을 부서 SP 텍스트가 아니라 이 라우터(코드) 단에 둔다 —
// §LEGAL-BASIS 상속 규칙과 동일한 SSOT 원칙. rec.처리사무 필드가
// 비어있으면 이 함수는 아무 것도 하지 않는다(대다수 부서는 아직
// 이 필드가 없음 — 데이터 채우기는 별도 작업).
let _permitProtocolCache = null;
async function _loadPermitProtocol() {
  if (!_permitProtocolCache) {
    _permitProtocolCache = await _fetchText('08-schema/PERMIT-CRITERIA-PROTOCOL_v1_0.md');
  }
  return _permitProtocolCache;
}

async function _appendPermitProtocolIfNeeded(text, rec) {
  const codes = (rec && Array.isArray(rec.처리사무)) ? rec.처리사무.filter(Boolean) : [];
  if (codes.length === 0) return { text, permitCodes: [] };
  const protocol = await _loadPermitProtocol();
  return { text: text + '\n\n---\n\n' + protocol, permitCodes: codes };
}

async function _fetchDeptText(entry) {
  if (!entry.domain || !entry.도코드) return { text: await _fetchText(entry.file, _currentProvinceRepo()), permitCodes: [] };
  const records = await _loadDeptMasterData();
  const rec = records.find(r => r.domain === entry.domain && r.도코드 === entry.도코드) || {};
  const templateRelPath = rec.template
    ? `02-do-dept/templates/${rec.template}`
    : `02-do-dept/templates/SP-DEPT-${entry.domain.toUpperCase()}-TEMPLATE_v1.0.md`;
  // 2026-07-24 신설(주피터 지시) — 예전엔 rec나 rec.template이 없으면
  // static file(entry.file, 대개 비어있거나 없음)로 폴백해 사실상 빈
  // 응답이 나갔다. 이제 rec.template이 없어도(실사 전) entry.domain은
  // 알고 있으니 원형 클래스 템플릿(SP-DEPT-{DOMAIN}-TEMPLATE_v1.0.md)을
  // 기본 라벨로 즉시 렌더링한다 — 시청 계층과 동일 원칙. rec 자체는
  // template 필드가 없어도(예: 콜센터·처리사무만 있는 부분 레코드) 그대로
  // 살려서 넘긴다(레코드를 통째로 버리면 처리사무 등 다른 필드가
  // 유실된다 — 2026-07-24 회귀 발견·수정).
  try {
    const template = await _fetchText(templateRelPath);
    return _appendPermitProtocolIfNeeded(_renderDeptTemplate(template, rec, entry.domain), rec);
  } catch (e) {
    console.warn(`[Jeju] 부서 템플릿 로드 실패(domain=${entry.domain}, 도코드=${entry.도코드}) — static file로 폴백: ${e.message}`);
    return _appendPermitProtocolIfNeeded(await _fetchText(entry.file, _currentProvinceRepo()), rec);
  }
}

// ── 국가기관(중앙정부 지역사무소) 템플릿 렌더링 (2026-07-04, 도 부서
// 템플릿과 동일 철학) — 소속 부처·정책 지식은 전국 공통 고정 텍스트,
// province별로 달라지는 건 관할 지역사무소 명칭(지사명)뿐이라 이것만
// 자리표시자로 뺀다. COURT처럼 지사 대표전화가 본문에 하드코딩된 예외
// 케이스는 개별 필드(대표전화)로 추가 파라미터화했다. ────────────────
let _natMasterData = null;
async function _loadNatMasterData() {
  if (_natMasterData) return _natMasterData;
  const raw = await _fetchText('09-national/agencies/templates/national-agency-master-data.json');
  _natMasterData = JSON.parse(raw).기관목록;
  return _natMasterData;
}

function _renderNatTemplate(template, rec) {
  return template
    .replaceAll('{지사명}', rec.지사명 || '')
    .replaceAll('{대표전화}', rec.대표전화 || '');
}

// entry: JEJU_NATIONAL_TABLE(또는 도별 국가기관 테이블) 항목. domain+도코드가 있으면 템플릿을 렌더링해
// 반환하고, 없으면 기존처럼 static file을 그대로 반환(_fetchDeptText와
// 동일한 폴백 철학).
const _NAT_NO_INFO_FALLBACK = (code) =>
  `[정보 없음] ${code} 관련 상세 안내를 아직 준비하지 못했습니다. ` +
  `정부24(gov.kr) 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`;

// ── 2026-08-09 신설 — 도 하나에 지사가 여럿인 국가기관 도메인(tax·court의
// seoul/gyeonggi 등) 대응. 지금까지는 domain+도코드로 .find()해 항상 첫
// 레코드만 반환했는데, 그러면 도 하나에 지사가 여럿 있을 때 실제로는
// 틀릴 수 있는 지사 하나를 임의로 확정해 말하는 위험이 있었다(2026-08-08
// 완도해양경찰서 오매칭 사례로 실측 확인된 바로 그 실수). 레코드가 도
// 하나에 2건 이상이면 각 레코드의 선택 필드 `시코드목록`으로 좁히고,
// 시/군 정보가 없거나 매칭이 안 되면 틀린 확신 대신 정직하게 "어느
// 시/군/구인지" 되묻는다 — 도코드당 1건뿐인 기존 도메인은 동작 변화 없음.
function _NAT_MULTI_BRANCH_PROMPT(entry, branches) {
  const names = [...new Set(branches.map(r => r.지사명))];
  return `[관할 확인 필요] 이 지역에는 관련 기관이 ${names.length}곳 있습니다(${names.join(', ')}). ` +
    `정확한 안내를 위해 거주(또는 문의 대상) 시/군/구를 알려주세요.`;
}

async function _fetchNatText(entry, 시코드 = null) {
  if (!entry.domain || !entry.도코드) {
    if (!entry.file) return { text: _NAT_NO_INFO_FALLBACK(entry.code), permitCodes: [] };
    return { text: await _fetchText(entry.file, _currentProvinceRepo()), permitCodes: [] };
  }
  const records = await _loadNatMasterData();
  const domainProvinceRecords = records.filter(r => r.domain === entry.domain && r.도코드 === entry.도코드);
  let rec = domainProvinceRecords[0];
  if (domainProvinceRecords.length > 1) {
    rec = 시코드
      ? domainProvinceRecords.find(r => Array.isArray(r.시코드목록) && r.시코드목록.includes(시코드))
      : null;
    if (!rec) {
      return { text: _NAT_MULTI_BRANCH_PROMPT(entry, domainProvinceRecords), permitCodes: [] };
    }
  }
  if (!rec || !rec.template) {
    console.warn(`[Jeju] 국가기관 데이터 레코드/템플릿 없음(domain=${entry.domain}, 도코드=${entry.도코드})`);
    if (!entry.file) return { text: _NAT_NO_INFO_FALLBACK(entry.code), permitCodes: [] };
    return _appendPermitProtocolIfNeeded(await _fetchText(entry.file, _currentProvinceRepo()), rec);
  }
  // ★ 2026-07-21 수정(버그4) — rec.template 필드값은 있는데 그 파일이
  // 실제로 저장소에 없는 경우(예: SP-NAT-TAX-TEMPLATE_v1.0.md 404)를
  // 못 잡고 그대로 throw해 응답 전체가 깨지던 버그(50개 사고실험 D1·D6
  // 에서 세무서·병무청 둘 다 실제로 재현). 템플릿 fetch를 try/catch로
  // 감싸 static file → 그것도 실패하면 정직한 정보없음으로 단계적
  // 폴백한다.
  // ★ 2026-08-02(2차 감사) — entry.file 폴백 단계 자체를 정리했다.
  // JEJU_NATIONAL_TABLE의 34개 entry.file 전부가 저장소에 실존하지
  // 않는 경로였다(09-national/agencies/ 아래엔 templates/ 서브디렉터리만
  // 있고 평평한 static 파일은 애초에 만들어진 적이 없다). 항상 실패하는
  // fetch를 시도했다가 잡는 죽은 코드였으므로, entry.file이 없을 때는
  // 그 단계를 건너뛰고 바로 정직한 정보없음으로 간다.
  try {
    const template = await _fetchText(`09-national/agencies/templates/${rec.template}`);
    return _appendPermitProtocolIfNeeded(_renderNatTemplate(template, rec), rec);
  } catch (e) {
    console.warn(`[gov-router] 국가기관 템플릿 파일 없음(${rec.template}): ${e.message}`);
    if (!entry.file) return { text: _NAT_NO_INFO_FALLBACK(entry.code), permitCodes: [] };
    try {
      return _appendPermitProtocolIfNeeded(await _fetchText(entry.file, _currentProvinceRepo()), rec);
    } catch (e2) {
      console.warn(`[gov-router] static 폴백도 실패(${entry.file}): ${e2.message} — 정직한 정보없음으로 대체`);
      return {
        text: _NAT_NO_INFO_FALLBACK(entry.code),
        permitCodes: [],
      };
    }
  }
}

// ── 시(市) 템플릿 렌더링 (2026-07-04, 도 부서 템플릿과 동일 철학이나
// 통치구조·상하수도 소관처럼 시마다 실제로 다른 서술까지 전부 데이터
// 필드로 뺀다 — 제주시·서귀포시조차 서로 다르다) ────────────────
let _cityMasterData = null;
async function _loadCityMasterData() {
  if (_cityMasterData) return _cityMasterData;
  const raw = await _fetchText('04-city/templates/city-master-data.json');
  _cityMasterData = JSON.parse(raw).시목록;
  return _cityMasterData;
}

function _renderCityTemplate(template, rec) {
  return template
    .replaceAll('{시이름}', rec.시이름 || '')
    .replaceAll('{통치구조_문구}', rec.통치구조_문구 || '')
    .replaceAll('{행정구역구성_문구}', rec.행정구역구성_문구 || '')
    .replaceAll('{관할읍면동목록}', rec.관할읍면동목록 || '')
    .replaceAll('{상하수도_capability_문구}', rec.상하수도_capability_문구 || '')
    .replaceAll('{상하수도_설명_문구}', rec.상하수도_설명_문구 || '')
    .replaceAll('{상하수도_예외_문구}', rec.상하수도_예외_문구 || '')
    .replaceAll('{유의사항_추가}', rec.유의사항_추가 || '')
    .replaceAll('{하위SP_접두어}', rec.하위SP_접두어 || '')
    .replaceAll('{GOV_COMMON}', 'JEJU-GOV-COMMON')
    .replaceAll('{DO_ROOT_SP}', 'SP-DO-000');
}

async function _fetchCityText(entry) {
  if (!entry.도코드 || !entry.시코드) return _fetchText(entry.file, _currentProvinceRepo());
  const records = await _loadCityMasterData();
  const rec = records.find(r => r.도코드 === entry.도코드 && r.시코드 === entry.시코드);
  if (!rec) {
    console.warn(`[Jeju] 시 데이터 레코드 없음(도코드=${entry.도코드}, 시코드=${entry.시코드}) — static file로 폴백`);
    return _fetchText(entry.file, _currentProvinceRepo());
  }
  const template = await _fetchText('04-city/templates/SP-CITY-TEMPLATE_v1.0.md');
  return _renderCityTemplate(template, rec);
}

// ── 시청 국(局) 렌더링·fetch ──────────────────────────────────────
// 2026-07-23 신설, 2026-07-24 개편(주피터 지시) — 단일 SP-CITYDEPT-TEMPLATE
// 1개를 쓰던 방식에서, 도청(SP-DEPT-*-TEMPLATE 16개)과 동일하게 **국코드별
// 추상 템플릿**(SP-CITYDEPT-{DOMAIN}-TEMPLATE_v1.0.md, §LEGAL-BASIS에 도메인별
// 개별 소관법 명시)을 쓰도록 바꿨다 — rec.template 필드로 선택.
// 실제 조직명(국이름)을 몰라도 DEFAULT_DEPT_LABEL로 즉시 렌더링 가능(주피터
// 지시: "개별 기관의 부서 명칭이 무엇이든 중요하지 않다") — city-dept-master-data.json
// 레코드에 없으면 상위 시청 텍스트만으로 폴백(호출부가 이미 시청 텍스트를
// parts에 넣은 뒤이므로, 여기서는 추가 텍스트 없이 조용히 스킵).

// 국코드별 기본 표시 라벨 — 실사로 확인된 실명이 아직 없는 인스턴스가
// "정식 명칭 확인 중" 상태로도 즉시 응답 가능하게 한다(SP-CITYDEPT-*-TEMPLATE
// 생성 스크립트의 dept_generic과 1:1 대응, 04-city/templates/에서 재생성 시
// 함께 갱신할 것).
const CITY_DEPT_DEFAULT_LABEL = {
  plan: '기획(예산)담당부서', safety: '안전총괄담당부서', jachi: '자치행정담당부서',
  econ: '지역경제담당부서', innov: '미래산업담당부서', welfare: '사회복지담당부서',
  climate: '환경관리담당부서', housing: '건설(주택)담당부서', transport: '교통행정담당부서',
  culture: '문화체육담당부서', sports: '체육담당부서', tourism: '관광담당부서',
  agri: '농축산담당부서', ocean: '해양수산담당부서', health: '보건소', family: '여성가족담당부서',
};

// 지자체유형별 기본 처분권 문구 — rec.처분권_문구가 있으면 그걸 우선하고,
// 없으면 rec.지자체유형으로 이 표에서 기본값을 고른다(둘 다 없으면 '일반시'
// 취급 — 처분권 있음 쪽을 기본값으로 두는 게 "일반구인데 자치구로 오안내"
// 보다 안전 — 반대 방향 오류(자치구인데 일반구로 안내)는 사용자가 시청으로
// 잘못 이첩되어도 최종적으로는 처리되지만, 반대는 "이 구가 처리 못 한다"는
// 잘못된 안내가 나갈 수 있어 비대칭적으로 위험하다).
const CITY_TYPE_DISPOSITION_DEFAULT = {
  일반시: '이 부서가 직접 처분청이다 — 정식 신청·심사를 통해 확정.',
  특례시: '이 부서가 직접 처분청이다(특례시 조항에 따라 일부 도메인은 광역시급 권한 포함) — 정식 신청·심사를 통해 확정.',
  자치구: '이 부서가 직접 처분청이다 — 정식 신청·심사를 통해 확정.',
  군: '이 부서가 직접 처분청이다 — 정식 신청·심사를 통해 확정.',
  행정시: '이 부서가 직접 처분청이다(행정시 체계 — 도지사 임명 시장 하의 국·과) — 정식 신청·심사를 통해 확정.',
  일반구: '수행 불가 — 이 구는 법인격이 없어 처분권자가 아니다. 실제 처분청은 모시(母市) 시장이며, 이 부서는 접수·안내 창구 기능만 수행한다.',
};

function _renderCityDeptTemplate(template, rec, cityRootSPCode) {
  const 국이름 = rec.국이름 || CITY_DEPT_DEFAULT_LABEL[rec.국코드] || '담당부서';
  const 처분권_문구 = rec.처분권_문구 || CITY_TYPE_DISPOSITION_DEFAULT[rec.지자체유형] || CITY_TYPE_DISPOSITION_DEFAULT.일반시;
  return template
    .replaceAll('{시이름}', rec.시이름 || '')
    .replaceAll('{국이름}', 국이름)
    .replaceAll('{지자체유형}', rec.지자체유형 || '일반시')
    .replaceAll('{처분권_문구}', 처분권_문구)
    .replaceAll('{입력_문구}', rec.입력_문구 || '')
    .replaceAll('{출력_문구}', rec.출력_문구 || '')
    .replaceAll('{처분성_문구}', rec.처분성_문구 || '')
    .replaceAll('{산하과목록}', rec.산하과목록 || '(정식 명칭 확인 중 — 콜센터로 확인 권장)')
    .replaceAll('{콜센터명}', rec.콜센터명 || '')
    .replaceAll('{콜센터번호}', rec.콜센터번호 || '')
    .replaceAll('{콜센터운영시간}', rec.콜센터운영시간 || '')
    .replaceAll('{GOV_COMMON}', 'JEJU-GOV-COMMON')
    .replaceAll('{DO_ROOT_SP}', 'SP-DO-000')
    .replaceAll('{CITY_ROOT_SP}', cityRootSPCode);
}

// 시/군/구 루트 SP 코드 도출 — 예전엔 jejusi/seogwipo 두 곳만 하드코딩된
// 삼항연산자였다(다른 시코드가 오면 전부 SEOGWIPO로 잘못 귀속되는 버그,
// 2026-07-24 발견). city-master-data.json에 SP코드 필드가 있으면 그걸
// 쓰고, 없으면 `SP-CITY-{시코드 대문자}` 관례값으로 즉시 생성한다 —
// 이래야 실사 없이도(주피터 지시 원칙) 새 시/군/구가 바로 작동한다.
async function _resolveCityRootSPCode(시코드) {
  try {
    const records = await _loadCityMasterData();
    const rec = records.find(r => r.시코드 === 시코드);
    if (rec?.SP코드) return rec.SP코드;
  } catch (e) {
    console.warn('[gov-router] city-master-data 조회 실패(관례값으로 대체):', e?.message);
  }
  return `SP-CITY-${String(시코드 || '').toUpperCase()}`;
}

async function _fetchCityDeptText(match, taskText = '') {
  // ★ 2026-08-05 신설 — §5-2 데이터소스 우선순위: PocketBase 정본을 먼저
  // 확인하고(§4-1에서 저작된 실시간 인스턴스가 있으면 그걸 그대로 쓴다),
  // 없으면 기존 JSON 경로로 폴백한다. 이 조회는 네트워크 실패에도 안전
  // (null 반환)하므로 아래 기존 로직에 영향을 주지 않는다.
  const govTreeKey = {
    tier: 'city-dept', 도코드: _resolveProvinceCode(), 시코드: match.시코드, 국코드: match.국코드,
  };
  const pbHit = await _fetchGovTreeInstancePocketBase(govTreeKey);
  if (pbHit) {
    return { text: pbHit.generated_content, permitCodes: [] };
  }

  const records = await _loadCityDeptMasterData();
  const rec = records.find(r => r.시코드 === match.시코드 && r.국코드 === match.국코드);
  const classification = _classifyCityDeptInstance(rec);
  if (classification !== 'REAL') {
    // 지금 이 사용자에게는 아래 기존 로직대로(스텁이면 스텁 내용을, 완전
    // 누락이면 null을) 그대로 응답하고, 백그라운드로만 미스 신호를 쏜다.
    _reportGovTreeInstanceMiss(govTreeKey, taskText);
  }
  if (!rec) {
    console.warn(`[gov-router] 시청 국 데이터 레코드 없음(시코드=${match.시코드}, 국코드=${match.국코드}) — 스킵`);
    return { text: null, permitCodes: [] };
  }
  const templateFile = rec.template || 'SP-CITYDEPT-TEMPLATE_v1.0.md';
  // 일반구처럼 법인격이 없어 자체 루트 SP가 없는 인스턴스는 rec.모시코드로
  // 상위(모시) 시코드를 지정한다 — {CITY_ROOT_SP}가 그 상위 시로 귀속된다
  // (2026-07-24 신설, 창원시 산하 5개 일반구 파일럿에서 처음 필요해짐).
  const [template, cityRootSPCode] = await Promise.all([
    _fetchText(`04-city/templates/${templateFile}`),
    _resolveCityRootSPCode(rec.모시코드 || match.시코드),
  ]);
  return _appendPermitProtocolIfNeeded(_renderCityDeptTemplate(template, rec, cityRootSPCode), rec);
}

// ── 과(division) 텍스트 fetch — 실사(제주)와 제네릭(비제주)을 함께 처리
// (2026-08-21 신설, 2026-08-22 재복원 2회차) ─────────────────────────
async function _fetchCityDivisionText(divEntry, cityDeptRec) {
  if (!divEntry.generic) {
    return _fetchText(divEntry.file, _currentProvinceRepo());
  }
  const template = await _fetchText(divEntry.file);
  return template
    .replaceAll('{GOV_COMMON}', '도청 공통')
    .replaceAll('{DO_ROOT_SP}', '도청 실국')
    .replaceAll('{CITY_ROOT_SP}', '시청')
    .replaceAll('{CITY_DEPT_ROOT_SP}', '시청 국')
    .replaceAll('{시이름}', cityDeptRec?.시이름 || '')
    .replaceAll('{국이름}', cityDeptRec?.국이름 || CITY_DEPT_DEFAULT_LABEL[divEntry.국코드] || '담당부서')
    .replaceAll('{콜센터명}', cityDeptRec?.콜센터명 || '')
    .replaceAll('{콜센터번호}', cityDeptRec?.콜센터번호 || '')
    .replaceAll('{콜센터운영시간}', cityDeptRec?.콜센터운영시간 || '');
}

// ── 응급 즉시 처리 (사고실험 2차 §3 권고 — 최우선, 다른 어떤 매칭보다 먼저) ──
// 분류 LLM 호출조차 기다리게 하면 안 되는 영역이라 순수 정규식으로만 판단하고,
// 애매하면 응급 쪽으로 분류한다(오탐 비용 < 누락 비용, SP-EXP-EMERGENCY §6).
const EMERGENCY_RE = /불\s*이?\s*났|불났|화재|가스.{0,4}(냄새|새는|누출|샌다)|쓰러지|심정지|의식.{0,3}없|숨.{0,3}(안\s*쉬|못\s*쉬)|피.{0,6}흘리|물에\s*빠|익수|침수|물이\s*차오|바다.{0,10}(안\s*보여|사라)|실종|없어졌어요|길을\s*잃|협박|스토킹|납치|칼을\s*들고|흉기|자해|자살|치인|치였|교통사고|지진|흔들려요|무너질|무너지|붕괴|침입했|낯선\s*사람.{0,6}(들어|침입)/;

// ★ 2026-07-23 신설(100건 사고실험에서 발견, 주피터 지시) — '화재'가
// "평화재단"·"문화재"·"화재보험" 같은 무관한 복합어에 부분문자열로
// 걸려 응급 최우선 게이트가 오탐하는 문제. _SIGUNGU_FALSE_POSITIVE_WORDS와
// 동일한 철학 — 알려진 비응급 복합어를 검사 전에 먼저 제거한다.
// "애매하면 응급으로 분류"(오탐 비용 < 누락 비용) 원칙은 진짜 애매한
// 경우를 위한 것이지, 이렇게 명백히 무관한 단어까지 덮으라는 뜻은 아니다.
const _EMERGENCY_FALSE_POSITIVE_WORDS = [
  '평화재단', '문화재', '화재보험', '화재예방', '화재안전', '방화재', '내화재',
  '교통사고사실확인원', '교통사고 사실확인원', '교통사고확인원', '교통사고 확인원',
  // ★ 2026-08-23 추가(6차 사고실험 발견) — "실종 예방을 위한 사전등록
  // 확인서"는 실종 신고가 아니라 아동 등 실종 예방을 위해 미리 등록해
  // 두는 제도의 확인서 발급 요청. '실종'만 지우면 진짜 실종 신고의
  // 잔여 문자열이 다른 패턴과 오매칭될 수 있어 서류명 전체를 지운다.
  // ※ 이 화이트리스트 방식 자체가 whack-a-mole 구조라는 근본 문제를
  // 사용자에게 별도 보고함(일반화 규칙은 안전 관련이라 확인 후 진행).
  '실종 예방을 위한 사전등록', '실종 예방 사전등록', '실종예방 사전등록',
];

function _isEmergency(text) {
  let cleaned = text;
  for (const w of _EMERGENCY_FALSE_POSITIVE_WORDS) cleaned = cleaned.split(w).join('');
  return EMERGENCY_RE.test(cleaned);
}

// ── PDV_HISTORY_REQUEST(§13b) scope 결정 테이블 (2026-07-04d) ─────
// ★ scope 명명 원칙(전체 설명은 gopang/worker.js VALID_PDV_SCOPES 위 주석
// 참조): scope 이름에 지역명을 넣지 않는다 — 다른 지역도 같은 종류의
// 부서/기관을 가질 수 있으면 k 접두어 전국 scope로, 실제 구현 지역은
// worker.js SCOPE_SOURCE_MAP의 reporter_svc에만 반영한다. ★
// trace의 마지막 SP 코드를 이 표로 조회해 §13b 자리표시자를 치환한다.
// 국가기관 지사 26개(+ktax/kpolice)와 도 자체 부서 13개 전부 이 원칙에
// 따라 k 접두어(전국 scope)를 쓴다 — jeju는 그 scope들의 현재 유일한
// reporter_svc일 뿐이다.
const SP_CODE_TO_PDV_SCOPE = {
  // 국가기관 지사
  'SP-NAT-TAX': 'ktax', 'SP-NAT-POLICE': 'kpolice',
  'SP-NAT-COURT': 'kcourt', 'SP-NAT-NPS': 'knps', 'SP-NAT-NHIS': 'knhis',
  'SP-NAT-IMMIGRATION': 'kimmigration', 'SP-NAT-POST': 'kpost',
  'SP-NAT-LABOR': 'klabor', 'SP-NAT-PROSECUTION': 'kprosecution',
  'SP-NAT-COASTGUARD': 'kcoastguard', 'SP-NAT-WEATHER': 'kweather',
  'SP-NAT-PPS': 'kpps', 'SP-NAT-MMA': 'kmma', 'SP-NAT-VETERANS': 'kveterans',
  'SP-NAT-LABORREL': 'klaborrel', 'SP-NAT-PROBATION': 'kprobation',
  'SP-NAT-ANIMALQUARANTINE': 'kanimalquarantine', 'SP-NAT-HUMANQUARANTINE': 'khumanquarantine',
  'SP-NAT-AGROQUALITY': 'kagroquality', 'SP-NAT-FISHQUALITY': 'kfishquality',
  'SP-NAT-FOODIMPORT': 'kfoodimport', 'SP-NAT-DATA': 'kdata', 'SP-NAT-RADIO': 'kradio',
  'SP-NAT-ENV': 'kenv', 'SP-NAT-LABORIMPROVE': 'klaborimprove',
  'SP-NAT-INTERNET': 'kinternet', 'SP-NAT-AIRPORT': 'kairport', 'SP-NAT-PORT': 'kport',
  // ★ 2026-07-24 신설(100건 사고실험에서 발견) — 이걸 빠뜨리면 §13b
  // PDV_HISTORY_REQUEST scope 치환이 이 6개 기관 응답에서 안전한
  // 기본값('pdv_general')으로 조용히 대체돼, 다른 기관들과 달리 이
  // 기관 관련 과거 민원 이력을 못 불러오는 미묘한 버그가 생겼을 것이다.
  'SP-NAT-CUSTOMS': 'kcustoms', 'SP-NAT-BOK': 'kbok', 'SP-NAT-STAT': 'kstat',
  'SP-NAT-FORESTRESEARCH': 'kforestresearch', 'SP-NAT-FORESTSEED': 'kforestseed',
  'SP-NAT-FORESTCOOP': 'kforestcoop',
  // 도 자체 부서
  'SP-DO-PLAN': 'kplan', 'SP-DO-SAFETY': 'ksafety', 'SP-DO-JACHI': 'kjachi',
  'SP-DO-ECON': 'kecon', 'SP-DO-INNOV': 'kinnov', 'SP-DO-WELFARE': 'kwelfare',
  'SP-DO-CLIMATE': 'kclimate', 'SP-DO-HOUSING': 'khousing', 'SP-DO-TRANSPORT': 'ktransport',
  'SP-DO-CULTURE': 'kculture', 'SP-DO-TOURISM': 'ktourism', 'SP-DO-AGRI': 'kagri',
  'SP-DO-OCEAN': 'kocean',
  // 2026-08-02 신설 — 나머지 도 부서 13개와 동일 원칙.
  'SP-DO-COMM': 'kcomm', 'SP-DO-GENDER': 'kgender',
  'SP-DO-GENERAL': 'kgeneral', 'SP-DO-SPOKES': 'kspokes',
};
const _PDV_HISTORY_SCOPE_PLACEHOLDER_RE = /\{이 턴에 로드된 SP의 PDV scope\}/g;

// trace 배열에서 뒤에서부터 SP_CODE_TO_PDV_SCOPE에 등록된 코드를 찾는다
// (trace 끝쪽 요소일수록 더 구체적인 노드 — city/emd 코드는 지리 정보라
// 이 표에 없으므로 자연히 건너뛰고 그 앞의 부서/기관 코드를 찾게 된다).
function _resolvePdvScopeFromTrace(trace) {
  for (let i = trace.length - 1; i >= 0; i--) {
    if (SP_CODE_TO_PDV_SCOPE[trace[i]]) return SP_CODE_TO_PDV_SCOPE[trace[i]];
  }
  return 'pdv_general'; // 부서를 특정 못 한 경우(공통 레이어 응답 등)의 안전한 기본값
}


// ── 메인 진입점(내부용) ──────────────────────────────────────────
// userText: 사용자 발화(또는 GWP ctx로 넘어온 최초 요청 텍스트)
// pdvLocationHint: PDV에 저장된 거주 읍면동(있으면 우선 참조, JEJU-GOV-COMMON §2)
// 반환: { systemPrompt, trace } — trace는 디버깅/로그용 체인 경로
// 2026-07-04: export하던 함수를 내부용(_Raw)으로 이름 바꾸고, 실제 export는
// 아래의 얇은 래퍼가 담당한다 — §13b PDV_HISTORY_REQUEST 자리표시자 치환을
// 반환 지점이 8곳 넘게 흩어진 이 함수 내부를 전부 건드리지 않고 한 곳에서
// 처리하기 위함(호출부 입장에서 동작은 완전히 동일, 순수 후처리 wrapper).
async function _assembleGovSystemPromptRaw(userText, pdvLocationHint = null, classifyFn = null, onProgress = null, directCode = null) {
  // 2026-07-05: UNIVERSAL-INTEGRITY를 여기서 fetch/삽입하던 걸 제거했다.
  // jeju-router.js는 이제 /ai/chat이 아니라 /gov/relay를 호출하고,
  // handleGovRelay()가 UNIVERSAL-INTEGRITY + UNIVERSAL-common(U9 포함)을
  // 항상 최상단에 서버측에서 붙인다(SP-COMMON-05 H2 원칙 — 클라이언트가
  // 공통 규칙을 빠뜨리거나 조작할 여지를 구조적으로 없앤다). 이 함수가
  // 반환하는 systemPrompt는 이제 "agencyPrompt"(JEJU-GOV-COMMON 이하)에
  // 해당하는 부분만 담당한다.
  const text = userText || '';
  // ★ 2026-07-20 — 매 요청(턴)마다 발화 기반으로 도를 다시 판별한다.
  // _resolveProvinceCode()는 동기 함수라 여기서 미리 계산해둔다.
  // ★ 2026-07-21 — 발화에 지역 언급이 없으면 PDV 위치 힌트로 2차 판별
  // (주피터 지시: "제주시 한경면 소재 홍길동의 등본 발급은 한경면사무소
  // 소관" — PDV 위치를 활용하면 관할 기관을 쉽게 특정할 수 있다). 이전엔
  // 여기서 실패하면 _resolveProvinceCode()의 최후 안전망이 조용히
  // 'jeju'로 대체해 "판별 불가"가 아니라 "제주로 확신에 찬 오답"이
  // 나가는 문제가 사고실험으로 확인됐다 — 아래 -0.5단계에서 명시적으로
  // 끊는다.
  const [_sigunguListForGuess, _emdNameIndexForGuess] = await Promise.all([
    _loadSigunguListForProvinceGuess(),
    _loadEmdNameToProvinceIndex(),
  ]);
  _currentResolvedProvinceCode =
    _guessProvinceFromText(text, _sigunguListForGuess, _emdNameIndexForGuess)
    || (pdvLocationHint ? _guessProvinceFromText(pdvLocationHint, _sigunguListForGuess, _emdNameIndexForGuess) : null);
  const govCommon = await _loadGovCommon();
  const trace = ['JEJU-GOV-COMMON'];
  const parts = [govCommon].filter(Boolean);

  // -1) 응급 감지 — 다른 모든 매칭·분류보다 먼저, 무조건 최우선.
  if (_isEmergency(text)) {
    const emergencySp = await _fetchText('06-expert/SP-EXP-EMERGENCY_v1.0.md');
    parts.push(emergencySp);
    return {
      systemPrompt: parts.join('\n\n---\n\n'),
      trace: ['JEJU-GOV-COMMON', 'SP-EXP-EMERGENCY', '(응급 감지 — 최우선 즉시 처리)'],
    };
  }

  // -0.9) directCode 직접 지정 — K-Search 엔티티 매칭으로 기관이 이미
  // 확정된 경우(§ENTITY-LAUNCH, 2026-08-03 신설). 응급 감지 다음,
  // 텍스트 추측(-0.8 이하) 전부보다 먼저 온다 — 이미 정확한 답을
  // 아는데 다시 추측할 이유가 없다.
  // ★ 2026-08-03(2차) — policy 다음으로 나머지 5개 tier(do-dept/do-agency/
  // org/city-dept/nat-agency) 연결. 이 5개는 policy와 달리 도(道) 범위
  // 테이블이라 _l2Table()/_agencyTable()/_orgTable()/_cityDeptTable()가
  // _resolveProvinceCode()에 의존한다 — directCode 자체가 "이미 제주
  // 기관으로 확정됐다"는 신호이므로, 텍스트/PDV 기반 도 추측 결과와
  // 무관하게 _currentResolvedProvinceCode를 'jeju'로 강제한다(텍스트에
  // 지역 단서가 전혀 없어 추측이 null이 되는 경우에도 directCode가
  // 있으면 안전하게 해석되도록).
  if (directCode) {
    const sep = String(directCode).indexOf(':');
    const tier = sep >= 0 ? directCode.slice(0, sep) : directCode;
    const code = sep >= 0 ? directCode.slice(sep + 1) : '';
    if (tier === 'policy' && code) {
      const nationalSp = await _loadNationalSp();
      parts.push(nationalSp);
      trace.push('JEJU-NATIONAL-SP');
      const resolved = await resolvePolicyBodyLazy(code, onProgress);
      parts.push(resolved.text);
      trace.push(`SP-POLICY-LAZY(${code}/${resolved.source}, directCode)`);
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    // ★ 2026-09-04 신설 — qgov/enterprise/other 3개 tier 추가. 함수
    // (resolveQgovLazy/resolveEnterpriseLazy/resolveOtherLazy)는 이미
    // 있었는데 directCode 분기가 policy tier만 있고 이 셋은 빠져 있어서
    // 자연어로만 닿고 링크로 직행이 안 됐다(전문가 페르소나 카탈로그와
    // 동일한 방식의 K-정부 카탈로그 제작 중 발견) — policy tier와 완전히
    // 동일한 패턴으로 3개를 추가한다.
    if (tier === 'qgov' && code) {
      const nationalSp = await _loadNationalSp();
      parts.push(nationalSp);
      trace.push('JEJU-NATIONAL-SP');
      const resolved = await resolveQgovLazy(code, onProgress);
      parts.push(resolved.text);
      trace.push(`SP-QGOV-LAZY(${code}/${resolved.source}, directCode)`);
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    if (tier === 'enterprise' && code) {
      const nationalSp = await _loadNationalSp();
      parts.push(nationalSp);
      trace.push('JEJU-NATIONAL-SP');
      const resolved = await resolveEnterpriseLazy(code, onProgress);
      parts.push(resolved.text);
      trace.push(`SP-ENT-LAZY(${code}/${resolved.source}, directCode)`);
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    if (tier === 'other' && code) {
      const nationalSp = await _loadNationalSp();
      parts.push(nationalSp);
      trace.push('JEJU-NATIONAL-SP');
      const resolved = await resolveOtherLazy(code, onProgress);
      parts.push(resolved.text);
      trace.push(`SP-OTHER-LAZY(${code}/${resolved.source}, directCode)`);
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    if (tier === 'do-dept' && code) {
      // ★ 2026-09-05 수정 — code에 "{도코드}:{실제코드}" 형식으로 도를
      // 명시할 수 있게 확장. 여러 도가 같은 도메인 코드(예: SP-DO-PLAN)를
      // 공유하기 때문에, 도를 안 정하면 _findEntryAcrossProvinces가 항상
      // 첫 번째로 매칭되는 도(제주)로만 연결되는 문제가 있었다(K-정부
      // 카탈로그에서 서울 등 다른 도 부서를 직접 링크하려다 사고실험으로
      // 발견). 도가 명시되면 그 도 테이블만 보고, 안 되면 기존 동작(전체
      // 도 검색) 그대로 유지해 하위 호환한다.
      const colonIdx = code.indexOf(':');
      const explicitProvince = colonIdx >= 0 ? code.slice(0, colonIdx) : null;
      const actualCode = colonIdx >= 0 ? code.slice(colonIdx + 1) : code;
      const found = (explicitProvince && PROVINCE_TABLES[explicitProvince])
        ? (() => {
            const entry = (PROVINCE_TABLES[explicitProvince].l2 || []).find(e => e.code === actualCode);
            return entry ? { provinceCode: explicitProvince, entry } : null;
          })()
        : _findEntryAcrossProvinces('l2', e => e.code === actualCode);
      if (found) {
        _currentResolvedProvinceCode = found.provinceCode;
        const doSp = await _loadDoSp();
        parts.push(doSp);
        trace.push('SP-DO-000');
        const divText = await _fetchDeptText(found.entry);
        parts.push(divText.text);
        trace.push(`${found.entry.code}(directCode)`);
        if (divText.permitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${divText.permitCodes.join(',')})`);
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
      // ★ 2026-08-03 신설 — 과(division) 단위 코드 폴백. 시딩 스크립트가
      // 기관·division을 같은 tier 접두어(do-dept:)로 등록했으므로,
      // 상위 실·국 코드로 못 찾으면 DO_DEPT_DIVISION_TABLE에서 찾는다
      // (domain 필드로 상위 실·국을 역참조해 체인을 완성).
      // ★ 2026-08-04 — DO_DEPT_DIVISION_TABLE 자체는 아직 제주 전용
      // 단일 테이블이다(도별로 나뉘어 있지 않음) — 다른 도의 division이
      // 생기면 이 테이블도 PROVINCE_TABLES 패턴으로 옮겨야 한다. 지금은
      // 기존 동작을 그대로 보존한다(제주 division만 존재하는 현재
      // 상태에서는 안전).
      _currentResolvedProvinceCode = 'jeju';
      const divEntry = DO_DEPT_DIVISION_TABLE.find(e => e.code === actualCode);
      if (divEntry) {
        const parentEntry = _l2Table().find(e => e.domain === divEntry.domain);
        if (parentEntry) {
          const doSp = await _loadDoSp();
          parts.push(doSp);
          trace.push('SP-DO-000');
          const parentText = await _fetchDeptText(parentEntry);
          parts.push(parentText.text);
          trace.push(parentEntry.code);
          parts.push(await _fetchText(divEntry.file, _currentProvinceRepo()));
          trace.push(`${divEntry.code}(directCode)`);
          return { systemPrompt: parts.join('\n\n---\n\n'), trace };
        }
      }
      // 코드가 테이블에 없으면(예: 한시기구처럼 L2 테이블 자체에 없는
      // 코드) 실패로 취급하지 않고 조용히 아래 텍스트 추측 경로로 폴백.
    }
    if (tier === 'do-agency' && code) {
      // ★ 2026-09-05 수정 — do-dept와 동일하게 "{도코드}:{실제코드}" 형식
      // 지원(기관 코드는 보통 도별로 고유하지만, 방어적으로 동일 패턴 적용).
      const colonIdx = code.indexOf(':');
      const explicitProvince = colonIdx >= 0 ? code.slice(0, colonIdx) : null;
      const actualCode = colonIdx >= 0 ? code.slice(colonIdx + 1) : code;
      const found = (explicitProvince && PROVINCE_TABLES[explicitProvince])
        ? (() => {
            const entry = (PROVINCE_TABLES[explicitProvince].agency || []).find(e => e.code === actualCode);
            return entry ? { provinceCode: explicitProvince, entry } : null;
          })()
        : _findEntryAcrossProvinces('agency', e => e.code === actualCode);
      if (found) {
        _currentResolvedProvinceCode = found.provinceCode;
        const doSp = await _loadDoSp();
        parts.push(doSp);
        trace.push('SP-DO-000');
        const agencyText = await _fetchAgencyText(found.entry);
        parts.push(agencyText);
        trace.push(`${found.entry.code}(directCode)`);
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
      // ★ 2026-08-03 신설 — 과(division) 단위 코드 폴백(do-dept와 동일 원칙).
      // ★ 2026-08-04 — JEJU_AGENCY_DIVISION_TABLE도 아직 제주 전용
      // 단일 테이블이다(위 do-dept division과 동일한 이유로 보존).
      _currentResolvedProvinceCode = 'jeju';
      const divEntry = JEJU_AGENCY_DIVISION_TABLE.find(e => e.code === actualCode);
      if (divEntry) {
        const parentEntry = _agencyTable().find(e => e.code === divEntry.institution);
        if (parentEntry) {
          const doSp = await _loadDoSp();
          parts.push(doSp);
          trace.push('SP-DO-000');
          const agencyText = await _fetchAgencyText(parentEntry);
          parts.push(agencyText);
          trace.push(parentEntry.code);
          parts.push(await _fetchText(divEntry.file, _currentProvinceRepo()));
          trace.push(`${divEntry.code}(directCode)`);
          return { systemPrompt: parts.join('\n\n---\n\n'), trace };
        }
      }
    }
    if (tier === 'org' && code) {
      // ★ 2026-08-04 수정 — 도 하드코딩 제거.
      const found = _findEntryAcrossProvinces('org', e => e.code === code);
      if (found) {
        _currentResolvedProvinceCode = found.provinceCode;
        const doSp = await _loadDoSp();
        parts.push(doSp);
        trace.push('SP-DO-000');
        const orgText = await _fetchOrgText(found.entry);
        parts.push(orgText);
        trace.push(`${found.entry.code}(directCode)`);
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
      // ★ 2026-08-03 신설 — 팀(division) 단위 코드 폴백(do-dept와 동일 원칙).
      // ★ 2026-08-04 — JEJU_ORG_DIVISION_TABLE도 아직 제주 전용 단일
      // 테이블이다(위와 동일한 이유로 보존).
      _currentResolvedProvinceCode = 'jeju';
      const divEntry = JEJU_ORG_DIVISION_TABLE.find(e => e.code === code);
      if (divEntry) {
        const parentEntry = _orgTable().find(e => e.code === divEntry.institution);
        if (parentEntry) {
          const doSp = await _loadDoSp();
          parts.push(doSp);
          trace.push('SP-DO-000');
          const orgText = await _fetchOrgText(parentEntry);
          parts.push(orgText);
          trace.push(parentEntry.code);
          parts.push(await _fetchText(divEntry.file, _currentProvinceRepo()));
          trace.push(`${divEntry.code}(directCode)`);
          return { systemPrompt: parts.join('\n\n---\n\n'), trace };
        }
      }
    }
    // ★ 2026-08-03 신설 — tier='city'. 다른 세션의 seed_gov_tree_remaining_
    // registry.py가 시청(SP-CITY-*)과 시청 division(SP-CITYDIV-*)을 이
    // 접두어로 등록했다 — 내가 만든 'city-dept:{시코드}-{국코드}' 규약
    // (seed_gov_tree_citydept_natagency.py)과는 별개의 코드 체계다. 둘 다
    // 실제 profiles에 등록돼 있으므로 gov-router.js도 둘 다 처리해야 한다.
    if (tier === 'city' && code) {
      // ★ 2026-08-04 수정 — 도 하드코딩 제거.
      const foundCity = _findEntryAcrossProvinces('city', e => e.code === code);
      if (foundCity) {
        _currentResolvedProvinceCode = foundCity.provinceCode;
        const cityText = await _fetchCityText(foundCity.entry);
        parts.push(cityText);
        trace.push(`${foundCity.entry.code}(directCode)`);
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
      // ★ 2026-08-04 — CITY_DIVISION_TABLE도 아직 제주 전용 단일
      // 테이블이다(위 do-dept division과 동일한 이유로 보존).
      _currentResolvedProvinceCode = 'jeju';
      const divEntry = CITY_DIVISION_TABLE.find(e => e.code === code);
      if (divEntry) {
        const parentCityEntry = _cityTable().find(e => e.시코드 === divEntry.시코드);
        const deptEntry = _cityDeptTable().find(e => e.시코드 === divEntry.시코드 && e.국코드 === divEntry.국코드);
        if (parentCityEntry) {
          const cityText = await _fetchCityText(parentCityEntry);
          parts.push(cityText);
          trace.push(parentCityEntry.code);
          if (deptEntry) {
            const { text: cityDeptText, permitCodes } = await _fetchCityDeptText(deptEntry, text);
            if (cityDeptText) {
              parts.push(cityDeptText);
              trace.push(`SP-CITYDEPT-${divEntry.시코드}-${divEntry.국코드}`);
              if (permitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${permitCodes.join(',')})`);
            }
          }
          parts.push(await _fetchText(divEntry.file, _currentProvinceRepo()));
          trace.push(`${divEntry.code}(directCode)`);
          return { systemPrompt: parts.join('\n\n---\n\n'), trace };
        }
      }
    }
    if (tier === 'city-dept' && code) {
      // code 형식: "{시코드}-{국코드}" (예: jejusi-jachi) — seed_gov_tree_
      // citydept_natagency.py의 entity_subtype 규약과 동일. 시코드 자체에
      // 하이픈이 없으므로 첫 '-'만 분리하면 된다.
      const dashIdx = code.indexOf('-');
      const cityCodeStr = dashIdx >= 0 ? code.slice(0, dashIdx) : '';
      const deptCodeStr = dashIdx >= 0 ? code.slice(dashIdx + 1) : '';
      // ★ 2026-08-04 수정 — 도 하드코딩 제거. 시코드로 먼저 도를 확정한
      // 뒤(시-국은 같은 도 소속이 구조적으로 보장됨), 이미 province-aware한
      // _cityDeptTable() 접근자를 그대로 재사용한다.
      const foundCity = _findEntryAcrossProvinces('city', e => e.시코드 === cityCodeStr);
      if (foundCity) {
        _currentResolvedProvinceCode = foundCity.provinceCode;
        const deptEntry = _cityDeptTable().find(e => e.시코드 === cityCodeStr && e.국코드 === deptCodeStr);
        if (deptEntry) {
          const cityText = await _fetchCityText(foundCity.entry);
          parts.push(cityText);
          trace.push(foundCity.entry.code);
          const { text: cityDeptText, permitCodes } = await _fetchCityDeptText(deptEntry, text);
          if (cityDeptText) {
            parts.push(cityDeptText);
            trace.push(`SP-CITYDEPT-${cityCodeStr}-${deptCodeStr}(directCode)`);
            if (permitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${permitCodes.join(',')})`);
            return { systemPrompt: parts.join('\n\n---\n\n'), trace };
          }
        }
      }
    }
    // ★ 2026-08-05 신설 — tier='province'(도청 자체). 지금까지 directCode
    // 해석부에 도청 단독 진입점이 없었다 — do-dept/do-agency/org/city/
    // city-dept/emd는 전부 있었는데 그 상위인 도청 자체만 빠져 있었다.
    // org_profiles(K-Compose 레지스트리) 재조정 과정에서 발견: 도청급
    // 기관(예: "경기도")을 gov_tree_ref로 연결하려 해도 받아줄 tier가
    // 없었다. code 형식은 도코드 그대로(예: "gyeonggi") — province-
    // master-data.json의 도코드 필드와 1:1 대응.
    if (tier === 'province' && code) {
      const records = await _loadProvinceMasterData();
      const rec = records.find(r => r.도코드 === code);
      if (rec) {
        _currentResolvedProvinceCode = code;
        const doSp = await _loadDoSp();
        parts.push(doSp);
        trace.push(`SP-DO-000(${code}, directCode)`);
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
      // 레코드가 없으면(실사 안 된 도) 실패로 취급하지 않고 아래 일반
      // 텍스트 추측 경로로 조용히 폴백 — do-dept 등 다른 tier와 동일 원칙.
    }
    if (tier === 'emd' && code) {
      // code 형식: "{읍면동명}" (예: 애월읍) — seed_gov_tree_emd_team.py의
      // entity_subtype 규약과 동일.
      // ★ 2026-08-05 — 2026-08-04에 emd-master-data.json 스키마(도코드·
      // 상위기관명·상위기관구분 등)와 SP-EMD-TEMPLATE(v1.3) 자체는 이미
      // 전국 일반화됐으나, 이 directCode 해석부는 여전히 'jeju' 하드코딩과
      // {행정시명} 전용 조회만 남아있었다(GOV_TREE_ABSTRACTION_LAYER_STATUS_v1_0.md
      // §2 갱신 필요 — "05-emd: 스키마부터"라는 구 서술은 이제 사실과
      // 다름, 실제 공백은 이 라우팅 코드였다). l2/city/agency/org와 동일한
      // 패턴(_findEntryAcrossProvinces)의 EMD 전용 버전인
      // _findEmdEntryAcrossProvinces로 도 하드코딩을 제거한다 — 새 도가
      // EMD_PATHS에 등록되기만 하면 이 코드는 다시 손대지 않아도 된다.
      const foundEmd = await _findEmdEntryAcrossProvinces(r => r.읍면동명 === code);
      // ★ 2026-08-05 신설 — §5-2 PocketBase 우선 조회. JSON에서 이미
      // 찾았어도(foundEmd) PocketBase에 더 나은(실시간 저작된) 버전이
      // 있으면 그걸 우선한다 — 없으면 null이 와서 기존 로직 그대로 진행.
      // cityEntry를 먼저 구해 city 레벨 컨텍스트는 항상 포함시킨다
      // (PocketBase generated_content는 emd 레벨 조각일 뿐 city 레벨을
      // 포함하지 않는다 — _generateGovTreeInstanceSP 참조).
      const emdGovTreeKey = { tier: 'emd', 도코드: foundEmd?.provinceCode || '', 읍면동명: code };
      const emdPbHit = await _fetchGovTreeInstancePocketBase(emdGovTreeKey);
      const emdClassification = _classifyEmdInstance(foundEmd?.entry);
      if (emdClassification !== 'REAL') _reportGovTreeInstanceMiss(emdGovTreeKey, text);
      if (foundEmd) {
        _currentResolvedProvinceCode = foundEmd.provinceCode;
        const emdEntry = foundEmd.entry;
        // v1.3 신규 필드(상위기관명) 우선, 구 스키마(행정시명)는 폴백 —
        // _renderEmdTemplate과 동일한 하위호환 원칙.
        const cityEntry = _findCityByName(emdEntry.상위기관명 || emdEntry.행정시명);
        if (cityEntry) {
          const cityText = await _fetchCityText(cityEntry);
          parts.push(cityText);
          trace.push(cityEntry.code);
          if (emdPbHit) {
            parts.push(emdPbHit.generated_content);
            trace.push(`SP-EMD-${code}(directCode·PocketBase)`);
            return { systemPrompt: parts.join('\n\n---\n\n'), trace };
          }
          const emdTemplate = await _fetchText('05-emd/SP-EMD-TEMPLATE_v1.3.md');
          parts.push(_renderEmdTemplate(emdTemplate, emdEntry));
          trace.push(`SP-EMD-${emdEntry.읍면동명}(directCode)`);
          return { systemPrompt: parts.join('\n\n---\n\n'), trace };
        }
      } else if (emdPbHit) {
        // ★ 2026-08-05 — JSON에는 전혀 없지만(foundEmd null) PocketBase에는
        // 있는 드문 경우(완전 신규 도가 PocketBase에만 저작된 상태) —
        // city 레벨 컨텍스트 없이 emd 레벨 내용만이라도 최선으로 응답한다.
        parts.push(emdPbHit.generated_content);
        trace.push(`SP-EMD-${code}(directCode·PocketBase·city 컨텍스트 없음)`);
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
    }
    if (tier === 'team' && code) {
      // code 형식: "{읍면동명}-{팀이름}" (예: 애월읍-총무팀). 읍면동명·팀이름
      // 둘 다 하이픈을 포함하지 않으므로 첫 '-'로만 분리하면 된다.
      // ★ 2026-08-05 — 위 'emd' tier와 동일하게 도 하드코딩 제거.
      const dashIdx2 = code.indexOf('-');
      const emdNameStr = dashIdx2 >= 0 ? code.slice(0, dashIdx2) : '';
      const teamNameStr = dashIdx2 >= 0 ? code.slice(dashIdx2 + 1) : '';
      const foundEmdForTeam = await _findEmdEntryAcrossProvinces(r => r.읍면동명 === emdNameStr);
      const emdEntry = foundEmdForTeam?.entry || null;
      if (emdEntry) _currentResolvedProvinceCode = foundEmdForTeam.provinceCode;
      const teamRecords = emdEntry ? await _loadTeamMasterData() : [];
      const teamEntry = teamRecords.find(r => r.emd_code === emdEntry?.emd_code && r.팀이름 === teamNameStr);
      if (emdEntry && teamEntry) {
        const cityEntry = _findCityByName(emdEntry.상위기관명 || emdEntry.행정시명);
        if (cityEntry) {
          const cityText = await _fetchCityText(cityEntry);
          parts.push(cityText);
          trace.push(cityEntry.code);
          const emdTemplate = await _fetchText('05-emd/SP-EMD-TEMPLATE_v1.3.md');
          parts.push(_renderEmdTemplate(emdTemplate, emdEntry));
          trace.push(`SP-EMD-${emdEntry.읍면동명}`);
          const teamResult = await _fetchEmdTeamText(teamEntry, emdEntry);
          if (teamResult) {
            parts.push(teamResult.text);
            trace.push(`${teamResult.code}(directCode)`);
          }
          return { systemPrompt: parts.join('\n\n---\n\n'), trace };
        }
      }
    }
    if (tier === 'nat-agency' && code) {
      // ★ 2026-08-04 수정 — 이 tier는 다른 tier와 달리 code(예: 'police')
      // 자체가 도별로 고유하지 않다(_makePoliceEntry가 모든 도에 같은
      // domain 값을 반복 생성) — 그래서 _findEntryAcrossProvinces로는
      // 도를 특정할 수 없다. 이 지사형 기관 tier는 애초에 "어느 도의
      // 지사냐"를 code가 아니라 사용자 위치로 판단해야 하는 성격이라
      // (아래 3700·3990행 부근의 동일 함수 호출부가 이미 그렇게 함),
      // 하드코딩 대신 이 파일 전역의 위치 기반 판별 결과를 그대로 쓴다.
      // 위치가 아직 판별 안 된 경우(_resolveProvinceCode()가 null)는
      // 아래 -0.5 게이트로 자연히 넘어가도록 폴백한다(여기서 강제하지
      // 않음 — 이 if 블록 진입 자체가 이미 -0.9 directCode 단계라 게이트
      // 이전이므로, null이면 resolveNationalAgencyLazy가 처리하게 둔다).
      const resolvedProvince = _resolveProvinceCode();
      if (resolvedProvince) {
        _currentResolvedProvinceCode = resolvedProvince;
        const nationalSp = await _loadNationalSp();
        parts.push(nationalSp);
        trace.push('JEJU-NATIONAL-SP');
        const resolved = await resolveNationalAgencyLazy(
          resolvedProvince, _provinceCodeToName(resolvedProvince), code, onProgress, null);
        parts.push(resolved.text);
        trace.push(`SP-NATIONAL-LAZY(${code}/${resolved.source}, directCode)`);
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
      // 위치 미판별 — 조용히 폴백하지 않고 아래 -0.5 게이트가 정직하게
      // "지역을 알려달라"고 안내하도록 이 if 블록을 그냥 빠져나간다.
    }
    // 여기까지 걸리는 게 없으면(테이블에서 code를 못 찾음, 또는 아직
    // 모르는 tier) 실패로 취급하지 않고 조용히 아래 텍스트 추측 경로로
    // 폴백한다(회귀 없음, 기존 policy-only 시절과 동일한 안전 원칙).
  }

  // ★ 2026-08-17 전수 감사 ★ _POLICY_BODY_DOMAIN_KEYWORDS(70) ×
  // _NAT_AGENCY_DOMAIN_KEYWORDS(34) 전수 대조 결과, 2026-08-03에 이미
  // 고쳐진 7개(NTS/KCS/POLICE/MMA/KCG/PPS/PROSECUTION) 외에 동일 패턴의
  // 충돌이 11개 더 있었음(live-policy-body-collision-audit.mjs로 22건
  // 실측, 22/22 가설 재현). 처리 결과:
  //  - 6개(NCA/CONSTCOURT/COTI/JPRI/SUPREMECOURT/MPVA)는 원인이 단독
  //    '법원'·'재판'·'보훈'처럼 지나치게 포괄적인 지사 키워드였다 —
  //    위 court/veterans 테이블에서 그 단독어를 제거해 근본 수정함.
  //  - 5개(CIO/KMA/MOEL/MOJ/OKA)는 원인이 되는 지사 키워드('수사'·
  //    '기상청'·'임금체불'·'출입국'·'체류자격')가 실제로 그 자체 지사
  //    실행형 민원에도 정당하게 쓰이므로 제거하지 않았다 — 이미 등록된
  //    안전 대안 키워드(예: CIO='공수처'/'고위공직자 비리 제보',
  //    KMA='장기예보 정확도 관련 문의')로 매칭되니 완전 차단은 아니지만,
  //    MOEL/MOJ/OKA는 기관 정식 명칭 자체('고용노동부'/'법무부'/
  //    '재외동포청')가 이미 안전해 실사용 영향이 작고, CIO('고위공직자
  //    범죄수사처')·KMA('기상청' — 지사 사전에도 동일 명칭 존재)만
  //    정식 명칭 그대로는 여전히 막힌다는 한계가 남아있음(추후 우선순위
  //    가드 로직 자체를 명세 특이성 기반으로 재설계할 때 재검토 필요).
  //
  //  ★ 2026-08-17 후속 수정 ★ CIO·KMA는 "기관 고유명칭 자체"가 겹치는
  //  경우라(MOEL의 '임금체불 진정'처럼 행위를 서술하는 문구가 아니라)
  //  아래 화이트리스트로 좁게 예외 처리한다 — 고유명칭 매칭일 때만
  //  지사 우선 가드를 건너뛰고, 다른 행위 서술형 충돌(MOEL/MOJ/OKA)에는
  //  전혀 영향을 주지 않는다.
  //
  // -0.8) 중앙부처 정책기관(policy-bodies) 매칭 (2026-08-02 신설) — 도
  // 판별 게이트(바로 아래 -0.5)보다 반드시 먼저 와야 한다. policy-bodies
  // 70개는 도별 지사가 없는 전국 단일 SP라(§0 "이 기관은 제주도지사
  // 지휘·감독을 받지 않으며 전국 단일 기관이다") 위치를 몰라도 응답할 수
  // 있는데, 이 체크가 도 판별 게이트 뒤에 있으면 위치 미기재 발화가 전부
  // "지역 미판별"로 조기 반환돼 정책기관 SP까지 절대 못 온다(1차 배선
  // 시도에서 실측 확인됨 — MOJ 등 위치 무관 발화가 전부 도 판별 실패로
  // 튕겨나갔음). 기관명·정책성 키워드 매칭은 애매함이 낮아 LLM 폴백 없이
  // classifyFn 유무와 무관하게 즉시 판단한다(도청/시군구 라우팅과 달리
  // 동음이의 충돌 위험이 낮음).
  // -0.85) 국회 상임위원회 매칭(2026-08-17 신설, 이전엔 "1차 배선 범위
  // 제외"로 남아있던 갭을 채움) — -0.8) 정책기관 매칭보다 먼저 시도한다.
  // 위원회명("교육위원회" 등)은 _POLICY_BODY_DOMAIN_KEYWORDS에 없어
  // -0.8)과 겹치지 않지만, 소관 부처 이름이 발화에 같이 나오면(예:
  // "고용노동부 관련 국회 위원회") 정책기관 쪽이 오탐할 수 있어 순서를
  // 위원회 쪽이 앞서게 둔다. 도 판별과 무관(위원회도 전국 단일 개념)해
  // -0.5) 게이트보다 반드시 먼저 와야 한다는 원칙은 -0.8)과 동일.
  const committeeGuess = await guessAssemblyCommitteeFromText(text, _fetchText);
  if (committeeGuess) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    trace.push('JEJU-NATIONAL-SP');
    const resolvedCommittee = await resolveAssemblyCommitteeLazy(committeeGuess, _fetchText, onProgress);
    if (resolvedCommittee) {
      parts.push(resolvedCommittee.text);
      trace.push(`SP-ASSEMBLYCOMMITTEE-LAZY(${committeeGuess}/${resolvedCommittee.source})`);
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
  }

  const policyBodyGuess = _guessPolicyBodyFromText(text);
  // 우선순위 가드 — 경찰청·검찰청·병무청 등은 policy-bodies(본청)와
  // 09-national/agencies(지사형 집행기관) 양쪽에 다 존재한다. 두 키워드
  // 사전이 동시에 매칭되면(예: '검찰청'은 이 사전에도, 0.5)단계 집행기관
  // 사전에도 있음) 실행형 민원("고소장 접수해줘")은 관할 지사가 처리하는
  // 게 맞으므로 집행기관 쪽이 우선한다 — 이 가드가 없으면 -0.8)이 0.5)
  // 보다 먼저 실행돼 지사 라우팅을 가로챈다.
  const _natAgencyHit = _guessNatAgencyDomainFromText(text);
  const _nameCollisionExempt = policyBodyGuess && _natAgencyHit &&
    (_POLICY_BODY_NAME_COLLISION_EXEMPT[policyBodyGuess] || []).some(kw => text.includes(kw));
  // ★ 2026-08-23 신설(재설계 1단계) — 국가기관(정책기관) 즉시확정 전
  // 시청 국(jachi 등) 계층 충돌 여부를 먼저 확인한다.
  // ★ 2026-08-30 수정 — 이 검사(_localGovCollisionCandidate) 자체는
  // 순수 키워드 스코어링이라 LLM 호출이 전혀 없다. 예전엔 classifyFn이
  // 없으면(하위호환) 검사를 통째로 생략했는데, 그러면 바로 위 주석이
  // 설명하는 원래 버그("소상공인 정책자금 대출 상담" → MSS로 즉시확정)가
  // classifyFn 없는 모드(gov-router.test.mjs 등)에서 그대로 재현됐다
  // (실측 확인). LLM 없이도 결정론적으로 판단 가능하므로 classifyFn
  // 유무와 무관하게 항상 검사한다.
  const _policyCityCollision = policyBodyGuess
    ? _localGovCollisionCandidate(text, pdvLocationHint) : null;
  if (policyBodyGuess && (!_natAgencyHit || _nameCollisionExempt) && !_policyCityCollision) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    trace.push('JEJU-NATIONAL-SP');
    const resolved = await resolvePolicyBodyLazy(policyBodyGuess, onProgress);
    parts.push(resolved.text);
    trace.push(`SP-POLICY-LAZY(${policyBodyGuess}/${resolved.source})`);
    // 2026-08-16 신설 — 본청 확정 뒤 그 기관 소속 division(실·국·과)
    // 매칭을 시도한다. §0 상속 체인(kgov→...→SP-NAT-POLICY-{code}→
    // [division])대로 본청 SP 뒤에 division SP를 이어붙인다. 매칭 실패/
    // 동점이면 divMatch가 null이라 본청 SP만으로 그대로 반환(회귀 없음).
    const divMatch = await _tryDivisionMatch(policyBodyGuess, text, onProgress);
    if (divMatch) {
      parts.push(divMatch.text);
      trace.push(`SP-POLICYDIV-LAZY(${policyBodyGuess}/${divMatch.부서코드}/${divMatch.source})`);
    }
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }
  if (policyBodyGuess && (!_natAgencyHit || _nameCollisionExempt) && _policyCityCollision) {
    // ★ 2026-08-30 수정 — classifyFn이 없으면 안 되묻고 안 통합판단할 수
    // 있으니, 예전엔 그냥 국가기관으로 확정해버렸다(원래 버그 재현:
    // "소상공인 정책자금 대출 상담" 등). 이 계층충돌이 감지됐다는 것
    // 자체가 "지역 소관이 더 흔한 사례"라는 뜻(위 -0.8) 진입 주석 참고)
    // 이므로, classifyFn 없을 때의 안전 기본값을 국가기관에서 로컬
    // (도청/시청)로 바꾼다 — classifyFn이 있을 때 시청 국을 고른 경우와
    // 동일하게 아래 일반 라우팅 경로로 통과시킨다.
    if (!classifyFn) {
      trace.push('(계층충돌 — classifyFn 없어 결정론적으로 지방행정 우선, 아래 라우팅 경로로 위임)');
    } else {
    // 국가기관과 시청 국 계층이 동시에 걸렸다 — 둘 다 후보로 얹어
    // classifyFn 한 번으로 통합 판단(2단계). CLARIFY 신호는 그대로
    // 위로 던져 사용자에게 되묻는다(기존 관례와 동일).
    const natCandidate = {
      code: `SP-POLICY-${policyBodyGuess}`,
      name: _POLICY_BODY_NAME_KO[policyBodyGuess] || policyBodyGuess,
      desc: ROUTE_DESCRIPTIONS[`SP-POLICY-${policyBodyGuess}`] ||
        `${_POLICY_BODY_NAME_KO[policyBodyGuess] || policyBodyGuess}(전국 단일 정책기관) 소관 사무`,
    };
    let picked = null;
    try {
      picked = await _classifyDivisionFallback(text, [natCandidate, _policyCityCollision], classifyFn);
    } catch (e) {
      if (e instanceof NeedsClarificationSignal) throw e;
      picked = null;
    }
    if (!picked || picked.code === natCandidate.code) {
      // classifyFn이 국가기관을 고르거나 확정 못 하면(안전 기본값)
      // 기존과 동일하게 국가기관으로 확정.
      const nationalSp = await _loadNationalSp();
      parts.push(nationalSp);
      trace.push('JEJU-NATIONAL-SP');
      const resolved = await resolvePolicyBodyLazy(policyBodyGuess, onProgress);
      parts.push(resolved.text);
      trace.push(`SP-POLICY-LAZY(${policyBodyGuess}/${resolved.source})`, '(계층충돌 통합판단 — 국가기관 확정)');
      const divMatch = await _tryDivisionMatch(policyBodyGuess, text, onProgress);
      if (divMatch) {
        parts.push(divMatch.text);
        trace.push(`SP-POLICYDIV-LAZY(${policyBodyGuess}/${divMatch.부서코드}/${divMatch.source})`);
      }
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    // classifyFn이 시청 국(局)을 골랐다 — 여기서 직접 확정하지 않고
    // 아래의 일반 city/jachi 라우팅 경로(1)~2) 단계)로 자연스럽게
    // 통과시킨다. 그 경로가 PERMIT-CRITERIA-PROTOCOL·division 매칭 등
    // 기존 배선을 이미 다 갖추고 있어 여기서 중복 구현하지 않는다.
    trace.push(`(계층충돌 통합판단 — 지방행정(${picked.code}) 소관으로 판정, 아래 라우팅 경로로 위임)`);
    }
  }

  // -0.78) 국가 공기업(enterprises) 매칭 (2026-08-23 신설) — enterprises도
  // policy-bodies와 마찬가지로 도별 지사가 없는 전국 단일 SP라(§0 "이
  // 기관은 도지사 지휘·감독을 받지 않으며 전국 단일 공기업이다") 위치
  // 판별 게이트(-0.5)보다 먼저 와야 한다.
  // ★ 2026-08-23 충돌가드 추가 — 최초 구현 때 "키워드가 전부 고유명사라
  // 안 겹친다"고 판단했으나 실제로는 KAC('한국공항공사')·IIAC('인천국제
  // 공항공사')가 09-national/agencies의 airport 도메인 키워드
  // ('공항공사', _NAT_AGENCY_DOMAIN_KEYWORDS)와 부분 문자열로 충돌한다
  // (도로/의료원 등 다른 기업명도 향후 같은 위험이 있을 수 있어, 개별
  // 화이트리스트 대신 위 -0.8) 정책기관 블록과 동일한 범용 가드를 쓴다).
  // _natAgencyHit는 이미 위(정책기관 블록, line ~4973)에서 계산돼 있다
  // — agencies(지사) 쪽이 이미 이 발화를 인식했다면 그쪽이 우선한다
  // (기존 정책기관 vs 지사 우선순위 원칙과 동일).
  const enterpriseGuess = _natAgencyHit ? null : _guessEnterpriseFromText(text);
  if (enterpriseGuess) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    trace.push('JEJU-NATIONAL-SP');
    const resolvedEnt = await resolveEnterpriseLazy(enterpriseGuess, onProgress);
    parts.push(resolvedEnt.text);
    trace.push(`SP-ENT-LAZY(${enterpriseGuess}/${resolvedEnt.source})`);
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // -0.77) 준정부기관(qgov) 매칭 (2026-08-23 신설) — enterprises 바로 다음
  // 단계. 동일한 _natAgencyHit 가드를 적용한다(NHIS/NPS/KCOMWEL처럼
  // agencies에도 동일 기관 지사가 있는 경우, 지사가 우선하도록).
  const qgovGuess = _natAgencyHit ? null : _guessQgovFromText(text);
  if (qgovGuess) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    trace.push('JEJU-NATIONAL-SP');
    const resolvedQgov = await resolveQgovLazy(qgovGuess, onProgress);
    parts.push(resolvedQgov.text);
    trace.push(`SP-QGOV-LAZY(${qgovGuess}/${resolvedQgov.source})`);
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // -0.76) 기타공공기관(other) 매칭 (2026-08-23 신설) — enterprises·qgov와
  // 동일한 구조적 결함(09-national/other 254개가 gov-router.js에 전혀
  // 배선돼 있지 않던 것)을 이어서 수정한다. 254개 중 11개는 등록에서
  // 제외했다:
  //  - KVMC·POSTFIN·POSTLOG(3개): qgov에 KVMC2·POSTFIN2·POSTLOG2로
  //    이름이 완전히 동일한 기관이 이미 등록돼 있음(원본 저장소에
  //    같은 기관 SP가 09-national/qgov와 /other 양쪽에 중복 생성된
  //    것으로 보임 — 콘텐츠 정리는 별도 과제, 여기선 중복 등록만 피함).
  //  - EXSERVICE·KRDIST·KRLOG·KRNW·KRTC·KRTECH·KEPCOMCS·KNF(8개): 이름이
  //    이미 등록된 enterprises 키워드(EX'한국도로공사'·KORAIL'코레일'·
  //    KEPCO'한전')를 그대로 포함하는 자회사라, 어차피 상위 enterprises
  //    매칭이 먼저 걸려 이 코드에 절대 도달하지 못한다(우선순위상 등록
  //    해도 죽은 코드가 됨) — 등록하지 않음.
  // 나머지 243개는 _NAT_AGENCY_DOMAIN_KEYWORDS·_POLICY_BODY_DOMAIN_
  // KEYWORDS·_ENTERPRISE_DOMAIN_KEYWORDS·_QGOV_DOMAIN_KEYWORDS 전체와
  // 파이썬으로 전수 대조해, 부산항만공사류(agency 'port' 도메인과 부분
  // 충돌)를 포함해 전부 기존 _natAgencyHit 가드로 안전하게 처리됨을
  // 확인했다(2026-08-23).
  const otherGuess = _natAgencyHit ? null : _guessOtherFromText(text);
  if (otherGuess) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    trace.push('JEJU-NATIONAL-SP');
    const resolvedOther = await resolveOtherLazy(otherGuess, onProgress);
    parts.push(resolvedOther.text);
    trace.push(`SP-OTHER-LAZY(${otherGuess}/${resolvedOther.source})`);
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // -0.5) 도 판별 실패(발화·PDV 위치 힌트 둘 다 실패) — 2026-07-21 신설.
  // 정확한 관할(도청/시군구/읍면동/국가기관 지역사무소 어느 계층이든)은
  // 지역 없이는 특정할 수 없다는 원칙(JEJU-GOV-COMMON §10 데이터 연동
  // 공백 고지 원칙)의 연장 — "판별 불가"를 정직하게 알리고, 발화가
  // 애초에 위치와 무관한 일반 질문일 수도 있으므로 GOV-COMMON 공통
  // 레이어까지는 포함해 반환한다(도청/L2/국가기관 트리는 로드하지 않음).
  // ★ 2026-07-21 수정(버그2) — 예전엔 _currentResolvedProvinceCode(발화·
  // PDV 기반 판별값)만 검사해서, window.HONDI_PROVINCE_CODE로 도가 이미
  // 고정된 배포(도별 전용 사이트)에서도 위치 없는 일반 질문이 전부
  // "지역 미판별"로 잘못 튕겨나가는 버그가 있었다(50개 사고실험 E7에서
  // 실증). _resolveProvinceCode()는 오버라이드까지 감안한 최종값이라
  // 이걸 검사해야 맞다.
  if (!_resolveProvinceCode()) {
    parts.push(
      '[지역 미판별] 정확한 관할 기관을 안내하려면 거주 지역(광역시도·시군구, ' +
      '가능하면 읍면동까지)을 알려주세요. PDV에 거주지가 저장돼 있다면 자동으로 반영됩니다.'
    );
    return {
      systemPrompt: parts.join('\n\n---\n\n'),
      trace: [...trace, '(지역 미판별 — 발화·PDV 힌트 모두 실패, 도청/국가기관 트리 로드 안 함)'],
    };
  }

  // 0) 국가기관 매칭 — JEJU-DO-SP(도청 트리)와 배타적인 형제 노드.
  //    매칭되면 도청 트리는 아예 로드하지 않는다(JEJU-NATIONAL-SP §0).
  const natMatch = _matchNational(text);
  // ★ 2026-08-23 신설(재설계 1단계) — policyBodyGuess와 동일한 계층충돌
  // 안전망. natMatch(지사형 집행기관)도 즉시확정 전에 시청 국 계층과
  // 충돌하는지 확인한다. classifyFn 없거나 시청 후보 없으면 기존과
  // 완전히 동일(회귀 없음).
  const _natCityCollision = (natMatch && classifyFn)
    ? _localGovCollisionCandidate(text, pdvLocationHint) : null;
  if (natMatch && !_natCityCollision) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    trace.push('JEJU-NATIONAL-SP');
    // 도 하나에 지사가 여럿인 도메인(tax·court 등) 대응 — 시/군구까지
    // 잡히면 _fetchNatText()가 그걸로 정확한 지사를 좁힌다. 못 잡아도
    // 기존처럼 도코드만으로 동작(도코드당 1건인 도메인은 영향 없음).
    const natCityHint = _matchCity(text, pdvLocationHint);
    const { text: agencyText, permitCodes: agencyPermitCodes } = await _fetchNatText(natMatch, natCityHint?.시코드 || null);
    parts.push(agencyText);
    trace.push(natMatch.code);
    if (agencyPermitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${agencyPermitCodes.join(',')})`);
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }
  if (natMatch && _natCityCollision) {
    const natCandidate = {
      code: natMatch.code,
      name: natMatch.name || natMatch.code,
      desc: ROUTE_DESCRIPTIONS[natMatch.code] || natMatch.domain || `${natMatch.code}(국가기관 지사) 소관 사무`,
    };
    let picked = null;
    try {
      picked = await _classifyDivisionFallback(text, [natCandidate, _natCityCollision], classifyFn);
    } catch (e) {
      if (e instanceof NeedsClarificationSignal) throw e;
      picked = null;
    }
    if (!picked || picked.code === natCandidate.code) {
      const nationalSp = await _loadNationalSp();
      parts.push(nationalSp);
      trace.push('JEJU-NATIONAL-SP');
      const natCityHint = _matchCity(text, pdvLocationHint);
      const { text: agencyText, permitCodes: agencyPermitCodes } = await _fetchNatText(natMatch, natCityHint?.시코드 || null);
      parts.push(agencyText);
      trace.push(natMatch.code, '(계층충돌 통합판단 — 국가기관 확정)');
      if (agencyPermitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${agencyPermitCodes.join(',')})`);
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    trace.push(`(계층충돌 통합판단 — 지방행정(${picked.code}) 소관으로 판정, 아래 라우팅 경로로 위임)`);
  }
  const catalogOnly = _matchCatalogOnly(text);
  if (catalogOnly) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    parts.push(_renderCatalogFallback(catalogOnly));
    trace.push('JEJU-NATIONAL-SP', `(§4 공통 폴백: ${catalogOnly.name})`);
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // 0.5) 국가기관 지연 초기화(2026-07-20 신설) — 이 도의 정적 테이블에
  // 해당 도메인이 없는 경우(2026-07-24 수정: 예전엔 "테이블 전체가
  // 비었는가"만 봤는데, police 선별 확대로 부분 커버리지 도가 생기면서
  // 그 판단으로는 부족해졌다 — natDomainGuess 자체가 이 도 테이블에
  // 있는지 직접 확인한다). classifyFn이 주입돼 있으면 시군구와 동일한
  // 철학으로 여기서 확정하지 않고 5단계 LLM 분류 폴백에 'SP-NATIONAL-LAZY'
  // 후보로 넘긴다. classifyFn이 없으면(상담할 AI 자체가 없음) 정규식이
  // 즉시 판단.
  if (!classifyFn) {
    const natDomainGuess = _guessNatAgencyDomainFromText(text);
    const alreadyCovered = natDomainGuess && _nationalTable().some(e => e.domain === natDomainGuess);
    if (natDomainGuess && !alreadyCovered) {
      const cityHint = _guessSigunguName(text, pdvLocationHint);
      const nationalSp = await _loadNationalSp();
      parts.push(nationalSp);
      trace.push('JEJU-NATIONAL-SP');
      const resolved = await resolveNationalAgencyLazy(_resolveProvinceCode(), _provinceCodeToName(_resolveProvinceCode()), natDomainGuess, onProgress, cityHint);
      parts.push(resolved.text);
      trace.push(`SP-NATIONAL-LAZY(${natDomainGuess}${cityHint ? '/' + cityHint : ''}/${resolved.source})`);
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
  }

  // 여기부터는 도청 트리(JEJU-DO-SP) — 국가기관이 아닌 것으로 판단됐으므로 로드.
  const doSp = await _loadDoSp();
  parts.push(doSp);
  trace.push('SP-DO-000');

  // L4 업무영역 SP 매칭 — 지금은 상하수도(SP-EXP-WATER) 하나뿐.
  // JEJU-GOV-COMMON §10(정직성·데이터 연동 공백 고지 원칙)의 첫 실증 사례.
  // ★ 2026-07-24 수정(100건 사고실험에서 발견) — '수압'이 빠져 있어서
  // "수압이 너무 약해요" 같은 정당한 상하수도 민원이 SP-EXP-WATER를
  // 못 띄우고 그냥 EMD 일반 안내로 끝났다.
  const isWaterQuery = /상수도|수돗물|누수|수질|정수|급수|배관|수압/.test(text);
  async function _appendExpertIfMatched() {
    if (isWaterQuery) {
      const expText = await _fetchText('06-expert/SP-EXP-WATER_v1.1.md');
      parts.push(expText);
      trace.push('SP-EXP-WATER');
    }
  }

  // 0.6) 직속기관(03-do-agency)/출자출연기관(07-org) 매칭 (2026-08-02 신설)
  // — 지금까지 이 두 계층은 top-level SP는 있어도 진입 경로가 없어 죽어있었다.
  // 위치 이력: 처음엔 3)L2 매칭 뒤 → "농업기술원"이 L2의 일반명사 '농업'에
  // 먼저 채이는 문제로 L2보다 앞(구 2.6단계)으로 이동 → 그런데 그 자리도
  // 1)읍면동(EMD) 매칭보다 뒤였다. PDV 힌트에 우연히 특정 동 이름이
  // 찍혀있으면("서귀포시 동홍동") EMD 매칭이 먼저 확정돼버려 "의료원
  // 진료 예약"처럼 기관 매칭이 됐어야 할 발화가 동홍동 행정복지센터로
  // 잘못 가는 걸 스모크테스트로 발견(주피터 지적 — 기관명 없이 PDV
  // 위치만으로도 올바른 기관을 찾아야 한다) — 결국 도청 트리 진입
  // 직후, 다른 어떤 지리적 매칭보다도 먼저로 확정했다. 기관명/업무
  // 키워드는 읍면동 행정구역과 무관한 신호이기 때문이다.
  // ★ 2026-08-02(2차) — 처음엔 이 자리에 `_resolveProvinceCode() ===
  // 'jeju'` 문자열 비교 가드가 있었다(임시방편). l2/city/national과
  // 동일하게 PROVINCE_TABLES에 편입해(_agencyTable()/_orgTable() 등
  // accessor 신설) 다른 도로 확장 시 이 자리를 다시 안 고쳐도 되게
  // 정리했다 — 실사 안 된 도는 accessor가 자동으로 빈 배열을 반환해
  // 아래 매칭이 전부 조용히 스킵된다(l2/national과 동일한 안전망).
  {
    const agyMatch = await _resolveInstitutionMatch(text, _agencyTable(), pdvLocationHint, classifyFn);
    if (agyMatch) {
      const agencyText = await _fetchAgencyText(agyMatch);
      parts.push(agencyText);
      trace.push(agyMatch.code);
      const agyDivisionMatch = await _resolveDoAgencyDivision(text, agyMatch, classifyFn);
      if (agyDivisionMatch) {
        parts.push(await _fetchText(agyDivisionMatch.file, _currentProvinceRepo()));
        trace.push(`${agyDivisionMatch.code}(과 특정)`);
      }
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    const orgMatch = await _resolveInstitutionMatch(text, _orgTable(), pdvLocationHint, classifyFn);
    if (orgMatch) {
      const orgText = await _fetchOrgText(orgMatch);
      parts.push(orgText);
      trace.push(orgMatch.code);
      const orgDivisionMatch = await _resolveOrgDivision(text, orgMatch, classifyFn);
      if (orgDivisionMatch) {
        parts.push(await _fetchText(orgDivisionMatch.file, _currentProvinceRepo()));
        trace.push(`${orgDivisionMatch.code}(팀 특정)`);
      }
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
  }

  // 1) 읍면동/리 이름이 직접 언급되면 규칙 B/C/F: 행정시 → 읍면동 체인
  const emdRecords = await _loadEmdRecords();
  // ★ 2026-08-23 구조적 강화(라이브 스모크테스트 전수취합 실측 발견,
  // 주피터 재차 지시 — "땜빵 말고 근본 논리 구조를 고쳐라") — _matchCity
  // 는 "발화 자체에서 매칭됐는지, 위치 힌트로만 매칭됐는지"를
  // _matchedViaTextItself로 추적해서, 힌트로만 매칭되면 즉시 확정하지
  // 않고 뒤 단계(L2/국가기관/전역 폴백)에 먼저 기회를 준 뒤 그래도
  // 안 걸리면 최후의 수단으로만 쓴다(cityOnlyFallback). 그런데 _matchEmd
  // 는 이 구분 자체가 없어서, 실제 AC가 항상 정확한 위치(읍면동까지)를
  // 아는 실사용 환경에서 — 즉 emdMatch가 거의 항상 "위치 힌트로만"
  // 성립하는 상황에서 — BUG-028/032로도 못 잡는 발화(토지대장·대학
  // 성적증명서 등, city-dept도 아니고 EMD도 아닌 제3의 기관 소관)가
  // 전부 무조건 EMD로 확정돼버렸다(실측 다건 확인). _matchCity와 동일한
  // 비대칭 방지 패턴을 EMD 레벨에도 대칭적으로 적용한다.
  const emdMatchedViaTextItself = !!_matchEmd(text, emdRecords);
  let emdMatch = _matchEmd(text, emdRecords)
    || (pdvLocationHint ? _matchEmd(pdvLocationHint, emdRecords) : null);
  let emdFallback = null; // ★ 신설 — cityOnlyFallback과 동일한 "보류" 그릇

  if (emdMatch) {
    // ★ 2026-08-05 — v1.3 신규 필드(상위기관명) 우선, 구 스키마(행정시명)는
    // 폴백(directCode 'emd'/'team' tier와 동일한 하위호환 원칙).
    const cityCode = _findCityByName(emdMatch.상위기관명 || emdMatch.행정시명);
    if (cityCode) {
      const cityText = await _fetchCityText(cityCode);
      // ★ 2026-08-23 수정 — cityText/cityCode.code를 여기서 곧바로 바깥
      // parts/trace에 push하지 않는다. 아래에서 EMD를 "보류"하기로
      // 결정하면(힌트 전용 매칭 + AI 있음), 바깥 parts/trace는 전혀 안
      // 건드린 채로 2)~5) 단계로 그대로 넘어가야 한다 — 여기서 먼저
      // push해버리면 뒤 단계가 최종적으로 다른 답(L2/국가기관 등)을
      // 찾아도 이 시청 프리픽스가 결과에 잘못 섞여버린다. 확정하는
      // 분기(cityDeptMatch/상하수도/즉시확정 EMD)에서만 각자 push한다.

      // ★ 2026-07-23 수정(주피터 지시) — 규칙 F(서귀포 상하수도는 읍면동
      // 생략)를 상하수도 전용에서 모든 시청 국(局) 도메인으로 일반화한다.
      // PDV 힌트에 동 이름이 있어 emdMatch까지는 됐지만("동홍동"),
      // 발화 내용 자체가 읍면동 사무(민원 등)가 아니라 시청 국 소관
      // 사무(예: 건축허가)인 경우, 읍면동 템플릿 대신 시청 국을 붙인다
      // — 읍면동은 건축허가를 처리하지 않으므로 이게 실제로 맞는 관할이다.
      //
      // ★ 2026-08-23 구조적 강화(라이브 스모크테스트 실측 발견) — 순수
      // 키워드(_matchCityDept)만 쓰면, 실제 AC가 항상 정확한 위치(읍면동
      // 까지)를 아는 실사용 환경에서 아주 흔한 실패가 발생한다: "세목별
      // 납세증명"·"미과세증명"처럼 jachi 소관이 명백한데 kw 사전에 정확히
      // 안 걸리는 발화가, LLM에게 물어볼 기회도 없이 그냥 읍면동으로
      // 확정돼버렸다("토지대장등본"·"대학 성적증명서" 등 EMD와 무관한
      // 발화까지 전부 SP-EMD-*로 오확정되는 게 실측 확인됨 — BUG-028
      // 당시 "예외 감지 지점이라 위험 비대칭적"이라 판단해 이 지점만
      // 일부러 LLM 구제망 적용 대상에서 뺐었는데, 반대 방향(진짜 시청
      // 국 사무를 읍면동으로 오확정)의 피해가 훨씬 크고 흔하다는 게
      // 실측으로 확인돼 판단을 뒤집는다. _resolveCityDeptMatch(BUG-028)
      // 를 여기에도 적용 — 키워드 완전매칭이면 기존처럼 즉시 확정(고속
      // 경로, 회귀 없음), 실패하면 시청 국 후보를 LLM에게 보여주고
      // "이게 진짜 읍면동 사무가 맞는지"까지 포함해 판단시킨다.
      const cityDeptMatch = await _resolveCityDeptMatch(text, cityCode.시코드, classifyFn);
      if (cityDeptMatch) {
        parts.push(cityText);
        trace.push(cityCode.code);
        const { text: cityDeptText, permitCodes: cityDeptPermitCodes } = await _fetchCityDeptText(cityDeptMatch, text);
        if (cityDeptText) {
          parts.push(cityDeptText);
          trace.push(`SP-CITYDEPT-${cityCode.시코드}-${cityDeptMatch.국코드}`,
            '(규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략)');
          if (cityDeptPermitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${cityDeptPermitCodes.join(',')})`);
          const divisionMatch = await _resolveCityDivision(text, cityDeptMatch, classifyFn);
          if (divisionMatch) {
            parts.push(await _fetchCityDivisionText(divisionMatch, null));
            trace.push(`${divisionMatch.code}(과/팀 특정)`);
          }
        }
        await _appendExpertIfMatched();
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      } else if (cityCode.code === 'SP-CITY-SEOGWIPO' && isWaterQuery) {
        parts.push(cityText);
        trace.push(cityCode.code);
        trace.push('(규칙 F: 서귀포 상하수도는 읍면동 생략)');
        await _appendExpertIfMatched();
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      } else {
        // ★ 2026-08-05 신설 — §5-2 PocketBase 우선 조회 + STUB/MISSING
        // 미스 신호(§4-1). 여기 도달했다는 건 이 발화가 실제로 읍면동
        // 사무라는 뜻이므로(규칙 F 우회 안 됨), 이 지점에서만 확인한다.
        const emdNlGovTreeKey = { tier: 'emd', 도코드: _resolveProvinceCode(), 읍면동명: emdMatch.읍면동명 };
        const emdNlPbHit = await _fetchGovTreeInstancePocketBase(emdNlGovTreeKey);
        if (_classifyEmdInstance(emdMatch) !== 'REAL') _reportGovTreeInstanceMiss(emdNlGovTreeKey, text);
        const emdContentParts = [];
        const emdContentTrace = [];
        if (emdNlPbHit) {
          emdContentParts.push(emdNlPbHit.generated_content);
          emdContentTrace.push(`SP-EMD-${emdMatch.읍면동명}(PocketBase)`);
        } else {
          const emdTemplate = await _fetchText('05-emd/SP-EMD-TEMPLATE_v1.3.md');
          emdContentParts.push(_renderEmdTemplate(emdTemplate, emdMatch));
          emdContentTrace.push(`SP-EMD-${emdMatch.읍면동명}`);
          // ★ 2026-08-02 신설 — 팀 단위 세부 매칭(division과 동일 원칙,
          // 동점일 때만 LLM). 읍면동 확정 후 그 안의 팀 중 더 구체적으로
          // 일치하는 게 있으면 이어붙인다(교체 아님).
          const teamMatch = await _resolveEmdTeam(text, emdMatch, classifyFn);
          if (teamMatch) {
            const teamResult = await _fetchEmdTeamText(teamMatch, emdMatch);
            if (teamResult) {
              emdContentParts.push(teamResult.text);
              emdContentTrace.push(teamResult.code);
            }
          }
        }

        // ★ 2026-08-23 신설 — emdMatch가 발화 자체(읍면동 이름을 직접
        // 언급)로 성립했거나 classifyFn이 없으면(AI 상담 불가) 기존처럼
        // 즉시 확정한다. 위치 힌트로만 성립했고 AI가 있으면, 이 결과를
        // 폴백으로만 들고 뒤 단계(2~5, cityOnly/L2/국가기관/전역 분류)에
        // 더 구체적인 매칭 기회를 먼저 준다 — _matchCity의 cityOnlyFallback
        // 과 완전히 동일한 원칙. 아무 데서도 안 걸리면 6)에서 이 폴백을
        // 쓴다(최종 결과는 최소 기존과 동일하거나 더 정확함 — 절대
        // 나빠지지 않는다).
        if (emdMatchedViaTextItself || !classifyFn) {
          parts.push(cityText);
          trace.push(cityCode.code);
          parts.push(...emdContentParts);
          trace.push(...emdContentTrace);
          await _appendExpertIfMatched();
          return { systemPrompt: parts.join('\n\n---\n\n'), trace };
        }
        emdFallback = {
          parts: [...parts, cityText, ...emdContentParts],
          trace: [...trace, cityCode.code, ...emdContentTrace],
        };
        // return 하지 않고 통과 — 2)~5) 단계에 기회를 준다.
      }
    }
    // 행정시 테이블(AdministrativeCity)에서 emdMatch.행정시명을 못 찾으면
    // (도 실사 불일치 등) 이 EMD 매칭은 신뢰하지 않고 무시한다 — 잘못된
    // 행정시로 단정하지 않는다(govType 가드·L2 원형키워드와 동일한
    // "정직한 미확정 처리" 원칙). 이후 단계(2·2.5·3 등)로 계속 진행.
  }

  // 2) 행정시만 언급(읍면동 특정 안 됨) → 시청 레이어만
  // ★ 2026-07-24 수정(100건 사고실험에서 발견) — "청년 월세 지원
  // 있어요?"에 제주시 PDV 힌트만 있는 경우, 예전엔 여기서 곧바로
  // 시청 공통 페이지로 확정해버려서 그보다 훨씬 구체적인 답을 줄 수
  // 있는 3)L2 실국 매칭이나 5)LLM 분류 폴백(WELFARE 등)까지 가지도
  // 못하고 끝났다. 발화 자체에 시 이름이 있으면(사용자가 명시적으로
  // 그 시를 지목) 기존처럼 즉시 확정하는 게 맞지만, PDV 힌트로만
  // 시가 잡히고 시청 국(局) 단위 매칭도 안 되고 classifyFn(AI)이
  // 있으면 — 즉시 확정하지 않고 이 결과를 폴백으로만 들고 뒤 단계
  // (L2/LLM)에 더 구체적인 매칭 기회를 먼저 준다. 아무것도 안 걸리면
  // 6)에서 이 폴백을 쓴다(기존 동작과 최종 결과는 동일 — 순서만 바뀜).
  const cityOnly = _matchCity(text, pdvLocationHint);
  let cityOnlyFallback = null;
  if (cityOnly) {
    const cityText = await _fetchCityText(cityOnly);

    // 2-1) 시청 국(局) 단위 매칭 (2026-07-23 신설, 2026-08-23 구조적
    // 강화) — 키워드 완전매칭이면 즉시 확정(고속경로, 기존과 동일).
    // 실패하면(kw 사전에 없는 새 표현) 조용히 포기하지 않고 이 시의
    // 모든 국(局) 후보를 LLM에게 한 번에 보여주고 직접 고르게 한다
    // (_resolveCityDeptMatch, BUG-024~027의 근본 원인 수정).
    const cityDeptMatch = await _resolveCityDeptMatch(text, cityOnly.시코드, classifyFn);
    if (cityDeptMatch) {
      parts.push(cityText);
      trace.push(cityOnly.code);
      const { text: cityDeptText, permitCodes: cityDeptPermitCodes } = await _fetchCityDeptText(cityDeptMatch, text);
      if (cityDeptText) {
        parts.push(cityDeptText);
        trace.push(`SP-CITYDEPT-${cityOnly.시코드}-${cityDeptMatch.국코드}`);
        if (cityDeptPermitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${cityDeptPermitCodes.join(',')})`);
        const divisionMatch = await _resolveCityDivision(text, cityDeptMatch, classifyFn);
        if (divisionMatch) {
          parts.push(await _fetchCityDivisionText(divisionMatch, null));
          trace.push(`${divisionMatch.code}(과/팀 특정)`);
        }
      }
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }

    if (cityOnly._matchedViaTextItself || !classifyFn) {
      // 발화 자체에 시 이름이 있으면(명시적 지목) 즉시 확정, 또는
      // classifyFn이 아예 없으면(AI 상담 불가) 기존처럼 즉시 확정.
      parts.push(cityText);
      trace.push(cityOnly.code);
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }

    // 힌트로만 시가 특정됐고, AI가 있으니 더 구체적인 매칭을 먼저
    // 시도한다 — 이 결과는 6)에서 아무것도 안 걸렸을 때만 쓴다.
    cityOnlyFallback = { parts: [...parts, cityText], trace: [...trace, cityOnly.code] };
  }

  // 2.5) 시군구 이름이 언급됐지만 정적 도시 테이블에는 없는 경우 —
  // 지연 초기화(worker.js /gov/sigungu-dept-resolve 호출, 비밀키 없음).
  // ★ 2026-07-20 재설계: classifyFn(AI)이 주입돼 있으면 여기서 즉시
  // 확정하지 않는다 — 정규식 오탐 가능성이 있어, AI가 있을 땐 5단계
  // LLM 분류 폴백에서 'SP-SIGUNGU-LAZY'를 다른 코드들과 동등한 후보로
  // 놓고 AI가 직접 판단하게 넘긴다(결정권을 코드→AI로 이동). classifyFn이
  // 없으면(상담할 AI 자체가 없음) 기존처럼 정규식이 즉시 판단한다 —
  // 하위호환 100% 유지.
  if (!classifyFn) {
    const sigunguGuess = _guessSigunguName(text, pdvLocationHint);
    if (sigunguGuess) {
      const domainGuess = _guessDomainFromText(text);
      if (domainGuess) {
        const resolved = await resolveSigunguDept(sigunguGuess, domainGuess, onProgress);
        parts.push(resolved.text);
        trace.push(`SP-SIGUNGU-LAZY(${sigunguGuess}/${domainGuess}/${resolved.source})`);
        await _appendExpertIfMatched();
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
    }
  }

  // 3) 실국 키워드 매칭 → 규칙 A: 짧은 체인
  const divMatch = _scoreMatch(text, _l2Table());
  if (divMatch) {
    // govType 가드(2026-07-21 신설) — 재산세 등 세정 키워드'만'으로
    // 매칭됐고 이 도가 GENERAL(기초자치단체 존재)이면, 도청이 아니라
    // 시군구 소관이므로 여기서 도청 L2로 확정하지 않는다.
    const _registryEntry = PROVINCE_REGISTRY[_resolveProvinceCode()];
    if (_registryEntry?.govType === 'GENERAL' && _isMunicipalTaxOnlyMatch(text, divMatch)) {
      const sigunguGuess = _guessSigunguName(text, pdvLocationHint);
      const domainGuess = _guessDomainFromText(text);
      if (sigunguGuess && domainGuess) {
        const resolved = await resolveSigunguDept(sigunguGuess, domainGuess, onProgress);
        parts.push(resolved.text);
        trace.push(`SP-SIGUNGU-LAZY(${sigunguGuess}/${domainGuess}/${resolved.source})`,
          '(govType 가드 — 세정은 시군구 소관, 도청 L2 매칭 우회)');
        await _appendExpertIfMatched();
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
      // 시/군/구 이름을 특정 못 하면 도청 소관으로 잘못 답하지 않고
      // 6)의 공통 레이어 응답으로 흘려보낸다(정직한 미확정 처리).
      trace.push('(govType 가드 — 세정은 시군구 소관이나 시군구명 미특정, 도청 L2 매칭 무시)');
    } else {
      const divText = await _fetchDeptText(divMatch);
      parts.push(divText.text);
      trace.push(divMatch.code);
      if (divText.permitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${divText.permitCodes.join(',')})`);
      const doDeptDivisionMatch = await _resolveDoDeptDivision(text, divMatch, classifyFn);
      if (doDeptDivisionMatch) {
        parts.push(await _fetchText(doDeptDivisionMatch.file, _currentProvinceRepo()));
        trace.push(`${doDeptDivisionMatch.code}(과 특정)`);
      }
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
  }

  // 3.5) 실국 원형키워드 매칭(2026-07-21 신설, L2Department 원형 —
  // 도 실사 여부와 무관). 여기 도달했다는 것 자체가 3단계 실사 매칭이
  // 확정 응답을 못 만들었다는 뜻이다.
  const canonicalDomain = _matchL2Canonical(text);
  if (canonicalDomain) {
    parts.push(_renderL2CanonicalFallback(canonicalDomain));
    trace.push(`SP-DO-${canonicalDomain.toUpperCase()}(원형 매칭, 도 실사 전)`);
    await _appendExpertIfMatched();
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // 4) 읍면동/실국 어느 쪽도 안 걸렸지만 업무영역만 매칭된 경우(예: 지역 언급 없이 "수돗물 냄새나요")
  // ★ 2026-07-24 수정(100건 사고실험에서 발견) — cityOnlyFallback이 있다는
  // 건 PDV 힌트로 시는 이미 알고 있다는 뜻이라, "지역 미특정" 문구를
  // 그대로 쓰면 모순이다(시청 페이지까지 이미 parts에 있는데 "지역
  // 모른다"고 말하는 셈). 이 경우엔 cityOnlyFallback 쪽(시청 정보 포함)에
  // 전문가 SP만 추가로 얹어 반환한다.
  if (isWaterQuery) {
    if (emdFallback) {
      const expText = await _fetchText('06-expert/SP-EXP-WATER_v1.1.md');
      emdFallback.parts.push(expText);
      emdFallback.trace.push('SP-EXP-WATER', '(1단계 힌트 전용 매칭 폴백 + 상하수도 전문 SP)');
      return { systemPrompt: emdFallback.parts.join('\n\n---\n\n'), trace: emdFallback.trace };
    }
    if (cityOnlyFallback) {
      const expText = await _fetchText('06-expert/SP-EXP-WATER_v1.1.md');
      cityOnlyFallback.parts.push(expText);
      cityOnlyFallback.trace.push('SP-EXP-WATER', '(2단계 힌트 전용 매칭 폴백 + 상하수도 전문 SP)');
      return { systemPrompt: cityOnlyFallback.parts.join('\n\n---\n\n'), trace: cityOnlyFallback.trace };
    }
    await _appendExpertIfMatched();
    trace.push('(지역 미특정 — SP-EXP-WATER가 먼저 지역 확인 유도)');
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // 5) 키워드 매칭 전부 실패 — LLM 분류 폴백 시도 (classifyFn 주입된 경우만).
  // "청년 월세 지원 있어요?"처럼 고유명사 없는 용건형 질문, "자치경찰이랑
  // 일반경찰 차이가 뭐예요"처럼 비교·설명형 질문은 정규식으로 못 잡는다 —
  // 여기서 LLM 자신에게 43개 코드 중 하나를 고르거나 NONE(=이 GOV-COMMON
  // 레이어 지식만으로 답 가능)을 판단하게 한다.
  const classified = await _classifyFallback(text, classifyFn);
  if (classified === 'SP-NATIONAL-LAZY') {
    // AI가 "이건 국가기관 지사 문제"라고 직접 판단한 경우 — 결정권은
    // AI에게 있고, 여기서는 도메인만 정규식으로 추출해 실행에 옮긴다
    // (시군구 LLM 분류 폴백과 완전히 동일한 철학).
    const natDomainGuess = _guessNatAgencyDomainFromText(text);
    if (natDomainGuess) {
      const cityHint = _guessSigunguName(text, pdvLocationHint);
      const nationalOnlyParts = [govCommon];
      const nationalSp = await _loadNationalSp();
      nationalOnlyParts.push(nationalSp);
      const resolved = await resolveNationalAgencyLazy(_resolveProvinceCode(), _provinceCodeToName(_resolveProvinceCode()), natDomainGuess, onProgress, cityHint);
      nationalOnlyParts.push(resolved.text);
      return {
        systemPrompt: nationalOnlyParts.join('\n\n---\n\n'),
        trace: ['JEJU-GOV-COMMON', 'JEJU-NATIONAL-SP', `SP-NATIONAL-LAZY(${natDomainGuess}${cityHint ? '/' + cityHint : ''}/${resolved.source})`, '(LLM 분류 폴백)'],
      };
    }
    // AI는 국가기관 문제라고 봤는데 정규식이 도메인을 못 뽑으면 — 억지로
    // 추측하지 않고 6)의 공통 레이어 응답으로 흘려보낸다.
  } else if (classified === 'SP-POLICY-LAZY') {
    // AI가 "이건 중앙부처 본청 정책 문제"라고 직접 판단한 경우 — 위
    // SP-NATIONAL-LAZY 분기와 동일한 철학, province 파라미터가 없다는
    // 점만 다르다(정책기관은 전국 단일 SP).
    const policyBodyGuess = _guessPolicyBodyFromText(text);
    if (policyBodyGuess) {
      const nationalOnlyParts = [govCommon];
      const nationalSp = await _loadNationalSp();
      nationalOnlyParts.push(nationalSp);
      const resolved = await resolvePolicyBodyLazy(policyBodyGuess, onProgress);
      nationalOnlyParts.push(resolved.text);
      const traceArr = ['JEJU-GOV-COMMON', 'JEJU-NATIONAL-SP', `SP-POLICY-LAZY(${policyBodyGuess}/${resolved.source})`, '(LLM 분류 폴백)'];
      // 2026-08-16 신설 — 위 -0.8) 분기와 동일한 division 매칭(중복 로직
      // 방지를 위해 _tryDivisionMatch 공유 헬퍼 재사용).
      const divMatch = await _tryDivisionMatch(policyBodyGuess, text, onProgress);
      if (divMatch) {
        nationalOnlyParts.push(divMatch.text);
        traceArr.push(`SP-POLICYDIV-LAZY(${policyBodyGuess}/${divMatch.부서코드}/${divMatch.source})`);
      }
      return {
        systemPrompt: nationalOnlyParts.join('\n\n---\n\n'),
        trace: traceArr,
      };
    }
  } else if (classified === 'SP-SIGUNGU-LAZY') {
    // AI가 "이건 시군구 문제"라고 직접 판단한 경우 — 결정권은 AI에게
    // 있고, 여기서는 그 판단을 실행에 옮기기 위해 이름·도메인만 정규식
    // 으로 추출한다(추출은 기계적 실행일 뿐, 판단 자체는 이미 AI가 끝냄).
    const sigunguGuess = _guessSigunguName(text, pdvLocationHint);
    const domainGuess = _guessDomainFromText(text);
    if (sigunguGuess && domainGuess) {
      const resolved = await resolveSigunguDept(sigunguGuess, domainGuess, onProgress);
      parts.push(resolved.text);
      trace.push(`SP-SIGUNGU-LAZY(${sigunguGuess}/${domainGuess}/${resolved.source})`, '(LLM 분류 폴백)');
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    // AI는 시군구 문제라고 봤는데 정규식이 이름·도메인을 못 뽑으면 —
    // 억지로 추측하지 않고 6)의 공통 레이어 응답으로 흘려보낸다.
  } else if (classified === 'SP-EMD-LAZY') {
    // ★ 2026-08-22 신설(사용자 지시 — 두 번째 근본결함 수정) — AI가
    // "이건 읍면동 민원팀 사무(등본·인감증명·가족관계증명·전입신고 등)"
    // 라고 판단했지만, 이 지점에 도달했다는 것 자체가 이미 앞선 1)
    // 단계(_matchEmd, 발화+pdvLocationHint 양쪽 다 검사)가 구체적
    // 읍면동 이름을 못 찾았다는 뜻이다 — 즉 위치 확보(Fix 1)가 실패한
    // 극소수 경우. 여기서 부서를 추측하는 대신 정직하게 위치를 되묻는다.
    //
    // ★ 2026-08-23 수정(BUG-034 배포 직후 라이브 스모크테스트 실측
    // 발견) — 위 주석의 전제("이 지점 도달 = 1)단계가 이미 실패")가
    // BUG-034 이후로는 더 이상 항상 참이 아니다. BUG-034가 emdMatch를
    // "위치 힌트로만" 확보한 경우 즉시 확정 대신 emdFallback에 보류하고
    // 뒤 단계에 기회를 주기 시작했는데, 그중 하나가 바로 이 5)단계라서
    // — 1)단계가 실제로는 "제주시 애월읍 애월리 123-4" 같은 완전한
    // 주소에서 '애월읍'을 정확히 찾아 emdFallback에 담아뒀는데도, 이
    // 5)단계에서 AI가 SP-EMD-LAZY를 고르면 그 사실을 모른 채 "어느
    // 읍면동에 거주하시나요"를 되물어버렸다(실사용에서는 이미 아는
    // 정보를 다시 묻는 모순) — BUG-034가 고친 문제와 정확히 대칭인
    // 새 회귀. emdFallback이 있으면(=1)단계가 실제로는 성공했었다는
    // 뜻) 위치를 되묻지 않고 그 결과를 그대로 확정한다.
    if (emdFallback) {
      await _appendExpertIfMatched();
      emdFallback.trace.push('(5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략)');
      return { systemPrompt: emdFallback.parts.join('\n\n---\n\n'), trace: emdFallback.trace };
    }
    throw new NeedsLocationSignal(
      '주민등록·인감증명 등은 거주하시는 읍면동(주민센터)에서 처리합니다. 어느 읍면동에 거주하시나요?'
    );
  } else if (classified) {
    if (_isNationalCode(classified)) {
      // 이미 parts에 SP-DO-000이 들어가 있으므로, 도청 트리를 걷어내고
      // 국가기관 트리로 다시 시작한다(JEJU-NATIONAL-SP §0: 배타적 형제 노드).
      const nationalOnlyParts = [govCommon];
      const nationalSp = await _loadNationalSp();
      nationalOnlyParts.push(nationalSp);
      const entry = _findTableEntry(classified);
      const natCityHint2 = _matchCity(text, pdvLocationHint);
      const { text: agencyText, permitCodes: agencyPermitCodes } = await _fetchNatText(entry, natCityHint2?.시코드 || null);
      nationalOnlyParts.push(agencyText);
      const natTrace = ['JEJU-GOV-COMMON', 'JEJU-NATIONAL-SP', classified, '(LLM 분류 폴백)'];
      if (agencyPermitCodes.length) natTrace.push(`PERMIT-CRITERIA-PROTOCOL(${agencyPermitCodes.join(',')})`);
      return {
        systemPrompt: nationalOnlyParts.join('\n\n---\n\n'),
        trace: natTrace,
      };
    }
    const entry = _findTableEntry(classified);
    if (entry) {
      const entryText = await _fetchDeptText(entry);
      parts.push(entryText.text);
      trace.push(classified, '(LLM 분류 폴백)');
      if (entryText.permitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${entryText.permitCodes.join(',')})`);
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
  }

  // 6) 그래도 안 걸리면(분류 결과 NONE 포함 — 비교·설명형 질문 등)
  // 도청 공통 레이어만 반환한다. 이건 실패가 아니라, 이런 질문은 원래
  // 특정 기관 SP 없이도 GOV-COMMON/DO-SP의 배경지식으로 충분히 답할 수
  // 있는 경우가 많다(예: 자치경찰 vs 국가경찰 차이 설명).
  // ★ 2026-07-24 수정(100건 사고실험에서 발견) — 2)에서 보류해둔
  // cityOnlyFallback이 있으면 완전히 빈손으로 끝내는 대신 그 시청
  // 페이지로 대체한다(더 구체적인 도메인 매칭은 다 실패했지만, PDV
  // 힌트로 시는 이미 알고 있었으므로 최소한 그 정보는 활용).
  // ★ 2026-08-23 신설 — 1)에서 보류해둔 emdFallback이 있으면
  // cityOnlyFallback보다 먼저 확인한다(EMD가 시청 일반보다 더 구체적인
  // 정보이므로). 뒤 단계(2~5)에서 더 정확한 매칭을 못 찾았다는 뜻이니,
  // 위치 힌트로 이미 확보해둔 이 결과를 최후의 수단으로 쓴다 — _matchCity
  // 의 cityOnlyFallback과 동일한 원칙.
  if (emdFallback) {
    await _appendExpertIfMatched();
    emdFallback.trace.push('(1단계 힌트 전용 매칭 폴백 — EMD가 위치 힌트로만 잡혀 2~5단계에 더 구체적인 매칭 기회를 먼저 줬으나 실패)');
    return { systemPrompt: emdFallback.parts.join('\n\n---\n\n'), trace: emdFallback.trace };
  }
  if (cityOnlyFallback) {
    await _appendExpertIfMatched();
    cityOnlyFallback.trace.push('(2단계 힌트 전용 매칭 폴백 — 3~5단계에서 더 구체적인 매칭 실패)');
    return { systemPrompt: cityOnlyFallback.parts.join('\n\n---\n\n'), trace: cityOnlyFallback.trace };
  }
  trace.push(classifyFn ? '(LLM 분류도 NONE — 공통 레이어 지식으로 답변)' : '(L2 미매칭 — 공통 레이어가 일반 안내만 제공)');
  return { systemPrompt: parts.join('\n\n---\n\n'), trace };
}

// ── 메인 진입점(export) ──────────────────────────────────────────
// _assembleGovSystemPromptRaw의 결과를 받아 §13b(PDV_HISTORY_REQUEST)
// scope 자리표시자를 trace 기반으로 치환한 뒤 반환한다. GOV_AGENCIES
// 쪽(worker.js handleGovRelay)의 서버측 치환과 동일한 목적 — LLM이
// scope 값을 추측하지 않게 한다(2026-07-04, 사고실험에서 발견된
// police/public/911 scope 불일치 버그와 동일 계열 문제를 jeju에서는
// 애초에 만들지 않기 위함).
// trace를 보고 /gov/relay에 넘길 agency 값을 판정한다 — worker.js
// GOV_AGENCIES/SP_DELEGATION_REGISTRY의 'gov_do'/'gov_national'과
// 반드시 동일한 문자열이어야 한다(어긋나면 UNKNOWN_AGENCY로 조용히
// 거부되는 사고가 난다 — SP-00-ROUTER v5.1 manifest 누락과 동일 유형).
// ★ 2026-07-21 개명 — 'jeju_do'/'jeju_national'이었다. 주피터 지시:
// "제주는 전국 광역시도 중 하나일 뿐인데 여전히 특별 취급해야 하는
// 이유는?" — 없다. JEJU-NATIONAL-SP/JEJU-DO-SP라는 트리 이름 자체는
// (파일명 등 여러 저장소에 걸친 문자열이라) 오늘은 그대로 두지만,
// 외부에 노출되는 agency 값만이라도 전국 중립적으로 바꾼다.
export function resolveGovAgency(trace) {
  return (trace || []).includes('JEJU-NATIONAL-SP') ? 'gov_national' : 'gov_do';
}
if (typeof window !== 'undefined') window.resolveGovAgency = resolveGovAgency;

// ── trace(개발자용 SP 코드 배열) → 사용자용 기관/부서 한글명 (2026-07-23 신설) ──
// 배경: 상단바 배지가 지금까지 trace.join(' > ')를 그대로 노출해
// "JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU" 같은 개발자용 코드가
// 사용자 화면에 그대로 보였다(실사로 지적됨). 각 매칭 테이블(JEJU_CITY_TABLE
// 등)의 kw 배열 첫 항목이 이미 그 기관/부서의 실제 한글 명칭이라는 점을
// 재사용해, trace를 다시 스캔해 가장 구체적인 명칭을 뽑아낸다 — 라우팅
// 로직 자체(_assembleGovSystemPromptRaw)는 건드리지 않는다.
// 2026-07-24 — 시청 국(局) 트레이스 파싱은 요청 당시의 province 컨텍스트가
// 아니라 trace 문자열만 갖고 사후에 호출될 수 있어(예: UI 배지 렌더링
// 시점), _cityDeptTable()(현재 컨텍스트의 province에 의존)을 쓰면 컨텍스트가
// 어긋날 위험이 있다. 시코드는 전국에서 유일하므로, 전체 도의 citydept
// 테이블을 한 번 평탄화해 시코드만으로 안전하게 조회한다.
const ALL_CITY_DEPT_ENTRIES = Object.values(PROVINCE_TABLES).flatMap(p => p.citydept || []);

export function resolveAgencyDisplayName(trace) {
  const t = Array.isArray(trace) ? trace : [];

  // 시청 국(局) 단위까지 특정된 경우가 가장 구체적 — 우선 확인
  for (const entry of t) {
    const m = /^SP-CITYDEPT-(\w+)-(\w+)$/.exec(entry);
    if (m) {
      const [, 시코드, 국코드] = m;
      const cityRec = Object.values(PROVINCE_TABLES).flatMap(p => p.city || []).find(c => c.시코드 === 시코드);
      const deptRec = ALL_CITY_DEPT_ENTRIES.find(d => d.시코드 === 시코드 && d.국코드 === 국코드);
      if (cityRec && deptRec) {
        const cityName = cityRec.kw.find(k => k.endsWith('청')) || cityRec.kw[0];
        return `${cityName} ${deptRec.kw[0]}`;
      }
    }
  }

  // 읍면동(행정복지센터) — SP-EMD-{읍면동명}에 이름이 그대로 들어있다
  for (const entry of t) {
    const m = /^SP-EMD-(.+)$/.exec(entry);
    if (m) {
      const cityEntry = t.find(e => _cityTable().some(c => c.code === e));
      const cityRec = cityEntry ? _cityTable().find(c => c.code === cityEntry) : null;
      return cityRec ? `${cityRec.kw[0]} ${m[1]}` : m[1];
    }
  }

  // 시청(국 단위 특정 없이 시 전체)
  for (const entry of t) {
    const cityRec = _cityTable().find(c => c.code === entry);
    if (cityRec) return cityRec.kw.find(k => k.endsWith('청')) || cityRec.kw[0];
  }

  // 국가기관
  for (const entry of t) {
    const natRec = _nationalTable().find(n => n.code === entry);
    if (natRec) return natRec.kw[0];
  }

  // 도청 실/국(局) 단위까지 특정된 경우
  for (const entry of t) {
    const l2Rec = _l2Table().find(l => l.code === entry);
    if (l2Rec) return l2Rec.kw[0];
  }

  return null; // 특정 안 됨 — 호출부가 "OO도청" 같은 일반 명칭으로 대체
}
if (typeof window !== 'undefined') window.resolveAgencyDisplayName = resolveAgencyDisplayName;

// ── 현재 요청의 판별된 도코드 노출 (2026-07-21 신설) ────────────────
// worker.js가 도별 동적 위임 렌더링(gov_do/gov_national)을 하려면
// provinceCode가 필요한데, 지금까지 /gov/relay 요청 바디에 이 정보가
// 아예 없었다(도 판별이 전부 클라이언트 쪽에만 있었음). resolveGovAgency와
// 동일하게 trace 계산 직후 바로 조회 가능하도록 export한다 — 호출부는
// assembleGovSystemPrompt(...) 완료 직후 이 함수를 호출하면 된다
// (모듈 전역 변수 _currentResolvedProvinceCode는 매 요청 시작 시
// 동기적으로 갱신되므로 순서만 지키면 안전).
export function resolveProvinceCode() {
  return _currentResolvedProvinceCode;
}
if (typeof window !== 'undefined') window.resolveProvinceCode = resolveProvinceCode;

// ── 경량 도 판별(SP 조립 없이) — 2026-07-21 신설 ────────────────────
// public/webapp.html처럼 지방행정 SP를 조립할 필요는 없지만(자기
// 서비스 고유 SP를 따로 쓴다) K-Public→gov_do/gov_national 위임 시
// provinceCode는 실어 보내야 하는 K-서비스를 위한 export. 도 판별에
// 필요한 데이터(시군구 목록, 읍면동 역색인)만 로드하고, 그 밖의 무거운
// SP 조립·네트워크 fetch는 전혀 하지 않는다 — assembleGovSystemPrompt()
// 전체를 부르는 것보다 훨씬 가볍다.
export async function guessProvinceCode(userText, pdvLocationHint = null) {
  const [sigunguList, emdNameIndex] = await Promise.all([
    _loadSigunguListForProvinceGuess(),
    _loadEmdNameToProvinceIndex(),
  ]);
  return _guessProvinceFromText(userText, sigunguList, emdNameIndex)
    || (pdvLocationHint ? _guessProvinceFromText(pdvLocationHint, sigunguList, emdNameIndex) : null);
}
if (typeof window !== 'undefined') window.guessProvinceCode = guessProvinceCode;

// ── G18(STAFF_REVIEW_GATE) handler_code — LLM 출력이 아니라 trace에서 결정
// (2026-07-19, 사용자 지적으로 설계 변경) ──────────────────────────────
// 애초 계획은 "handler_code 형식을 스키마 문서에 못박는다"였다. 그런데
// 이건 결국 LLM이 형식을 정확히 지킬 거라는 가정에 다시 기대는 것이고,
// 이 프로젝트가 오늘만도 여러 번 겪은 "프롬프트 지시 준수 여부에 기능이
// 좌우되는" 취약점을 하나 더 추가하는 셈이다. 라우터는 이번 턴에 어느
// 부서/시/읍면동으로 실제 매칭했는지 trace로 이미 정확히 알고 있으므로
// (SP-DO-WELFARE, SP-CITY-JEJU, SP-EMD-한림읍 형식 — 전부 이 파일이
// 직접 만든 문자열), LLM의 handler_code는 "게이트를 트리거했다"는 신호로만
// 쓰고, 실제 대상은 trace의 가장 구체적인(마지막) 노드에서 결정한다.
// SP-DO-000/JEJU-GOV-COMMON 같은 공통 레이어 노드는 "담당자"가 아니므로
// 건너뛰고, 실제 업무 단위(SP-DO-{domain}/SP-CITY-*/SP-EMD-*/SP-NAT-*)만
// 후보로 삼는다.
export function resolveHandlerCodeFromTrace(trace) {
  if (!Array.isArray(trace)) return null;
  for (let i = trace.length - 1; i >= 0; i--) {
    const t = trace[i];
    if (/^SP-(DO|CITY|EMD|NAT)-/.test(t)) return t;
  }
  return null;
}
if (typeof window !== 'undefined') window.resolveHandlerCodeFromTrace = resolveHandlerCodeFromTrace;

// ★ 2026-08-03 신설 — directCode: K-Search(SP-18)가 profiles 엔티티로
// 기관을 이미 정확히 특정한 경우(§ENTITY-LAUNCH), 아래 텍스트 추측
// 단계(-0.8 정책기관 키워드 매칭, 도 판별 등)를 전부 건너뛰고 해당
// 계층의 lazy resolver를 직접 호출한다. 형식: "{tier}:{code}" —
// 지금은 tier='policy'만 연결됨(정책기관 70개, resolvePolicyBodyLazy가
// 이미 code 단일 인자를 받는 구조라 가장 안전하게 먼저 연결). 나머지
// 5개 티어(do-dept/city-dept/do-agency/org/nat-agency)는 각 lazy
// resolver가 province/city 등 추가 인자를 요구해 매핑이 더 필요하므로
// 후속 패치로 넘긴다 — 지금 단계에서 그 티어들의 directCode는 조용히
// 무시되고 기존 텍스트 추측 경로로 정상 폴백된다(회귀 없음).
export async function assembleGovSystemPrompt(userText, pdvLocationHint = null, classifyFn = null, onProgress = null, directCode = null) {
  let result;
  try {
    result = await _assembleGovSystemPromptRaw(userText, pdvLocationHint, classifyFn, onProgress, directCode);
  } catch (e) {
    // ★ 2026-08-21 신설(사용자 지시 — 설계 공백 해소) — classifyFn이
    // 후보 중 2개 이상이 똑같이 그럴듯하다고 판단하면(CLARIFY 신호)
    // 여기서 잡아 needsClarification으로 반환한다. 호출부(pages/
    // regional-gov.html의 _callAI 등)는 이 필드가 있으면 SP를 조립해
    // AI를 부르는 대신, question/options로 사용자에게 직접 되묻는
    // 말풍선을 보여줘야 한다 — 잘못된 부서로 조용히 확정하지 않는다.
    if (e instanceof NeedsClarificationSignal) {
      return {
        systemPrompt: null,
        trace: ['JEJU-GOV-COMMON', '(의도 불명확 — 사용자 재질문 필요)'],
        needsClarification: {
          question: '어느 쪽에 가까운 용건인지 알려주시면 더 정확히 안내해드릴 수 있어요.',
          options: e.options,
        },
      };
    }
    // ★ 2026-08-22 신설(사용자 지시 — 두 번째 근본결함 수정) — 부서
    // 선택형 되묻기와 달리 위치를 몰라서 못 고르는 경우. options가
    // 비어있는 게 정상(자유형 질문) — 호출부는 이 필드를 보면 선택지
    // 목록 대신 question 텍스트만 그대로 보여줘야 한다.
    if (e instanceof NeedsLocationSignal) {
      return {
        systemPrompt: null,
        trace: ['JEJU-GOV-COMMON', '(위치 불명 — 사용자 재질문 필요)'],
        needsClarification: {
          question: e.question,
          options: [],
          isLocationQuestion: true,
        },
      };
    }
    throw e;
  }
  if (!_PDV_HISTORY_SCOPE_PLACEHOLDER_RE.test(result.systemPrompt)) return result;
  const scope = _resolvePdvScopeFromTrace(result.trace);
  return {
    ...result,
    systemPrompt: result.systemPrompt.replace(_PDV_HISTORY_SCOPE_PLACEHOLDER_RE, scope),
  };
}

if (typeof window !== 'undefined') window.assembleGovSystemPrompt = assembleGovSystemPrompt;
