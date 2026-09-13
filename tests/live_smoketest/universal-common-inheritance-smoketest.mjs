#!/usr/bin/env node
/**
 * tests/live_smoketest/universal-common-inheritance-smoketest.mjs
 * ------------------------------------------------------------------
 * 2026-09-13 발견한 결함(UNIVERSAL-common이 client-side _loadSpByKey()
 * 경로에서 실제로는 결합되지 않고 있었음 — K-Job/K-Plan/K-Watch/
 * K-Telecom/K-Estate가 U0~U13(서비스 자기 인식 원칙 포함)을
 * 하나도 못 받고 있었음)의 수정을 검증한다.
 *
 * render_expert_prompts.mjs와 동일한 원칙을 따른다 — 검증 로직을
 * 별도로 재구현하지 않고, manifest-loader.js의 프로덕션 함수
 * _loadSpByKey()를 Node에서 그대로 호출해 실제 합성 결과를 검사한다.
 * fetch('/prompts/...')는 로컬 prompts/ 디렉터리 파일 읽기로 셔밍한다
 * (render_expert_prompts.mjs와 같은 셔밍, 네트워크 불필요).
 *
 * 검증 대상:
 *   1) switch형 5개 SP(K-Telecom/K-Estate/K-Plan/K-Watch/K-Job — K-Bank는
 *      2026-09-13에 gwp-registry.js의 2026-08-01 철회(kgdc가 은행
 *      기능을 이미 흡수)를 뒤늦게 반영해 call-ai.js에서 함께 삭제,
 *      이 목록에서도 제외했다. 대상 목록: prompts/AC-PRO-CORE_*.txt
 *      changelog·call-ai.js 커밋 참고)
 *      각각의 합성 결과에 UNIVERSAL-common과 UNIVERSAL-INTEGRITY가
 *      둘 다 실려 있는지 — 하나라도 빠지면 이번 수정이 불완전한 것.
 *   2) UNIVERSAL-common 안에 U13(서비스 자기 인식) 문구가 실제로
 *      들어있는지 — 파일이 결합됐다는 것과 그 안에 U13이 있다는 것은
 *      별개 확인이 필요하다(구버전 UNIVERSAL-common이 캐시됐을 가능성
 *      등 배제).
 *   3) AC-PRO-CORE(_loadSpByKey('AC-PRO-CORE', ...)) 자체도 동일하게
 *      UNIVERSAL-common을 받는지, 그리고 그 원문 안에 이번에 신설한
 *      §ACCOUNT-FACTS가 있는지.
 *
 * Usage: node tests/live_smoketest/universal-common-inheritance-smoketest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../');
const PROMPTS_DIR = path.join(REPO_ROOT, 'prompts');

// ── fetch('/prompts/...') → 로컬 prompts/ 디렉터리 파일 읽기로 치환
// (render_expert_prompts.mjs와 동일 패턴) ──────────────────────────
globalThis.fetch = async (url, _opts) => {
  const u = String(url);
  if (!u.startsWith('/prompts/')) {
    throw new Error(`[universal-common-smoketest] 예상치 못한 fetch 대상: ${u}`);
  }
  const fname = u.slice('/prompts/'.length);
  const fpath = path.join(PROMPTS_DIR, fname);
  try {
    const text = fs.readFileSync(fpath, 'utf-8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  } catch (e) {
    return { ok: false, status: 404, text: async () => '', json: async () => { throw e; } };
  }
};

// switch형 6개 SP — manifest 키·표시 라벨 (call-ai.js의 _loadK*SP() 함수들이
// 실제로 넘기는 값과 동일. call-ai.js 자체는 import하지 않는다 — ui/bubble.js
// 등 브라우저 전용 모듈 체인을 끌고 오지 않기 위해 manifest-loader.js의
// _loadSpByKey()를 직접, 같은 인자로 호출한다).
const SWITCH_TYPE_SPS = [
  { manifestKey: 'SP-23_ktelecom', label: 'K-Telecom' },
  { manifestKey: 'SP-24_kestate', label: 'K-Estate' },
  { manifestKey: 'k-plan', label: 'K-Plan' },
  { manifestKey: 'k-watch', label: 'K-Watch' },
  { manifestKey: 'k-job', label: 'K-Job' },
];

async function main() {
  // ★ 2026-09-13 수정(Windows 실사용에서 재현) — path.join()이 만든
  // 절대경로를 동적 import()에 그대로 넘기면 macOS/Linux(경로가
  // '/'로 시작)에서는 우연히 동작하지만, Windows(경로가 'C:\...'로
  // 시작)에서는 Node ESM 로더가 'C:'를 스킴으로 오인해
  // ERR_UNSUPPORTED_ESM_URL_SCHEME로 즉시 실패한다 — 이 컨테이너
  // (Linux)에서 검증할 때는 못 잡았던 크로스플랫폼 결함이다.
  // pathToFileURL()로 감싸면 두 OS 모두에서 올바른 file:// URL이 된다.
  const { _loadSpByKey } = await import(pathToFileURL(path.join(REPO_ROOT, 'src/gopang/ai/manifest-loader.js')).href);

  let failCount = 0;
  const results = [];

  for (const { manifestKey, label } of SWITCH_TYPE_SPS) {
    try {
      const composed = await _loadSpByKey(manifestKey, label);
      const hasIntegrity = composed.includes('UNIVERSAL-INTEGRITY') || composed.includes('제1공리');
      const hasUniversalCommon = composed.includes('UNIVERSAL-common');
      const hasU13 = composed.includes('서비스 자기 인식') || composed.includes('U13');
      const ok = hasIntegrity && hasUniversalCommon && hasU13;
      if (!ok) failCount++;
      results.push({
        label, manifestKey, promptLength: composed.length,
        hasUniversalIntegrity: hasIntegrity, hasUniversalCommon, hasU13,
        status: ok ? 'OK' : 'MISSING_COMMON_LAYER',
      });
      console.log(`${ok ? '[ok]' : '[FAIL]'} ${label} (${manifestKey}) — ` +
        `INTEGRITY=${hasIntegrity} UNIVERSAL-common=${hasUniversalCommon} U13=${hasU13} — ${composed.length}자`);
    } catch (e) {
      failCount++;
      results.push({ label, manifestKey, status: 'EXCEPTION', error: e.message });
      console.error(`[EXCEPTION] ${label} (${manifestKey}): ${e.message}`);
    }
  }

  // AC-PRO-CORE 자체 — sp-catalog.json이 가리키는 실제 최신 파일을 그대로 따라간다
  // (파일명을 여기 하드코딩하지 않음 — v1_14 이후 버전이 나와도 이 테스트가
  // 낡은 파일명에 고정되는 걸 피하기 위함, manifest-loader.js와 동일 원칙).
  try {
    const acComposed = await _loadSpByKey('AC-PRO-CORE', 'AC-PRO-CORE');
    const hasUniversalCommon = acComposed.includes('UNIVERSAL-common');
    const hasAccountFacts = acComposed.includes('§ACCOUNT-FACTS');
    const ok = hasUniversalCommon && hasAccountFacts;
    if (!ok) failCount++;
    results.push({
      label: 'AC-PRO-CORE', manifestKey: 'AC-PRO-CORE', promptLength: acComposed.length,
      hasUniversalCommon, hasAccountFacts, status: ok ? 'OK' : 'MISSING_EXPECTED_CONTENT',
    });
    console.log(`${ok ? '[ok]' : '[FAIL]'} AC-PRO-CORE — UNIVERSAL-common=${hasUniversalCommon} ` +
      `§ACCOUNT-FACTS=${hasAccountFacts} — ${acComposed.length}자`);
  } catch (e) {
    failCount++;
    results.push({ label: 'AC-PRO-CORE', status: 'EXCEPTION', error: e.message });
    console.error(`[EXCEPTION] AC-PRO-CORE: ${e.message}`);
  }

  const outDir = path.resolve(__dirname, '../../results/universal-common-inheritance');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(results, null, 2), 'utf-8');

  console.log(`\n${results.length}건 검증, 실패 ${failCount}건. 상세: ${path.join(outDir, '_manifest.json')}`);
  if (failCount > 0) process.exitCode = 1;
}

main();
