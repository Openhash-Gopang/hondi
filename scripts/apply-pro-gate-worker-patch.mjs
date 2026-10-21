// worker.js 에 전문가용 SP 서버 게이트(pro-gate.js)를 "앵커 기준 제자리 삽입"으로 연결한다 (2026-10-21, 계획 W1-5).
// 전제: scripts/apply-pro-verify-worker-patch.mjs 가 이미 적용돼 있어야 한다(#724). 여러 번 실행해도 한 번만 적용된다.
// 사용: node scripts/apply-pro-gate-worker-patch.mjs [worker.js 경로]
import fs from 'node:fs';
const file = process.argv[2] || 'worker.js';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('checkProGate')) { console.log('이미 적용됨 — 변경 없음'); process.exit(0); }

function once(anchor) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error(`앵커가 ${n}번 나타남(1번이어야 함): ${anchor.slice(0, 80)}`); process.exit(1); }
}
function insertAfter(anchor, text) { once(anchor); s = s.replace(anchor, () => anchor + text); }
function insertBefore(anchor, text) { once(anchor); s = s.replace(anchor, () => text + anchor); }

insertAfter(
  "import { makePocketBaseProVerifyStore } from './src/worker/pro-verify-store.js';\n",
  "import { checkProGate } from './src/worker/pro-gate.js';\n",
);

insertBefore(
  "    if (pathname === '/chat/completions')        return callDeepSeek(bodyText, env, corsHeaders, null, _meta, ctx);\n",
  `    // ── 전문가용 SP 서버 게이트(2026-10-21, 계획 W1-5) — 전문가용(-assistant) SP 가 실린 AI 호출은 유효한 전문가 세션(body.pro_session)이 있어야 한다.
    // env.PRO_GATE_MODE: off | log(기본, 차단 없이 기록만) | enforce. 세션은 POST /pro-verify/session 으로 발급(env.PRO_SESSION_SECRET 필요).
    if (isAiProxyPath) {
      const _pg = await checkProGate({ bodyText, env });
      if (_pg.wouldBlock) console.warn(JSON.stringify({ tag: 'HONDI_PRO_GATE_WOULD_BLOCK', path: pathname, code: _pg.wouldBlock, persona: _pg.persona || null, ..._meta }));
      if (!_pg.ok) return _err(_pg.status, _pg.code, _pg.message, corsHeaders);
      bodyText = _pg.bodyText;
    }

`,
);

fs.writeFileSync(file, s);
console.log('적용 완료:', file);
