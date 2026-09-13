#!/usr/bin/env node
/**
 * tests/live_smoketest/hondi_guide_50_live_test.mjs
 * ------------------------------------------------------------------
 * pages/expert-chat.html의 composeExpertPrompt()를 그대로 재현해
 * hondi-guide의 실제 프로덕션 시스템 프롬프트를 조립한 뒤(UNIVERSAL-
 * INTEGRITY → UNIVERSAL-common → PROFESSIONAL-common → SP_common_
 * guardrails → SP_EXPERT_BASE → SP_hondi-guide, '\n\n---\n\n' 결합),
 * 실제 라이브 엔드포인트(hondi-proxy.tensor-city.workers.dev/deepseek,
 * "혼디 제공 무료 기본 키" 폴백 — 인증 불필요)에 50개 질의를 그대로
 * 던진다.
 *
 * 2026-09-13 세션에서 발견·수정한 두 가지(§1-2 사용자 매뉴얼 단절,
 * §1-3 GDC/인증/PDV 매뉴얼 단절, 63→552 페르소나 수 하드코딩 사고)가
 * 실제 라이브 응답에 반영됐는지 확인하는 게 목적이다.
 *
 * Usage:
 *   node tests/live_smoketest/hondi_guide_50_live_test.mjs
 *   node tests/live_smoketest/hondi_guide_50_live_test.mjs --sample 10   # 비용 절감용 표본
 */

const RAW_BASE = "https://raw.githubusercontent.com/Openhash-Gopang/hondi/main/prompts/";
const RELAY_ENDPOINT = "https://hondi-proxy.tensor-city.workers.dev";

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

async function composeHondiGuidePrompt() {
  const catalog = JSON.parse(await fetchText(RAW_BASE + "sp-catalog.json"));
  const keys = [
    "UNIVERSAL-INTEGRITY",
    "UNIVERSAL-common",
    "PROFESSIONAL-common",
    "SP_common_guardrails",
    "SP_EXPERT_BASE",
    "SP_hondi-guide",
  ];
  const parts = [];
  for (const k of keys) {
    const fname = catalog[k];
    if (!fname) throw new Error(`manifest 키 없음: ${k}`);
    const text = await fetchText(RAW_BASE + fname);
    parts.push(text);
    console.error(`[구성] ${k} -> ${fname} (${text.length}자)`);
  }
  return parts.join("\n\n---\n\n");
}

async function askHondiGuide(systemPrompt, question) {
  const body = {
    model: "hondi-flash",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
    max_tokens: 1200,
    temperature: 0.4,
    stream: true,
    guid: null,
  };
  const res = await fetch(`${RELAY_ENDPOINT}/deepseek`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  // SSE 스트림 파싱 (data: {...}\n\n 형식, OpenAI 호환 delta 청크)
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || "";
        full += delta;
      } catch {
        // 파싱 실패한 조각은 무시(청크 경계 문제 등)
      }
    }
  }
  return full;
}

// ── 50개 질의 (§1-2/§1-3/회귀/경계 케이스) ────────────────────────
const CASES = [
  // §1-3 GDC/인증/PDV 정본 매뉴얼 (15)
  { id: "g01", q: "GDC는 어떻게 충전하나요?", expectAny: ["결제", "카드", "계좌", "충전"] },
  { id: "g02", q: "GDC 자동충전 기능이 있나요?", expectAny: ["자동충전", "자동 충전"] },
  { id: "g03", q: "GDC를 실제 화폐로 환전할 수 있나요?", expectAny: ["환전", "화폐", "GDC_WHITEPAPER", "발행"] },
  { id: "g04", q: "개발자용 GDC 과금 요금 체계가 어떻게 되나요?", expectAny: ["과금", "요금", "개발자"] },
  { id: "g05", q: "회원가입할 때 전화번호 인증은 어떻게 하나요?", expectAny: ["인증", "전화번호", "문자"] },
  { id: "g06", q: "생체인증이 왜 필수인가요?", expectAny: ["생체인증", "지문", "얼굴"] },
  { id: "g07", q: "새 기기로 로그인하려면 어떻게 하나요?", expectAny: ["기기", "연결", "로그인"] },
  { id: "g08", q: "기기 연결 승인은 얼마나 걸리나요?", expectAny: ["기기", "연결", "승인"] },
  { id: "g09", q: "제 PDV 데이터는 누가 접근할 수 있나요?", expectAny: ["PDV", "접근", "권한", "소유"] },
  { id: "g10", q: "PDV 소유권이 저한테 있나요, 혼디한테 있나요?", expectAny: ["PDV", "소유"] },
  { id: "g11", q: "K-서비스들의 인증 체계가 예전이랑 지금이랑 달라졌나요?", expectAny: ["인증", "이관", "마이그레이션"] },
  { id: "g12", q: "GDC 지갑 충전 최소 금액이 있나요?", expectAny: ["GDC", "충전", "금액"] },
  { id: "g13", q: "인증번호 유효시간이 몇 분인가요?", expectAny: ["인증번호", "분", "유효"] },
  { id: "g14", q: "GDC 발행량에 제한이 있나요?", expectAny: ["GDC", "발행"] },
  { id: "g15", q: "PDV 거버넌스가 정확히 무슨 뜻인가요?", expectAny: ["PDV", "거버넌스"] },

  // §1-2 사용자용 튜토리얼 매뉴얼 (10)
  { id: "t01", q: "혼디를 처음 쓰는데 전체적으로 어떻게 활용하면 되나요?", expectAny: ["활용", "가이드", "매뉴얼"] },
  { id: "t02", q: "혼디 사용자 가이드 문서가 있나요?", expectAny: ["가이드", "user-guide"] },
  { id: "t03", q: "게임하듯 배우면서 GDC도 받을 수 있는 학습 콘텐츠가 있나요?", expectAny: ["인터랙티브", "퀴즈", "GDC", "챕터"] },
  { id: "t04", q: "초등학생 대상 혼디 교육 프로그램이 있나요?", expectAny: ["어린이", "교실"] },
  { id: "t05", q: "중학생용 혼디 워크숍도 있나요?", expectAny: ["중학생", "워크숍"] },
  { id: "t06", q: "고등학생 대상 진로설계 워크숍 내용이 뭔가요?", expectAny: ["고등학생", "진로"] },
  { id: "t07", q: "대학생 대상 혼디 실전 워크숍이 있나요?", expectAny: ["대학생", "워크숍"] },
  { id: "t08", q: "혼디를 체계적으로 배우고 싶은데 추천할 자료 있나요?", expectAny: ["매뉴얼", "가이드", "인터랙티브"] },
  { id: "t09", q: "혼디 활용의 한계는 어디까지인가요?", expectAny: ["한계", "활용"] },
  { id: "t10", q: "일상생활에서 혼디를 어디까지 쓸 수 있나요?", expectAny: ["일상", "업무", "활용"] },

  // 63→552 회귀 확인 (5)
  { id: "r01", q: "전문가 페르소나가 몇 명이에요?", expectAny: ["552"], expectNot: ["63명", "63개"] },
  { id: "r02", q: "K-서비스가 총 몇 개예요?", expectAny: ["28", "33"], expectNot: ["20개"] },
  { id: "r03", q: "전문가 페르소나 종류가 어떻게 되나요?", expectAny: ["552", "변호사", "의사"] },
  { id: "r04", q: "개발자용으로 K-서비스 전체(오케스트레이션 내부 포함) 몇 개인가요?", expectAny: ["33"] },
  { id: "r05", q: "사용자가 실제로 쓸 수 있는 K-서비스는 몇 개인가요?", expectAny: ["28"] },

  // profile-assistant와의 경계 (5)
  { id: "b01", q: "이 화면 어떻게 써요?", expectRoute: "profile-assistant 소관 — hondi-guide가 직접 튜토리얼처럼 답하면 오답" },
  { id: "b02", q: "내 프로필 채워줘", expectRoute: "profile-assistant 소관" },
  { id: "b03", q: "혼디가 뭐예요?", expectAny: ["혼디", "플랫폼", "서비스"] },
  { id: "b04", q: "K-Plan이 뭘 해줘요?", expectAny: ["K-Plan", "일정"] },
  { id: "b05", q: "혼디야, 안녕", expectRoute: "AC 자신의 인사 처리 — hondi-guide 위임 대상 아님" },

  // kgdc(실행)와의 경계 (5)
  { id: "e01", q: "GDC가 뭐예요?", expectAny: ["GDC"] },
  { id: "e02", q: "GDC 충전 방법 알려줘", expectAny: ["충전", "결제"] },
  { id: "e03", q: "GDC 500개 충전해줘", expectRoute: "실제 충전 실행 요청 — [GWP: kgdc]로 빠져야 하며 hondi-guide 개념 설명이 나오면 오탐" },
  { id: "e04", q: "GDC 충전 실행해줘", expectRoute: "kgdc 실행 요청" },
  { id: "e05", q: "GDC 개념 좀 설명해줘", expectAny: ["GDC"] },

  // 일반 정체성/철학 질문 (10)
  { id: "i01", q: "DAWN 철학이 뭔가요?", expectAny: ["DAWN"] },
  { id: "i02", q: "혼디는 누가 만들었나요?", expectAny: ["도영민", "개발"] },
  { id: "i03", q: "혼디는 특정 회사 소유인가요?", expectAny: ["오픈소스", "소유"] },
  { id: "i04", q: "혼디 이용 요금이 어떻게 되나요?", expectAny: ["요금", "GDC"] },
  { id: "i05", q: "혼디는 완성이 얼마나 됐나요?", expectAny: ["완성", "%", "배너"] },
  { id: "i06", q: "혼디 로드맵이 궁금해요", expectAny: ["로드맵"] },
  { id: "i07", q: "혼디 버그를 발견했는데 어디에 신고하나요?", expectAny: ["feedback", "제안", "신고"] },
  { id: "i08", q: "혼디 기능 개선 제안을 하고 싶어요", expectAny: ["제안", "feedback"] },
  { id: "i09", q: "혼디 개발에 저도 참여할 수 있나요?", expectAny: ["개발", "참여", "오픈소스"] },
  { id: "i10", q: "Openhash가 뭔가요?", expectAny: ["Openhash", "원장"] },
];

function grade(question, answer) {
  const notes = [];
  let pass = true;
  if (question.expectAny) {
    const hit = question.expectAny.some((kw) => answer.includes(kw));
    if (!hit) { pass = false; notes.push(`기대 키워드(${question.expectAny.join("/")}) 없음`); }
  }
  if (question.expectNot) {
    const hit = question.expectNot.some((kw) => answer.includes(kw));
    if (hit) { pass = false; notes.push(`금지 키워드(${question.expectNot.join("/")}) 등장`); }
  }
  if (question.expectRoute) {
    pass = null; // 자동 채점 불가 — 사람이 라우팅 여부를 직접 확인
    notes.push(`사람 확인 필요: ${question.expectRoute}`);
  }
  return { pass, notes };
}

async function main() {
  const sampleArg = process.argv.indexOf("--sample");
  const sample = sampleArg >= 0 ? parseInt(process.argv[sampleArg + 1], 10) : null;
  const cases = sample ? CASES.slice(0, sample) : CASES;

  console.error("=== hondi-guide 시스템 프롬프트 조립 중 ===");
  const systemPrompt = await composeHondiGuidePrompt();
  console.error(`=== 조립 완료: 총 ${systemPrompt.length}자 ===\n`);

  const results = { PASS: 0, FAIL: 0, REVIEW: 0 };
  const failures = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    let answer = "";
    let error = null;
    try {
      answer = await askHondiGuide(systemPrompt, c.q);
    } catch (e) {
      error = e.message;
    }
    const { pass, notes } = error ? { pass: false, notes: [`요청 실패: ${error}`] } : grade(c, answer);
    const status = pass === null ? "REVIEW" : pass ? "PASS" : "FAIL";
    results[status]++;
    if (status === "FAIL") failures.push({ id: c.id, q: c.q, notes, answer: answer.slice(0, 200) });

    console.log(`[${i + 1}/${cases.length}] ${status.padEnd(6)} (${c.id}) "${c.q}"`);
    if (notes.length) console.log(`         ${notes.join(" / ")}`);
    console.log(`         답변 일부: ${answer.slice(0, 120).replace(/\n/g, " ")}...`);
    console.log();
  }

  console.log("=".repeat(70));
  console.log(`PASS=${results.PASS} FAIL=${results.FAIL} REVIEW=${results.REVIEW} (총 ${cases.length}건)`);
  if (failures.length) {
    console.log("\n--- 실패 상세 ---");
    failures.forEach((f) => console.log(`  ${f.id} "${f.q}": ${f.notes.join(", ")}`));
  }
}

main().catch((e) => {
  console.error("치명적 오류:", e);
  process.exit(1);
});
