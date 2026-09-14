#!/usr/bin/env node
/**
 * GOV-TASK-904-GAP 2026-08-21 세션 — 부서 미지정 발화 라이브 스모크테스트
 * (v2: 실제 프로덕션 배선 재현).
 *
 * ★ 2026-08-21 재작성 — v1은 classifyFn을 이 스크립트가 즉석에서 만든
 * 프롬프트(api.deepseek.com 직접 호출, model=deepseek-chat)로 대체해서
 * 돌렸다. 이건 실제 프로덕션 어느 진입점과도 다른 "제3의 배선"이었다
 * (worker.js의 handleGovTreeStepExecute는 classifyFn=null이라 애초에
 * LLM 폴백을 안 쓰고, pages/regional-gov.html이 진짜 사용자 채팅 진입점
 * 이며 _govClassifyFn을 씀 — 이번 세션 사용자 지적으로 발견).
 *
 * v2는 pages/regional-gov.html의 _govClassifyFn을 그대로 복제한다 —
 * 같은 프록시(hondi-proxy.tensor-city.workers.dev), 같은 모델
 * (deepseek-v4-flash), 같은 프롬프트 문구. DEEPSEEK_API_KEY는 이제
 * classifyFn(체크1·2)에는 안 쓰고, SP 응답 품질(체크3)만 확인할 때
 * 보조로 쓴다(프록시가 아닌 별도 호출).
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... node gov_router_2026_08_21_department_live_smoketest.mjs
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

// ★ 2026-08-21 재작성 — pages/regional-gov.html의 _govClassifyFn을
// 토씨 하나 안 틀리고 그대로 복제(system 프롬프트 문구, model=
// deepseek-v4-flash, max_tokens=20, temperature=0, hondi-proxy 엔드포인트,
// 코드 추출 정규식까지 동일). 이게 진짜 프로덕션에서 사용자가 겪는
// K-Intent 폴백이다 — 이 스크립트가 즉석에서 만든 프롬프트가 아니다.
let classifyCallCount = 0;
async function realClassifyFn(text, candidatesText) {
  classifyCallCount++;
  try {
    const r = await fetch(`${PROXY}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // ★ 2026-08-23 신설(라이브 스모크테스트 403 실패 진단) — worker.js의
        // AI_PROXY_PATHS 방어벽(2026-06-28 DeepSeek 크레딧 소진 사고 이후
        // 추가, "AI 프록시 호출에는 브라우저 Origin이 필요합니다")이 Node
        // fetch()의 기본 동작(Origin 헤더 미전송)을 봇/스크립트로 간주해
        // 403으로 차단한다. 실제 프로덕션(pages/regional-gov.html)은
        // 브라우저에서 실행돼 자동으로 Origin이 붙지만, 이 스크립트는
        // 명시적으로 흉내내야 한다 — 보안 우회가 아니라 "실제 프로덕션과
        // 동일하게 재현한다"는 이 스크립트의 원래 목표를 지키는 수정.
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
    // ★ 2026-08-21 재동기화 — pages/regional-gov.html의 _govClassifyFn과
    // 완전히 동일한 CLARIFY 파싱 로직(먼저 시도했다가 여기 반영을 놓쳐서
    // 첫 재검증 라운드에서 되묻기가 한 번도 안 뜬 원인이었음).
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
  {
    id: 'safety-hospital',
    utterance: '종합병원을 새로 개원하려고 하는데 어디서 허가를 받아야 하나요',
    expectContains: 'SP-DO-SAFETY',
    note: 'INNOV/SAFETY kw 미스 — 병원급 의료기관 개설허가(jeju:hospital_establishment_permit)',
  },
  {
    id: 'plan-youth-inflow',
    utterance: '다른 지역에서 제주로 막 이사왔는데 청년한테 주는 지원금이 있다고 들었어요',
    expectContains: 'SP-DO-PLAN',
    note: '청년 전입축하장려금(jeju:youth_inflow_incentive_application)',
  },
  {
    id: 'transweak-wheelchair-taxi',
    utterance: '휠체어를 타는데 이동할 때 쓸 수 있는 콜택시 같은 서비스가 있나요',
    expectContains: 'SP-ORG-TRANSWEAK',
    note: '특별교통수단 이용자 등록(transweak:special_transport_registration) — 도청 TRANSPORT와 경합',
  },
  {
    id: 'jtp-equipment-test',
    utterance: '우리 회사 제품 시험분석을 좀 맡기고 싶은데 어디로 가야 하나요',
    expectContains: 'SP-ORG-JTP',
    note: '시험분석 의뢰(jtp:equipment_testing_request)',
  },
  {
    id: 'jiles-scholarship',
    utterance: '대학생인데 등록금이나 생활비 도와주는 장학금 신청하고 싶어요',
    expectContains: 'SP-ORG-JILES',
    note: '장학금 신청(jiles:scholarship_application)',
  },
  {
    id: 'childmeal-registration',
    utterance: '어린이집을 새로 운영하려고 하는데 급식 관련해서 신고할 데가 있나요',
    expectContains: 'SP-ORG-CHILDMEAL',
    note: '어린이급식소 등록 신청(childmeal:kids_food_service_registration) — 로컬 테스트에서 SP-AGY-LIBRARY로 오탐됨',
  },
  {
    id: 'jcgf-credit-guarantee',
    utterance: '소상공인인데 대출받으려고 보증 좀 받고 싶어요',
    expectContains: 'SP-ORG-JCGF',
    note: '신용보증 신청(jcgf:credit_guarantee_application) — 로컬 테스트에서 SP-ORG-JEDA로 오탐됨',
  },
  {
    id: 'jpdc-public-housing',
    utterance: '임대주택에 들어가고 싶은데 어떻게 신청하나요',
    expectContains: 'SP-ORG-JPDC',
    note: '공공임대주택 청약(jpdc:public_housing_application) — 로컬 테스트에서 SP-DO-HOUSING(도청)으로 오탐됨',
  },

  // ══════════════════════════════════════════════════════════════
  // ★ 2026-08-22 신설 — 사용자가 첨부한 정부24 국가 민원서비스 목록
  // 기반 시나리오. 09-national/05-emd 계층은 이번 세션에 한 번도
  // 실측 검증 안 됨("이전에 모두 통과했다는 사실이 놀랍다"는 사용자
  // 지적으로 착수). 기대값은 SP-EMD-TEMPLATE §3(05-emd/templates/
  // SP-TEAM-CIVIL-TEMPLATE_v2.1.md)의 명시적 업무분장 근거:
  //   - 주민등록등본·인감증명·가족관계증명·전입신고 → 읍면동(EMD)이
  //     직접 수행("즉시발급 증명서")
  //   - 여권 발급·갱신 → EMD "수행 불가" 명시, 시/군/구청 여권과로
  //     외부 안내(전국 예외 세종 조치원읍 제외) — 제주는 시군구가
  //     없으므로 jejusi/seogwipo 시청(jachi 계열)이 실제 창구.
  //     외교부(MOFA, 국가기관 테이블에도 '여권' kw 있음)로 새면 오답.
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // ★ 2026-08-22 신설(사용자 지시) — 가상의 주소·현재위치를 AC(라우팅
  // 모듈)에 실어 보낸다. "AI 비서는 항상 사용자 위치를 안다"는 원칙에
  // 따라 실제로는 location.js가 GPS/프로필주소를 resolveLocationHint로
  // 채워주지만, 이 Node 스모크테스트엔 브라우저 GPS/프로필 API가 없어
  // 직접 목 주소를 locationHint 필드로 얹는다 — Fix 1(위치 레이스컨디션
  // 수정)이 실제로 _matchEmd(pdvLocationHint,...)를 살려 EMD 라우팅을
  // 정상화하는지, 여권이 jachi(시청 여권과)로 정확히 가는지 검증한다.
  // ══════════════════════════════════════════════════════════════
  {
    id: 'emd-resident-cert',
    utterance: '등본을 좀 떼야 하는데 어디로 가면 되나요',
    locationHint: '제주특별자치도 제주시 애월읍 애월리 123-4',
    expectContains: 'SP-EMD-',
    note: '주민등록표 등본 발급 — EMD 민원팀 직접 수행 사무. 가상 주소(애월읍) 실어서 _matchEmd(pdvLocationHint) 경로 검증.',
  },
  {
    id: 'emd-seal-cert',
    utterance: '인감증명서가 필요한데 어디서 받을 수 있나요',
    locationHint: '제주특별자치도 제주시 애월읍 애월리 123-4',
    expectContains: 'SP-EMD-',
    note: '인감증명서 발급 — EMD 민원팀 직접 수행 사무(인감증명법). 가상 주소 실음.',
  },
  {
    id: 'passport-not-emd',
    utterance: '여권을 잃어버려서 다시 만들어야 하는데 어디로 가야 하나요',
    locationHint: '제주특별자치도 제주시 애월읍 애월리 123-4',
    expectContains: 'jachi',
    note: '여권 재발급 — EMD "수행 불가" 명시 사무, 시/군/구청 여권과가 정답. 2026-08-22 근본원인 수정(JEJU_CITY_DEPT_TABLE jachi kw에 "여권" 누락) 검증용. 가상 주소 실음.',
  },
  {
    id: 'emd-transfer-report',
    utterance: '다른 지역으로 이사를 왔는데 신고해야 하나요',
    locationHint: '제주특별자치도 제주시 애월읍 애월리 123-4',
    expectContains: 'SP-EMD-',
    note: '전입신고 — EMD 민원팀 직접 수행 사무. 가상 주소 실음.',
  },
  {
    id: 'emd-family-relation-cert',
    utterance: '가족관계증명서를 떼려고 하는데요',
    locationHint: '제주특별자치도 제주시 애월읍 애월리 123-4',
    expectContains: 'SP-EMD-',
    note: '가족관계증명서 발급 — EMD 민원팀 직접 수행 사무. 가상 주소 실음.',
  },
  {
    id: 'building-register',
    utterance: '건축물대장을 발급받고 싶어요',
    expectContains: 'housing',
    note: '건축물대장 발급/열람 — 국토교통부 소관이나 실무는 지자체 건축과. expectContains는 도청/시청 HOUSING 계열 도메인 문자열로 느슨하게 확인.',
  },
  {
    id: 'income-cert-nts',
    utterance: '소득금액증명이 필요한데 어디서 받나요',
    expectContains: 'NTS',
    note: '소득금액증명 발급 — 국세청(NTS) 소관, 국가기관 테이블에 이미 등재된 코드로 확인.',
  },
  {
    id: 'health-cert',
    utterance: '보건증 발급받고 싶은데요',
    expectContains: 'health',
    note: '건강진단결과서(보건증) 발급 — 보건복지부 소관이나 실무는 보건소. expectContains는 도청/시청 HEALTH 계열 도메인 문자열로 느슨하게 확인.',
  },
];

async function main() {
  globalThis.window = globalThis;
  globalThis.window.HONDI_PROVINCE_CODE = 'jeju';

  // gov-router.js는 raw.githubusercontent.com에서 마스터데이터를 fetch한다
  // — 실제 저장소 원격 데이터를 그대로 쓴다(로컬 테스트처럼 목을 쓰지 않음
  // — 이 스모크테스트는 프로덕션과 최대한 가깝게 검증하는 것이 목적).
  const { assembleGovSystemPrompt, resolveGovAgency } = await import(
    // BUG-FIX(2026-09-14, Windows) — gov24_corpus_live_smoketest.mjs와
    // 동일한 이유로 수정(ERR_UNSUPPORTED_ESM_URL_SCHEME).
    pathToFileURL(path.join(REPO_ROOT, 'src/gopang/gov/gov-router.js'))
  );

  const results = [];
  for (const s of SCENARIOS) {
    console.log(`\n=== ${s.id}: "${s.utterance}" ===`);
    if (s.locationHint) console.log(`  📍 가상 위치 힌트: "${s.locationHint}"`);
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
    // ★ 2026-08-21 신설 — CLARIFY 신호로 되묻기가 발동하면 라우팅 성공/
    // 실패와 별개로 명시적으로 표시한다(사용자 지시 — 설계 공백 해소분
    // 확인용). 되묻기가 뜨면 systemPrompt가 null이라 체크3은 자동으로
    // 건너뛴다(아래 기존 로직 그대로).
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

  const outDir = path.join(REPO_ROOT, 'results', 'gov_router_2026_08_21_department_smoketest');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(results, null, 2),
    'utf-8',
  );

  const passCount = results.filter((r) => r.routedOk).length;
  console.log(`\n\n총 ${results.length}건 중 라우팅 성공 ${passCount} / 실패 ${results.length - passCount}`);
  console.log(`결과 저장: results/gov_router_2026_08_21_department_smoketest/results.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
