#!/usr/bin/env node
/**
 * tests/live_smoketest/render_expert_prompts.mjs
 * -------------------------------------------------
 * "professor EXPERT 페르소나가 관제탑 원칙(CONTROL-TOWER-PRINCIPLE)에 따라
 * 응답하는지" 검증(NEXT_SESSION_HANDOFF_20260809_v2.md §2)의 1단계 —
 * expert-session.js의 _composeExpertPrompt(def)를 실제 프로덕션 코드
 * 그대로 호출해 리프별 system prompt 전문을 파일로 저장한다.
 *
 * ## 왜 파이썬 재구현 대신 이 방식인가 (§2-1 대응)
 * 인계서 §2-1은 기존 expert_persona_smoketest.py의 compose_expert_prompt()가
 * (1) CONTROL-TOWER-PRINCIPLE을 조립에서 빠뜨리고 (2) 조상 체인을 1단만
 * 지원해(3단 professor 계열 미지원) 프로덕션과 어긋나 있다고 지적한다.
 * 같은 날 병렬로 진행된 gov-tree 스레드(render_govtree_prompts.mjs,
 * PR #288)가 이미 "파이썬으로 프로덕션 로직을 다시 옮기지 말고, 프로덕션
 * 코드 자체를 Node로 실행해 실제 출력을 캡처한다"는 패턴을 확립했다 —
 * 이 스크립트는 그 패턴을 expert-session.js._composeExpertPrompt()에
 * 그대로 적용한다. 재구현이 아니므로 "두 로직이 어긋날 위험" 자체가
 * 구조적으로 없어진다(포팅해서 동기화 상태를 계속 감시할 필요가 없음).
 *
 * ## Node에서 브라우저 전용 모듈을 로드하기 위한 최소 셔밍
 * expert-session.js는 gwp/engine.js·gwp/allowed-origins.js를 정적
 * import하는데, 이 파일들은 모듈 최상단에서 window/location/
 * addEventListener를 참조한다(실사로 확인 — 셔밍 없이 import하면
 * "location is not defined" → "window.addEventListener is not a
 * function" 순으로 즉시 실패). 아래 4개 전역만 최소로 채워주면 이후
 * import·호출 전부 정상 동작한다(DOM 전체를 흉내낼 필요 없음 — 이
 * 조립 경로가 실제로 건드리는 브라우저 API는 이게 전부였다).
 *
 * manifest-loader.js(_loadSpByKey/_loadSpRawByKey)는 fetch('/prompts/...')
 * 상대경로로 SP를 읽는다 — 브라우저에서는 same-origin이 자동 해석하지만
 * Node에는 base가 없으므로, 아래 fetch 셔밍이 그 경로를 로컬
 * prompts/ 디렉터리 파일 읽기로 그대로 치환한다(네트워크 불필요 — 전부
 * 정적 파일이라 gov-tree의 nat-agency tier처럼 GitHub Actions egress가
 * 따로 필요하지 않다).
 *
 * Usage:
 *   node render_expert_prompts.mjs \
 *     --scenarios scenarios_control_tower_professor_20260809.json \
 *     --out ../../results/professor-control-tower-prompts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../');
const PROMPTS_DIR = path.join(REPO_ROOT, 'prompts');

function parseArgs() {
  const args = {
    scenarios: 'scenarios_control_tower_professor_20260809.json',
    out: '../../results/professor-control-tower-prompts',
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scenarios') args.scenarios = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

// ── 브라우저 전역 최소 셔밍 (expert-session.js가 정적 import하는
// gwp/engine.js·gwp/allowed-origins.js가 모듈 최상단에서 요구) ──────────
globalThis.window = globalThis;
globalThis.location = { origin: 'https://hondi.net' };
globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});

// ── fetch('/prompts/...') → 로컬 prompts/ 디렉터리 파일 읽기로 치환 ────
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.startsWith('/prompts/')) {
    throw new Error(`[render_expert_prompts] 예상치 못한 fetch 대상(정적 SP 로딩 경로 밖): ${u}`);
  }
  const fname = u.slice('/prompts/'.length);
  const fpath = path.join(PROMPTS_DIR, fname);
  try {
    const text = fs.readFileSync(fpath, 'utf-8');
    return {
      ok: true,
      status: 200,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  } catch (e) {
    return {
      ok: false,
      status: 404,
      text: async () => '',
      json: async () => { throw e; },
    };
  }
};

async function main() {
  const args = parseArgs();

  // 프로덕션 코드 그 자체를 import — _composeExpertPrompt는 여기서
  // 재구현하지 않는다(§2-1 핵심).
  // ★ 2026-09-13 수정(Windows 실사용에서 재현, universal-common-
  // inheritance-smoketest.mjs와 동일 결함) — path.join()이 만든 절대
  // 경로를 동적 import()에 그대로 넘기면 Windows에서
  // ERR_UNSUPPORTED_ESM_URL_SCHEME로 실패한다. pathToFileURL()로 감싼다.
  const { _composeExpertPrompt } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'src/gopang/ai/expert-session.js')).href
  );
  const { EXPERT_REGISTRY } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'src/gopang/ai/expert-registry.js')).href
  );

  const scenariosPath = path.resolve(__dirname, args.scenarios);
  const scenarios = JSON.parse(fs.readFileSync(scenariosPath, 'utf-8'));

  const outDir = path.resolve(__dirname, args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];
  let failCount = 0;

  for (const s of scenarios) {
    const { id, expert_key } = s;
    const def = EXPERT_REGISTRY[expert_key];
    if (!def) {
      failCount++;
      manifest.push({ id, expert_key, renderStatus: 'MISSING_DEF', error: `EXPERT_REGISTRY에 없는 키: ${expert_key}` });
      console.error(`[MISSING_DEF] ${id} (${expert_key})`);
      continue;
    }
    try {
      // 조상 체인 기록(§2-3 표본 설계 검증용) — parentKey를 따라 올라가며
      // 실제로 몇 단인지 사람이 매니페스트만 보고도 확인할 수 있게 남긴다.
      const ancestorChain = [];
      let cur = def.parentKey;
      while (cur) {
        ancestorChain.push(cur);
        cur = EXPERT_REGISTRY[cur]?.parentKey;
      }

      const systemPrompt = await _composeExpertPrompt(def);
      const outFile = path.join(outDir, `${id}.txt`);
      fs.writeFileSync(outFile, systemPrompt, 'utf-8');

      const hasControlTower = systemPrompt.includes('CONTROL-TOWER-PRINCIPLE') || systemPrompt.includes('관제탑');
      manifest.push({
        id,
        expert_key,
        label: def.label,
        ancestorChain, // 루트 방향(바로 위 부모 → ... → professor)
        treeDepth: ancestorChain.length + 1, // 리프 자신 포함
        promptLength: systemPrompt.length,
        hasControlTowerPrinciple: hasControlTower,
        renderStatus: hasControlTower ? 'OK' : 'MISSING_CONTROL_TOWER',
        systemPromptFile: `${id}.txt`,
      });
      if (!hasControlTower) {
        failCount++;
        console.error(`[MISSING_CONTROL_TOWER] ${id} (${expert_key}) — 조립됐지만 원칙 문서가 안 실림, 렌더 버그 의심`);
      } else {
        console.log(`[ok] ${id} (${expert_key}) depth=${ancestorChain.length + 1} chain=${JSON.stringify(ancestorChain)} -> ${systemPrompt.length}자`);
      }
    } catch (e) {
      failCount++;
      manifest.push({ id, expert_key, renderStatus: 'EXCEPTION', error: e.message });
      console.error(`[EXCEPTION] ${id} (${expert_key}): ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(outDir, '_render_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\n${manifest.length}건 렌더 완료, 실패 ${failCount}건. 매니페스트: ${path.join(outDir, '_render_manifest.json')}`);
  if (failCount > 0) process.exitCode = 1;
}

main();
