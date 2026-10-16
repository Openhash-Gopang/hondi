/**
 * appraiser_chat_start.test.js — 감정평가사 보조 AI 페이지의 「대화로 서류 작성 시작하기」 흐름(2026-10-17)
 *
 * 정적 검사(의존성 없음): 페이지·위젯·CSS에 필요한 요소가 들어 있는지만 본다.
 * 실제 동작(슬라이드 패널 열림, 마이크, 첨부, SP 호출)은 브라우저 환경이 필요해 이 파일 범위 밖이다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('감정평가사 보조 AI — 시작 영역(감정 평가·방법론 + 입력창)', () => {
  const page = read('pages/appraiser.html');
  const widget = read('assets/chat-widget.js');
  const css = read('assets/pro-doc-page.css');

  it('A-01: 상단 경고는 짧은 문구 하나뿐이고 본문(doc-intro)에 노란 경고문이 없다', () => {
    assert.ok(/disclaimer:\s*'[^']*단독으로 기능하지 않는다[^']*검토·확정 전에는 사용할 수 없다[^']*'/.test(page), '상단 경고 문구(문자열)가 없음');
    const intro = page.slice(page.indexOf('<div class="doc-intro">'), page.indexOf('<div class="doc-toolbar'));
    assert.ok(!intro.includes('svc-callout important'), 'doc-intro 안에 노란 경고문이 남아 있음');
  });

  it('A-02: 시작 영역에 탭 2개·입력창·첨부·마이크가 있고 위젯 공개 API(open/send)를 호출한다', () => {
    assert.ok(page.includes('id="startBox"') && page.includes('>감정 평가<') && page.includes('>방법론<'), '탭 2개 없음');
    assert.ok(page.includes('id="startInput"') && page.includes('id="startAttach"') && page.includes('id="startMic"'), '입력창/첨부/마이크 없음');
    assert.ok(!page.includes('id="startChat"') && !page.includes('start-chat-btn'), '옛 시작 버튼이 남아 있음');
    assert.ok(/HondiChatWidget/.test(page) && /W\(\)\.open\(\)/.test(page) && /W\(\)\.send\(/.test(page), '위젯 open/send 호출 없음');
    assert.ok(page.includes("classList.add('has-start-field')"), '말풍선 숨김 클래스 없음');
  });

  it('A-02b: 경고문에 「다시 보지 않기」(옵트인)가 있고 다른 페이지 동작은 그대로다', () => {
    assert.ok(page.includes("disclaimerDismissKey: 'appraiser'"), '이 페이지의 다시 보지 않기 키 없음');
    const hdr = read('assets/ph-header.js');
    assert.ok(hdr.includes('다시 보지 않기') && hdr.includes('ph-disclaimer-x') && hdr.includes('localStorage'), '헤더에 다시 보지 않기 구현 없음');
    assert.ok(/dismissible\s*=\s*typeof config\.disclaimerDismissKey === 'string'/.test(hdr), '옵트인 조건이 아님');
    const other = read('pages/nurse.html');
    assert.ok(!other.includes('disclaimerDismissKey'), '다른 페이지에 옵션이 새어 들어감');
  });

  it('A-03: 감정평가사 SP를 쓰고 슬라이드·마이크 옵션을 켠다', () => {
    assert.ok(page.includes('sp: "SP_appraiser-assistant"'), 'SP_appraiser-assistant 키가 아님');
    assert.ok(page.includes('panelMode: "slide"') && page.includes('mic: true'), '슬라이드/마이크 옵션 없음');
    const catalog = JSON.parse(read('prompts/sp-catalog.json'));
    assert.ok(catalog['SP_appraiser-assistant'], 'sp-catalog.json 에 SP_appraiser-assistant 키 없음');
    assert.ok(read('prompts/' + catalog['SP_appraiser-assistant']).length > 50, 'SP 파일이 비어 있음');
  });

  it('A-04: 위젯이 슬라이드·마이크·카메라 옵션을 지원하고 기본값은 기존 동작이다', () => {
    assert.ok(/panelMode:\s*'popup',\s*mic:\s*false,\s*camera:\s*true/.test(widget), '새 옵션의 기본값이 기존 동작이 아님');
    assert.ok(widget.includes("CFG.panelMode === 'slide'") && widget.includes("id = 'hcw-mic'") && widget.includes("lang = 'ko-KR'"), '슬라이드/마이크 구현 없음');
  });

  it('A-05: 공용 CSS에 알약형 탭·입력창 규칙과 슬라이드 패널 규칙이 있다', () => {
    assert.ok(/\.start-tabs\s*\{[^}]*border-radius:\s*999px/.test(css), '탭 묶음 알약 스타일 없음');
    assert.ok(/\.start-tab\.active\s*\{[^}]*background:\s*#ffffff/.test(css), '활성 탭 스타일 없음');
    assert.ok(/\.start-field\s*\{[^}]*border-radius:\s*999px/.test(css), '입력창 알약 스타일 없음');
    assert.ok(css.includes('body.has-start-field #hcw-fab { display: none; }'), 'FAB 숨김 규칙 없음');
    assert.ok(widget.includes('#hcw-panel.hcw-slide.open{visibility:visible;transform:translateX(0)'), '슬라이드 열림 규칙 없음');
  });
});
