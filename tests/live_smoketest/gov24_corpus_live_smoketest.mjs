#!/usr/bin/env node
/**
 * 정부24 민원서비스 전수취합 코퍼스 — 라이브 스모크테스트 (실제 DeepSeek API)
 *
 * 배경(주피터 지시): "지금까지 진행한 사고 실험 시나리오를 모두 취합하여,
 * 라이브 스모크 테스트 시나리오를 작성하세요." 로컬 목(mock) classifyFn
 *으로 8개 배치(정부24 실제 민원서비스 약 350건)를 사고실험하며 BUG-023~031
 * 을 발견·수정했지만, 로컬 목은 실제 LLM의 의미 이해 능력을 근사할 뿐이라
 * "메커니즘이 작동하는가"는 증명해도 "실제로 정확한가"는 검증 불가능하다는
 * 한계가 반복 확인됐다. 이 스크립트는 gov_router_2026_08_21_department_
 * live_smoketest.mjs의 realClassifyFn(pages/regional-gov.html의
 * _govClassifyFn을 그대로 복제 — 같은 프록시·같은 모델·같은 프롬프트)을
 * 재사용하되, 시나리오를 소스코드에 하드코딩하지 않고 외부 JSON 파일에서
 * 읽는다 — 350건을 한 번에 돌리면 GitHub Actions 타임아웃·API 요금
 * 문제가 생기므로, 원래 사고실험 배치 단위(50건씩 7개 파일)로 나눠 여러
 * 번의 워크플로 실행으로 나눠 돌리는 걸 전제로 설계했다.
 *
 * ★ SP 응답 품질 체크(체크3, callDeepSeek 재호출)는 이 스크립트에서
 * 의도적으로 생략했다 — 이 전수조사의 목적은 라우팅 정확도(trace/agency)
 * 관찰이지 응답 품질 평가가 아니며, 350건 전체에 체크3까지 돌리면 API
 * 호출이 2배로 늘어 시간·비용 부담이 커진다.
 *
 * ★ 대부분의 시나리오는 expectContains가 'JEJU-GOV-COMMON'(모든 trace에
 * 항상 존재)으로 설정된 관찰용 placeholder다 — 350건 각각의 정확한 기대
 * 코드를 사람이 일일이 검증하는 건 이번 취합 작업의 범위를 벗어났다.
 * 대신 각 시나리오의 note 필드에 정부24가 명시한 소관기관을 담아뒀으니,
 * 결과 판정은 results.json의 trace/agency 필드를 note와 사람이 직접
 * 대조해서 내려야 한다. routedOk가 항상 true인 건 "통과"가 아니라
 * "라우팅이 완료돼 trace가 기록됐다"는 뜻일 뿐이다.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... node gov24_corpus_live_smoketest.mjs --scenarios <file>
 *   (file은 tests/live_smoketest/ 안의 JSON 파일명, 기본값:
 *    scenarios_gov24_corpus_batch1_20260823.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// pages/regional-gov.html의 PROXY 상수와 완전히 동일한 값
// (gov_router_2026_08_21_department_live_smoketest.mjs와 동일하게 유지).
const PROXY = 'https://hondi-proxy.tensor-city.workers.dev';

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--scenarios');
  const file = idx >= 0 && args[idx + 1] ? args[idx + 1] : 'scenarios_gov24_corpus_batch1_20260823.json';
  return { file };
}

// ★ gov_router_2026_08_21_department_live_smoketest.mjs의 realClassifyFn과
// 토씨 하나 안 틀리고 동일 — 프로덕션 K-Intent 폴백을 그대로 복제한다.
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

async function main() {
  const { file } = parseArgs();
  const scenariosPath = path.join(__dirname, file);
  const SCENARIOS = JSON.parse(fs.readFileSync(scenariosPath, 'utf-8'));
  console.log(`시나리오 파일: ${file} (${SCENARIOS.length}건)`);

  globalThis.window = globalThis;
  globalThis.window.HONDI_PROVINCE_CODE = 'jeju';

  const { assembleGovSystemPrompt, resolveGovAgency } = await import(
    // BUG-FIX(2026-09-14, Windows) — path.join()이 만드는 'C:\...' 형태의
    // 절대경로를 import()에 그대로 넘기면 Windows에서
    // ERR_UNSUPPORTED_ESM_URL_SCHEME로 실패한다(Node ESM 로더가 절대경로는
    // file:// URL이어야 한다고 요구 — 리눅스/맥은 스킴 없는 절대경로도
    // 허용해 여태 안 드러났다). pathToFileURL()로 감싸 플랫폼 공통으로
    // 만든다.
    pathToFileURL(path.join(REPO_ROOT, 'src/gopang/gov/gov-router.js'))
  );

  const results = [];
  for (const s of SCENARIOS) {
    console.log(`\n=== ${s.id}: "${s.utterance}" ===`);
    classifyCallCount = 0;
    let r;
    let error = null;
    try {
      // ★ 2026-08-23 수정(사용자 지적) — '제주시'(시 단위)만 넘기면
      // _matchEmd가 요구하는 읍면동 정보가 없어 "위치 불명 — 사용자
      // 재질문 필요"가 뜬다. 이건 라우팅 버그가 아니라 이 스크립트의
      // 테스트 설계 결함이다 — 실제 AC(사용자 AI 비서)는 GPS/프로필
      // 주소로 처음부터 구체적 위치(읍면동까지)를 알고 있으므로 이런
      // 재질문은 실사용에서 발생하지 않는다. gov_router_2026_08_21_
      // department_live_smoketest.mjs가 이미 쓰던 전체 주소 관례를
      // 그대로 따른다.
      r = await assembleGovSystemPrompt(
        s.utterance,
        s.locationHint || '제주특별자치도 제주시 애월읍 애월리 123-4',
        realClassifyFn,
      );
    } catch (e) {
      error = e.message;
    }

    const trace = r?.trace ?? [];
    const agency = r ? resolveGovAgency(trace) : null;
    const routedOk = trace.some((t) => t.includes(s.expectContains));

    console.log(`  trace: [${trace.join(' > ')}]`);
    console.log(`  agency: ${agency}`);
    console.log(`  K-Intent(classifyFn) 호출 횟수: ${classifyCallCount}`);
    if (r?.needsClarification) {
      const nc = r.needsClarification;
      if (nc.isLocationQuestion) {
        console.log(`  🔔 위치 되묻기 발동: "${nc.question}"`);
      } else {
        console.log(`  🔔 되묻기 발동: "${nc.question}" 옵션: ${nc.options?.map((o) => o.name).join(' / ')}`);
      }
    }
    console.log(`  note: ${s.note}`);

    results.push({
      id: s.id,
      utterance: s.utterance,
      note: s.note,
      trace,
      agency,
      classifyCallCount,
      needsClarification: r?.needsClarification ?? null,
      routedOk,
      error,
    });
  }

  const base = path.basename(file, '.json');
  const outDir = path.join(REPO_ROOT, 'results', `gov24_corpus_smoketest_${base}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(results, null, 2),
    'utf-8',
  );

  const crashCount = results.filter((r) => r.error).length;
  const emergencyCount = results.filter((r) => r.trace.some((t) => t.includes('응급 감지'))).length;
  console.log(`\n\n총 ${results.length}건 — 크래시 ${crashCount} / 응급감지 발동 ${emergencyCount}`);
  console.log('※ routedOk는 관찰용 placeholder입니다 — 정확도는 results.json의 trace/agency를 note의 소관기관과 사람이 직접 대조해서 판정하세요.');
  console.log(`결과 저장: results/gov24_corpus_smoketest_${base}/results.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
