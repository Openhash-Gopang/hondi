// ═══════════════════════════════════════════════════════════
// gov-template-renderer.js v1.1 — 제주 기관 SP 조립 엔진 (SP-AUTHOR 템플릿 렌더러)
//
// ★ 2026-07-12 파일명 분리 — 이 파일은 2026-07-08 신설 당시 "jeju-router.js"라는
// 이름을 썼으나, Openhash-Gopang/jeju 독립 저장소의 jeju-router.js(실제
// jeju.hondi.net을 서빙하는 프론트엔드 라우터, resolveJejuAgency/
// assembleJejuSystemPrompt)와 이름이 겹쳐 혼동 위험이 있었다. 두 파일은
// 목적·export 함수가 완전히 다르다(이 파일은 jeju.hondi.net 실트래픽과
// 무관 — SP-AUTHOR PHASE A~E가 "기존 템플릿 조립" 경로를 택했을 때만
// 호출되는 오프라인/관리자용 렌더링 엔진). 2026-07-09/07-11에 두 차례
// 정정 주석을 남긴 뒤, 2026-07-12에 예고했던 대로 파일명을
// gov-template-renderer.js로 분리했다 — 이제 이름만으로 jeju 저장소의
// jeju-router.js와 구분된다. import/require 경로로 이 파일을 참조하는
// 코드는 없었음을 확인(2026-07-12, gopang 모노레포 전체 grep)했으므로
// 이 이름 변경 자체는 파괴적 변경이 아니다 — 단, 이 파일을 수동으로
// fetch·복사해 쓰던 외부 스크립트가 있다면 경로를 갱신해야 한다.
//
// 여러 문서(national-agency-master-data.json 주석 등)가 "_renderNatTemplate()이
// domain으로 template을 찾고 도코드로 레코드를 찾아 자리표시자를 채운다"고
// 전제해왔으나 실제 구현 파일이 존재하지 않았다(2026-07-08 확인). 이 파일이
// 그 전제를 실제 코드로 채운다 — SP-AUTHOR(PHASE A~E)가 "기존 템플릿 조립"
// 경로를 선택했을 때 실제로 호출하는 엔진이 바로 이것이다.
//
// 설계 원칙:
//   1. 모든 계층(do-dept/national/city/emd)이 "템플릿 파일 + master-data.json
//      레코드"라는 동일 철학을 쓰므로, 계층별 함수는 공통 렌더러
//      (_renderTemplate)의 얇은 래퍼로만 존재한다 — 계층마다 로직을
//      새로 짜지 않는다.
//   2. 레코드 값이 문자열이면 단순 치환, 배열/객체면 마크다운으로
//      자동 직렬화한다(05-emd 레코드처럼 중첩 구조가 있는 경우 대비).
//   3. 템플릿에 있지만 레코드에 없는 자리표시자(예: {DO_ROOT_SP},
//      {GOV_COMMON}, {읍면동})는 조용히 무시하지 않고 unresolved 목록으로
//      반환한다 — 이런 토큰은 이 엔진의 몫이 아니라 상위 조립 단계(다른
//      문서 삽입, 런타임 개인화)의 몫이므로, 호출자가 알고 처리하게 한다.
//   4. 실패를 삼키지 않는다 — 레코드를 못 찾으면 빈 문자열이 아니라
//      명시적 에러를 던진다(SP-AUTHOR PHASE A가 "계층 판별 실패"를
//      정확히 구분해야 하기 때문).
// ═══════════════════════════════════════════════════════════

const _RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/hondi/main/';

const TIER_CONFIG = {
  // 2026-07-10 신설 — 과(課) 계층. 도청 실·국(do-dept)/시청 국(city-dept)
  // 산하에 공통으로 존재하는 가장 세부적인 처분 단위. "소속기관코드"는
  // city-dept의 (시코드-국코드) 또는 do-dept의 (도코드-domain)을 하이픈으로
  // 이어붙인 값을 그대로 재사용해 상위 계층과 매칭한다.
  'division': {
    masterDataPath: 'prompts/gov-tree/00-common/templates/division-master-data.json',
    listKey: '과목록',
    templateDir: 'prompts/gov-tree/00-common/templates/',
    fixedTemplate: 'SP-DIV-TEMPLATE_v1.0.md',
    matchFn: (rec, { orgCode, divCode }) => rec['소속기관코드'] === orgCode && rec['과코드'] === divCode,
  },
  // 2026-07-10 신설 — 시청 국(局) 계층. jeju-gov-sp-hierarchy.md가 SP-JEJUSI-*/
  // SP-SGP-*로 예정해뒀으나 실제로 만들어진 적 없던 계층. city 계층과 같은
  // fixedTemplate 패턴(제주시/서귀포시 모두 같은 국 원형을 공유) — 국코드로
  // 시별 실제 조직명·소관을 구분한다.
  'city-dept': {
    masterDataPath: 'prompts/gov-tree/04-city/templates/city-dept-master-data.json',
    listKey: '국목록',
    templateDir: 'prompts/gov-tree/04-city/templates/',
    fixedTemplate: 'SP-CITYDEPT-TEMPLATE_v1.0.md',
    matchFn: (rec, { cityCode, deptCode }) => rec['시코드'] === cityCode && rec['국코드'] === deptCode,
  },
  // 2026-07-10 신설, 같은 날 184개 실제 인스턴스로 확장 — 읍면동 팀 계층.
  // jeju-gov-sp-hierarchy.md가 SP-TEAM-*로 예정해뒀으나 실제로 만들어진
  // 적 없던 계층. 처음엔 team_type 4종만 원형화했으나, emd-master-data.json/
  // hallim-data.json에 이미 읍면동별 실제 팀구성 데이터가 있어 43개
  // 읍면동 전체를 (emd_code, team_code) 실제 인스턴스로 확장했다.
  // 2026-07-13 갱신 — 팀마다 실제 업무 성격이 크게 달라(§CAPABILITIES가
  // 팀마다 다름 — 예: 민원팀의 여권/등기부등본/개명신고 불가 조항은
  // 총무팀엔 없음) 단일 SP-TEAM-TEMPLATE 하나로는 얕았다. team_code별
  // 5종 원형(SP-TEAM-{GENERAL|CIVIL|WELFARE|OUTREACH|INDUSTRY}-
  // TEMPLATE_v2.0.md)으로 교체 — fixedTemplate은 폴백(레코드 누락 시
  // general로 처리)이고, 실제로는 각 레코드의 `template` 필드(아래
  // team-master-data.json에 team_code별로 채워둠, _renderTemplate
  // L225의 `record.template || cfg.fixedTemplate` 우선순위 로직 그대로
  // 재사용)가 우선 적용된다.
  'team': {
    masterDataPath: 'prompts/gov-tree/05-emd/templates/team-master-data.json',
    listKey: '팀목록',
    templateDir: 'prompts/gov-tree/05-emd/templates/',
    fixedTemplate: 'SP-TEAM-GENERAL-TEMPLATE_v2.1.md',
    matchFn: (rec, { emdCode, teamCode }) => rec.emd_code === emdCode && rec.team_code === teamCode,
  },
  'do-dept': {
    masterDataPath: 'prompts/gov-tree/02-do-dept/templates/do-dept-master-data.json',
    listKey: '부서목록',
    templateDir: 'prompts/gov-tree/02-do-dept/templates/',
    matchFn: (rec, { domain, doCode }) => rec.domain === domain && rec['도코드'] === doCode,
  },
  'national': {
    masterDataPath: 'prompts/gov-tree/09-national/agencies/templates/national-agency-master-data.json',
    listKey: '기관목록',
    templateDir: 'prompts/gov-tree/09-national/agencies/templates/',
    matchFn: (rec, { domain, doCode }) => rec.domain === domain && rec['도코드'] === doCode,
  },
  'city': {
    masterDataPath: 'prompts/gov-tree/04-city/templates/city-master-data.json',
    listKey: '시목록',
    templateDir: 'prompts/gov-tree/04-city/templates/',
    fixedTemplate: 'SP-CITY-TEMPLATE_v1.0.md',
    matchFn: (rec, { cityCode }) => rec['시코드'] === cityCode,
  },
  'emd': {
    // 2026-07-13 갱신 — AGENCY-AC-COMMON 공리 0(main()/submodule) 반영,
    // 구 SP-EMD-TEMPLATE_v1.2(단일 평면 SP)를 SP-EMD-AGENT-COMMON-
    // TEMPLATE_v1.0(읍면동 AC 원형)으로 교체. 읍면동도 팀(§3 COMPOSE)
    // 여러 개를 조합하는 2단계 조직이므로 도청 실·국·시청 국과
    // 동일하게 AC가 필요하다는 판단(AC-AUTHOR PHASE 0 적용).
    masterDataPath: 'prompts/gov-tree/05-emd/emd-master-data.json',
    listKey: '읍면동목록',
    templateDir: 'prompts/gov-tree/05-emd/agent-common/',
    fixedTemplate: 'SP-EMD-AGENT-COMMON-TEMPLATE_v1.1.md',
    matchFn: (rec, { emdCode }) => rec.emd_code === emdCode,
  },
  // 2026-07-09 신설 — 전국 단일 창구형 정책기관(19부·4헌법기관·6대통령직속·
  // 12총리직속, 총 41개). 기존 'national' 계층(도별 지사, domain별 별도
  // 템플릿)과 달리 도코드 개념이 없다 — 국민권익위원회에 "제주지사"는
  // 없으므로, city/emd 계층과 같은 fixedTemplate 패턴을 쓴다. matchFn이
  // domain만으로 매칭하는 게 city(cityCode)·emd(emdCode)와의 유일한 차이다.
  'policy': {
    masterDataPath: 'prompts/gov-tree/09-national/policy-bodies/templates/policy-bodies-master-data.json',
    listKey: '기관목록',
    templateDir: 'prompts/gov-tree/09-national/policy-bodies/templates/',
    fixedTemplate: 'SP-NAT-POLICY-TEMPLATE_v1.0.md',
    matchFn: (rec, { domain }) => rec.domain === domain,
  },
  // 2026-07-09 신설 — 광역자치단체(도·특별시·광역시) 계층. 지금까지
  // 이 파일은 "제주"라는 단일 광역단체 안의 하위 계층(부서/시/읍면동/
  // 정책기관)만 다뤘는데, 이번에 광역단체 자기 자신을 템플릿화하는
  // 최상위 계층을 신설한다 — GOV-TIER-IO-SCHEMA_v1_0 Tier A 대응.
  // city 계층과 같은 fixedTemplate 패턴(도코드 하나로 단순 매칭,
  // domain 개념 없음). ★ 파일럿 단계 — 경기도 1건만 실제 레코드 있음,
  // 나머지 16개 광역시도는 미등재(레코드 없음 에러 → SP-AUTHOR PHASE B
  // 진행 신호, 기존 원칙 그대로).
  'province': {
    masterDataPath: 'prompts/gov-tree/01-do/templates/province-master-data.json',
    listKey: '도목록',
    templateDir: 'prompts/gov-tree/01-do/templates/',
    fixedTemplate: 'SP-PROVINCE-TEMPLATE_v1.1.md',
    matchFn: (rec, { doCode }) => rec['도코드'] === doCode,
  },
};

// ── 캐시 ──────────────────────────────────────────────────
const _masterDataCache = new Map(); // tier -> parsed json
const _templateCache = new Map();   // tier+filename -> text

async function _fetchText(relPath) {
  const res = await fetch(_RAW + relPath, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`jeju-router: fetch 실패 (${res.status}) — ${relPath}`);
  return res.text();
}

async function _loadMasterData(tier) {
  if (_masterDataCache.has(tier)) return _masterDataCache.get(tier);
  const cfg = TIER_CONFIG[tier];
  if (!cfg) throw new Error(`jeju-router: 알 수 없는 tier — ${tier}`);
  const text = await _fetchText(cfg.masterDataPath);
  const json = JSON.parse(text);
  _masterDataCache.set(tier, json);
  return json;
}

async function _loadTemplate(tier, filename) {
  const cacheKey = tier + '::' + filename;
  if (_templateCache.has(cacheKey)) return _templateCache.get(cacheKey);
  const cfg = TIER_CONFIG[tier];
  const text = await _fetchText(cfg.templateDir + filename);
  _templateCache.set(cacheKey, text);
  return text;
}

// ── 값 직렬화 (배열/객체 → 마크다운) ───────────────────────
function _serializeValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '(없음)';
    if (typeof value[0] === 'object' && value[0] !== null) {
      // 객체 배열 → 마크다운 표 (모든 원소가 같은 키 집합을 공유한다고 가정)
      const keys = Object.keys(value[0]);
      const header = `| ${keys.join(' | ')} |`;
      const sep = `|${keys.map(() => '---').join('|')}|`;
      const rows = value.map((row) => `| ${keys.map((k) => row[k] ?? '').join(' | ')} |`);
      return [header, sep, ...rows].join('\n');
    }
    // 문자열 배열 → 불릿 리스트
    return value.map((v) => `- ${v}`).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `- ${k}: ${_serializeValue(v)}`)
      .join('\n');
  }
  return String(value);
}

// ── 공통 렌더러 — 순수 함수(테스트 용이) ───────────────────
// meta 키(domain/template/도코드/시코드/emd_code 등 라우팅 전용 키)는
// 본문 치환 대상에서 제외한다 — 그 값 자체가 SP 본문에 노출될 이유가
// 없고(내부 조회 키일 뿐), 실수로 {domain} 같은 토큰이 우연히 일치해
// 엉뚱한 값이 들어가는 것도 막는다.
const _META_KEYS = new Set(['domain', 'template', '_비고', '_schema_설명', '_meta']);

export function _renderTemplate(templateText, record) {
  const usedKeys = new Set();
  const rendered = templateText.replace(/\{([^{}]+)\}/g, (whole, key) => {
    if (_META_KEYS.has(key)) return whole; // meta 키는 애초에 치환 후보가 아님
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      usedKeys.add(key);
      return _serializeValue(record[key]);
    }
    return whole; // 레코드에 없으면 그대로 남김 (unresolved로 보고)
  });

  const allTokens = Array.from(templateText.matchAll(/\{([^{}]+)\}/g)).map((m) => m[1]);
  const unresolved = [...new Set(allTokens.filter((t) => !usedKeys.has(t) && !_META_KEYS.has(t)))];

  return { text: rendered, unresolved };
}

// ── 계층별 조립 ─────────────────────────────────────────────
async function _assemble(tier, matchParams) {
  const cfg = TIER_CONFIG[tier];
  const masterData = await _loadMasterData(tier);
  const list = masterData[cfg.listKey];
  if (!Array.isArray(list)) {
    throw new Error(`jeju-router: master-data 형식 이상 — ${tier}.${cfg.listKey}가 배열이 아님`);
  }
  const record = list.find((rec) => cfg.matchFn(rec, matchParams));
  if (!record) {
    throw new Error(
      `jeju-router: 레코드 없음 — tier=${tier}, params=${JSON.stringify(matchParams)}. ` +
      `SP-AUTHOR PHASE A는 이 에러를 "기존 템플릿 없음 → 신규 초안 필요"로 해석해야 한다.`
    );
  }
  const templateFilename = record.template || cfg.fixedTemplate;
  if (!templateFilename) {
    throw new Error(`jeju-router: 레코드에 template 필드가 없고 tier 기본 템플릿도 없음 — ${tier}`);
  }
  const templateText = await _loadTemplate(tier, templateFilename);
  const { text, unresolved } = _renderTemplate(templateText, record);
  return { text, unresolved, record, templateFilename, tier };
}

/**
 * 과(課) 계층 조립 — 소속기관코드+과코드 매칭.
 * 예: _renderDivisionTemplate('jejusi-welfare', 'elderly') → 제주시 복지위생국 노인복지과 SP 조립.
 */
export async function _renderDivisionTemplate(orgCode, divCode) {
  return _assemble('division', { orgCode, divCode });
}

/**
 * 시청 국(局) 계층 조립 — 시코드+국코드 매칭.
 * 예: _renderCityDeptTemplate('jejusi', 'welfare') → 제주시 복지위생국 SP 조립.
 */
export async function _renderCityDeptTemplate(cityCode, deptCode) {
  return _assemble('city-dept', { cityCode, deptCode });
}

/**
 * 읍면동 팀 계층 조립 — (emd_code, team_code) 매칭, 43개 읍면동 전체
 * 실제 인스턴스(2026-07-10 확장, 184건). {읍면동이름}/{시이름}/{도이름}
 * 전부 생성 시점에 emd-master-data.json에서 미리 채워져 있다.
 * 예: _renderTeamTemplate('SP-EMD-HALLIM', 'civil') → 한림읍 민원팀 SP 조립.
 */
export async function _renderTeamTemplate(emdCode, teamCode) {
  return _assemble('team', { emdCode, teamCode });
}

/** do-dept 계층 조립 — {부서명} 등 자리표시자를 도코드+domain으로 채움 */
export async function _renderDoDeptTemplate(domain, doCode = 'jeju') {
  return _assemble('do-dept', { domain, doCode });
}

/** 09-national 계층 조립 — jeju-national-agency-catalog.md 주석이 예고했던 함수 */
export async function _renderNatTemplate(domain, doCode = 'jeju') {
  return _assemble('national', { domain, doCode });
}

/** 04-city 계층 조립 — 시코드(jejusi/seogwipo) 단일 매칭, domain 개념 없음 */
export async function _renderCityTemplate(cityCode) {
  return _assemble('city', { cityCode });
}

/** 05-emd 계층 조립 — emd_code(예: SP-EMD-AEWOL) 단일 매칭 */
export async function _renderEmdTemplate(emdCode) {
  return _assemble('emd', { emdCode });
}

/**
 * 정책기관(전국 단일 창구) 계층 조립 — domain만으로 매칭, 도코드 없음.
 * 예: _renderPolicyTemplate('acrc') → 국민권익위원회 SP 조립.
 * 'national' 계층과 혼동 주의 — 그쪽은 도별 지사(도코드 필수), 이쪽은
 * 전국에 인스턴스가 하나뿐인 기관이다. 사용자 요청이 어느 계층 소관인지
 * 판별하는 라우팅 규칙 자체는 이 파일의 책임이 아니다(POLICY-BODIES-
 * WORK-LOG_2026-07-09.md §4-4, 다음 과제로 남겨둠).
 */
export async function _renderPolicyTemplate(domain) {
  return _assemble('policy', { domain });
}

/**
 * 광역자치단체(도청/특별시청/광역시청) 계층 조립 — 도코드 단일 매칭,
 * domain 개념 없음(city 계층과 동일 패턴).
 * 예: _renderProvinceTemplate('gyeonggi') → 경기도청 SP 조립.
 * ★ 2026-07-09 파일럿 — province-master-data.json에 경기도 1건만
 * 등재돼 있다. 다른 도코드로 호출하면 "레코드 없음" 에러가 나는 게
 * 정상이다(SP-AUTHOR가 신규 조사 신호로 해석).
 */
export async function _renderProvinceTemplate(doCode) {
  return _assemble('province', { doCode });
}

/**
 * SP-AUTHOR PHASE A/B가 호출하는 단일 진입점.
 * tier를 이미 판별했다는 전제 하에, 계층에 맞는 params만 넘기면 된다.
 * 레코드가 없으면(=아직 아무도 이 기관을 템플릿화한 적 없으면) 에러가 나며,
 * SP-AUTHOR는 이걸 "PHASE B(웹검색+data.go.kr 조사)로 진행해 새 레코드를
 * 만들어야 한다"는 신호로 받아들인다 — 조용히 빈 SP를 반환하지 않는다.
 */
export async function assembleGovSP(tier, params) {
  return _assemble(tier, params);
}
