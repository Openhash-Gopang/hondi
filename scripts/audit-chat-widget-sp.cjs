#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   scripts/audit-chat-widget-sp.cjs — 정적 전수 감사 (2026-09-08)

   attach-chat-widget.cjs로 부착된 각 페이지의
   window.HONDI_CHAT_WIDGET_CONFIG.sp 값이 실제로 prompts/sp-catalog.json
   에 등록돼 있고, 그 SP 파일이 리포지토리에 실재하며, 내용이 비어있지
   않은지를 네트워크 없이(로컬 파일만으로) 검사한다.

   chat-widget.js의 loadSP()가 런타임에 하는 일(manifest 조회 →
   파일 fetch → 길이 검사)과 동일한 검증을 배포 전에 미리 수행해,
   오탈자·미등록 키·파일 누락을 커밋 단계에서 잡기 위한 것이다.
   실제 브라우저에서 위젯이 그 SP를 "기본으로 호출"하는지까지 확인
   하려면 scripts/smoke-test-chat-widget.cjs(라이브, 네트워크 필요)를
   함께 실행해야 한다 — 이 스크립트는 설정 정합성만 본다.

   실행:  node scripts/audit-chat-widget-sp.cjs
   ══════════════════════════════════════════════════════════════════ */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const MIN_SP_LEN = 50; // chat-widget.js의 loadSP() 폴백 임계값과 동일

const PAGES = [
  'pages/k-government.html',
  'pages/expert-personas.html',
  'pages/k-services.html',
];

function extractConfig(html, file) {
  const m = html.match(/window\.HONDI_CHAT_WIDGET_CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return null;
  const sandbox = {};
  try {
    vm.createContext(sandbox);
    return vm.runInContext('(' + m[1] + ')', sandbox);
  } catch (e) {
    console.error('  ✗ ' + file + ': HONDI_CHAT_WIDGET_CONFIG 파싱 실패 — ' + e.message);
    return null;
  }
}

function checkAuthOrder(html, file) {
  const authIdx   = html.indexOf('k-service-auth-client.js');
  const widgetIdx = html.indexOf('/assets/chat-widget.js');
  if (authIdx === -1) return '경고: k-service-auth-client.js include 없음 (인증 없이 채팅 오픈)';
  if (widgetIdx === -1) return '오류: /assets/chat-widget.js include 없음';
  if (authIdx > widgetIdx) return '오류: k-service-auth-client.js가 chat-widget.js보다 뒤에 있음(순서 위반)';
  return null;
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/sp-catalog.json'), 'utf8'));
} catch (e) {
  console.error('FATAL: prompts/sp-catalog.json 파싱 실패 — ' + e.message);
  process.exit(1);
}

let failCount = 0, warnCount = 0;

for (const rel of PAGES) {
  const fp = path.join(ROOT, rel);
  console.log('── ' + rel + ' ──');

  if (!fs.existsSync(fp)) {
    console.log('  ✗ 파일 없음');
    failCount++;
    continue;
  }
  const html = fs.readFileSync(fp, 'utf8');

  const orderIssue = checkAuthOrder(html, rel);
  if (orderIssue) {
    console.log('  ' + (orderIssue.startsWith('오류') ? '✗' : '△') + ' ' + orderIssue);
    if (orderIssue.startsWith('오류')) failCount++; else warnCount++;
  }

  const cfg = extractConfig(html, rel);
  if (!cfg) {
    console.log('  ✗ HONDI_CHAT_WIDGET_CONFIG를 찾을 수 없음');
    failCount++;
    continue;
  }

  const spKey = cfg.sp;
  if (!spKey) {
    console.log('  ✗ config.sp 누락');
    failCount++;
    continue;
  }
  const fname = manifest[spKey];
  if (!fname) {
    console.log('  ✗ sp-catalog.json에 키 없음: ' + spKey);
    failCount++;
    continue;
  }
  const spPath = path.join(ROOT, 'prompts', fname);
  if (!fs.existsSync(spPath)) {
    console.log('  ✗ SP 파일 없음: prompts/' + fname + ' (키: ' + spKey + ')');
    failCount++;
    continue;
  }
  const spContent = fs.readFileSync(spPath, 'utf8');
  if (spContent.length < MIN_SP_LEN) {
    console.log('  ✗ SP 파일이 비정상적으로 짧음(' + spContent.length + '자 < ' + MIN_SP_LEN + '): prompts/' + fname);
    failCount++;
    continue;
  }

  console.log('  ✓ sp: ' + spKey + ' → prompts/' + fname + ' (' + spContent.length + '자)');
  console.log('  ✓ context: ' + (cfg.context ? '"' + cfg.context.slice(0, 40) + (cfg.context.length > 40 ? '…' : '') + '"' : '(없음)'));
  console.log('  ✓ label: "' + (cfg.label || '(기본값)') + '"  greeting: "' + (cfg.greeting || '(기본값)').slice(0, 30) + '…"');
}

console.log('\n' + (failCount === 0 ? '전수 감사 통과' : failCount + '건 실패') + (warnCount ? ' (경고 ' + warnCount + '건)' : ''));
process.exit(failCount === 0 ? 0 : 1);
