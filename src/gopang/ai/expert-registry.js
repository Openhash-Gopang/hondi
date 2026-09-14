/**
 * ai/expert-registry.js — 전문가 AI 정적 레지스트리
 *
 * ⚠️ 낡음(2026-09-14 발견·정정) — 바로 아래 두 줄("GWP_REGISTRY(새 탭 방식)에
 * 넣지 않고... 같은 스레드 내 System Prompt 교체")은 2026-08-06 이전 설계를
 * 설명하며, 그 시점부로 사실이 아니다. 실제로는 전문가 페르소나도 K-서비스와
 * 동일하게 새 탭(pages/expert-chat.html)에서 독립 실행된다 — call-ai.js의
 * "(2026-08-06 정정)" 주석 참고: 예전에 메인 스레드에 있던 isExpertActive()
 * 분기는 항상 else(AC-PRO-CORE 로드)만 타는 죽은 조건문이었다고 명시돼 있다.
 * expert-session.js의 스레드 내 교체 방식은 src/_archive/
 * expert-session-legacy-inthread.js.md로 이미 아카이브된 예전 설계다. 아래
 * 원문은 역사적 맥락 보존을 위해 남겨두되, 현재 동작의 근거로 인용하지 말 것.
 *
 * (원문, 낡음) 전문 분야(기관) AI(K-Law·K-Tax 등)는 별도 URL을 가진 새 탭
 * 서비스이지만, 전문가 AI(변호사·간호사 등 개별 자격직)는 별도 서비스가 없는
 * "순수 System Prompt" 페르소나다. 따라서 GWP_REGISTRY(새 탭 방식)에 넣지
 * 않고, 이 레지스트리를 통해 "같은 스레드 내 System Prompt 교체" 방식
 * (expert-session.js)으로 호출한다.
 *
 * 분류(LAW/HEALTH/EDU/ENG/FIN/REAL_ESTATE/IT/TRANSLATION/TOURISM/SPORTS/BEAUTY/
 * CULINARY)는 각 SP 파일 1행에 적힌 코드(SP-LAW-01 등)를 그대로 따른다. 임상심리사·
 * 정신건강전문요원·전문상담교사는 SP-EDU 코드를 부여받아 category는 EDU를
 * 유지하지만, needsMedicalSafety는 true다 — 2026-07-04에 위기개입 프로토콜
 * (SP-COMMON-03 M5, 자살·자해 대응)을 상속받도록 수정됐다(카테고리 분류와
 * 안전모듈 상속은 별개 기준).
 *
 * ownerAgency (2026-07-20 신설): 이 페르소나의 세션 데이터·상담 이력이
 * 귀속되는 소유 K-서비스(GWP_REGISTRY의 agency id)다. 원칙적으로 category와
 * 1:1이지만 두 종류의 예외가 있다:
 *   (1) FIN 카테고리 안에서도 자격별 업무 실질이 달라 개별 override가 있다
 *       — tax-accountant는 카테고리 기본값(ktax) 그대로, accountant는
 *       kfinance(회계감사·재무제표·기업가치평가가 K-Tax보다 K-Stock 쪽 실질에
 *       가까움), financial-planner는 kbank(개인 자산관리) — 각 override는
 *       해당 엔트리 옆 주석 참조.
 *   (2) 대응하는 K-서비스 저장소가 아직 없는 카테고리(ENG/TRANSLATION/
 *       TOURISM/SPORTS/BEAUTY/CULINARY)는 총괄 저장소인 gopang으로 폴백한다
 *       — 수요가 확인되면 그때 전용 K-서비스로 분리한다(의도된 폴백이지
 *       누락이 아님).
 * 세션 종료 시 이 필드를 기준으로 소유 K-서비스의 PDV(가명화 해시 상담기록)에
 * 6하원칙 레코드가 기록된다 — 자세한 스키마는 SP_PDV 문서 참조.
 */

export const UNIVERSAL_INTEGRITY_KEY   = 'UNIVERSAL-INTEGRITY'; // 2026-07-09: 하드코딩 경로 -> manifest 키로 전환
// 2026-07-09: v3.3 → v3.6 갱신. v3.4~v3.6이 실제로는 이 상수가 안 바뀌어서
// 한 번도 로드된 적이 없었다(실사로 확인 — expert-session.js가 이 URL을
// fetch()로 직접 읽고, sp-catalog.json을 거치지 않는 별도 체계이기 때문).
// C40(공익·사익 재분류 게이트)·C41(오케스트레이션 하위 판단 요청)이 이제야
// 실제로 로드된다.
export const COMMON_GUARDRAILS_KEY     = 'SP_common_guardrails'; // 2026-07-09: 하드코딩 경로 -> manifest 키로 전환
export const COMMON_MEDICAL_SAFETY_KEY = 'SP_common_medical_safety'; // 2026-07-09: 상동
export const CONTROL_TOWER_PRINCIPLE_KEY = 'CONTROL-TOWER-PRINCIPLE'; // 2026-08-08 신설
// (실사로 발견된 버그 수정) — CONTROL-TOWER-PRINCIPLE_v1_1.md 자신은
// "manifest-loader.js(_loadSpByKey)를 통해 로드되는 모든 SP 앞에 자동
// 결합된다"고 명시하지만, 실제로는 EXPERT 페르소나 조립(_composeExpertPrompt)
// 안에서 그 문서를 직접 fetch하는 경로가 어디에도 없었다 — 이 함수는
// UNIVERSAL-INTEGRITY를 로드할 때 self-concat 방지 분기(_loadSpByKey 내부)
// 때문에 자동 결합이 걸리지 않고, 나머지 문서는 전부 _loadSpRawByKey(자동
// 결합 없음)로 로드하기 때문. 결과적으로 professor·physician·lawyer 등
// 158개+ EXPERT 페르소나 전부가 관제탑 원칙 문서를 한 번도 못 받고 있었다
// (SP_common_guardrails 자체 내장 C50 절만 받고 있었음 — 별도 CONTROL-
// TOWER-PRINCIPLE.md와는 무관). 이 상수로 명시적으로 한 번 로드해 고친다.
export const EXPERT_BASE_KEY           = 'SP_EXPERT_BASE'; // 2026-08-07 신설(HANDOFF
// SP-EXPERT-BASE-전체롤아웃계획 §6-1) — SP_EXPERT_BASE_v1_0.md(SP-COMMON-06,
// 법무사·변호사·감정평가사·세무사 4개 실사검증 페르소나에서 추출한 STEP 골격
// 스캐폴드). COMMON_GUARDRAILS_KEY·COMMON_MEDICAL_SAFETY_KEY와 동일한 원문
// 로드(_loadSpRawByKey) 패턴을 따른다 — 개별 SP는 이 문서가 이미 정의한
// STEP 0-(-1)/STEP R 본체/STEP D 본체/C50 NEXT_STEP을 재서술하지 않는다.

import { PHYSICIAN_REGISTRY } from './expert-registry-physician.js';
import { LAWYER_REGISTRY } from './expert-registry-lawyer.js';
import { PROFESSOR_REGISTRY } from './expert-registry-professor.js';
import { CORE_REGISTRY } from './expert-registry-core.js';

// 2026-08-08 리팩터링(도메인 분리) — 원래 이 파일 하나에 168개 엔트리가
// 전부 있었는데, 의사·변호사·교수 세부분야가 여러 세션에서 동시에 빠르게
// 확장되면서 병합 충돌이 반복 발생해(§ 파일 상단 각 partial 헤더 참고)
// 4개 파일로 쪼갰다. EXPERT_REGISTRY는 그 4개를 병합한 결과이고, 외부에서
// 보이는 모양(단일 평면 객체, 키 충돌 시 마지막 값이 이긴다는 점 포함)은
// 리팩터링 전과 완전히 동일하다 — import하는 쪽(expert-session.js,
// call-ai.js, 테스트)은 코드를 고칠 필요가 없다.
export const EXPERT_REGISTRY = {
  ...CORE_REGISTRY,
  ...PHYSICIAN_REGISTRY,
  ...LAWYER_REGISTRY,
  ...PROFESSOR_REGISTRY,
};



export function getExpertDef(personaId) {
  return EXPERT_REGISTRY[personaId] || null;
}

// 2026-08-07 신설(내부 자문 호출 기능) — 부모 SP가 대화 중 "이 사안은
// 세부분야 전문의 소견이 필요하다"고 판단했을 때, 실제로 소환 가능한
// 자식 SP 목록을 역조회한다. `parentKey`는 이미 §5(세부분야 상속)에서
// 정적 조립(EXPERT_BASE→부모→자식)에 쓰이고 있었는데, 이 함수는 그
// 동일한 관계를 동적 호출("자식을 부모 자리에서 아예 로드"가 아니라
// "부모가 대화를 이어가며 자식에게 좁은 질문 하나만 던지고 소견만
// 받아오는") 정당성 검증에 재사용한다 — 등록되지 않은 임의의 페르소나를
// 자문 대상으로 호출하는 것을 막는 화이트리스트 역할.
export function getConsultableChildren(parentId) {
  return Object.entries(EXPERT_REGISTRY)
    .filter(([, def]) => def && def.parentKey === parentId)
    .map(([id, def]) => ({ id, label: def.label, key: def.key, needsMedicalSafety: !!def.needsMedicalSafety }));
}

// 위와 짝을 이루는 검증 함수 — childId가 실제로 parentId의 등록된
// 자식인지 확인한다(단순 truthy 체크가 아니라 정확한 관계 매칭).
export function isConsultableChild(parentId, childId) {
  const childDef = EXPERT_REGISTRY[childId];
  return !!(childDef && childDef.parentKey === parentId);
}

// ── 2026-08-08 신설(과목 게이트/subject-gate.js 지원) ──────────────────
// §CATALOG-EXPERT 표에는 라우팅 후보 절약을 위해 professor/physician/
// lawyer 세 상위 직업군이 각각 "한 줄"로만 올라가 있다(예: professor |
// 교수(1:1 맞춤교육)). 그런데 실제 등록된 리프(중계열·소계열이 아닌,
// 실제로 세션이 열리는 말단 페르소나)는 이 세 직업군 아래 158개+가
// parentKey 체인으로 걸려 있다 — 라우팅 LLM은 이 리프들의 존재 자체를
// 모른 채 [EXPERT: professor]까지만 낼 수 있다("교수(범용)"로 뭉뚱그려
// 라우팅됨, 세부 리프에는 자연어 라우팅으로 도달 불가 — 사고실험 코드
// 추적으로 사전 확인된 구조적 결함). 이 함수는 주어진 상위 노드
// (professor/physician/lawyer 등) 아래의 모든 리프(자신을 자식으로 둔
// 노드가 하나도 없는 노드)를 재귀적으로 수집한다 — subject-gate.js가
// 2단계 분류(사용자 발화 → 리프 후보 목록 중 하나)를 할 때 그 후보
// 목록을 만드는 데 쓴다. 중계열(중간 노드, triggers: []로 표시되는
// 직접 호출 대상 아닌 노드)은 결과에서 제외되고, 상위 노드 자신도
// 자식이 하나라도 있으면 제외된다(자식이 없으면 자기 자신이 곧 유일한
// 리프이므로 포함 — 예: physician 세부분야가 없는 상태로 물으면 그냥
// physician 자신).
export function getLeafDescendants(rootId) {
  const children = Object.entries(EXPERT_REGISTRY).filter(
    ([, def]) => def && def.parentKey === rootId
  );
  if (children.length === 0) {
    // rootId 자신이 등록돼 있으면 자기 자신을 유일한 리프로 반환
    const selfDef = EXPERT_REGISTRY[rootId];
    return selfDef ? [{ id: rootId, label: selfDef.label }] : [];
  }
  const leaves = [];
  for (const [childId] of children) {
    leaves.push(...getLeafDescendants(childId));
  }
  return leaves;
}

// BUG-FIX(2026-07-03): GWP_REGISTRY와 동일한 문제 — AGENT-COMMON SP는
// [EXPERT: SP-LAW-01] 같은 형식을 예시로 가르쳤지만 실제 키는 'lawyer'
// 같은 kebab-case 직업군 슬러그다. SP는 이제 정답 표를 갖도록 고쳤지만
// (아래 §9), 모델이 그래도 실수로 흔한 오표기를 낼 가능성에 대비해
// 별칭 해석 안전망을 둔다.
const EXPERT_ID_ALIAS = {
  'SP-LAW-01': 'lawyer',
  lawyer_ai: 'lawyer', attorney: 'lawyer',
  vet: 'veterinarian',
  pt: 'physical-therapist',
  physicaltherapist: 'physical-therapist',
  nutritionist: 'dietitian',
  psychologist: 'clinical-psychologist',
  counselor: 'school-counselor',
  // 2026-07-06 신설 8개의 흔한 대체 표기
  doctor: 'physician', 'medical-doctor': 'physician', physician_ai: 'physician',
  dentist_ai: 'dentist',
  'tcm-doctor': 'traditional-medicine-doctor', 'oriental-medicine-doctor': 'traditional-medicine-doctor',
  pharmacist_ai: 'pharmacist',
  cpa: 'accountant', 'certified-public-accountant': 'accountant',
  'realtor': 'real-estate-agent', 'real-estate': 'real-estate-agent',
  'social-worker-ai': 'social-worker',
  // 2026-07-17 신설 5개 페르소나의 흔한 대체 표기
  'afpk': 'financial-planner', 'cfp': 'financial-planner', 'financial-advisor': 'financial-planner',
  'property-appraiser': 'appraiser', 'valuation-appraiser': 'appraiser',
  'insurance-adjuster': 'loss-adjuster',
  'labor-consultant': 'labor-attorney', 'employment-attorney': 'labor-attorney',
  // 2026-08-06 신설 — 라이브 재검증(패널 오케스트레이션) 중 실사로 발견:
  // K-Compose가 가족관계등록(출생신고 등) 적합성 확인을 위해 EXPERT
  // 위임을 낼 때 'kfam'이라는, 등록된 적 없는 ID를 스스로 지어냈다.
  // 전용 가족법 전문가 페르소나가 아직 없어 일반 변호사('lawyer')로
  // 대신 받도록 흔히 나올 법한 표기를 미리 별칭 처리한다. 다만 이건
  // '그럴듯한 오표기 안전망'일 뿐이라, 화이트리스트에도 없는 완전히
  // 새로운 이름을 지어내는 경우까지는 못 막는다 — 그 경우를 위한
  // 방어는 call-ai.js의 EXPERT(scope=orchestration_subtask) 처리부에
  // 별도로 추가했다(존재하지 않는 ID면 침묵하지 않고 K-Compose에게
  // 정정 요청을 되돌려준다).
  'kfam': 'lawyer', 'family-law': 'lawyer', 'family-law-attorney': 'lawyer',
  'civil-registration': 'lawyer', 'family-registration': 'lawyer',
  'emt': 'paramedic', 'emergency-medical-technician': 'paramedic',
  'patent-agent': 'patent-attorney', 'ip-attorney': 'patent-attorney',
  'customs-agent': 'customs-broker',
  'midwife-ai': 'midwife',
  'speech-therapist': 'speech-language-pathologist', 'slp': 'speech-language-pathologist',
  'optometrist': 'optician',
  'hygienist': 'sanitarian',
  'youth-counselor-ai': 'youth-counselor',
  'daycare-teacher': 'childcare-teacher', 'preschool-teacher': 'childcare-teacher',
  'lifelong-education-instructor': 'lifelong-educator',
  'landscape-architect-eng': 'landscape-engineer',
  'surveyor': 'surveying-engineer', 'geospatial-engineer': 'surveying-engineer',
  'electrical-engineer-safety': 'electrical-safety-engineer',
  'gas-engineer': 'gas-safety-engineer',
  'security-expert': 'security-engineer', 'infosec': 'security-engineer', 'cybersecurity-expert': 'security-engineer',
  'translator': 'translator-interpreter', 'interpreter': 'translator-interpreter',
  'tourist-guide': 'tour-guide', 'travel-guide': 'tour-guide',
  'fitness-instructor': 'sports-instructor', 'personal-trainer': 'sports-instructor',
  'hair-stylist': 'hairdresser', 'hairstylist': 'hairdresser',
  'cook': 'chef', 'baker': 'chef', 'culinary-chef': 'chef',
  'health-education-specialist': 'health-educator', 'public-health-educator': 'health-educator',
  'hondi-sp': 'hondi-guide', 'hondi': 'hondi-guide', 'platform-guide': 'hondi-guide',
};

export function resolveExpertId(personaId) {
  if (!personaId) return null;
  // 1) 원문 그대로 매치 — SP-LAW-01처럼 원래 대문자인 별칭 키를 우선 존중
  if (EXPERT_REGISTRY[personaId]) return personaId;
  if (EXPERT_ID_ALIAS[personaId]) return EXPERT_ID_ALIAS[personaId];

  // 2) 대소문자 무관 매치 (2026-07-06 — 사고실험 100건 #98~100에서 실증된
  //    버그 수정: 'ATTORNEY'/'Vet'/'Counselor' 같은 변형이 일반 객체 키
  //    조회라 조용히 null이 되던 것. registry/alias 키를 소문자로도 한 번
  //    더 비교한다 — 값(personaId 자체)은 이미 소문자 kebab-case이므로
  //    별도 변환 불필요.)
  const lower = personaId.toLowerCase();
  for (const key of Object.keys(EXPERT_REGISTRY)) {
    if (key.toLowerCase() === lower) return key;
  }
  for (const key of Object.keys(EXPERT_ID_ALIAS)) {
    if (key.toLowerCase() === lower) return EXPERT_ID_ALIAS[key];
  }
  return null;
}

// ── 2026-07-03: 전문가 페르소나도 GWP 서비스처럼 "별도 새 탭"으로 연다 ──
// 이전에는 별도 서비스가 없다는 이유로 "같은 스레드 안에서 System Prompt만
// 교체"하는 방식(expert-session.js의 startExpertSession)을 썼다. 문제는:
// (1) 사용자가 그림자 AI와 나누던 대화 스레드 자체가 전문가 페르소나로
// 바뀌어버려서, 세션이 끝나고 그림자 AI로 복원되기 전까지는 사용자가 지금
// 누구와 대화 중인지 UI상 구분이 흐릿했다. (2) GWP 기관 서비스와 호출
// 경험이 이원화되어 있었다(하나는 새 탭, 하나는 같은 창) — 사용자 입장에서
// 일관성이 없다. 이제 모든 전문가 페르소나를 하나의 공용 페이지
// (pages/expert-chat.html)에서 persona 쿼리 파라미터로 SP만 갈아끼워
// 서빙하고, GWP와 동일하게 _gwpLaunch()로 새 탭을 연다.
const EXPERT_CHAT_BASE_URL = 'https://hondi.net/pages/expert-chat.html';

export function getExpertGwpDef(personaId) {
  const def = EXPERT_REGISTRY[personaId];
  if (!def) return null;
  return {
    id:   personaId,
    name: def.label,
    icon: def.icon,
    url:  `${EXPERT_CHAT_BASE_URL}?persona=${encodeURIComponent(personaId)}`,
  };
}
