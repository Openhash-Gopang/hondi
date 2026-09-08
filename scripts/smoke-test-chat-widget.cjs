#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   scripts/smoke-test-chat-widget.cjs — 라이브 스모크 테스트 (2026-09-08)

   audit-chat-widget-sp.cjs가 "리포지토리 안"의 정합성(파일 존재·SP
   등록 여부)만 본다면, 이 스크립트는 실제 배포된 hondi.net에 대해
   브라우저가 하는 것과 동일한 네트워크 호출을 그대로 재현해 "각
   페이지의 채팅 아이콘이 실제로 그 페이지의 SP를 기본으로 호출하는지"
   를 종단간(end-to-end)으로 검증한다.

   ⚠ Claude의 샌드박스 bash_tool은 이그레스 allowlist에 hondi.net이
   없어(host_not_allowed) 이 스크립트를 직접 실행할 수 없다 — 일반
   인터넷 접속이 되는 곳(본인 PC, CI 등)에서 실행해야 한다. Node
   18+(내장 fetch)만 있으면 되고 별도 설치가 필요 없다.

   검사 단계(페이지마다):
     1. 페이지 HTML을 실제로 GET해서 window.HONDI_CHAT_WIDGET_CONFIG를
        추출(= 브라우저가 파싱하는 것과 동일한 소스).
     2. chat-widget.js / k-service-auth-client.js가 200으로 응답하고
        문법상 유효한 JS인지 확인.
     3. /prompts/sp-catalog.json에서 config.sp 키가 가리키는 파일명을
        조회(= chat-widget.js의 loadSP()가 하는 것과 동일한 조회).
     4. /prompts/{파일명}을 GET해 200 + 최소 길이 이상인지 확인 — 이
        내용이 실제로 "그 페이지의 SP"로 쓰일 시스템 프롬프트다.
     5. (--deep 옵션) WORKER_URL(/ai/chat)에 그 SP를 system으로 실어
        실제 채팅 1턴을 보내 응답이 오는지까지 확인. 실제 AI 호출
        비용이 발생하므로 기본은 꺼져 있다.

   실행:
     node scripts/smoke-test-chat-widget.cjs            # 1~4단계만
     node scripts/smoke-test-chat-widget.cjs --deep      # 5단계 포함
     node scripts/smoke-test-chat-widget.cjs --base-url=https://hondi.net
   ══════════════════════════════════════════════════════════════════ */

const vm = require('vm');

const args = process.argv.slice(2);
const DEEP = args.includes('--deep');
const baseUrlArg = args.find((a) => a.startsWith('--base-url='));
const BASE_URL = baseUrlArg ? baseUrlArg.split('=')[1] : 'https://hondi.net';
const WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';
const MIN_SP_LEN = 50;

const PAGES = [
  { path: '/pages/k-government.html', expectSp: 'HONDI_VISITOR_SP' },
  { path: '/pages/expert-personas.html', expectSp: 'SP_EXPERT_BASE' },
  { path: '/pages/k-services.html', expectSp: 'HONDI_VISITOR_SP' },
];

function extractConfig(html) {
  const m = html.match(/window\.HONDI_CHAT_WIDGET_CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return null;
  const sandbox = {};
  vm.createContext(sandbox);
  return vm.runInContext('(' + m[1] + ')', sandbox);
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function checkScriptSyntax(url, label) {
  const { ok, status, text } = await fetchText(url);
  if (!ok) return { pass: false, msg: label + ' GET 실패 (HTTP ' + status + ')' };
  try {
    new vm.Script(text);
  } catch (e) {
    return { pass: false, msg: label + ' 문법 오류: ' + e.message };
  }
  return { pass: true, msg: label + ' OK (' + text.length + '자)' };
}

async function testPage(page) {
  const url = BASE_URL + page.path;
  console.log('\n── ' + page.path + ' ──');
  let fail = 0;

  // 1. 페이지 HTML + 설정 추출
  const pageRes = await fetchText(url);
  if (!pageRes.ok) {
    console.log('  ✗ 페이지 GET 실패 (HTTP ' + pageRes.status + ')');
    return 1;
  }
  const cfg = extractConfig(pageRes.text);
  if (!cfg) {
    console.log('  ✗ HONDI_CHAT_WIDGET_CONFIG를 페이지에서 찾을 수 없음(위젯 미부착?)');
    return 1;
  }
  console.log('  ✓ config 발견: sp=' + cfg.sp + (cfg.context ? ', context 있음' : ''));
  if (page.expectSp && cfg.sp !== page.expectSp) {
    console.log('  ✗ 기대한 SP(' + page.expectSp + ')와 실제(' + cfg.sp + ') 불일치');
    fail++;
  }

  // 2. 공용 스크립트 도달성/문법
  for (const [scriptUrl, label] of [
    [BASE_URL + '/assets/chat-widget.js', 'chat-widget.js'],
    [BASE_URL + '/auth/k-service-auth-client.js', 'k-service-auth-client.js'],
  ]) {
    const r = await checkScriptSyntax(scriptUrl, label);
    console.log('  ' + (r.pass ? '✓' : '✗') + ' ' + r.msg);
    if (!r.pass) fail++;
  }

  // 3. sp-catalog.json에서 키 조회
  const manifestRes = await fetchText(BASE_URL + '/prompts/sp-catalog.json');
  if (!manifestRes.ok) {
    console.log('  ✗ sp-catalog.json GET 실패 (HTTP ' + manifestRes.status + ')');
    return fail + 1;
  }
  let manifest;
  try { manifest = JSON.parse(manifestRes.text); } catch (e) {
    console.log('  ✗ sp-catalog.json 파싱 실패: ' + e.message);
    return fail + 1;
  }
  const fname = manifest[cfg.sp];
  if (!fname) {
    console.log('  ✗ sp-catalog.json에 키 없음: ' + cfg.sp);
    return fail + 1;
  }

  // 4. 실제 SP 파일 fetch
  const spRes = await fetchText(BASE_URL + '/prompts/' + fname);
  if (!spRes.ok) {
    console.log('  ✗ SP 파일 GET 실패 (HTTP ' + spRes.status + '): /prompts/' + fname);
    fail++;
  } else if (spRes.text.length < MIN_SP_LEN) {
    console.log('  ✗ SP 파일이 비정상적으로 짧음(' + spRes.text.length + '자): /prompts/' + fname);
    fail++;
  } else {
    console.log('  ✓ SP 로드 성공: /prompts/' + fname + ' (' + spRes.text.length + '자) — 위젯이 실제로 이 파일을 시스템 프롬프트로 씀');
  }

  // 5. (선택) 실제 /ai/chat 왕복
  if (DEEP && spRes.ok) {
    const composedSP = cfg.context ? spRes.text + '\n\n---\n[현재 화면 컨텍스트]\n' + cfg.context : spRes.text;
    try {
      const chatRes = await fetch(WORKER_URL + '/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          system: composedSP,
          messages: [{ role: 'user', content: '스모크테스트: 이 페이지는 무엇을 하는 곳인지 한 문장으로만 답하십시오.' }],
          max_tokens: 200,
        }),
      });
      const data = await chatRes.json().catch(() => ({}));
      if (!chatRes.ok || !data.content) {
        console.log('  ✗ /ai/chat 왕복 실패 (HTTP ' + chatRes.status + '): ' + JSON.stringify(data).slice(0, 120));
        fail++;
      } else {
        console.log('  ✓ /ai/chat 왕복 성공: "' + data.content.slice(0, 60).replace(/\n/g, ' ') + '…"');
      }
    } catch (e) {
      console.log('  ✗ /ai/chat 호출 예외: ' + e.message);
      fail++;
    }
  }

  return fail;
}

(async () => {
  console.log('BASE_URL = ' + BASE_URL + (DEEP ? ' (--deep: 실제 /ai/chat 왕복 포함, AI 호출 비용 발생)' : ''));
  let totalFail = 0;
  for (const page of PAGES) {
    totalFail += await testPage(page);
  }
  console.log('\n' + (totalFail === 0 ? '전체 통과' : totalFail + '건 실패'));
  process.exit(totalFail === 0 ? 0 : 1);
})();
