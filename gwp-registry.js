// ═══════════════════════════════════════════════════════════
// gwp-registry.js v2.2 — 혼디 서비스 레지스트리
//
// v2.0 변경사항:
//   - type 필드 추가: 'inline' | 'tab' | 'tool'
//   - sp_url 필드: Agent 전용 SP 파일 경로
//   - status 필드: 'active' | 'pending' (임시등록)
//   - threshold 필드: 서비스별 매칭 임계값
//   - pending_agents: L1에서 로드한 임시등록 항목 동적 병합
// v2.1 변경사항:
//   - sp_url 하드코딩 제거 → sp_key 필드로 대체
//   - 빌드 시 자동 생성되는 prompts/sp-catalog.json 을 런타임에 fetch
//   - resolveSpUrls() 로 레지스트리 초기화 (앱 시작 시 1회)
// v2.2 변경사항 (2026-06-29, manifest.json 정합화 점검 반영):
//   (2026-07-09: prompts/manifest.json → prompts/sp-catalog.json 개명, W-16)
//   - kinsurance.sp_key: 'SP-14_kinsurance' → 'SP-16_kinsurance'
//     (K-Insurance가 K-Cleaner와의 SP-14 번호 충돌로 SP-16 재배정됨에 따라
//      manifest.json(현 sp-catalog.json) 키가 바뀌었고, 이 파일의 sp_key가 그 변경을 따라가지
//      못해 깨져 있었음 — resolveSpUrls() 호출 시 sp_url이 null이 되는 버그)
// ═══════════════════════════════════════════════════════════

const _RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/hondi/main/prompts/';

// ── manifest 기반 SP URL resolver ──────────────────────────
// prompts/sp-catalog.json 은 CI 빌드 시 tools/build_manifest.py 가 자동 생성.
// 키 형식: "SP-NN_slug" (예: "SP-05_kmarket", "SP-14_kcleaner")
let _manifest = null;

async function _loadManifest() {
  if (_manifest) return _manifest;
  try {
    const res = await fetch('/prompts/sp-catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest fetch 실패: ' + res.status);
    _manifest = await res.json();
    console.info('[Registry] manifest 로드 완료 (' + Object.keys(_manifest).length + '개 항목)');
  } catch (e) {
    console.warn('[Registry] manifest 로드 실패, sp_url 은 null 유지:', e.message);
    _manifest = {};
  }
  return _manifest;
}

// 레지스트리의 sp_key → sp_url 를 manifest 기준으로 채운다.
// 앱 초기화 시 한 번만 호출하면 됨 (loadPendingAgents 와 함께 호출 권장).
async function resolveSpUrls() {
  const manifest = await _loadManifest();
  for (const entry of GWP_REGISTRY) {
    if (!entry.sp_key) continue;
    const fname = manifest[entry.sp_key];
    entry.sp_url = fname ? _RAW + fname : null;
    if (!fname) {
      console.warn('[Registry] manifest 에 키 없음 (sp_url=null):', entry.sp_key);
    }
  }
}

const GWP_REGISTRY = [

  // ── 긴급·재난 (EMG) — tab: 사용자 명시적 확인 필요 ────────
  {
    id: 'kemergency', name: 'K-Emergency', category: 'EMG',
    type: 'tab',      // 긴급은 반드시 새 탭 — 사용자가 직접 확인
    url: 'https://911.hondi.net/webapp.html',
    sp_key: 'SP-02_k119',
    status: 'active', priority: 0, threshold: 0.60,
    description: '긴급 구조·재난 대응. 119·112 연계.',
    triggers: [
      '긴급','응급','119','112','살려줘','화재','불났어','구조','사고',
      '쓰러졌어','다쳤어','심정지','익사','지진','홍수','가스 누출','위험해',
      '자살','자해',
      // 2026-08-08 추가(사각지대 실사 발견) — 아동학대 신고 전화번호는
      // 2014년에 1577-1391에서 112로 통합됐다(아동권리보장원 공지
      // 확인). 기존 트리거엔 폭력·응급 일반어만 있고 아동학대 특유의
      // 완곡한 자기 노출 표현이 없었다 — 미성년자가 위기를 직접
      // "긴급"·"응급" 같은 단어로 표현하지 않는 경우가 많다는 점을
      // 반영해 추가한다. AC-PRO-CORE §SAFETY의 미성년자 관련 신설
      // 절과 함께 봐야 한다 — 이 trigger들은 성인 발화에도 걸릴 수
      // 있으므로(예: 성인 대상 가정폭력), 미성년자 여부와 무관하게
      // kemergency로 가는 것 자체는 항상 안전한 기본값이다.
      '때려요','맞아요','학대','방임','가둬요','굶겨요',
    ],
  },

  // ── 법률 (JUS) — inline: 대화 맥락 필요 ───────────────────
  {
    id: 'klaw', name: 'K-Law', category: 'JUS',
    type: 'inline',
    url: 'https://klaw.hondi.net/webapp.html',
    sp_key: 'SP-01_klaw',
    status: 'active', priority: 1, threshold: 0.70,
    description: 'AI 가상 판결문. K-Law v20.0. 1초·1,000원.',
    triggers: [
      '소송','고소','고발','판결','재판','법원','계약서','손해배상',
      '위법','불법','형사','민사','이혼','상속','부당해고','명예훼손',
      '저작권','사기','횡령','배임','변호사','법률','판례','헌법소원',
      '임금체불','산재','내용증명','고소장','형량','처벌',
    ],
  },

  {
    id: 'kpolice', name: 'K-Police', category: 'JUS',
    type: 'inline',
    url: 'https://police.hondi.net/webapp.html',
    sp_key: 'SP-03_kpolice',
    status: 'active', priority: 1, threshold: 0.65,
    description: '실시간 범죄 예측·대응. 경찰청 연동.',
    triggers: [
      '경찰','112 신고','범죄','절도','폭행','성범죄','스토킹',
      // ⚠ '강도'는 '운동 강도'·'필라테스 강도'(세기/intensity 의미)와 동음이의어
      // 충돌 위험이 실측 확인됨(2026-07-05, 300건 사고실험). 제거하면 실제
      // 강도 신고("강도예요 도와주세요") recall이 떨어지므로 남기되, 이 필드를
      // 다시 프로그램적 매칭에 쓸 경우(현재는 미사용) 문맥 없이 단독 매칭하지
      // 않도록 주의할 것.
      '협박','납치','강도','가정폭력','수사','증거',
    ],
  },

  {
    id: 'ksecurity', name: 'K-Security', category: 'JUS',
    type: 'inline',
    url: 'https://security.hondi.net/webapp.html',
    sp_key: 'SP-15_ksecurity',
    // ★ 2026-07-12 정정 — status가 특별한 이유 없이 'pending'으로 방치돼
    // 있었다(관련 커밋 이력 없음). security.hondi.net에 실제로 배포된
    // 웹앱이 있고 정상 응답함을 실사로 확인(HTTP 200, K-Security 타이틀의
    // 실제 챗봇 UI, /deepseek 호출 확인) — active로 정정. 스미싱·
    // 보이스피싱 신고(750건 사고실험 #831/832) 같은 시급한 요청이 이
    // 서비스로 못 가고 있었을 가능성이 있다. 단, /deepseek 직결 방식
    // (school/stock과 같은 구형 패턴)이라 최신 서비스들의 /gov/relay
    // 패턴으로의 현대화는 별도 과제로 남긴다.
    status: 'active', priority: 2, threshold: 0.70,
    description: '사이버 보안·개인정보 침해 대응.',
    triggers: [
      '해킹','피싱','스미싱','보이스피싱','계정 탈취','랜섬웨어',
      '악성코드','개인정보 유출','사이버 범죄','비밀번호 유출',
    ],
  },

  // ── 의료 (MED) — inline ────────────────────────────────────
  {
    id: 'khealth', name: 'K-Health', category: 'MED',
    type: 'inline',
    url: 'https://health.hondi.net/webapp.html',
    sp_key: 'SP-04_khealth',
    status: 'active', priority: 3, threshold: 0.70,
    description: '실거래 기반 건강 위험도 산정. 병원 연동.',
    triggers: [
      '아파요','병원','증상','처방','진단','의사','수술','약',
      '건강','검진','통증','열이 나','기침','두통','복통','혈압','당뇨',
      '암','응급실','입원','처방전','예방접종','우울증','불면증',
      // 2026-07-25 추가(주피터 지시) — 300건 사고실험에서 실패 확인된
      // 콜로키얼 표현. 기존 트리거는 전부 의학 전문용어('복통','우울증')
      // 라서, 일상어('배가 아파','우울한데')로 말하면 안 걸렸다.
      '배가 아파','아랫배','속이 안 좋아','머리가 아파','몸이 안 좋아',
      '우울해','우울한데','기분이 안 좋아',
    ],
  },

  // ── 교육 (EDU) — inline ────────────────────────────────────
  {
    id: 'kedu', name: 'K-School', category: 'EDU',
    type: 'inline',
    url: 'https://school.hondi.net/webapp.html',
    sp_key: 'SP-09_kschool',
    status: 'active', priority: 4, threshold: 0.70,
    // 2026-08-08 정정 — K-School은 더 이상 "AI가 직접 유치원~대학원까지
    // 가르치는 개인 교수" 서비스가 아니다(school 저장소
    // docs/K_SCHOOL_PUBLIC_EDUCATION_DATA_SYSTEM_v1_0.md의 범위 정정 반영,
    // prompts/system_prompt.txt를 v2.0→v3.0으로 전면 교체). 개별 학생 1:1
    // 지도는 이제 professor(EXPERT, gopang expert-registry-professor.js)
    // 전담이고, K-School은 다수 PDV를 집계하는 공공 교육정책 데이터
    // 시스템(정책결정자·연구자용 통계 조회)으로 축소됐다. description을
    // 그에 맞춰 정정 — 아래 '과외' 트리거 자체는 유지한다(§CORE R1축이
    // 위임의도로 GWP/EXPERT를 가르지, trigger 존재 여부로 안 가른다 — R1
    // 문서 자체가 "trigger 표는 검색 편의를 위한 색인일 뿐"이라고 명시).
    description: '공공 교육정책 데이터 시스템 — 다수 학습자 PDV 집계(정책결정자·연구자용). 개별 학생 1:1 지도는 담당하지 않음(→ professor).',
    triggers: [
      '공부','학습','교육','과목','진로','시험','강의','자격증',
      '논문','입학','졸업','취업','숙제','과제','수능','학점',
      // 2026-07-25 추가(주피터 지시) — 300건 사고실험 A범주("과외 선생님을
      // 구해줘")에서 확인된 불일치: 당시 K-School은 "AI가 직접
      // 유치원~대학원까지 가르치는 개인 교수" 서비스였으나, 2026-08-08
      // 범위 정정으로 이 역할 자체가 professor(EXPERT)로 이관됐다(위 주석
      // 참고) — 그래서 지금은 이 trigger가 붙어 있어도, 위임의도가 있는
      // 발화는 R1축에 따라 EXPERT(professor)로 가는 게 정상이고, kedu는
      // 그 발화가 진로상담·시험제도처럼 실제로 제도·집계 성격일 때만
      // 맞는 후보다. '과외' 자체를 trigger에서 빼지 않은 이유: 후보 축소
      // 단계(0단계 prefilter)에서는 recall을 넓게 잡아 kedu·professor·
      // teacher를 다 후보에 올리는 게 목적이고, GWP/EXPERT 최종 판정은
      // 다음 단계(R1축)가 한다.
      '과외',
    ],
  },

  // ── 금융 (ECO) — inline (조회) / tab (결제) ────────────────
  {
    id: 'kgdc', name: 'GDC', category: 'ECO',
    type: 'tab',   // 결제·송금은 반드시 새 탭
    url: 'https://gdc.hondi.net/webapp.html',
    sp_key: 'SP-08_gdc',
    status: 'active', priority: 5, threshold: 0.75,
    // 2026-08-01 정정 — GDC는 결제·송금만 하는 게 아니라 예금·적금·대출·
    // 신용평가·투자·환전(FIAT POOL)까지 이미 전부 갖춘 통합 금융 서비스다
    // (github.com/Openhash-Gopang/gdc README §5, js/gdc-bank.js,
    // prompts/SP-GDC_kbank_v1.0.txt — 전에 별도로 'kbank' GWP를 새로
    // 만들려 했던 시도는 이미 있는 걸 몰라서 중복 설계한 것이었다, 2026-08-01
    // 주피터님 지적으로 정정). description·triggers에 은행 관련 어휘를
    // 못 넣어놨던 게 batch2 라이브 테스트에서 "카드값 나눠 갚기" 같은
    // 요청이 kgdc로 안 가고 딴 데로 새던 실제 원인이었다.
    // ★ "은행"이라는 단어는 쓰지 않는다 — gdc 저장소 SP-GDC_v2_0.txt
    // 자체 규칙("은행"이라는 표현 사용 금지 — GDC는 금융 서비스 플랫폼).
    // 인가 없이 은행업을 표방하지 않기 위한 의도적 제약이므로 이 GWP
    // 레지스트리·description에서도 동일하게 지킨다.
    description: '결제·송금·환전 + 예금·적금·대출·신용평가·투자(재무제표 기반) — 국적통화 FIAT POOL 연동, 무위험 자산 담보 디지털 화폐. (신용·체크카드 상품은 아직 없음 — GDC_ROADMAP.md 기준 미제공) 투자 상품 가입·잔고 조회 자체가 목적이면 여기, 자산 분석·포트폴리오 조언이 목적이면 kfinance(K-Stock) 소관.',
    triggers: [
      'GDC','결제','송금','이체','잔고',
      '고팡 화폐','디지털 화폐','GDC 충전','글로벌 결제',
      '예금','적금','저금','대출','빌리다','융자','이자','금리',
      '신용평가','신용등급','대출 한도','상환','환전','해외 송금',
      '투자','펀드','국민성장펀드','ETF',
    ],
  },

  {
    id: 'kfinance', name: 'K-Stock', category: 'ECO',
    type: 'inline',
    url: 'https://stock.hondi.net/webapp.html',
    sp_key: 'SP-11_kstock',
    status: 'active', priority: 5, threshold: 0.75,
    // ★ 2026-08-02 상호참조 추가 — kgdc가 2026-08-01 kbank 통합으로
    // 투자/ETF/펀드 어휘를 갖게 되면서 트리거가 겹침("GWP-GWP 동층위
    // 혼동" 사고실험에서 확인). kgdc 쪽에도 동일하게 추가.
    description: '89개 자산군 실시간 분석. 포트폴리오. 상품 가입·실행·잔고 조회 자체는 kgdc 소관 — 여기는 분석·조언 전담.',
    triggers: [
      '주식','투자','포트폴리오','ETF','자산','펀드','채권',
      '암호화폐','비트코인','환율','리밸런싱','절세','IRP','ISA',
      '배당주','공모주','수익률','재테크',
    ],
  },

  {
    id: 'kinsurance', name: 'K-Insurance', category: 'ECO',
    type: 'inline',
    url: 'https://insurance.hondi.net/webapp.html',
    sp_key: 'SP-16_kinsurance',  // v2.2 — SP-14에서 재배정됨 (K-Cleaner 번호충돌 해소)
    status: 'active', priority: 6, threshold: 0.70,
    // 2026-07-26 정정: insurance/webapp.html 실제 배포본 대조 결과,
    // 공적 보험(건강·산재·고용보험·국민연금) 청구·수급 절차 안내만
    // 하며 지급 여부 결정 권한이 없음을 프롬프트에 명시하고 있다.
    // 민간 보험사 상품도 미취급(각 민간 보험사는 자체 AI 운영).
    description: '공적 보험(건강·산재·고용보험·국민연금) 청구·수급 절차 안내. 지급 결정 권한 없음 — 민간 보험 상품은 미취급. 사업장 4대보험 가입·신고는 kbusiness, 고용보험 행정민원은 kgov 소관.',
    triggers: [
      '보험','보장','청구','보험료','실손','자동차보험',
      '보험금','생명보험','화재보험','보험 가입','보험 해지',
      // 2026-08-31 추가 — 설명("국민연금 청구·수급 절차 안내")에 정작
      // '연금' 관련 trigger가 하나도 없어 사전필터가 못 찾던 문제
      // (SP 100건 라이브 검증에서 재현 확인)
      '국민연금','연금 수급','연금 신청',
      // 2026-08-31 2차 추가 — 마찬가지로 "고용보험 청구·수급"이
      // 설명에 있는데 '실직'·'지원금'·'고용보험'·'실업급여' 전부
      // 빠져있어 실업급여 문의가 전혀 안 잡히던 문제
      '실직','지원금 신청','고용보험','실업급여',
    ],
  },

  // ── 2026-07-12 신설 → 재설계(같은 날) — 250건 사고실험에서 발견된
  // 커버리지 갭 해소(SP-Author 프로세스 대행, 주피터님 지시). 통신
  // (요금제·인터넷·유심)을 다루는 SP가 21개 목록 어디에도 없었다.
  //
  // ★ 2026-08-01 kbank 항목 철회 — 애초에 "은행 기능이 빠져있다"는
  // 전제 자체가 틀렸다. github.com/Openhash-Gopang/gdc를 확인한 결과
  // kgdc(GDC)가 이미 예금·적금·대출·신용평가·투자·환전까지 은행 기능을
  // 전부 갖추고 있었다(README §5, js/gdc-bank.js,
  // prompts/SP-GDC_kbank_v1.0.txt). 그 사실을 모른 채 별도의 'kbank'
  // GWP를 새로 설계했던 것(v1.0 → v2.0 두 차례)은 전부 철회하고
  // prompts/archive/로 옮겼다 — kgdc description·triggers를 은행
  // 어휘로 보강하는 쪽으로 대체(위 kgdc 엔트리 참고).
  //
  // ★ 재설계 경위(ktelecom/kestate에 여전히 적용) — 처음엔 K-Health/
  // K-Traffic처럼 "새 저장소+새 도메인+/gov/relay" 패턴(type:'inline',
  // url 있음)으로 만들고 status를 pending_review로 뒀었다. 그런데
  // "모든 SP가 별도 저장소가 필요한 것은 아니다"(주피터님 지적)를
  // 재검토한 결과, K-Telecom/Estate 두 SP 모두 "최종 실행(개통·계약)은
  // 본인 몫, AI는 정보 수집·안내까지만" 이라고 스스로 설계돼 있어 —
  // 이건 K-Search/K-Intent/K-Compose/K-Deliver가 이미 쓰는 시스템
  // 전환형(별도 탭·도메인 없이 _forwardSwitchSP로 같은 세션 안에서
  // 시스템 프롬프트만 바꾸는 방식, call-ai.js)과 정확히 같은 성격이다.
  // 저장소 배포를 기다릴 필요 없이 gopang 저장소 안의 SP 파일만으로
  // 즉시 active로 켤 수 있다. type:'switch'는 이 둘을 위해 신설한
  // 값 — _parseAgentTags(call-ai.js)가 이 타입을 보면 _gwpLaunch
  // (새 탭) 대신 _forwardSwitchSP(시스템 전환)로 분기한다. SP 초안은
  // prompts/SP-23_ktelecom_v1_0.md, prompts/SP-24_kestate_v1_0.md
  // 참조(RULE-09도 이 재설계에 맞춰 갱신됨).
  //
  // ⚠ 2026-08-01 — 같은 날 오판과 정정이 함께 있었다. 한때 "이 둘도
  // kbank처럼 핸들러가 없는 게 아닌가" 의심해서 status를 잠깐
  // pending_review로 내렸었는데, 몇 시간 뒤 그 의심 자체가 틀렸음을
  // 확인했다 — call-ai.js를 리터럴 문자열 "CALL_KTELECOM"으로
  // grep해서 안 나온 것뿐이었고, 실제 코드는
  // `/\[CALL_(KBANK|KTELECOM|KESTATE):.../` 정규식 alternation으로
  // 세 태그를 한 번에 처리하고 있었다(SWITCH_SP_LOADERS 매핑,
  // _loadKTelecomSP/_loadKEstateSP 로더까지 2026-07-12에 이미 완성).
  // status는 'active'가 맞다 — AC-PRO-CORE_v1_0.txt의 §CATALOG 표에도
  // 정식으로 등재했다(예전엔 "미구현" 경고 블록에 따로 빼놨었는데,
  // 그 블록 자체가 같은 검색 실수로 만들어진 오정보였다).
  {
    id: 'ktelecom', name: 'K-Telecom', category: 'UTL',
    type: 'switch',
    sp_key: 'SP-23_ktelecom',
    // 2026-08-01 — 같은 날 두 번 정정. 먼저 status를 'active'→
    // 'pending_review'로 내렸다가("[CALL_KTELECOM:...] 핸들러가
    // call-ai.js에 없다"는 판단 근거로), 몇 시간 뒤 그 판단 자체가
    // 틀렸음을 발견해 도로 'active'로 되돌렸다. 원인: call-ai.js를
    // 리터럴 문자열 "CALL_KTELECOM"으로 grep했는데, 실제 코드는
    // `/\[CALL_(KBANK|KTELECOM|KESTATE):.../` 처럼 정규식 alternation
    // 하나로 세 태그를 함께 처리하고 있어서(_handleOrchestrationTags,
    // SWITCH_SP_LOADERS 매핑, _loadKTelecomSP 로더까지 전부 2026-07-12에
    // 이미 완성돼 있었음) 리터럴 검색으로는 안 잡혔다. AC-PRO-CORE_v1_0.txt
    // 에 있던 "2026-07-28 코드 전수 확인 결과 핸들러 없음"이라는 서술도
    // 같은 방식의 검색 실수로 만들어진, 애초부터 틀린 서술이었다 —
    // 그것도 함께 정정했다(§CATALOG 참고). status는 'active'가 맞다.
    status: 'active', priority: 6, threshold: 0.70,
    description: '통신 서비스 안내(요금제·인터넷·유심·로밍·결합상품·분실신고) — 단말기 자체 구매는 kcommerce 소관. 최종 실행(개통 등)은 본인이 통신사 앱에서.',
    triggers: [
      '요금제','인터넷 설치','유심','로밍','결합상품','통신사',
      '휴대폰 분실','기기변경','와이파이','공유기','IPTV',
    ],
  },
  {
    id: 'kestate', name: 'K-Estate', category: 'ECO',
    type: 'switch',
    sp_key: 'SP-24_kestate',
    // 2026-08-01 정정 — ktelecom과 동일 사유(위 주석 참고). [CALL_KESTATE:
    // ...] 핸들러도 실제로 존재한다 — status는 'active'가 맞다.
    status: 'active', priority: 6, threshold: 0.70,
    description: '부동산 매물 탐색·등록·중개연결·임대차 계약관리 — 계약서 법률검토(klaw)·세금(ktax)·전입신고 등 행정(kgov)·자동이체 설정(kgdc)은 각 소관 서비스로. 최종 계약 체결은 본인·공인중개사·법무사 몫.',
    triggers: [
      '전세','월세','매매 매물','부동산','공인중개사','임대차',
      '계약 갱신','재건축','조합원','매물 등록','이사 갈 집',
    ],
  },

  // ── 2026-09-02 신설 — K-Plan/K-Watch/K-Job. 셋 다 K-Telecom/K-Estate와
  // 동일한 이유(별도 저장소·도메인이 필요 없는 SP)로 type:'switch'로
  // 등록한다. sp_key는 SP-NN 번호 체계가 아니라 k-business와 동일한
  // 평문 이름 — sp-catalog.json에 새로 등록한 'k-plan'·'k-watch'·
  // 'k-job' 키를 그대로 쓴다(call-ai.js SWITCH_SP_LOADERS·
  // _loadKPlanSP/_loadKWatchSP/_loadKJobSP 참조). 셋 다 SP 문서
  // 자체에 "아직 실제 서비스 백엔드에 연결되지 않았다"고 명시돼 있던
  // 설계 단계 문서였으나, 이 커밋으로 AC 오케스트레이션(이 레지스트리
  // + call-ai.js 태그 디스패치)에 처음 편입된다 — 여전히 status는
  // 'active'로 등록하되(핸들러가 실제로 동작하므로), K-Report 이후
  // PDV 기록·집단 학습 저장소 같은 후속 기능은 각 SP 문서의 "아직
  // 없는 것" 절 그대로 미구현임을 유의.
  {
    id: 'kplan', name: 'K-Plan', category: 'UTL',
    type: 'switch',
    sp_key: 'k-plan',
    status: 'active', priority: 6, threshold: 0.70,
    description: '목표를 PDV와 종합해 최적 경로를 설계 — 요청을 곧바로 실행하지 않고 그 요청이 목표 달성의 최선 경로인지부터 평가한다. 다른 실행형 모듈과 달리 대안이 있으면 반드시 제시.',
    triggers: [
      '계획을 세워줘','목표를 이루고 싶어','동선 짜줘','스케줄 짜줘',
      '출장 준비','일정 계획','최선의 방법이 뭘까','어떻게 접근해야',
    ],
  },
  {
    id: 'kwatch', name: 'K-Watch', category: 'JUS',
    type: 'switch',
    sp_key: 'k-watch',
    status: 'active', priority: 6, threshold: 0.70,
    description: '시민 신고 접수·대응 기관 선정·진행상황 공개. 범죄뿐 아니라 생활 속 부당·불법·편법·오염·파손까지 — 사용자가 제3자로서 목격한 사건 전담(본인 위험 신호 자동감지는 kpolice 소관).',
    triggers: [
      '신고하고 싶어','목격했어','불법주차','쓰레기 무단투기',
      '동물 사체','배기가스 심한 차','고객 차별','진상 고객',
      '끼어들기 신고',
    ],
  },
  {
    id: 'kjob', name: 'K-Job', category: 'ECO',
    type: 'switch',
    sp_key: 'k-job',
    status: 'active', priority: 6, threshold: 0.70,
    description: '이력서·자기소개서 작성, 면접 준비, 채용 공고 매칭, 지원 현황 관리 — 구직자 개인용(K-Biz식 업종별 세분화 없이 단일 공통 모듈). 사업주 측 채용·인사·노무 대행은 미포함.',
    triggers: [
      '이력서','자기소개서','자소서','면접 준비','모의 면접',
      '채용 공고','구직','취업 상담','지원 현황','이직 준비',
    ],
  },

  // ── 2026-07-12 신설 — "판매자로 등록하고 싶다"(중고거래 매물 등록,
  // 서비스 제공자 등록 등)는 kcommerce(구매자용 webapp.html)로 보내면
  // 안 된다 — 250건 사고실험(#48/#57)에서 발견. 조사 결과 판매자 등록
  // 기능 자체는 이미 완비돼 있었다(desktop.html#seller — 서술형 입력→
  // SP-MKT_seller_site_v3.1이 구조화→/biz/catalog/sync로 TOFU+Ed25519
  // 서명 검증 후 라이브 등록). 빠진 건 AC가 이 경로로 갈 방법뿐이었다
  // — 별도 GWP id로 등록해 방향(구매 vs 판매)에 따라 다른 URL로 가게
  // 한다.
  {
    id: 'kcommerce_seller', name: 'K-Market(판매자 등록)', category: 'MKT',
    type: 'tab',
    url: 'https://market.hondi.net/desktop.html#seller',
    sp_key: null,  // AI가 아니라 desktop.html 자체의 서술형 입력폼 UI — GWP는 탭 오픈까지만
    status: 'active', priority: 7, threshold: 0.70,
    description: '판매자 등록(중고물품·서비스 판매 시작) — 구매가 아니라 "내가 판매자가 되고 싶다"는 요청 전용. 일반 구매/탐색은 kcommerce로.',
    triggers: [
      '판매자로 등록','물건을 팔고','매물로 등록','팔고 싶어',
      '중고 거래로 등록','판매 시작','내 상품 올리기','셀러 등록',
    ],
  },

  {
    id: 'ktax', name: 'K-Tax', category: 'ECO',
    type: 'inline',
    url: 'https://tax.hondi.net/webapp.html',
    sp_key: 'SP-07_ktax',
    status: 'active', priority: 6, threshold: 0.75,
    // ★ 2026-08-02 정정 — 기존 description('재무제표 실시간 자동 생성·
    // 신고.')이 실제 SP(prompts/archive/SP-07_ktax_v2.3.txt, 도메인:
    // "세무·세액 계산·신고·절세 전략")와 맞지 않았다 — kbusiness의
    // 실제 도메인(재무제표·손익계산서·대차대조표)이 잘못 들어가 있던
    // 것으로 보임(git 히스토리상 최초 등록 때부터 이 값이라 원인 특정은
    // 불가, 등록 당시 복붙 실수로 추정). ktax↔kbusiness 트리거가 실제로
    // 겹치는 게(세금/사업자 세금, 부가세/부가세 신고, 세무/사업자 세무)
    // "GWP-GWP 동층위 혼동" 사고실험에서 확인돼, description을 SP
    // 원문 기준으로 바로잡으며 상호참조도 명시한다.
    description: '세액 계산·신고·절세 전략 안내(국세청·홈택스 연동) — 재무제표·손익계산서 등 회계장부 작성 자체는 kbusiness 소관.',
    triggers: [
      '세금','부가세','종합소득세','세무','납부',
      '연말정산','환급','세무조사','관세','재산세','증여세','상속세',
      '국세청','홈택스','전자세금계산서',
    ],
  },

  // ── 시장·거래 (MKT) — tab: 주문·결제 트랜잭션 ────────────
  {
    id: 'kcommerce', name: 'K-Market', category: 'MKT',
    type: 'tab',
    url: 'https://market.hondi.net/webapp.html',
    // sp_key: 'SP-05_kmarket' — 2026-07-05 실사 결과 죽은 참조로 확인됨.
    // resolveSpUrls()/entry.sp_url을 실제로 읽는 호출부가 코드베이스
    // 어디에도 없고(엔진 주석 언급뿐), market/webapp.html은 이 레지스트리를
    // 거치지 않고 market 레포 자체의 raw.githubusercontent.com URL을
    // 직접 fetch한다(현재 SP-KMARKET-v2_7.txt). 진짜 SP는 market 레포가
    // 정본이며, gopang의 SP-05_kmarket_*.txt/SP-05_kcommerce_*.txt는
    // 전부 사용되지 않는 레거시 문서로 정리됨(DEPRECATED_SP-05_kmarket-kcommerce.txt
    // 참조). sp_key 필드 자체는 하위호환을 위해 남겨두되 신뢰하지 말 것.
    sp_key: 'SP-05_kmarket',
    status: 'active', priority: 7, threshold: 0.75,
    description: '자율 구매대행 에이전트 — 판매자 탐색·비교·거래·환불/반품/예약 처리 전담.',
    triggers: [
      '주문','배달','음식','쇼핑','구매','상점','시장','시켜','맛집',
      '식당','상품','가격','예약','반품','교환','거래','마켓',
    ],
  },

  // ── 교통·물류 (TRN) — inline ───────────────────────────────
  {
    id: 'ktransport', name: 'K-Traffic', category: 'TRN',
    type: 'inline',
    url: 'https://traffic.hondi.net/webapp.html',
    sp_key: 'SP-06_ktraffic',
    status: 'active', priority: 8, threshold: 0.75,
    // ★ 2026-07-12 정정 — 이전 설명("실시간 교통 흐름 예측·우회 경로")은
    // 실제 SP(traffic.hondi.net webapp.html의 AGENCY_PROMPT)와 완전히
    // 달랐다. 실제로는 /gov/relay(agency='traffic')를 쓰는 교통행정
    // 민원 대화형 안내 AI다 — 내비게이션·경로탐색이 아니라 "도로·대중
    // 교통·주정차 단속·과태료·운전면허 행정" 민원을 인터뷰 방식으로
    // 파악해 절차를 안내한다(250건 사고실험 재개 중 발견).
    description: '교통행정 민원 안내(대중교통 노선·도로 공사통제 정보·주정차 단속 및 과태료·운전면허 행정) — 실시간 길찾기/내비게이션이 아님.',
    triggers: [
      '과태료','단속','주정차','운전면허','대중교통','노선',
      '도로 공사','도로 통제','교통 민원','교통사고 신고',
    ],
  },

  {
    id: 'klogistics', name: 'K-Logistics', category: 'TRN',
    type: 'inline',
    url: 'https://logistics.hondi.net/webapp.html',
    sp_key: 'SP-13_klogistics',
    status: 'active', priority: 8, threshold: 0.70,
    description: '주문-출고-배송-반품 전 과정 자동화.',
    triggers: [
      '배송','물류','택배','운송','창고','재고','통관',
      '배송 추적','배송 지연','국제 배송','관세',
    ],
  },

  // ── 전국 지방행정(GOV-REGIONAL) — tab: 광역시도·시군구·읍면동·국가기관
  // 지역사무소 4단계 SP 체인 자체 라우터 (2026-07-21 전국 중심 전환) ──
  // 2026-07-19까지 제주 전용이었으나, gov-router.js가 PROVINCE_REGISTRY
  // 기반으로 16개 광역시도(실사 진행 중)를 다루도록 일반화됐다(#24~#31).
  // sp_key 없음 — 배포된 웹앱이 요청마다 사용자 발화·PDV 위치로 도를
  // 판별해 SP를 동적 조립한다. id는 'kregionalgov'로 명명(과거 PDV
  // 기록이 없어 자유롭게 변경 가능 — 주피터 확인).
  {
    id: 'kregionalgov', name: '전국 지방행정 AI', category: 'GOV',
    type: 'tab',
    // ★ 2026-07-22 변경 — jeju.hondi.net(별도 서브도메인, 별개 오리진)에서
    // hondi.net 자체 안의 페이지로 이전. 사용자 지시: "hondi.net/jeju,
    // hondi.net/seoul 형식으로 하여, 탭 전환 시 별도의 인증이 불필요하게
    // 하십시오." 별도 오리진이면 지갑(localStorage/IndexedDB)을 직접 못
    // 읽어 매번 postMessage 서명 왕복이 필요했고, 그 타이밍/팝업차단
    // 문제가 오늘 하루 종일의 SSO 버그 전부의 근본 원인이었다 — 같은
    // 오리진으로 옮기면 그 문제 자체가 사라진다(pages/regional-gov.html
    // 참조). 라우팅 로직 자체(어느 광역시도인지 판별)는 이미 전국 대응
    // 으로 일반화된 gov-router.js를 그대로 재사용하므로 변경 없음.
    url: 'https://hondi.net/pages/regional-gov.html',
    status: 'active', priority: 8, threshold: 0.70,
    description: '광역시도청·시군구청·읍면동사무소·국가기관 지역사무소 행정 안내(전국 대응, GOV-COMMON SP 트리 자체 라우팅).',
    triggers: [
      '시청','도청','군청','구청','읍사무소','면사무소','동주민센터',
      '읍면동','행정복지센터','인감',
      // 2026-08-31 추가 — "동사무소"(구어)·"주민센터"(단독형)·"지방세"·
      // "지자체 지원 사업" 등 일반 표현이 하나도 없어 사전필터가 전혀
      // 못 찾던 문제(SP 100건 라이브 검증에서 4건 전부 미발견 확인).
      // "동주민센터"·"읍면동" 등 격식형만 있고 실생활 구어는 빠져있었다.
      '동사무소','주민센터','지방세','지자체 지원 사업','지자체','제주도',
      '제주도청','제주특별자치도청','제주시청','서귀포시청','제주특별자치도',
      '제주 행정','도지사','제주콜센터',
      '애월읍','조천읍','구좌읍','한경면','추자면','우도면',
      '대정읍','남원읍','성산읍','안덕면','표선면',
      '일도1동','일도2동','이도1동','이도2동','삼도1동','삼도2동',
      '용담1동','용담2동','건입동','화북동','삼양동','봉개동',
      '아라동','오라동','연동','노형동','외도동','이호동','도두동',
      '송산동','정방동','중앙동','천지동','효돈동','영천동','동홍동',
      '서홍동','대륜동','대천동','중문동','예래동','한림읍',
    ],
  },

  // ── 행정 (GOV) — inline ────────────────────────────────────
  {
    id: 'kgov', name: 'K-Public', category: 'GOV',
    type: 'inline',
    url: 'https://public.hondi.net/webapp.html',
    sp_key: 'SP-10_kpublic',
    status: 'active', priority: 9, threshold: 0.70,
    // ★ 2026-07-21 트리거 정리 — '시청'·'도청'·'구청'이 kregionalgov(전국
    // 지방행정 AI, tab)와 그대로 겹쳐 있어서, "제주도청 불러 줘"처럼
    // 특정 지역 관청을 콕 집어 부르는 발화까지 이 inline 서비스가 먼저
    // 채가는 사고가 실사로 확인됐다(탭이 열려야 하는데 AC가 그냥 직접
    // 답해버림). 관청 "기관명"으로 부르는 라우팅은 kregionalgov가 전담
    // 하고, 여기는 발급물·절차 종류(등본·전입신고 등) 위주로만 남긴다 —
    // 두 서비스의 트리거가 다시 겹치지 않도록 주의할 것.
    description: '민원·행정·허가 AI 자동 처리(발급·절차 안내 위주). 특정 시/도/구/읍/면/동 관청을 기관명으로 호출하는 경우는 kregionalgov(전국 지방행정 AI) 소관.',
    triggers: [
      '민원','등본','주민등록','복지','행정','공공','허가',
      '발급','증명서','전입신고','사업자 등록',
      '여권','국민연금','고용보험',
    ],
  },

  {
    id: 'kdemocracy', name: 'K-Democracy', category: 'LEG',
    type: 'inline',
    url: 'https://democracy.hondi.net/webapp.html',
    sp_key: 'SP-12_kdemocracy',
    status: 'active', priority: 10, threshold: 0.70,
    // ★ 2026-07-12 정정 — "국민동의청원에 서명해줘"·"입법예고에 의견
    // 제출해줘"(750건 사고실험 #611/612)가 "청원"·"의견 제출"이라는
    // 단어 때문에 이 서비스의 "안건 제안"과 혼동될 위험을 발견해 경계를
    // 명시한다. K-Democracy는 혼디 자체 거버넌스(DAWN) 전용이지 국회·
    // 정부의 실제 청원·입법예고 시스템이 아니다 — 그건 kgov(K-Public)
    // 소관이다.
    description: '고팡 직접 민주주의 플랫폼(DAWN) 전용 — 국민동의청원·입법예고 등 실제 국가기관 청원/의견 시스템은 kgov 소관.',
    triggers: [
      '투표','안건','민주주의','정책','DAWN','의결',
      '안건 제안','고팡 운영','배심원','찬성','반대','발의',
    ],
  },

  // ── 사업체 지원 (BIZ) — tab: K-Market 관리자 대시보드 내 어드바이저 ──
  // 2026-07-05 신설. k-business(글로벌 표준)+business-kr(한국모듈) 상속.
  // sp_key 없음 — /business/relay(worker.js)가 UNIVERSAL-INTEGRITY+
  // UNIVERSAL-common+k-business+business-kr을 서버에서 직접 조립한다
  // (jeju와 동일하게 manifest 방식이 아닌 자체 relay 엔드포인트 방식).
  // 이 항목이 없으면 "재무제표 작성해줘" 같은 발화가 라우터에서 매칭될
  // 서비스가 없어 gopang-direct로만 빠지는 사각지대가 있었음(실사로 확인).
  {
    id: 'kbusiness', name: 'K-Business', category: 'BIZ',
    type: 'tab',
    url: 'https://market.hondi.net/kmarket_admin_dashboard.html',
    status: 'active', priority: 9, threshold: 0.70,
    // ★ 2026-08-02 상호참조 추가 — ktax와 트리거가 실제로 겹침(세금/
    // 사업자 세금, 부가세/부가세 신고, 세무/사업자 세무 — "GWP-GWP
    // 동층위 혼동" 사고실험에서 확인). ktax 쪽에도 동일하게 추가.
    description: '사업체 재무제표·세금·고용(4대보험) 보조. K-Market 판매자 연동. 개인 세금 신고·절세는 ktax 소관.',
    triggers: [
      '재무제표','손익계산서','대차대조표','사업자 세금','부가세 신고',
      '사업자 세무','법인세','4대보험','급여 계산','직원 급여',
      '고용보험 신고','인건비','경영 분석','매출 분석','사업 자금',
      '노란우산공제','사업자 회계','원천세','판매자 정산',
      // ★ 2026-08-11 추가 — 상권분석 실제 기능(handleTradeAreaAnalysis,
      // kmarket_admin_dashboard.html 상권분석 탭) 신설에 맞춰 트리거
      // 보강. 이전엔 desktop.html/flyer 예시 문구만 있고 매칭 트리거가
      // 아예 없어 "우리 가게 상권 분석해줘" 발화가 라우터에서 kbusiness로
      // 안 잡히는 사각지대였음(실사로 확인).
      '상권분석','상권 분석','유동인구','경쟁업체','경쟁업체 분석',
      '입지분석','우리 가게 근처','창업 진단','우리 동네 상권',
      // ★ 2026-08-11 추가 — 마케팅 방안 제안 실제 기능(handleMarketingPlan)
      // 신설에 맞춰 트리거 보강.
      '마케팅','마케팅 방안','홍보 방법','판촉','고객 유치','손님 늘리기',
      // ★ 2026-08-11 추가 — 위생점검 실행형 기능(관할 보건소 조회,
      // /gov/sigungu-dept-resolve 첫 실사용 연결)에 맞춰 보강.
      '위생점검 일정','위생점검 신청','관할 보건소','우리 가게 위생',
      // ★ 2026-08-11 추가 — 고객 리뷰 대응 실기능(seller_reviews 신설,
      // handleReviewList/ReplyDraft/ReplySubmit) 신설에 맞춰 보강.
      '고객 리뷰','리뷰 대응','리뷰 답글','악성 리뷰','리뷰 관리',
      // ★ 2026-08-11 추가 — 재고관리·공급망·인사·채용·업무일정관리
      // 실제 데이터 연동(biz_suppliers/biz_staff/biz_staff_tasks 신설)에
      // 맞춰 보강. 금융(예금/대출)은 의도적으로 트리거를 넓게 잡지
      // 않는다 — kgdc가 이미 예금·대출 관련 어휘를 담당하므로(위
      // kbank 철회 이력 참고), 여기 넣으면 두 GWP가 충돌한다. 대신
      // K-Business SP §B13에서 kgdc/실제 금융기관으로 안내하도록 함.
      '재고 관리','재주문','품절','공급업체','발주',
      '직원 채용','채용 공고','지원자 관리','직원 일정','업무 배정',
    ],
  },

  // ── profile-assistant — 앱 사용법 튜토리얼 + 프로필 작성 (2026-07-11 신설) ──
  // AC(§0-1)가 첫 인사 뒤 사용자가 준비됐다고 하면, 또는(§0-E) 자연스러운
  // 시점에 프로필 작성을 제안해 사용자가 동의하면 [GWP: profile-assistant]를
  // 낸다 — 다른 GWP 서비스와 동일한 새 탭 방식(구 CALL_PROFILE_ASSISTANT
  // 같은 창 전환 방식에서 이관, 튜토리얼이 AC 자신의 대본과 섞여 실제
  // 사용자 지시를 가로채던 문제 해결). threshold를 의도적으로 높게 잡아
  // 애매한 발화로 오발동하지 않게 하고, AC의 명시적 판단(§0-1/§0-E)에
  // 주로 의존한다.
  {
    id: 'profile-assistant', name: '혼디 안내(튜토리얼·프로필)', category: 'ONB',
    type: 'tab',
    url: '/pages/profile-assistant.html',
    status: 'active', priority: 5, threshold: 0.85,
    description: '앱 사용법 튜토리얼(PHASE -1) 및 프로필 작성/수정(PHASE 0/1). 중단해도 다음 호출 시 이어서 진행.',
    triggers: [
      '프로필 작성', '프로필 수정', '사용법 알려줘', '앱 사용법',
      '튜토리얼', '튜토리얼 다시', '이용법 안내',
    ],
  },

  // ── 환경 (ENV) — inline (신고) ────────────────────────────
  {
    id: 'fiil-kcleaner', name: 'K-Cleaner', category: 'ENV',
    type: 'inline',
    url: 'https://fiil.kr/webapp.html',
    sp_key: 'SP-14_kcleaner',
    status: 'active', priority: 11, threshold: 0.65,
    description: '해안·도심 쓰레기 AI 자동 분석·신고.',
    triggers: [
      '쓰레기','환경','해안','분리수거','청소','오염','폐기물',
      '불법 투기','해변','해양 오염','폐수','불법 배출',
    ],
  },

  // ── 플랫폼 유틸리티 (UTL) — 2026-07-08 신설 ────────────────
  // ★ 표준 [GWP: id] 새 탭 방식이 아니라 [KSEARCH_HANDOFF]로 동일
  // 스레드 안에서 system을 전환하는 방식(call-ai.js _switchToKSearchSP)
  // — 다른 항목과 달리 _gwpLaunch()가 이 id로 새 탭을 열 일은 없다.
  // 여기 등록하는 목적은 트리거 키워드 참고·문서 일관성용이며, status는
  // RULE-03 후반부(미청구 프로필 생성)가 아직 미구현이라 'pending'으로
  // 둔다(RULE-02는 2026-07-08부로 배선 완료 — SP-18_ksearch_v1.0.txt 참조).
  {
    id: 'ksearch', name: 'K-Search', category: 'UTL',
    type: 'inline',
    url: null,
    sp_key: 'SP-18_ksearch',
    status: 'pending', priority: 9, threshold: 0.70,
    // v1.1(2026-07-08): "검색은 K-Search만 전담" 원칙이 K-Market 등
    // 생태계 전체로 확정 — 다만 이 항목은 AC→K-Search 직접 위임(RULE-06
    // 6-A, [KSEARCH_HANDOFF])만을 위한 것이고, K-Market의 nested 위임
    // (RULE-06 6-B, [CALL_KSEARCH])은 market 레포 자체 구현이라 여기
    // 등록과 무관하다. AC 자신의 라우팅(예: [GWP: kcommerce])은 이
    // 변경으로 바뀌지 않는다 — AGENT-COMMON v3.34 참조.
    description: '혼디 생태계 전체의 유일한 검색 실행 에이전트 — 사람·AI비서 식별은 물론 K-Market 등 타 SP가 위임하는 판매자·상품 탐색까지 전담. 모호하면 되묻고, 없으면 솔직히 안내.',
    triggers: [
      '찾아줘','연결해줘','불러줘','아는 사람','그분','그 사람',
      '누구였지','아이디 찾','핸들 찾','프로필 찾',
    ],
  },

  // ── Tool 목록 ──────────────────────────────────────────────
  // type: 'tool' — function calling 방식, url 없음
  {
    id: 'tool-web-search',
    name: '웹 검색',
    category: 'TOOL',
    type: 'tool',
    url: null,
    sp_url: null,
    status: 'active',
    priority: 20,
    threshold: 0.60,
    description: '실시간 웹 검색. SP 자동생성 시 의무 사용.',
    fn: null,  // routing-engine.js의 _webSearch로 연결 (런타임 주입)
    triggers: [
      '검색해줘','찾아줘','최신','뉴스','오늘','지금','실시간',
      '날씨','환율','주가','시세','최근',
    ],
  },

  {
    id: 'tool-calculator',
    name: '계산기',
    category: 'TOOL',
    type: 'tool',
    url: null,
    sp_url: null,
    status: 'active',
    priority: 21,
    threshold: 0.70,
    description: '수식 계산. function calling.',
    fn: null,
    triggers: ['계산','얼마','합계','퍼센트','%','환산'],
  },

  {
    id: 'kqna', name: 'Gopang QnA', category: 'GOV',
    type: 'tab',
    url: 'https://qna.hondi.net/webapp.html',
    status: 'active', priority: 9, threshold: 0.65,
    description: '범부처 질의응답 라우터. SP-CORE + 도메인별 SP(BIZ/ECONOMY/EDU/GOV/INFRA/IP/LEGAL/LOGISTICS/SAFETY) 자체 라우팅.',
    triggers: [
      '질문있어','문의','궁금해','뭐예요','어떻게 해요','절차가',
      '신청 방법','자격 요건','필요한 서류',
    ],
  },

  {
    id: 'kusers', name: 'Gopang Users', category: 'GOV',
    type: 'tab',
    url: 'https://users.hondi.net/webapp.html',
    status: 'active', priority: 9, threshold: 0.65,
    description: '개인/기관 엔티티 검색·해석. GAS(Gopang Address System) v1.6 기반. SP-USERS 자체 라우팅.',
    triggers: [
      '이 사람 찾아줘','프로필 찾아줘','연락처 찾아줘','누구세요',
      '가입자 조회','엔티티 검색',
    ],
  },

  // ── 2026-09-01 신설 — K-Mail: 혼디 사용자 간 메일 발송·수신·주소록.
  // 관리자 전용 공문(hondi.org, gov-mail)과 도메인·인증·목적 모두 별개.
  // 같은 사이트 내 새 페이지(/pages/kmail-assistant.html)라 kemergency
  // 같은 별도 서브도메인 신설이 필요 없다 — type:'tab'만으로 충분.
  // 수신자·발송시각·회신처리는 이 탭 안의 대화(SP-25_kmail)에서 결정.
  {
    id: 'kmail', name: 'K-Mail', category: 'UTL',
    type: 'tab',
    url: '/pages/kmail-assistant.html',
    sp_key: 'SP-25_kmail',
    status: 'active', priority: 8, threshold: 0.75,
    description: '혼디 사용자 간 메일 발송·수신·주소록 관리(예약발송·회신취합·자동삭제 규칙). 관리자 전용 공문과 무관.',
    triggers: [
      '메일 보내', '메일 보내줘', '메일 확인', '메일함', '메일 정리',
      '이메일 보내', '이메일 확인', '주소록에 추가', '주소록 검색',
    ],
  },

];

// ── L1 pending_agents 동적 로드 (앱 시작 시 1회) ───────────────
// 다른 사용자가 임시 등록한 항목을 로드하여 GWP_REGISTRY에 병합
async function loadPendingAgents() {
  try {
    const L1_BASE = (typeof L1_URL !== 'undefined' ? L1_URL : '')
      .replace('/api/collections/profiles/records', '');
    if (!L1_BASE) return;

    const res = await fetch(
      `${L1_BASE}/api/collections/pending_agents/records?perPage=100`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return;

    const data = await res.json();
    const items = data.items || [];
    let added = 0;

    for (const item of items) {
      // 이미 있으면 건너뜀
      if (GWP_REGISTRY.find(s => s.id === item.id)) continue;
      GWP_REGISTRY.push({ ...item, type: item.type || 'inline' });
      added++;
    }

    if (added > 0) {
      console.info(`[Registry] pending_agents ${added}개 로드 완료`);
    }
  } catch (e) {
    console.warn('[Registry] pending_agents 로드 실패 (무시):', e.message);
  }
}

// ── Tool fn 런타임 주입 ────────────────────────────────────────
// routing-engine.js 로드 후 _webSearch 함수를 tool에 연결
function injectToolFns({ webSearch, calculator }) {
  const ws = GWP_REGISTRY.find(s => s.id === 'tool-web-search');
  if (ws && webSearch) ws.fn = webSearch;

  const calc = GWP_REGISTRY.find(s => s.id === 'tool-calculator');
  if (calc && calculator) calc.fn = calculator;
}

// ── 조회 함수 ──────────────────────────────────────────────────
// BUG-FIX(2026-07-03): AGENT-COMMON SP §9는 실제로 [GWP: klaw]/[GWP: ktax]
// 두 개만 정확한 id로 가르치고, 세 번째 예시([GWP: kmarket])조차 실제
// 레지스트리 id(kcommerce)와 다르다. 나머지 13개 서비스는 SP가 id를 아예
// 가르치지 않아 모델이 추측해야 하는데, 레지스트리 id 절반가량(kedu, kgdc,
// kfinance, ktransport, kgov, kemergency 등)이 표시명과 다른 이름이라
// 추측이 구조적으로 틀리기 쉽다. getService()가 정확히 일치하는 id만
// 받아주면 이 경우 탭이 열렸다가 조용히 닫히므로(_parseAgentTags의 else
// 분기), 흔히 나올 법한 오표기를 정답으로 되돌리는 별칭 해석을 안전망으로
// 추가한다. worker.js의 SVC_ALIAS(레지스트리id→저장소slug, 백엔드 PDV
// 라우팅용)와는 방향이 반대다 — 이건 "모델이 낼 법한 오표기→레지스트리id".
const SVC_ID_ALIAS = {
  kmarket:     'kcommerce',   // SP §9 예시 자체가 이렇게 잘못 가르침(확인됨)
  kschool:     'kedu',
  gdc:         'kgdc',
  kstock:      'kfinance',
  ktraffic:    'ktransport',
  kpublic:     'kgov',
  k119:        'kemergency',
  kcleaner:    'fiil-kcleaner',
  'k-cleaner': 'fiil-kcleaner',
  // 하이픈형 표기(모델이 종종 "K-Law" 표시명을 그대로 슬러그화할 때)
  'k-law':       'klaw',
  'k-tax':       'ktax',
  'k-police':    'kpolice',
  'k-security':  'ksecurity',
  'k-health':    'khealth',
  'k-insurance': 'kinsurance',
  'k-logistics': 'klogistics',
  'k-democracy': 'kdemocracy',
  'k-market':    'kcommerce',
  'k-traffic':   'ktransport',
  'k-public':    'kgov',
  'k-119':       'kemergency',
  'k-emergency': 'kemergency',
  'k-business':  'kbusiness',
  'business':    'kbusiness',
  // kregionalgov(전국 지방행정 AI) — 2026-07-22 복원. 2026-07-21에 신설
  // 됐던 이 별칭들이 같은 날 later(e469e54, jeju.hondi.net → hondi.net
  // 오리진 이전 커밋)에서 실수로 통째로 삭제됐다. 이 별칭들은 지역
  // 라우팅용이 아니라 "모델이 [GWP: xxx] 태그에 낼 법한 id(jeju,
  // 제주도청 등)를 실제 서비스 id(kregionalgov)로 되돌리는 안전망"이라
  // 오리진 변경과 무관하게 계속 필요하다 — 이게 없으면 "제주도청 불러
  // 줘"에 응답은 하지만 실제로는 탭이 안 열리는 바로 그 사고가 재발한다
  // (실사로 재현 확인, 2026-07-22).
  jeju:          'kregionalgov',
  jejudo:        'kregionalgov',
  kjeju:         'kregionalgov',
  regionalgov:   'kregionalgov',
  'k-regionalgov': 'kregionalgov',
  'regional-gov':  'kregionalgov',
  '제주도청':      'kregionalgov',
  '제주특별자치도청': 'kregionalgov',
  '지방행정':      'kregionalgov',
  '지자체':        'kregionalgov',
};

function getService(id) {
  if (!id) return null;
  return GWP_REGISTRY.find(s => s.id === id)
      || GWP_REGISTRY.find(s => s.id === SVC_ID_ALIAS[id])
      || null;
}

// ── 엔티티 기반 launch 폴백 (2026-08-03 신설, §ENTITY-LAUNCH) ──────
// ★ §1 제1원칙(AC-PRO-CORE, 2026-08-03) 코드 강제 ★ "모든 사용자는
// SP다 — 개인도 기관도 사물도 개념도, 호출한다는 것은 그 guid에
// 할당된 SP를 호출한다는 것이다." 이 함수가 그 원칙을 코드로 강제하는
// 지점이다: institution/org 엔티티는 이 함수에서 절대 null을 반환하지
// 않는다 — 전용 SP(entity_subtype)가 없으면 kgov(추상 클래스, 전용
// 인스턴스 없는 모든 사무를 받는 범용 창구)로 낙착시킨다. "전담 SP가
// 없다"는 이유로 호출이 실패하는 경우를 코드 차원에서 없앤다.
//
// K-Search(SP-18)가 profiles 컬렉션에서 institution/org 엔티티를 찾아
// 그 guid로 [GWP: {guid}]가 호출되는 경우 — 이 guid는 위 core 21개
// 배열엔 없다(getService()는 못 찾음). 이 함수 하나가 178개 gov-tree
// 기관(및 앞으로 추가될 institution/org 엔티티) 전부를 공통으로
// 처리한다 — 기관마다 이 파일에 개별 항목을 추가하지 않는다.
//
// entity_subtype 계약: profiles.extra.public.identity.entity_subtype에
// "{tier}:{code}"(예: "policy:ASSEMBLY") 형식의 코드가 seeding
// 스크립트(tools/seed_gov_tree_registry.py)로 미리 채워져 있으면 그
// 전용 SP로, 없으면 kgov로 연결한다.
//
// 비동기 함수다 — getService()(동기)와 별도로, 호출부(call-ai.js
// _parseAgentTags)가 getService() 실패 시에만 fire-and-forget으로
// 추가 시도한다.
async function _resolveEntityGwp(guid) {
  if (!guid) return null;
  try {
    const base = (typeof CFG !== 'undefined' && CFG?.endpoint) ? CFG.endpoint.replace(/\/+$/, '') : '';
    const res = await fetch(`${base}/profile?guid=${encodeURIComponent(guid)}`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const profile = data?.profile;
    if (!profile) return null;

    // ★ institution/org/platform만 이 함수가 직접 처리한다. person은
    // claim된 계정이면 이미 _mergeAgentSP()로 본인의 그림자 AI가
    // 할당돼 있어(§1 원칙이 이미 다른 경로로 충족됨) 이 함수의 대상이
    // 아니다 — person을 여기서 잘못 다루면 사칭 경로가 열린다(SP-18
    // RULE-01 금지-4와 동일한 우려). platform 중 'gwp:' 접두사는 core
    // 레지스트리로 pass-through(아래), 'expert:' 접두사는 검색은 되지만
    // launch 연결은 후속 과제(아래 참조). business/thing/concept은
    // 아직 기본 SP가 정의돼 있지 않다 — 없는 매핑을 지어내지 않고
    // 정직하게 null(호출부가 기존처럼 처리) — 후속 과제로 남긴다.
    if (!['institution', 'org', 'platform'].includes(profile.entity_type)) return null;

    const identity = profile.extra?.public?.identity || {};
    const subtype = identity.entity_subtype || null;

    // ★ 2026-08-03 신설 — entity_type='platform' + entity_subtype='gwp:{id}'는
    // 핵심 GWP 서비스를 "안전장치"로 profiles에도 등록해 K-Search가
    // 찾을 수 있게 한 것(주피터 지시). 이미 core 레지스트리에 실제
    // 정의가 있으므로 그걸 그대로 반환한다 — 여기서 새로 svcDef를
    // 만들지 않는다(중복 정의 방지, 단일 소스 유지).
    if (profile.entity_type === 'platform' && subtype?.startsWith('gwp:')) {
      const coreId = subtype.slice('gwp:'.length);
      return getService(coreId);
    }
    // ★ 2026-08-03 수정 — 이전 주석("EXPERT는 같은 탭 시스템 프롬프트
    // 교체 방식")은 사실과 다른 낡은 정보였다. expert-session.js를 직접
    // 확인한 결과, 2026-07-03부터 handleExpertTag()가 이미 GWP 기관과
    // 완전히 동일하게 _gwpLaunch()로 새 탭(pages/expert-chat.html)을
    // 연다(persona 쿼리 파라미터로 SP를 갈아끼워 서빙) — startExpertSession
    // (구 같은-탭 방식)은 2026-07-03 이후 call-ai.js 어디서도 호출되지
    // 않는 미사용 레거시임을 확인했다. 그래서 institution/org와 동일한
    // svcDef를 그대로 만들어 반환한다 — 별도 분기가 필요 없었다.
    if (profile.entity_type === 'platform' && subtype?.startsWith('expert:')) {
      const personaId = subtype.slice('expert:'.length);
      return {
        id: guid,
        name: identity.display_name || profile.name || '전문가',
        category: 'EXPERT',
        type: 'tab',
        url: `https://hondi.net/pages/expert-chat.html?persona=${encodeURIComponent(personaId)}`,
        status: 'active',
      };
    }
    if (profile.entity_type === 'platform') return null;

    const govCode = subtype;
    const displayName = identity.display_name || profile.name || '기관';

    if (govCode) {
      return {
        id: guid,
        name: displayName,
        category: 'GOV',
        type: 'tab',
        // regional-gov.html은 이미 있는 페이지 — gov_code 쿼리
        // 파라미터로 assembleGovSystemPrompt의 directCode 경로
        // (2026-08-03 신설)를 바로 태운다.
        url: `https://hondi.net/pages/regional-gov.html?gov_code=${encodeURIComponent(govCode)}`,
        status: 'active',
      };
    }

    // ★ §1 원칙 강제 지점 — 전용 SP(entity_subtype)가 없다고 여기서
    // null을 반환하면 "전담 SP가 없어 호출 실패"가 되어 원칙 위반이다.
    // kgov(core 레지스트리의 추상 클래스, 이미 존재)로 낙착시킨다 —
    // 그 기관 이름을 ctx에 실어 보내는 건 호출부(_parseAgentTags)가
    // 이미 하고 있으므로(cleanedReply/gwpCtx), kgov 진입 후 텍스트
    // 매칭이 최대한 좁혀준다.
    const kgovDef = getService('kgov');
    if (kgovDef) {
      return { ...kgovDef, id: guid, name: displayName };
    }
    return null; // kgov 코어 항목 자체가 없다면(설정 오류) 정직하게 null.
  } catch (e) {
    console.warn('[Registry] 엔티티 기반 서비스 해석 실패(무시):', e.message);
    return null;
  }
}
function getByCategory(cat) {
  return GWP_REGISTRY.filter(s => s.category === cat);
}
// ※ matchService()(구 window.gwpMatch/window.matchService)는 2026-07-05
// 제거됨 — 호출부 0건 확인(SP-00-ROUTER와 함께 죽은 코드였음). 실제
// 라우팅은 AGENT-COMMON이 [GWP:]/[EXPERT:] 태그로 직접 수행한다.
// 자세한 경위는 prompts/archive/SP-00-ROUTER-DEPRECATED.md 참조.

// ── 전역 노출 ──────────────────────────────────────────────────
window.GWP_REGISTRY    = GWP_REGISTRY;
window.getService      = getService;
window._resolveEntityGwp = _resolveEntityGwp;
window.getByCategory   = getByCategory;
window.loadPendingAgents = loadPendingAgents;
window.resolveSpUrls     = resolveSpUrls;
window.injectToolFns     = injectToolFns;
