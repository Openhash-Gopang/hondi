// worker.js 에 면허 인증(/pro-verify/*) 연결을 "앵커 기준 제자리 삽입"으로 추가한다 (2026-10-21).
// 최신 main 의 worker.js 위에서 실행한다 — 파일 전체를 교체하지 않으므로 다른 세션의 변경과 충돌하지 않는다. 여러 번 실행해도 한 번만 적용된다.
// 사용: node scripts/apply-pro-verify-worker-patch.mjs [worker.js 경로]
import fs from 'node:fs';
const file = process.argv[2] || 'worker.js';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('handleProVerifyRoutes')) { console.log('이미 적용됨 — 변경 없음'); process.exit(0); }

function insertAfter(anchor, text) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error(`앵커가 ${n}번 나타남(1번이어야 함): ${anchor.slice(0, 70)}`); process.exit(1); }
  s = s.replace(anchor, () => anchor + text);
}
function insertBefore(anchor, text) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error(`앵커가 ${n}번 나타남(1번이어야 함): ${anchor.slice(0, 70)}`); process.exit(1); }
  s = s.replace(anchor, () => text + anchor);
}

insertAfter(
  "import { makePocketBaseRatingStore, makePocketBaseRewardStore } from './src/worker/doc-form-reward-store.js';\n",
  "import { makeProVerifyHandler } from './src/worker/pro-verify-handler.js';\nimport { makePocketBaseProVerifyStore } from './src/worker/pro-verify-store.js';\n",
);

insertBefore(
  "// ── 나비 서식 DB(2026-10-14 신설)",
  `// ── 전문가 면허 인증(2026-10-21 신설) — 면허증 사본 업로드 → 운영자 수동 승인. 사본은 승인·반려 즉시 삭제.
// 운영자는 env.PRO_VERIFY_ADMINS(guid 또는 공개키, 쉼표 구분)의 지갑 서명으로만 승인·열람한다.
function handleProVerifyRoutes(request, url, env, corsHeaders) {
  const handler = makeProVerifyHandler({
    store: makePocketBaseProVerifyStore({ base: L1_DEFAULT, getToken: () => _l1AdminToken(env) }),
    getPinnedPubKey: async (e, guid) => (await _l1FindProfileByGuid(e, guid))?.pubkey_ed25519 || null,
  });
  return handler.handle(request, url, env, corsHeaders);
}

`,
);

insertAfter(
  "    if (pathname.startsWith('/doc-form/')) return handleDocFormRoutes(request, url, env, corsHeaders);\n",
  "    if (pathname.startsWith('/pro-verify/')) return handleProVerifyRoutes(request, url, env, corsHeaders);\n",
);

fs.writeFileSync(file, s);
console.log('적용 완료:', file);
