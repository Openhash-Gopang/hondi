#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   scripts/attach-chat-widget.js — pages/*.html에 채팅 위젯 include
   블록을 일괄 삽입 (2026-09-08)

   목적: assets/chat-widget.js(+ k-service-auth-client.js)를 여러
   페이지에 붙일 때, 페이지마다 손으로 <script> 블록을 복붙하지 않고
   이 스크립트 한 번 실행으로 전부(혹은 PAGES 배열에 새로 추가한 페이지
   만) 적용하기 위한 도구. 이미 삽입된 페이지는 건너뛴다(재실행 안전).

   실행:  node scripts/attach-chat-widget.cjs

   새 페이지에 적용하려면 PAGES 배열에 항목을 추가하고 다시 실행하면
   된다 — 마크업을 직접 옮겨 붙일 필요가 없다.
   ══════════════════════════════════════════════════════════════════ */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const PAGES = [
  {
    file: 'pages/k-government.html',
    sp: 'HONDI_VISITOR_SP',
    context: '사용자는 지금 K-Government(전자정부 연동) 설명 섹션에 있습니다. ' +
      '지자체·중앙부처 서비스와의 연동 방향을 다룹니다.',
    label: 'K-정부에 물어보기',
    greeting: '안녕하세요! K-정부 페이지 이용과 관련해 궁금한 점을 물어보세요. 😊',
    serviceLabel: 'K-정부',
  },
  {
    file: 'pages/expert-personas.html',
    sp: 'SP_EXPERT_BASE',
    context: '사용자는 지금 전문가 페르소나(SP) 체계 설명 섹션에 있습니다. ' +
      '각 분야 전문가 AI가 어떻게 문서(SP)로 정의되고 관리되는지를 다룹니다.',
    label: '전문가 페르소나에 물어보기',
    greeting: '안녕하세요! 전문가 페르소나(SP) 체계에 대해 궁금한 점을 물어보세요. 😊',
    serviceLabel: '전문가 페르소나',
  },
  {
    file: 'pages/k-services.html',
    sp: 'HONDI_VISITOR_SP',
    context: '사용자는 지금 K-서비스 전체 목록 섹션에 있습니다. K-Law, ' +
      'K-Tax, K-Market, GDC 등 16개 K-서비스 위성 저장소를 개괄합니다.',
    label: 'K-서비스에 물어보기',
    greeting: '안녕하세요! K-서비스 전체 목록과 관련해 궁금한 점을 물어보세요. 😊',
    serviceLabel: 'K-서비스',
  },
];

const MARKER = '<!-- hcw-attach:v1 (scripts/attach-chat-widget.cjs가 삽입, 손으로 지우지 마세요) -->';
const ANCHOR = '<script src="/assets/ph-header.js"></script>';

function jsStringLiteral(s) {
  return JSON.stringify(s);
}

function buildBlock(page) {
  return [
    MARKER,
    '<script>',
    '  window.K_AUTH_CONFIG = { serviceLabel: ' + jsStringLiteral(page.serviceLabel) + ' };',
    '  window.HONDI_CHAT_WIDGET_CONFIG = {',
    '    sp: ' + jsStringLiteral(page.sp) + ',',
    '    context: ' + jsStringLiteral(page.context) + ',',
    '    label: ' + jsStringLiteral(page.label) + ',',
    '    greeting: ' + jsStringLiteral(page.greeting) + ',',
    '    serviceLabel: ' + jsStringLiteral(page.serviceLabel) + ',',
    '  };',
    '</script>',
    '<script src="https://hondi.net/auth/k-service-auth-client.js"></script>',
    '<script src="/assets/chat-widget.js"></script>',
  ].join('\n');
}

let changed = 0, skipped = 0;

for (const page of PAGES) {
  const fp = path.join(ROOT, page.file);
  let html = fs.readFileSync(fp, 'utf8');

  if (html.includes(MARKER)) {
    console.log('skip (already attached): ' + page.file);
    skipped++;
    continue;
  }
  if (!html.includes(ANCHOR)) {
    console.error('ANCHOR not found, skipping: ' + page.file);
    continue;
  }

  const block = buildBlock(page);
  html = html.replace(ANCHOR, ANCHOR + '\n' + block);
  fs.writeFileSync(fp, html, 'utf8');
  console.log('attached: ' + page.file);
  changed++;
}

console.log('\n' + changed + ' file(s) updated, ' + skipped + ' skipped.');
