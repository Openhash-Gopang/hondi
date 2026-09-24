#!/usr/bin/env node
/**
 * gov-tree batch12~17 신설 SP 17개 — 더 폭넓은 사용자 발화 라이브
 * 스모크테스트 (작업 #19, 2026-09-24).
 *
 * 배경: 프로젝트 총괄(피터/주피터)이 gov_router_2026_09_24_new_agencies_
 * live_smoketest.mjs(22건)의 실제 GitHub Actions 실행 결과 22건 중 2건
 * 실패(veterans-registration, police-committee-deliberation)를 확인하고
 * "수정하십시오. 그리고, 더욱 폭넓은 사용자 발화로 라이브 테스트를 한 번
 * 더 진행하십시오"라고 명시적으로 지시했다. 이 파일이 그 두 번째(더 폭넓은)
 * 라이브 테스트다 — 기존 22건 파일·워크플로는 그대로 보존하고(계속 재실행
 * 가능해야 함), 이 파일을 별도로 신설했다.
 *
 * 이전 파일과 다른 점(더 "폭넓은" 발화):
 *   - 격식체/반말, 다른 어휘 선택, 간접적 표현, 복합 질문 등으로 표현을 다양화
 *   - 신설 SP 17개 각각 최소 2건, 특히 이번에 실패했던 보훈청(SP-AGY-VETERANS)·
 *     자치경찰위원회(SP-COMM-POLICE)는 각 3건 이상(회귀 재발 검증 포함)
 *   - 애매한 경계 케이스(비교형 질문, 여러 소방서 중 어디인지 불명확한 질문 등)를
 *     info-only(라우팅 정답을 강제하지 않고 trace만 기록·관찰)로 포함
 *
 * 구조는 gov_router_2026_09_24_new_agencies_live_smoketest.mjs를 그대로
 * 복제했다 — realClassifyFn(pages/regional-gov.html의 _govClassifyFn 그대로
 * 복제), assembleGovSystemPrompt/resolveGovAgency 실제 import(목 아님),
 * 체크1(라우팅 도달)·체크3(SP 응답 품질) 동일 패턴. info-only 시나리오는
 * `info: true`로 표시하고 pass/fail 집계에서 제외한다(gov-router.test.mjs의
 * CASES "참고용" 패턴과 동일한 원리).
 *
 * ⚠️ 정직한 데이터 출처 표시 — 이 세션엔 실제 DEEPSEEK_API_KEY가 없어
 * realClassifyFn(LLM 폴백)까지 포함한 완전한 라이브 실행은 이 세션에서
 * 못 했다. GitHub Actions에서 workflow_dispatch로 DEEPSEEK_API_KEY secret과
 * 함께 수동 실행해야 완전한 결과를 얻는다. 이 세션의 검증 범위는 (1) 문법
 * 검사(node --check), (2) classifyFn=null(순수 키워드 매칭)만으로
 * assembleGovSystemPrompt를 호출한 오프라인 시뮬레이션 — archive/README.md와
 * PR 설명에 정직하게 기록했다.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... node gov_router_2026_09_24_new_agencies_broad_live_smoketest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';
const API_KEY = process.env.DEEPSEEK_API_KEY;

// ★ pages/regional-gov.html의 PROXY 상수와 완전히 동일한 값.
const PROXY = 'https://hondi-proxy.tensor-city.workers.dev';

if (!API_KEY) {
  console.error('DEEPSEEK_API_KEY 환경변수가 없습니다.');
  process.exit(1);
}

async function callDeepSeek(messages, { maxTokens = 400 } = {}) {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();

  return data.choices?.[0]?.message?.content ?? '';
}

// ★ pages/regional-gov.html의 _govClassifyFn을 토씨 하나 안 틀리고 그대로
// 복제(system 프롬프트 문구, model=deepseek-v4-flash, max_tokens=30,
// temperature=0, hondi-proxy 엔드포인트, 코드 추출 정규식까지 동일).
let classifyCallCount = 0;
async function realClassifyFn(text, candidatesText) {
  classifyCallCount++;
  try {
    const r = await fetch(`${PROXY}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://hondi.net',
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash', max_tokens: 30, temperature: 0,
        messages: [
          { role: 'system', content:
            '아래는 제주 지방행정 라우팅 코드 후보 목록이다. 사용자 발화를 읽고 ' +
            '가장 알맞은 코드 하나만 답하라. 확신이 없거나 해당하는 코드가 없으면 ' +
            'NONE이라고만 답하라. 후보 중 2개가 똑같이 그럴듯해서 하나로 못 고르겠으면 ' +
            '"CLARIFY:코드1,코드2" 형식으로만 답하라(콤마로 구분, 공백 없이, 정확히 2개만). ' +
            '다른 설명·문장부호 없이 코드, NONE, 또는 CLARIFY:... 중 하나만 출력한다.\n\n' +
            candidatesText },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!r.ok) {
      console.warn(`  [_govClassifyFn] 프록시 응답 실패: ${r.status}`);
      return null;
    }
    const d = await r.json();
    const raw = (d.choices?.[0]?.message?.content || '').trim();
    if (raw.startsWith('CLARIFY:')) {
      const codes = raw.slice(8).match(/[A-Z0-9][A-Z0-9-]*/g) || [];
      return codes.length >= 2 ? `CLARIFY:${codes[0]},${codes[1]}` : null;
    }
    const m = raw.match(/[A-Z0-9][A-Z0-9-]*/);
    return m ? m[0] : (raw === 'NONE' ? 'NONE' : null);
  } catch (e) {
    console.warn(`  [_govClassifyFn] 실패(무시): ${e.message}`);
    return null;
  }
}

const SCENARIOS = [
  // ══════════════════════════════════════════════════════════════
  // 보훈청(SP-AGY-VETERANS) — 3건+ (버그1 회귀 검증 최우선)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'veterans-registration-casual',
    utterance: '국가유공자 등록하고 싶은데 어디로 가야 돼?',
    expectContains: 'SP-AGY-VETERANS',
    note: '★버그1 회귀 검증(반말) — "국가유공자 등록"(보훈청 보상과 division kw). 작업 #19에서 SP-NAT-VETERANS(bare "국가유공자")와의 명칭충돌을 고친 바로 그 사무를 반말로 재검증.',
  },
  {
    id: 'veterans-registration-formal',
    utterance: '국가유공자 등록 절차를 상세히 안내받고 싶습니다',
    expectContains: 'SP-AGY-VETERANS',
    note: '★버그1 회귀 검증(격식체) — "국가유공자 등록"(보훈청 보상과 division kw)을 격식체로.',
  },
  {
    id: 'veterans-affairs-event',
    utterance: '참전유공자단체 활동 지원 신청은 어디서 받나요',
    expectContains: 'SP-AGY-VETERANS',
    note: '참전유공자단체(보훈청 보훈과 division kw) — SP-AGYDIV-VETERANS-AFFAIRS.',
  },
  {
    id: 'veterans-hall-tour-formal',
    utterance: '항일기념관을 단체로 방문하고자 하는데 사전 예약 절차를 안내해 주시겠습니까',
    expectContains: 'SP-AGY-VETERANS',
    note: '항일기념관(격식체) — SP-AGYDIV-VETERANS-MEMORIAL.',
  },

  // ══════════════════════════════════════════════════════════════
  // 자치경찰위원회(SP-COMM-POLICE) — 3건+ (버그2 회귀 검증 최우선)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'comm-police-policy-review-casual',
    utterance: '자치경찰 정책 이런 거 심의하는 위원회가 있다던데 거기 연락처 좀',
    expectContains: 'SP-COMM-POLICE',
    note: '★버그2 회귀 검증(반말·간접 표현) — 자치경찰사무 정책 심의 주체(위원회) 문의. 작업 #19에서 고친 institution 매칭(siblingTables) 재검증.',
  },
  {
    id: 'comm-police-personnel-eval',
    utterance: '자치경찰사무 담당 공무원 인사 평가는 어느 기구에서 하는지 궁금합니다',
    expectContains: 'SP-COMM-POLICE',
    note: '★버그2 회귀 검증(다른 사무·격식체) — 위원회 §2 "자치경찰사무 담당 공무원 인사·평가".',
  },
  {
    id: 'comm-police-coordination',
    utterance: '자치경찰협력과 관련해서 사무조정 절차가 있다고 들었는데 어디서 담당하나요',
    expectContains: 'SP-COMM-POLICE',
    note: '★버그2 회귀 검증(복합 질문) — division "자치경찰협력과"(SP-COMMDIV-POLICE-COOP) 언급. ("국가경찰"이라는 단어를 쓰면 SP-NAT-POLICE의 bare institution kw("국가경찰")가 즉시 확정돼버려 이번 작업#19 수정 범위 밖의 별개 명칭충돌이 함께 재현되므로 의도적으로 배제 — 그 별개 이슈는 이 스모크테스트의 목적이 아니라 별도 보고 대상.)',
  },
  {
    id: 'comm-police-membership',
    utterance: '자치경찰위원회 위원 구성이 어떻게 되어있는지 협의체 관련해서 알고 싶어요',
    expectContains: 'SP-COMM-POLICE',
    note: 'institution kw "위원구성협의체" 직접 매칭 확인.',
  },

  // 대응쌍: 자치경찰단(집행조직, SP-AGY-POLICE) — 위원회와 실제로 갈라지는지 재확인 2건
  {
    id: 'agy-police-tourist-crime',
    utterance: '외국인 관광객이 소매치기를 당했다고 신고하러 왔는데 관광경찰 쪽으로 연결해주세요',
    expectContains: 'SP-AGY-POLICE',
    note: '관광경찰(자치경찰단 institution kw) — 위원회(SP-COMM-POLICE)와 실제로 갈라지는지 대조 확인.',
  },
  {
    id: 'agy-police-parking',
    utterance: '동네에 불법 주정차 차량이 계속 있는데 자치경찰단에 단속 요청하고 싶어요',
    expectContains: 'SP-AGY-POLICE',
    note: '자치경찰단(institution kw) — 생활안전/교통 단속 사무.',
  },

  // ══════════════════════════════════════════════════════════════
  // 공공정책연수원(SP-AGY-PUBLICPOLICY) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'publicpolicy-domestic-training',
    utterance: '저희 부서에서 특별자치전문교육을 신청하려고 하는데 절차가 어떻게 되나요',
    expectContains: 'SP-AGY-PUBLICPOLICY',
    note: '특별자치전문교육(institution kw) — SP-AGY-PUBLICPOLICY §2.',
  },
  {
    id: 'publicpolicy-foreignlang',
    utterance: '공무원 외국어교육 프로그램이 있다고 들었는데 신청 방법 좀 알려주실래요',
    expectContains: 'SP-AGY-PUBLICPOLICY',
    note: '외국어교육(desc "외국어교육 등 공무원 역량 개발") — SP-AGY-PUBLICPOLICY §2, 간접 표현.',
  },

  // ══════════════════════════════════════════════════════════════
  // 문화예술진흥원(SP-AGY-CULTUREARTS) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'cultureearts-exhibit-hall',
    utterance: '전시실을 대관해서 개인전을 열고 싶은데 사용허가 신청은 어떻게 하나요',
    expectContains: 'SP-AGY-CULTUREARTS',
    note: '전시실 사용허가(운영과 division kw) — SP-AGY-CULTUREARTS §2.',
  },
  {
    id: 'cultureearts-friends-society',
    utterance: '문화사랑회 회원 가입 관련해서 문의드리고 싶습니다',
    expectContains: 'SP-AGY-CULTUREARTS',
    note: '문화사랑회(운영과 division kw) — SP-AGY-CULTUREARTS §2, 격식체.',
  },

  // ══════════════════════════════════════════════════════════════
  // 해양수산연구원(SP-AGY-MARINEFISHERIES) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'marinefisheries-abalone',
    utterance: '전복류 품종개량 관련 연구 지원을 받을 수 있는지 궁금한데요',
    expectContains: 'SP-AGY-MARINEFISHERIES',
    note: '전복류 품종개량(수산종자연구과 division kw) — SP-AGY-MARINEFISHERIES §2.',
  },
  {
    id: 'marinefisheries-village-fishery',
    utterance: '마을어장 자원생태 조사 결과를 좀 열람하고 싶습니다',
    expectContains: 'SP-AGY-MARINEFISHERIES',
    note: '마을어장 자원생태(해양환경연구과 division kw) — SP-AGY-MARINEFISHERIES §2, 격식체.',
  },

  // ══════════════════════════════════════════════════════════════
  // 동물위생시험소(SP-AGY-ANIMALHYGIENE) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'animalhygiene-shelter',
    utterance: '유기동물 보호 관련해서 광역동물보호센터에 문의하고 싶은데요',
    expectContains: 'SP-AGY-ANIMALHYGIENE',
    note: '광역동물보호센터(institution/division kw) — SP-AGY-ANIMALHYGIENE §2.',
  },
  {
    id: 'animalhygiene-residue-test',
    utterance: '축산물에 유해 잔류물질이 있는지 검사받으려면 어디로 문의하나요',
    expectContains: 'SP-AGY-ANIMALHYGIENE',
    note: '축산물 유해 잔류물질 검사(축산물안전과 division kw) — SP-AGY-ANIMALHYGIENE §2.',
  },

  // ══════════════════════════════════════════════════════════════
  // 설문대여성문화센터(SP-AGY-SEOLMUNDAE) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'seolmundae-volunteer-center',
    utterance: '여성자원활동센터 운영 프로그램에 자원봉사로 참여하고 싶은데 방법 좀 알려주세요',
    expectContains: 'SP-AGY-SEOLMUNDAE',
    note: '여성자원활동센터(division kw) — SP-AGY-SEOLMUNDAE §2.',
  },
  {
    id: 'seolmundae-lifelong-education',
    utterance: '여성 대상 평생교육 강좌를 듣고 싶은데 어디서 신청하나요',
    expectContains: 'SP-AGY-SEOLMUNDAE',
    note: '여성평생교육(division kw) — SP-AGY-SEOLMUNDAE §2.',
  },

  // ══════════════════════════════════════════════════════════════
  // 돌문화공원관리소(SP-AGY-STONEPARK) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'stonepark-research',
    utterance: '돌문화 관련 자료 조사 연구 결과가 궁금한데 어디에 문의하면 되나요',
    expectContains: 'SP-AGY-STONEPARK',
    note: '돌문화 자료 조사(돌문화연구과 division kw) — SP-AGY-STONEPARK §2.',
  },
  {
    id: 'stonepark-park-visit',
    utterance: '돌문화공원 단체 관람을 신청하고 싶은데 어떻게 해야 하나요',
    expectContains: 'SP-AGY-STONEPARK',
    note: '돌문화공원(institution kw) — SP-AGY-STONEPARK §2.',
  },

  // ══════════════════════════════════════════════════════════════
  // 고용센터(SP-AGY-EMPLOYMENT) — 2건 (명칭충돌 일원화 추가 검증)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'employment-training-facility',
    utterance: '직업훈련시설 등록하고 싶은데 어느 부서로 문의드려야 하나요',
    expectContains: 'SP-AGY-EMPLOYMENT',
    note: '★명칭충돌 추가 검증 — 직업훈련시설(고용지원과 division kw) — SP-AGY-EMPLOYMENT §2.',
  },
  {
    id: 'employment-seogwipo-branch',
    utterance: '서귀포 쪽에 사는데 서귀포지소 고용센터 위치가 어디인가요',
    expectContains: 'SP-AGY-EMPLOYMENT',
    note: '서귀포고용센터(division kw) — SP-AGY-EMPLOYMENT §2, 위치 이원화 확인.',
  },

  // ══════════════════════════════════════════════════════════════
  // 중앙협력본부(SP-AGY-CENTRALCOOP) — 2건 (명칭충돌 일원화 추가 검증)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'centralcoop-assembly-liaison',
    utterance: '국회 협력 기획 관련해서 도정 협력 업무를 협의하고 싶은데 담당 부서가 어디죠',
    expectContains: 'SP-AGY-CENTRALCOOP',
    note: '★명칭충돌 추가 검증 — 국회 협력 기획(division kw) — SP-AGY-CENTRALCOOP §2.',
  },
  {
    id: 'centralcoop-press',
    utterance: '중앙언론 대상 도정 홍보 협조를 요청하고 싶은데 어디에 연락하면 되나요',
    expectContains: 'SP-AGY-CENTRALCOOP',
    note: '중앙언론 대상 도정홍보(desc) — SP-AGY-CENTRALCOOP §2, 격식체.',
  },

  // ══════════════════════════════════════════════════════════════
  // 제주환경자원순환센터(SP-AGY-ENVCIRCULATION) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'envcirculation-landfill',
    utterance: '매립시설 반입 절차에 대해서 환경자원순환센터에 문의드리고 싶은데요',
    expectContains: 'SP-AGY-ENVCIRCULATION',
    note: '매립시설(자원순환시설관리과 division kw) — SP-AGY-ENVCIRCULATION §2.',
  },
  {
    id: 'envcirculation-incinerator',
    utterance: '소각시설 운영 관련해서 민원을 넣고 싶습니다',
    expectContains: 'SP-AGY-ENVCIRCULATION',
    note: '소각시설(자원순환시설관리과 division kw) — SP-AGY-ENVCIRCULATION §2, 격식체.',
  },

  // ══════════════════════════════════════════════════════════════
  // 제주안전체험관(SP-AGY-SAFETYEXPERIENCE) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'safetyexperience-program-plan',
    utterance: '학교 단위로 체험교육 프로그램을 기획해서 신청하고 싶은데 어디로 연락하나요',
    expectContains: 'SP-AGY-SAFETYEXPERIENCE',
    note: '체험교육 프로그램 기획(체험기획과 division kw) — SP-AGY-SAFETYEXPERIENCE §2.',
  },
  {
    id: 'safetyexperience-onsite',
    utterance: '안전체험관 현장 체험 진행 일정이 어떻게 되는지 궁금해요',
    expectContains: 'SP-AGY-SAFETYEXPERIENCE',
    note: '체험교육 현장 진행(체험운영과 division kw) — SP-AGY-SAFETYEXPERIENCE §2.',
  },

  // ══════════════════════════════════════════════════════════════
  // 소방서 4개(과 레벨) — 각 1건 이상, 총 4건+
  // ══════════════════════════════════════════════════════════════
  {
    id: 'firejeju-permit',
    utterance: '제주소방서 관할 지역에 소방시설 인허가 신청을 접수하고 싶은데요',
    expectContains: 'SP-AGY-FIREJEJU',
    note: '제주소방서(institution kw) — SP-AGY-FIREJEJU §2, 다른 표현.',
  },
  {
    id: 'fireseogwipo-inspection',
    utterance: '서귀포소방서 쪽에 소방시설 점검을 요청드리려고 하는데 접수 방법이 궁금합니다',
    expectContains: 'SP-AGY-FIRESEOGWIPO',
    note: '서귀포소방서(institution kw) — SP-AGY-FIRESEOGWIPO §2, 격식체.',
  },
  {
    id: 'fireseobu-permit-casual',
    utterance: '한림 쪽인데 서부소방서에 소방시설 인허가 좀 받고 싶은데',
    expectContains: 'SP-AGY-FIRESEOBU',
    note: '서부소방서(institution kw, 반말) — SP-AGY-FIRESEOBU §2.',
  },
  {
    id: 'firedongbu-inspection',
    utterance: '표선 쪽인데 동부소방서 관할로 소방시설 점검 신청드립니다',
    expectContains: 'SP-AGY-FIREDONGBU',
    note: '동부소방서(institution kw) — SP-AGY-FIREDONGBU §2. (★"화재" 단어는 응급 감지 게이트가 최우선 가로채므로 의도적으로 배제.)',
  },

  // ══════════════════════════════════════════════════════════════
  // 감사위원회(SP-COMM-AUDIT) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'comm-audit-plan',
    utterance: '자체감사 계획이 언제 수립되는지 궁금한데 알려주실 수 있나요',
    expectContains: 'SP-COMM-AUDIT',
    note: '자체감사 계획(감사과 division kw) — SP-COMM-AUDIT §2.',
  },
  {
    id: 'comm-audit-integrity-rating',
    utterance: '청렴도 평가 지원 관련 자료를 요청하고 싶습니다',
    expectContains: 'SP-COMM-AUDIT',
    note: '청렴도 평가 지원(부패방지지원센터 division kw) — SP-COMM-AUDIT §2, 격식체.',
  },

  // ══════════════════════════════════════════════════════════════
  // 지방노동위원회(SP-COMM-LABOR) — 2건
  // ══════════════════════════════════════════════════════════════
  {
    id: 'comm-labor-mediation',
    utterance: '노사 간 조정위원회에 조정사건을 접수하고 싶은데 절차가 어떻게 되나요',
    expectContains: 'SP-COMM-LABOR',
    note: '조정위원회/조정사건(institution/division kw) — SP-COMM-LABOR §2.',
  },
  {
    id: 'comm-labor-injury-review',
    utterance: '산재로 재해보상 심사를 받고 싶은데 여기가 맞는 곳인가요',
    expectContains: 'SP-COMM-LABOR',
    note: '재해보상 심사(institution kw) — SP-COMM-LABOR §2.',
  },

  // ══════════════════════════════════════════════════════════════
  // 애매한 경계 케이스(info-only) — pass/fail 강제하지 않고 trace만 관찰.
  // 로버스트니스 확대를 위한 시나리오. expectContains를 null로 두고
  // info: true로 표시한다.
  // ══════════════════════════════════════════════════════════════
  {
    id: 'info-police-comparison',
    utterance: '자치경찰이랑 국가경찰 차이가 뭐예요',
    expectContains: null,
    info: true,
    note: '[관찰용] 비교·설명형 질문 — 특정 SP 확정보다 "차이를 설명해달라"는 개념 질문에 가깝다. 자치경찰단/위원회 어느 쪽으로도 확정되면 안 된다고 강제하기보다, 실제로 어떻게 처리되는지(클래리파이/일반 안내/특정 SP 확정 등) 관찰 목적.',
  },
  {
    id: 'info-firestation-ambiguous',
    utterance: '우리 동네 근처 소방서에 문의하고 싶은데 어디로 연락해야 하나요',
    expectContains: null,
    info: true,
    note: '[관찰용] 지역(어느 소방서 관할인지)이 특정 안 된 소방서 문의 — 4개 소방서(제주/서귀포/서부/동부) 중 어디인지 발화만으로 특정 불가능한 경계 케이스. 위치 되묻기(NeedsLocationSignal)가 뜨는지, 상위 SP-AGY-FIRE(소방안전본부)로 일반화되는지 관찰.',
  },
  {
    id: 'info-veterans-vs-nat',
    utterance: '국가유공자 관련해서 문의할 게 있는데 어디로 가야 하는지 잘 모르겠어요',
    expectContains: null,
    info: true,
    note: '[관찰용] "국가유공자"만 언급하고 구체 사무(등록/보상금/증서/기념관)를 특정하지 않은 매우 일반적인 질문 — SP-NAT-VETERANS(국가보훈부)/SP-AGY-VETERANS(도 보훈청) 어느 쪽이 나오든, 최소한 사용자에게 되묻거나 두 기관 모두 언급하는지 관찰(양쪽 다 실재하는 기관이라 "정답"이 하나로 고정되지 않는 케이스).',
  },
  {
    id: 'info-agencies-vs-collegial-generic',
    utterance: '자치경찰 관련해서 문의하고 싶은데 어디로 연락하면 되나요',
    expectContains: null,
    info: true,
    note: '[관찰용] "자치경찰"만 언급하고 집행조직(단속·신고)인지 위원회(정책 심의)인지 구분되는 사무를 언급하지 않은 매우 일반적인 질문 — 이 경우 어느 쪽으로 가든 "오답"이라 단정하기 어려워 관찰 전용으로 둔다.',
  },
];

async function main() {
  globalThis.window = globalThis;
  globalThis.window.HONDI_PROVINCE_CODE = 'jeju';

  const { assembleGovSystemPrompt, resolveGovAgency } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'src/gopang/gov/gov-router.js'))
  );

  const results = [];
  for (const s of SCENARIOS) {
    console.log(`\n=== ${s.id}: "${s.utterance}" ===`);
    classifyCallCount = 0;
    let r;
    let error = null;
    try {
      r = await assembleGovSystemPrompt(s.utterance, s.locationHint || null, realClassifyFn);
    } catch (e) {
      error = e.message;
    }

    const trace = r?.trace ?? [];
    const agency = r ? resolveGovAgency(trace) : null;
    const routedOk = s.info ? null : trace.some((t) => t.includes(s.expectContains));
    const classifyInvoked = classifyCallCount > 0;

    console.log(`  trace: [${trace.join(' > ')}]`);
    console.log(`  agency: ${agency}`);
    console.log(`  K-Intent(classifyFn) 호출 횟수: ${classifyCallCount}`);
    if (r?.needsClarification) {
      const nc = r.needsClarification;
      if (nc.isLocationQuestion) {
        console.log(`  🔔 위치 되묻기 발동: "${nc.question}"`);
      } else {
        console.log(`  🔔 되묻기 발동: "${nc.question}" 옵션: ${nc.options.map((o) => o.name).join(' / ')}`);
      }
    }
    if (s.info) {
      console.log('  [관찰용(info-only)] pass/fail 강제하지 않음');
    } else {
      console.log(`  체크1(라우팅 도달): ${routedOk ? '✅' : '❌'} (기대: ${s.expectContains})`);
    }

    let spResponseSnippet = null;
    let spQualityNote = null;
    const shouldCheckQuality = s.info ? !!r?.systemPrompt : (routedOk && r?.systemPrompt);
    if (shouldCheckQuality) {
      try {
        const reply = await callDeepSeek(
          [
            { role: 'system', content: r.systemPrompt.slice(0, 12000) },
            { role: 'user', content: s.utterance },
          ],
          { maxTokens: 500 },
        );
        spResponseSnippet = reply.slice(0, 400);
        const bulletCount = (reply.match(/^[-*•]\s|^\d+\.\s/gm) || []).length;
        spQualityNote = bulletCount >= 5
          ? `⚠️ 나열식 응답 의심(불릿/번호 ${bulletCount}개)`
          : '✅ 나열식 아님(불릿/번호 5개 미만)';
        console.log(`  체크3(SP 응답 품질): ${spQualityNote}`);
        console.log(`  응답 일부: ${spResponseSnippet.replace(/\n/g, ' ')}`);
      } catch (e) {
        spQualityNote = `SP 응답 호출 실패: ${e.message}`;
        console.log(`  체크3: ${spQualityNote}`);
      }
    } else if (!s.info && !routedOk) {
      console.log('  체크3: 라우팅 실패로 건너뜀');
    }

    results.push({
      id: s.id,
      utterance: s.utterance,
      note: s.note,
      info: !!s.info,
      trace,
      agency,
      classifyInvoked,
      classifyCallCount,
      needsClarification: r?.needsClarification ?? null,
      routedOk,
      spResponseSnippet,
      spQualityNote,
      error,
    });
  }

  const outDir = path.join(REPO_ROOT, 'results', 'gov_router_2026_09_24_new_agencies_broad_smoketest');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(results, null, 2),
    'utf-8',
  );

  const judged = results.filter((r) => !r.info);
  const passCount = judged.filter((r) => r.routedOk).length;
  console.log(`\n\n총 ${results.length}건(판정 대상 ${judged.length}건 + 관찰용 ${results.length - judged.length}건) 중 라우팅 성공 ${passCount} / 실패 ${judged.length - passCount}`);
  console.log(`결과 저장: results/gov_router_2026_09_24_new_agencies_broad_smoketest/results.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
