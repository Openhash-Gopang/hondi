// SP-INTERCALL 오케스트레이션 실제 코드 검증 하네스
// worker.js를 그대로 import해서 실제 handleGovRelay 경로를 통과시킨다
// (재구현이 아니라 실행 결과로 검증 — 기존 라우팅 검증과 동일한 방식).
//
// [2026-08-06 수정 — 사전 존재 버그] worker.js가 gov-router.js를 정적
// import하고, gov-router.js 최상단에 `window.resolveGovAgency = ...`
// 등 6개 비가드 전역 할당이 있다(§215행의 `typeof window !== 'undefined'`
// 가드와 달리 무가드). ESM은 정적 import를 다른 모든 코드보다 먼저
// 로드·실행하므로, 이 파일 하단에 `globalThis.window = globalThis`를
// 아무리 일찍 적어도 정적 `import worker from '../../worker.js'`가 이미
// 그 전에 gov-router.js를 실행해버려 `window is not defined`로 죽는다.
// gov-router.test.mjs 등 다른 테스트 파일들이 이미 쓰고 있는 패턴(전역을
// 먼저 세팅한 뒤 동적 import로 전환)을 그대로 따른다.
globalThis.window = globalThis;
const { default: worker } = await import('../../worker.js');

// ── DeepSeek 응답 스크립트 ────────────────────────────────
// 시나리오별로 순서대로 소비되는 응답 큐. agency 호출과 상관없이
// 실제 코드가 몇 번, 어떤 순서로 fetch(DEEPSEEK_URL, ...)를 호출하는지
// 그대로 관찰한다.
let deepseekQueue = [];
let deepseekCallLog = [];

const PROMPT_FILES = {
  'UNIVERSAL-INTEGRITY_v1_0.md': '[UNIVERSAL-INTEGRITY 텍스트]',
  'UNIVERSAL-common_v1_1.md':    '[UNIVERSAL-common v1.1 텍스트 — U9 포함]',
  'K-Public_common_v1_3.md':     '[K-Public_common 텍스트]',
  'PROFESSIONAL-common_v1_0.md': '[PROFESSIONAL-common 텍스트]',
  'sp-catalog.json': JSON.stringify({
    'SP-04_khealth': 'SP-04_khealth_v2.1.txt',
    'SP-10_kpublic': 'SP-10_kpublic_v3.4.txt',
    // ★ 2026-08-30 추가 — 2026-07-21 gov_do/gov_national dynamicRegional
    // 재설계로 새로 생긴 매니페스트 경유 파일 3종(SP-PROVINCE-TEMPLATE,
    // NATIONAL-SP-CORE, NATIONAL-SP-OVERLAY-TEMPLATE). 옛 정적 파일
    // (JEJU-DO-SP_v1.5.md 등)은 더 이상 이 경로에서 안 쓰이지만, 다른
    // 위임 대상(via:'url')이 참조할 수 있어 그대로 남겨둔다.
    'SP-PROVINCE-TEMPLATE':         'SP-PROVINCE-TEMPLATE_v1.1.md',
    'NATIONAL-SP-CORE':             'NATIONAL-SP-CORE_v1.2.md',
    'NATIONAL-SP-OVERLAY-TEMPLATE': 'NATIONAL-SP-OVERLAY-TEMPLATE_v1.0.md',
    'GOV-COMMON-OVERLAY-TEMPLATE':  'GOV-COMMON-OVERLAY-TEMPLATE_v1.1.md',
    'GOV-TREE-PROTOCOL':            'JEJU-TREE-PROTOCOL_v1.0.md',
    // [2026-08-06 추가 — 사전 존재 버그] 실제 sp-catalog.json(prompts/)에는
    // 있지만 이 목에는 빠져 있던 4개 키. UNIVERSAL-INTEGRITY·UNIVERSAL-
    // common·PROFESSIONAL-common은 PROMPT_FILES에 내용까지 이미 있었는데
    // 카탈로그 쪽 키-파일명 매핑만 빠져 있어 "manifest 키 없음"으로
    // 조용히 실패하고 있었다(HUMAN-AUTHORITY-GATE-SCHEMA·PDV-TRANSFER-
    // PROTOCOL은 코드가 로드 실패를 무시하도록 이미 방어돼 있어 그대로 둠
    // — 아래 두 줄은 그래도 붙여서 그 무시 경로 자체가 잘 도는지도 함께
    // 확인).
    'UNIVERSAL-INTEGRITY':          'UNIVERSAL-INTEGRITY_v1_0.md',
    'UNIVERSAL-common':             'UNIVERSAL-common_v1_1.md',
    'PROFESSIONAL-common':          'PROFESSIONAL-common_v1_0.md',
    'HUMAN-AUTHORITY-GATE-SCHEMA':  'HUMAN-AUTHORITY-GATE-SCHEMA_v1_0.md',
    'PDV-TRANSFER-PROTOCOL':        'PDV-TRANSFER-PROTOCOL_v1_0.md',
    'K-Public_common':              'K-Public_common_v1_3.md',
  }),
  'SP-04_khealth_v2.1.txt': '[K-Health SP 텍스트]',
  // ★ 2026-07-09 추가 — jeju_do/jeju_national이 이제 kgov+OVERLAY+
  // TREE-PROTOCOL 상위 체인을 fetch한다(worker.js _loadGovCommonChain).
  // 'public' 항목과 동일 소스(SP-10_kpublic)를 kgov로 재사용하므로
  // 실제 파일명과 맞춰뒀다.
  'SP-10_kpublic_v3.4.txt': '[kgov(SP-10_kpublic) 텍스트]',
  'GOV-COMMON-OVERLAY-TEMPLATE_v1.1.md':
    '[오버레이 템플릿] {도이름} {콜센터명} {콜센터번호} {출자기관예시_문구} {행정시목록_문구} {관할예시_문구}',
  'gov-common-overlay-master-data.json': JSON.stringify({
    도목록: [{ 도코드: 'jeju', 도이름: '제주특별자치도', 콜센터명: '제주콜센터', 콜센터번호: '064-120',
      출자기관예시_문구: '(테스트)', 행정시목록_문구: '제주시와 서귀포시', 관할예시_문구: '(테스트)' }],
  }),
  'JEJU-TREE-PROTOCOL_v1.0.md': '[JEJU-TREE-PROTOCOL 텍스트]',
  // ★ 2026-08-20 신설 — _loadGovCommonChain이 AGENCY-AC-COMMON도 함께
  // 조립한다(직접 fetch, GITHUB_RAW_BASE + 경로 + 캐시버스팅 쿼리).
  'AGENCY-AC-COMMON_v1.5.md': '[AGENCY-AC-COMMON 텍스트]',
  // ★ 2026-08-30 추가 — gov_do/gov_national의 2026-07-21 dynamicRegional
  // 재설계로 필요해진 도별 동적 렌더링 원본. 옛 JEJU-DO-SP_v1.5.md/
  // JEJU-NATIONAL-SP_v1.0.md는 이 경로에서 더는 안 읽히지만(다른
  // 위임 대상이 참조할 수 있어 아래에 그대로 둠), 실제로 렌더링에
  // 쓰이는 건 이 템플릿+마스터데이터 조합이다.
  'SP-PROVINCE-TEMPLATE_v1.1.md':
    '[제주도청 총괄 SP 텍스트] {도이름}({도코드}) {통치구조_문구} {이원화_문구} {인접기관_문구} {광역출력_문구} {위임사무_문구} {하위SP_접두어} {유의사항_추가}',
  'province-master-data.json': JSON.stringify({
    도목록: [{ 도코드: 'jeju', 도이름: '제주특별자치도', 통치구조_문구: '(테스트)', 이원화_문구: '(테스트)',
      인접기관_문구: '(테스트)', 광역출력_문구: '(테스트)', 위임사무_문구: '(테스트)', 하위SP_접두어: 'SP-CITY',
      유의사항_추가: '' }],
  }),
  'NATIONAL-SP-CORE_v1.2.md': '[제주 국가기관 총괄 SP 텍스트]',
  'NATIONAL-SP-OVERLAY-TEMPLATE_v1.0.md': '[국가기관 오버레이 템플릿] {도이름}',
  'national-sp-overlay-master-data.json': JSON.stringify({
    도목록: [{ 도코드: 'jeju', 도이름: '제주특별자치도' }],
  }),
  'national-agency-master-data.json': JSON.stringify({ 기관목록: [] }),
  // BUG-FIX(2026-07-17): worker.js SP_DELEGATION_REGISTRY.jeju_do.url이
  // .../01-do/JEJU-DO-SP_v1.5.md를 가리키는데(버전 올라감) 이 목은 예전
  // v1.0 파일명 그대로 남아있어 실제로는 404를 돌려주고 있었다(테스트가
  // "위임 대상 SP 로드 실패" 예외 경로를 조용히 타면서 LLM 호출 횟수 등
  // 나머지 검증이 줄줄이 어긋남). ★ 2026-08-30 — 이 두 파일은 이제
  // gov_do/gov_national dynamicRegional 경로에서는 안 쓰이지만(위 새
  // 템플릿으로 대체됨), via:'url' 레거시 경로용으로 남겨둔다.
  'JEJU-DO-SP_v1.5.md':       '[제주도청 총괄 SP 텍스트(레거시 정적 파일)]',
  'JEJU-NATIONAL-SP_v1.0.md': '[제주 국가기관 총괄 SP 텍스트(레거시 정적 파일)]',
  'HUMAN-AUTHORITY-GATE-SCHEMA_v1_0.md': '[HUMAN-AUTHORITY-GATE-SCHEMA 텍스트]',
  'PDV-TRANSFER-PROTOCOL_v1_0.md':       '[PDV-TRANSFER-PROTOCOL 텍스트]',
};

global.fetch = async (url, opts = {}) => {
  const u = String(url);

  if (u.includes('api.deepseek.com')) {
    const body = JSON.parse(opts.body);
    deepseekCallLog.push({ model: body.model, lastMsg: body.messages[body.messages.length - 1], messages: body.messages });
    const next = deepseekQueue.shift();
    if (!next) throw new Error('deepseekQueue 고갈 — 예상보다 LLM 호출이 많음(무한루프 의심)');
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: next } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    };
  }

  if (u.includes('raw.githubusercontent.com')) {
    // ★ 2026-08-30 수정 — AGENCY-AC-COMMON 등 일부 fetch가 캐시버스팅
    // 쿼리스트링(?t=...)을 붙이는데, 기존엔 u.split('/').pop()이 그
    // 쿼리까지 파일명에 포함시켜 PROMPT_FILES 매칭에 실패했다. 쿼리를
    // 떼고 매칭한다.
    const fname = u.split('/').pop().split('?')[0];
    const content = PROMPT_FILES[fname];
    if (content == null) return { ok: false, status: 404 };
    return { ok: true, text: async () => content, json: async () => JSON.parse(content) };
  }

  throw new Error('예상치 못한 fetch 대상: ' + u);
};

function makeEnv() { return { DEEPSEEK_API_KEY: 'test-key' }; } // KV 미설정 → 과금은 0으로 처리(정상)

function makeRequest(payload) {
  return new Request('https://worker.example/gov/relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://public.hondi.net' },
    body: JSON.stringify(payload),
  });
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name} — ${detail || ''}`); }
}

async function run(name, queue, payload) {
  deepseekQueue = [...queue];
  deepseekCallLog = [];
  const res = await worker.fetch(makeRequest(payload), makeEnv(), { waitUntil: (p) => p.catch(() => {}) });
  const data = await res.json();
  return { res, data, calls: deepseekCallLog, leftoverQueue: deepseekQueue.length };
}

// ═══════════════════════════════════════════════════════════
// 시나리오 1 — 정상 위임: public → jeju_national → 최종 합성 (LLM 3회)
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('정상 위임', [
    JSON.stringify({ sp_call: { target: 'gov_national', purpose: '국세 확인', query: '국세 체납액 확인' } }), // 1차: 위임 요청
    '국세 체납 조회는 홈택스 연동이 필요합니다.',                                                              // 2차: 위임 대상(gov_national) 답변
    '제주 소재 국가기관 확인 결과, 국세는 홈택스에서 확인 필요합니다. 지방세는 0원입니다.',                     // 3차: 원 SP 최종 합성
  ], { guid: 'u1', agency: 'public', agencyPrompt: '[도청 SP]', provinceCode: 'jeju', messages: [{ role: 'user', content: '국세랑 지방세 체납액 합쳐서 알려줘' }], stream: false });

  check('LLM 호출 정확히 3회', calls.length === 3, `실제 ${calls.length}회`);
  check('2번째 호출이 위임 대상(gov_national) 프롬프트 기반', calls[1]?.lastMsg?.content === '국세 체납액 확인');
  check('최종 응답에 위임 결과가 반영됨', data.choices[0].message.content.includes('홈택스'));
  check('최종 응답에 출처 문구 포함(U9-5 취지)', data.choices[0].message.content.includes('국가기관'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 2 — 순환 감지: public이 자기 자신(public)에게 위임 시도 → 거부
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('순환(자기 자신 위임) 거부', [
    JSON.stringify({ sp_call: { target: 'public', purpose: '자기참조', query: 'x' } }), // 1차: 순환 시도
    '죄송합니다, 문의하신 내용은 관련 기관에 직접 확인하시는 것을 권장드립니다.',        // 2차: 거부 후 마무리
  ], { guid: 'u2', agency: 'public', agencyPrompt: '[도청 SP]', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('순환 감지 시 LLM 호출 2회로 종료(대상 서브 호출 없음)', calls.length === 2, `실제 ${calls.length}회`);
  check('2번째 호출 프롬프트에 CYCLE_DETECTED 사유 포함',
    calls[1]?.lastMsg?.content?.includes('CYCLE_DETECTED'));
  check('클라이언트에는 정상 응답(에러 아님) 반환', !!data.choices?.[0]?.message?.content);
}

// ═══════════════════════════════════════════════════════════
// 시나리오 3 — 미등록 대상: 존재하지 않는 target으로 위임 시도 → 거부
// ═══════════════════════════════════════════════════════════
{
  const { calls } = await run('미등록 대상 거부', [
    JSON.stringify({ sp_call: { target: 'made_up_agency', purpose: 'x', query: 'y' } }),
    '알겠습니다, 가진 정보로만 답변드립니다.',
  ], { guid: 'u3', agency: 'gov_do', agencyPrompt: '[도청]', provinceCode: 'jeju', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('미등록 대상 거부 시 LLM 호출 2회로 종료', calls.length === 2, `실제 ${calls.length}회`);
  check('거부 사유가 TARGET_NOT_REGISTERED', calls[1]?.lastMsg?.content?.includes('TARGET_NOT_REGISTERED'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 4 — 재위임 시도 방어: 위임 대상 답변이 규칙을 어기고 또 sp_call을
// 내놓아도 서버가 절대 재귀하지 않고 raw text로 그대로 흡수해야 한다.
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('위임 대상의 재위임 시도 무시', [
    JSON.stringify({ sp_call: { target: 'gov_national', purpose: 'x', query: 'y' } }),      // 1차: 정상 위임
    JSON.stringify({ sp_call: { target: 'health', purpose: '재위임시도', query: 'z' } }),     // 2차: 위임 대상이 규칙 위반 시도
    '위임 대상의 응답을 있는 그대로 반영한 최종 답변입니다.',                                  // 3차: 원 SP 최종 합성
  ], { guid: 'u4', agency: 'public', agencyPrompt: '[도청]', provinceCode: 'jeju', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('재위임 시도가 있어도 LLM 호출 정확히 3회(4회 이상으로 번지지 않음)', calls.length === 3, `실제 ${calls.length}회`);
  check('원 SP가 받은 위임 결과 텍스트에 재위임 JSON 원문이 그대로 포함(무시하고 흡수됨)',
    calls[2]?.lastMsg?.content?.includes('sp_call'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 5 — 최종 안전망: 최종 합성 호출조차 sp_call을 내놓으면
// 정형화된 안내 문구로 강제 치환(재귀 절대 없음).
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('최종 합성 단계 안전망', [
    JSON.stringify({ sp_call: { target: 'gov_national', purpose: 'x', query: 'y' } }),
    '위임 대상 정상 답변',
    JSON.stringify({ sp_call: { target: 'health', purpose: '또시도', query: 'z' } }), // 최종 합성조차 규칙 위반
  ], { guid: 'u5', agency: 'public', agencyPrompt: '[도청]', provinceCode: 'jeju', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('최종 안전망 발동 시에도 LLM 호출 3회로 종료', calls.length === 3, `실제 ${calls.length}회`);
  check('클라이언트에 원문 JSON이 새지 않고 안내 문구로 치환됨',
    !data.choices[0].message.content.includes('sp_call'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 6 — 위임 불가 agency(원래 GOV_AGENCIES이지만 originator 아님)는
// sp_call을 출력해도 위임 로직 자체가 발동하지 않아야 한다(파일럿 범위 제한).
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('비-originator agency는 위임 발동 안 함', [
    JSON.stringify({ sp_call: { target: 'gov_national', purpose: 'x', query: 'y' } }), // health는 originator가 아니므로 이 텍스트가 그대로 최종 응답이 되어야 함
  ], { guid: 'u6', agency: 'health', agencyPrompt: '[K-Health]', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('비-originator는 LLM 호출 1회로 종료(위임 오케스트레이션 미발동)', calls.length === 1, `실제 ${calls.length}회`);
  check('sp_call JSON이 그대로(가공 없이) 반환됨 — 파일럿 범위 제한 확인용',
    data.choices[0].message.content.includes('sp_call'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 7 — 실사용 사례 A: jeju_do(도청, 지방세 담당)가 국세 정보가
// 필요해 jeju_national(국가기관)에 위임. jeju-router.test.mjs에서
// "국세랑 지방세 체납액 합쳐서 알려줘"가 배타적 분기 때문에 도청 트리
// 하나만 선택되는 걸 실측한 뒤, 그 한계를 메우는 실제 위임 흐름을 검증.
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('실사용 A: 도청→국가기관(국세) 위임', [
    JSON.stringify({ sp_call: { target: 'gov_national', purpose: '국세 체납액 확인', query: '국세 체납액이 얼마인지 확인해줘' } }),
    '국세 체납 조회는 홈택스 로그인 후 "나의 세금 조회"에서 확인 가능합니다. 나비와는 아직 직접 연동돼 있지 않습니다.',
    '지방세(취득세·재산세) 체납액은 0원으로 확인됩니다. 국세는 제주세무서(국가기관) 확인 결과, 홈택스에서 직접 조회하셔야 합니다 — 두 세목은 관할이 달라 따로 안내드립니다.',
  ], { guid: 'jeju1', agency: 'gov_do', agencyPrompt: '[SP-DO-PLAN — 지방세 담당]', provinceCode: 'jeju', messages: [{ role: 'user', content: '국세랑 지방세 체납액 합쳐서 알려줘' }], stream: false });

  check('실사용 A: LLM 호출 3회(판단/위임대상/최종합성)', calls.length === 3, `실제 ${calls.length}회`);
  check('실사용 A: 최종 답변에 지방세+국세 정보 모두 포함', data.choices[0].message.content.includes('지방세') && data.choices[0].message.content.includes('국세'));
  check('실사용 A: 출처(국가기관) 명시', data.choices[0].message.content.includes('국가기관'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 8 — 실사용 사례 B: 역방향 — jeju_national(국가기관, 국민연금
// 담당)이 전입신고 정보가 필요해 jeju_do(도청)에 위임. "중앙 행정기관
// SP가 제주 지방정부 SP를 호출하거나, 그 역도 가능"이라는 요구사항의
// 양방향성을 실제로 검증(시나리오 7과 반대 방향).
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('실사용 B: 국가기관→도청(전입신고) 위임', [
    JSON.stringify({ sp_call: { target: 'gov_do', purpose: '전입신고 절차 확인', query: '제주 전입신고는 어디서 어떻게 하나요' } }),
    '전입신고는 관할 읍면동 주민센터 방문 또는 정부24 온라인으로 가능합니다.',
    '국민연금 가입은 저희(국민연금공단 제주지역본부)에서 안내드리며, 전입신고는 제주도청 확인 결과 읍면동 주민센터 방문 또는 정부24로 가능합니다.',
  ], { guid: 'jeju2', agency: 'gov_national', agencyPrompt: '[SP-NAT-NPS — 국민연금 담당]', provinceCode: 'jeju', messages: [{ role: 'user', content: '전입신고랑 국민연금 가입 둘 다 어디서 처리하나요' }], stream: false });

  check('실사용 B: LLM 호출 3회', calls.length === 3, `실제 ${calls.length}회`);
  check('실사용 B: 위임 방향이 역방향(국가기관→도청)으로 정상 작동', calls[1]?.lastMsg?.content === '제주 전입신고는 어디서 어떻게 하나요');
  check('실사용 B: 최종 답변에 도청 확인 결과 반영', data.choices[0].message.content.includes('도청'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 9 — ★ 2026-07-09 신설, 2026-08-30 gov_do/gov_national
// dynamicRegional 재설계에 맞게 갱신: gov_do/gov_national로 위임될 때
// worker.js가 실제로 kgov+OVERLAY+TREE-PROTOCOL+AGENCY-AC-COMMON 상위
// 체인을 앞에 붙이는지, 그리고 도별 동적 렌더링 본문(SP-PROVINCE-
// TEMPLATE 기반)이 그 뒤에 이어지는지 검증(GOV_COMMON 조사에서 발견한
// 갭의 회귀 방지 + 2026-07-21 재설계 이후에도 순서 요건이 유지되는지
// 확인). 위임 대상의 시스템 메시지(messages[0])에 마커가 순서대로
// 들어있어야 한다.
// ═══════════════════════════════════════════════════════════
{
  const { calls } = await run('GOV-COMMON 체인이 gov_do 위임 프롬프트 앞에 붙음', [
    JSON.stringify({ sp_call: { target: 'gov_do', purpose: '테스트', query: '테스트 질의' } }),
    '위임 결과 반영한 최종 답변',
  ], { guid: 'gc1', agency: 'public', agencyPrompt: '[도청]', provinceCode: 'jeju', messages: [{ role: 'user', content: 'x' }], stream: false });

  const delegatedCall = calls[1]; // 0=판단 호출(public), 1=위임 대상(gov_do) 호출
  const sysMsg = delegatedCall?.messages?.find(m => m.role === 'system')?.content
    ?? delegatedCall?.messages?.[0]?.content ?? '';
  const idxKgov = sysMsg.indexOf('kgov(SP-10_kpublic)');
  const idxOverlay = sysMsg.indexOf('[오버레이 템플릿] 제주특별자치도');
  const idxTree = sysMsg.indexOf('[JEJU-TREE-PROTOCOL 텍스트]');
  const idxAgencyAc = sysMsg.indexOf('[AGENCY-AC-COMMON 텍스트]');
  const idxDoSp = sysMsg.indexOf('[제주도청 총괄 SP 텍스트]'); // SP-PROVINCE-TEMPLATE_v1.1.md 렌더링 결과(도별 동적)

  check('kgov(SP-10_kpublic) 마커가 위임 프롬프트에 포함됨', idxKgov !== -1, `sysMsg 앞 200자: ${sysMsg.slice(0, 200)}`);
  check('오버레이(제주특별자치도 렌더링 결과)가 포함됨', idxOverlay !== -1);
  check('JEJU-TREE-PROTOCOL이 포함됨', idxTree !== -1);
  check('AGENCY-AC-COMMON이 포함됨(2026-08-20 신설분)', idxAgencyAc !== -1);
  check('도별 동적 렌더링 본문(SP-PROVINCE-TEMPLATE)이 포함됨', idxDoSp !== -1);
  check('다섯 조각이 kgov→오버레이→TREE-PROTOCOL→AGENCY-AC-COMMON→동적본문 순으로 이어붙여짐',
    idxKgov !== -1 && idxOverlay > idxKgov && idxTree > idxOverlay && idxAgencyAc > idxTree && idxDoSp > idxAgencyAc,
    `순서: kgov=${idxKgov}, overlay=${idxOverlay}, tree=${idxTree}, agencyAc=${idxAgencyAc}, doSp=${idxDoSp}`);
}

console.log(`\n총 ${pass + fail}개 검증 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
