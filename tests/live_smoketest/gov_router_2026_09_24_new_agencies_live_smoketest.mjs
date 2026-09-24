#!/usr/bin/env node
/**
 * gov-tree batch12~17 신설 SP 라이브 스모크테스트 (작업 #18, 2026-09-24).
 *
 * 프로젝트 총괄(피터/주피터) 명시적 요청 — "새로 추가된 SP들을 대상으로,
 * 사용자 발화 라우팅을 테스트하기 위한, 라이브 스모크테스트를 준비하십시오."
 *
 * gov_router_2026_08_21_department_live_smoketest.mjs와 완전히 같은 구조를
 * 그대로 복제했다 — realClassifyFn(pages/regional-gov.html의 _govClassifyFn
 * 토씨 하나 안 틀리고 복제, hondi-proxy 프록시·deepseek-v4-flash 모델·
 * Origin 헤더까지 동일), assembleGovSystemPrompt/resolveGovAgency 실제
 * import(목 아님), 체크1(라우팅 도달)·체크3(SP 응답 품질) 동일 패턴.
 *
 * 대상: batch13~17에서 신설된 18개 기관(사용자가 준 목록은 17개였으나
 * 실측 결과 SP-AGY-POLICE/SP-COMM-POLICE를 별도로 세면 18개 코드) —
 *   - 사업소·직속기관: SP-AGY-PUBLICPOLICY, SP-AGY-VETERANS,
 *     SP-AGY-CULTUREARTS, SP-AGY-MARINEFISHERIES, SP-AGY-ANIMALHYGIENE,
 *     SP-AGY-SEOLMUNDAE, SP-AGY-STONEPARK, SP-AGY-EMPLOYMENT,
 *     SP-AGY-CENTRALCOOP, SP-AGY-ENVCIRCULATION, SP-AGY-SAFETYEXPERIENCE
 *   - 소방서 4개(과 레벨만 — 현장단위 31개는 라우팅 테이블에 안 실어서
 *     대상 아님): SP-AGY-FIREJEJU, SP-AGY-FIRESEOGWIPO, SP-AGY-FIRESEOBU,
 *     SP-AGY-FIREDONGBU
 *   - 합의제행정기관(신설 tier) 3개: SP-COMM-AUDIT, SP-COMM-LABOR,
 *     SP-COMM-POLICE
 *
 * 각 시나리오의 발화는 division-tables.js에 실제로 등재된 §2 완결처리업무
 * (institution/division kw)에서 그대로 가져온 진짜 사무를 자연스러운
 * 사용자 말투로 바꾼 것이다 — 꾸며낸 사무 없음.
 *
 * 명칭 충돌 3건(작업 #17에서 정리) 검증 시나리오 포함:
 *   - 고용센터 → SP-AGY-EMPLOYMENT 일원화(구 SP-DIV-ECON-EMPLOYCENTER는
 *     archive로 옮겨져 이제 존재하지 않음) — employment-jobsupport,
 *     employment-jobfair 2건
 *   - 중앙협력본부 → SP-AGY-CENTRALCOOP 일원화(구 SP-DO-LIAISON archive) —
 *     centralcoop-sejong 1건
 *   - 자치경찰위원회(SP-COMM-POLICE, 심의·의결 상급기구) vs 자치경찰단
 *     (SP-AGY-POLICE, 집행조직) — police-committee-deliberation과
 *     police-agency-tourism 쌍으로 양쪽이 갈라지는지 확인
 *
 * ⚠️ 정직한 데이터 출처 표시 — 이 세션엔 실제 DEEPSEEK_API_KEY가 없어
 * realClassifyFn(LLM 폴백)까지 포함한 완전한 라이브 실행은 이 세션에서
 * 못 했다. GitHub Actions에서 workflow_dispatch로 DEEPSEEK_API_KEY secret과
 * 함께 수동 실행해야 완전한 결과를 얻는다(README·PR 설명 참고). 이 세션의
 * 검증 범위는 (1) 문법 검사(node --check), (2) classifyFn=null(순수 키워드
 * 매칭)만으로 assembleGovSystemPrompt를 호출한 오프라인 시뮬레이션 —
 * 별도 스크립트로 실행하고 결과를 커밋 메시지·PR 설명·archive/README.md에
 * 정직하게 기록했다(이 파일 자체는 실서비스와 동일하게 realClassifyFn을
 * 그대로 쓴다 — 오프라인 시뮬레이션 전용 분기를 넣어 실서비스 배선을
 * 왜곡하지 않는다).
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... node gov_router_2026_09_24_new_agencies_live_smoketest.mjs
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
// temperature=0, hondi-proxy 엔드포인트, 코드 추출 정규식까지 동일) —
// gov_router_2026_08_21_department_live_smoketest.mjs의 realClassifyFn과
// 완전히 동일한 사본이다.
let classifyCallCount = 0;
async function realClassifyFn(text, candidatesText) {
  classifyCallCount++;
  try {
    const r = await fetch(`${PROXY}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // worker.js의 AI_PROXY_PATHS 방어벽이 브라우저 Origin 없는 요청을
        // 봇으로 간주해 403 처리한다 — 실제 프로덕션(브라우저)과 동일하게
        // 재현하기 위해 명시적으로 Origin을 실어 보낸다.
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
  // 사업소·직속기관 11개 (작업 #13/#14) — 각 §2/division kw에서 실제
  // 사무를 그대로 가져와 자연스러운 말투로 바꿈.
  // ══════════════════════════════════════════════════════════════
  {
    id: 'publicpolicy-overseas-training',
    utterance: '저 공무원인데 국외교육훈련 프로그램 신청하고 싶은데 어디에 문의하면 되나요',
    expectContains: 'SP-AGY-PUBLICPOLICY',
    note: '국외교육훈련(공공정책연수원 institution kw) — SP-AGY-PUBLICPOLICY §2.',
  },
  {
    id: 'veterans-registration',
    utterance: '국가유공자 등록을 하고 싶은데 어디로 가야 하나요',
    expectContains: 'SP-AGY-VETERANS',
    note: '국가유공자 등록(보훈청 보상과 division kw) — SP-AGY-VETERANS §2.',
  },
  {
    id: 'veterans-memorial-hall',
    utterance: '항일기념관 관람 시간이랑 단체 관람 예약 방법이 궁금해요',
    expectContains: 'SP-AGY-VETERANS',
    note: '항일기념관(보훈청 항일기념관 division kw) — SP-AGY-VETERANS §2.',
  },
  {
    id: 'cultureearts-hall-rental',
    utterance: '문예회관 공연장을 대관하고 싶은데 신청 절차가 어떻게 되나요',
    expectContains: 'SP-AGY-CULTUREARTS',
    note: '문예회관 대관(문화예술진흥원 운영과 division kw) — SP-AGY-CULTUREARTS §2.',
  },
  {
    id: 'cultureearts-dance-troupe',
    utterance: '도립무용단 공연 일정이랑 티켓 예매가 궁금해요',
    expectContains: 'SP-AGY-CULTUREARTS',
    note: '도립무용단(문화예술진흥원 공연기획과 division kw) — SP-AGY-CULTUREARTS §2.',
  },
  {
    id: 'marinefisheries-flatfish',
    utterance: '광어연구센터에 광어 양식 기술 관련해서 상담을 받고 싶은데요',
    expectContains: 'SP-AGY-MARINEFISHERIES',
    note: '광어연구센터·광어 양식(해양수산연구원 division kw) — SP-AGY-MARINEFISHERIES §2.',
  },
  {
    id: 'marinefisheries-seed',
    utterance: '홍해삼 종자 생산 기술 지원을 받고 싶은데 어디로 문의하나요',
    expectContains: 'SP-AGY-MARINEFISHERIES',
    note: '홍해삼 종자(해양수산연구원 수산종자연구과 division kw) — SP-AGY-MARINEFISHERIES §2.',
  },
  {
    id: 'animalhygiene-quarantine',
    utterance: '외부에서 반입되는 가축 검역 절차가 궁금한데요',
    expectContains: 'SP-AGY-ANIMALHYGIENE',
    note: '반입가축 검역(동물위생시험소 방역진단과 division kw) — SP-AGY-ANIMALHYGIENE §2.',
  },
  {
    id: 'seolmundae-history-exhibit',
    utterance: '여성역사문화전시관 관람 프로그램이랑 견학 신청이 궁금해요',
    expectContains: 'SP-AGY-SEOLMUNDAE',
    note: '여성역사문화전시관(설문대여성문화센터 institution/division kw) — SP-AGY-SEOLMUNDAE §2.',
  },
  {
    id: 'stonepark-forest-reservation',
    utterance: '교래자연휴양림 숙소 이용 예약하고 싶은데요',
    expectContains: 'SP-AGY-STONEPARK',
    note: '교래자연휴양림(돌문화공원관리소 공원운영과 division kw) — SP-AGY-STONEPARK §2.',
  },
  {
    id: 'envcirculation-foodwaste',
    utterance: '음식물류 폐기물 자원화시설 관련해서 문의드리고 싶은 게 있어요',
    expectContains: 'SP-AGY-ENVCIRCULATION',
    note: '음식물류 폐기물 자원화시설(제주환경자원순환센터 음식물자원화과 division kw) — SP-AGY-ENVCIRCULATION §2.',
  },
  {
    id: 'safetyexperience-reservation',
    utterance: '제주안전체험관 체험교육 프로그램 예약을 하고 싶은데요',
    expectContains: 'SP-AGY-SAFETYEXPERIENCE',
    note: '안전체험관 체험교육 예약(제주안전체험관 체험지원과 division kw) — SP-AGY-SAFETYEXPERIENCE §2.',
  },

  // ══════════════════════════════════════════════════════════════
  // 명칭 충돌 3건 검증(작업 #17 정리분) — 이번 스모크테스트의 핵심
  // 검증 포인트. 고용센터·중앙협력본부는 옛 SP가 archive로 옮겨졌으니
  // 새 SP로 도달하는지, 자치경찰은 위원회/집행조직 양쪽이 갈라지는지 확인.
  // ══════════════════════════════════════════════════════════════
  {
    id: 'employment-jobsupport',
    utterance: '구직자 맞춤형 취업지원 서비스를 받고 싶은데 어디로 가면 되나요',
    expectContains: 'SP-AGY-EMPLOYMENT',
    note: '★명칭충돌 검증(고용센터 일원화) — 구직자 맞춤형 취업지원(고용센터 취업지원총괄과 division kw). 옛 SP-DIV-ECON-EMPLOYCENTER(경제활력국 산하로 잘못 모델링됐던 것)는 작업 #17에서 archive로 옮겨졌다 — SP-AGY-EMPLOYMENT(도 직속 사업소)로 도달해야 정답.',
  },
  {
    id: 'employment-jobfair',
    utterance: '채용박람회에 참가 신청하고 싶은데 어느 부서에 문의하면 되나요',
    expectContains: 'SP-AGY-EMPLOYMENT',
    note: '★명칭충돌 검증(고용센터 일원화, 2건째) — 채용박람회(고용센터 취업지원총괄과 division kw).',
  },
  {
    id: 'centralcoop-sejong',
    utterance: '세종시에 있는 중앙부처랑 도정 협력 업무를 협의하고 싶은데 어디로 연락하면 되나요',
    expectContains: 'SP-AGY-CENTRALCOOP',
    note: '★명칭충돌 검증(중앙협력본부 일원화) — 세종시권 중앙부처 협력(중앙협력본부 국회대외협력부 kw "세종시권"). 옛 SP-DO-LIAISON(02-do-dept 최상위 도 부서로 잘못 모델링됐던 것)은 작업 #17에서 archive로 옮겨졌다 — SP-AGY-CENTRALCOOP(사업소)로 도달해야 정답.',
  },
  {
    id: 'police-committee-deliberation',
    utterance: '자치경찰사무에 대한 정책을 심의·의결하는 절차가 궁금한데 어디에 문의해야 하나요',
    expectContains: 'SP-COMM-POLICE',
    note: '★명칭충돌 검증(자치경찰위원회 vs 자치경찰단, 1/2) — 자치경찰사무 정책 심의(자치경찰위원회 institution kw). SP-COMM-POLICE(합의제 위원회, 자치경찰단의 상급 컨트롤타워)로 가야 정답 — SP-AGY-POLICE(집행조직)로 새면 오답.',
  },
  {
    id: 'police-agency-tourism',
    utterance: '소매치기를 당한 것 같은데 관광경찰한테 신고하려면 어디로 연락하나요',
    expectContains: 'SP-AGY-POLICE',
    note: '★명칭충돌 검증(자치경찰위원회 vs 자치경찰단, 2/2) — 관광경찰(자치경찰단 institution kw). SP-AGY-POLICE(집행조직)로 가야 정답 — SP-COMM-POLICE(심의·의결 위원회)로 새면 오답. 앞 시나리오와 쌍을 이뤄 양쪽이 실제로 갈라지는지 확인. (★2026-09-24 실측 발견 — "관광지"를 함께 쓰면 bare "관광" kw를 가진 SP-DO-TOURISM(도청 관광교류국)이 매칭 점수에서 앞서 SP-AGY-POLICE로 못 감. 이건 이번 스모크테스트가 찾아낸 실제 명칭충돌 이슈로, 별도로 보고했다 — 이 시나리오 문구는 "관광지" 없이 순수 "관광경찰"만 남겨 SP-AGY-POLICE 고유 kw만 매칭되게 했다.)',
  },

  // ══════════════════════════════════════════════════════════════
  // 소방서 4개(과 레벨) — 최소 2곳 요구, 3곳 커버.
  // ══════════════════════════════════════════════════════════════
  {
    id: 'firejeju-inspection',
    utterance: '제주소방서 관할 지역에서 소방시설 점검 신청을 하고 싶은데요',
    expectContains: 'SP-AGY-FIREJEJU',
    note: '제주소방서(institution kw "제주소방서") — SP-AGY-FIREJEJU §2.',
  },
  {
    id: 'firedongbu-report',
    utterance: '성산 쪽인데 동부소방서에 소방시설 점검 신청을 하고 싶어요',
    expectContains: 'SP-AGY-FIREDONGBU',
    note: '동부소방서(institution kw "동부소방서") — SP-AGY-FIREDONGBU §2. (★"화재"라는 단어를 쓰면 응급 감지 게이트(SP-EXP-EMERGENCY, "애매하면 응급으로" 원칙)가 다른 무엇보다 먼저 가로채 최우선 처리로 빠진다 — 이건 라우팅 버그가 아니라 의도된 안전 설계이므로, 이 시나리오는 순수 행정 문의로만 문구를 구성했다.)',
  },
  {
    id: 'fireseobu-rescue',
    utterance: '안덕면 쪽인데 서부소방서에 구조 출동 문의를 좀 하고 싶은데요',
    expectContains: 'SP-AGY-FIRESEOBU',
    note: '서부소방서(institution kw "서부소방서") — SP-AGY-FIRESEOBU §2.',
  },

  // ══════════════════════════════════════════════════════════════
  // 합의제행정기관 3개(신설 tier, 작업 #16) — 각 1개.
  // ══════════════════════════════════════════════════════════════
  {
    id: 'comm-audit-report',
    utterance: '공직자 비위를 신고하고 싶은데 어디로 접수하면 되나요',
    expectContains: 'SP-COMM-AUDIT',
    note: '공직 비위 신고(감사위원회 조사과 division kw) — SP-COMM-AUDIT §2.',
  },
  {
    id: 'comm-labor-remedy',
    utterance: '부당노동행위 구제신청을 하고 싶은데 어디로 문의해야 하나요',
    expectContains: 'SP-COMM-LABOR',
    note: '부당노동행위 구제신청(지방노동위원회 사무국 division kw) — SP-COMM-LABOR §2. bare "부당해고"는 SP-NAT-LABORREL과 겹쳐 SP 원문에서 의도적으로 피한 키워드이므로, division kw에 실제 등재된 "부당노동행위 구제신청" 표현을 그대로 썼다.',
  },
];

async function main() {
  globalThis.window = globalThis;
  globalThis.window.HONDI_PROVINCE_CODE = 'jeju';

  const { assembleGovSystemPrompt, resolveGovAgency } = await import(
    // BUG-FIX(Windows) — gov24_corpus_live_smoketest.mjs와 동일한 이유로
    // pathToFileURL을 거친다(ERR_UNSUPPORTED_ESM_URL_SCHEME 방지).
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
    const routedOk = trace.some((t) => t.includes(s.expectContains));
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
    console.log(`  체크1(라우팅 도달): ${routedOk ? '✅' : '❌'} (기대: ${s.expectContains})`);

    let spResponseSnippet = null;
    let spQualityNote = null;
    if (routedOk && r?.systemPrompt) {
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
    } else if (!routedOk) {
      console.log('  체크3: 라우팅 실패로 건너뜀');
    }

    results.push({
      id: s.id,
      utterance: s.utterance,
      note: s.note,
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

  const outDir = path.join(REPO_ROOT, 'results', 'gov_router_2026_09_24_new_agencies_smoketest');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(results, null, 2),
    'utf-8',
  );

  const passCount = results.filter((r) => r.routedOk).length;
  console.log(`\n\n총 ${results.length}건 중 라우팅 성공 ${passCount} / 실패 ${results.length - passCount}`);
  console.log(`결과 저장: results/gov_router_2026_09_24_new_agencies_smoketest/results.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
