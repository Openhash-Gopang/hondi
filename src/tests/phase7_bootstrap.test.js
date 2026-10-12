/**
 * phase7_bootstrap.test.js — Phase 7 부트스트랩 + Shell UI 테스트
 * B-01~B-09
 *
 * ⚠️ 2026-07-18 결정 사항(PART H 조사 후 주피터님 확인) ─────────────────
 * 여기서 검증하는 registry/ShellUI/plugin-registry.js 체계는 "나비 v2"
 * 시절(K서비스가 klaw·khealth 2개뿐이던 초기 아키텍처, src/app.js 파일
 * 자체 주석에도 "v2 부트스트랩 진입점 v3"라 명시)의 유산이다. 지금은
 * GWP_REGISTRY(28개 서비스 라우팅 테이블) + SP 파일 + 18개 개별 K서비스
 * 저장소 체계가 이 역할을 완전히 대체했다 — src/app.js가 하드코딩으로
 * 아는 플러그인은 여전히 KLawPlugin/KHealthPlugin 딱 2개뿐이다.
 *
 * 실측 결과: `gopang-app.js`(webapp.html이 로드하는 실제 진입점)의
 * `_boot()`가 지금도 매 페이지 로드마다 `src/app.js`의 `bootstrap()`을
 * 동적 import로 호출하고는 있으나(죽은 코드는 아님), 그 마지막 단계인
 * `ShellUI.render()`가 찾는 DOM 루트 `#gopang-shell`이 webapp.html/
 * desktop.html 어디에도 없어 `_renderDOM()`의 `if (!root) return` 가드에
 * 걸려 매번 조용히 아무 일도 안 하고 끝난다. webapp.html은 `#message-list`/
 * `#status-dot`/`#tab-bar` 등 자기 UI를 이미 손으로 다 구현해놨고, 이
 * registry/ShellUI 결과를 전혀 소비하지 않는다.
 *
 * 결정: (1) 이 파일은 살려두되 실제 index.html 구조(기기 판별 리다이렉터,
 * 아래 B-03 참고)에 맞게 최소 수정만 한다 — B-01/02/04~09는 여전히
 * src/app.js·shell-ui.js 자체의 내부 로직(부트 순서, 이중호출 방지 등)을
 * 검증하는 것이라 유효하다. (2) `gopang-app.js`의 `bootstrap()` 호출부와
 * `src/app.js`/`shell-ui.js`/`core/plugin-registry.js` 자체를 통째로
 * 제거하는 정리 작업은 **의도적으로 보류**한다 — 이건 프로덕션 엔트리
 * 파일(`gopang-app.js`)을 건드리는 리팩토링이라 A1-3(core/auth.js 의존성
 * 방향 위반)과 같은 수준의 신중함이 필요하다. 착수 시 아래 세 가지를
 * 함께 지워야 한다: `gopang-app.js`의 `await import('./src/app.js')` +
 * `await bootstrap()` 호출부(_boot 함수 4-1 단계), `src/app.js` 전체,
 * `src/shell-ui.js` 전체(둘 다 이 테스트 외 다른 곳에서 import되지 않음,
 * 2026-07-18 grep 확인). 원하시면 별도 세션에서 진행.
 * ───────────────────────────────────────────────────────────────────
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ── 모의 의존성 (브라우저 API 없는 Node 환경) ──────────────

// EventBus 모의
const _handlers = {};
const MockEventBus = {
  _events: [],
  init() {},
  on(event, fn) {
    _handlers[event] = _handlers[event] || [];
    _handlers[event].push(fn);
  },
  emit(event, data) {
    this._events.push({ event, data });
    (_handlers[event] || []).forEach(fn => { try { fn(data); } catch {} });
  },
  off(event, fn) {
    if (_handlers[event]) _handlers[event] = _handlers[event].filter(h => h !== fn);
  },
};

// PluginRegistry 모의
class MockRegistry {
  constructor() { this._plugins = []; }
  async init() {}
  async register(plugin) { this._plugins.push(plugin); }
  list() { return [...this._plugins]; }
}

// 레이어 모의
const LayerMock = { init: async () => {} };

// 플러그인 모의
class MockPlugin {
  constructor(name, icon, label) {
    this.name = name;
    this.metadata = { icon, label };
  }
  async init() {}
}

// ── 테스트 ─────────────────────────────────────────────────

describe('Phase 7 — 부트스트랩 + Shell UI', () => {

  // ── B-01: app.js 파일 존재 확인 ──────────────────────────
  it('B-01: app.js 파일이 존재한다', () => {
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    assert.ok(content.length > 0, 'app.js가 비어 있음');
  });

  // ── B-02: shell-ui.js 파일 존재 확인 ─────────────────────
  it('B-02: shell-ui.js 파일이 존재한다', () => {
    const content = readFileSync(join(ROOT, 'src/shell-ui.js'), 'utf8');
    assert.ok(content.length > 0, 'shell-ui.js가 비어 있음');
  });

  // ── B-03: index.html — 기기 판별 리다이렉터 구성요소 ──────
  // (2026-07-18 수정: 2026-05-30 아키텍처 개편으로 index.html은 더 이상
  //  Shell UI 마운트 지점이 아니라, 기기 판별 후 webapp.html(모바일/SSO)
  //  또는 desktop.html(PC 정적 랜딩)로 즉시 리다이렉트만 하는 라우터
  //  페이지다. #gopang-shell/#boot-splash/src/app.js 참조는 더 이상
  //  존재하지 않는 게 정상이므로, 실제 역할에 맞는 항목으로 교체했다.)
  it('B-03: index.html이 기기 판별 후 webapp.html/desktop.html로 리다이렉트한다', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    assert.ok(html.includes('webapp.html'),          'webapp.html(모바일/SSO 진입점) 리다이렉트 대상 없음');
    assert.ok(html.includes('desktop.html'),         'desktop.html(PC 정적 랜딩) 리다이렉트 대상 없음');
    assert.ok(html.includes('window.location.replace'), '리다이렉트 로직(location.replace) 없음');
  });

  // ── B-04: bootstrap() 부트 순서 (코어→레이어→플러그인→AI→네트워크→UI) ──
  it('B-04: bootstrap() 부트 순서가 올바르다', () => {
    // BUG-011 수정 후 실제 구조 반영:
    //   PDV/OpenHash/Network/GDC/Privacy는 개별 함수 export → init() 없음
    //   AIPipeline → runPipeline 함수 → init() 없음
    //   순서 검증: registry.init → registry.register → ShellUI.render
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const registryIdx = content.indexOf('registry.init');
    const pluginIdx   = content.indexOf('registry.register');
    const uiIdx       = content.indexOf('ShellUI.render');

    assert.ok(registryIdx > -1,          'registry.init 호출이 있어야 함');
    assert.ok(pluginIdx   > -1,          'registry.register 호출이 있어야 함');
    assert.ok(uiIdx       > -1,          'ShellUI.render 호출이 있어야 함');
    assert.ok(registryIdx < pluginIdx,   'registry.init이 플러그인 등록보다 앞이어야 함');
    assert.ok(pluginIdx   < uiIdx,       '플러그인 등록이 UI render보다 앞이어야 함');
  });

  // ── B-05: bootstrap() 중복 호출 방지 ─────────────────────
  it('B-05: bootstrap() 동시 이중 호출 시 오류 발생', async () => {
    // app.js를 직접 import하면 실제 의존성이 필요하므로
    // 부트 상태 로직만 검증 (소스 코드 분석)
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    assert.ok(
      content.includes('already in progress') || content.includes('BOOTING'),
      'bootstrap() 이중 호출 방지 로직 없음'
    );
  });

  // ── B-06: ShellUI.render() 플러그인 → 탭 생성 ────────────
  it('B-06: ShellUI.getState()가 플러그인 목록을 반영한다', async () => {
    // shell-ui.js import (EventBus 모의 주입)
    // Node 환경: document 없으므로 DOM 작업 생략, 상태만 검증
    const { ShellUI } = await import(join(ROOT, 'src/shell-ui.js'));

    const plugins = [
      new MockPlugin('k-law',    '⚖️', 'K-Law'),
      new MockPlugin('k-health', '🏥', 'K-Health'),
    ];

    await ShellUI.render(plugins);
    const state = ShellUI.getState();

    assert.equal(state.plugins.length, 2, '플러그인 2개가 상태에 반영되어야 함');
    assert.equal(state.isBooted, true, 'isBooted가 true이어야 함');
  });

  // ── B-07: ShellUI.switchTab() 활성 탭 변경 ───────────────
  it('B-07: switchTab()이 activeTab을 변경한다', async () => {
    const { ShellUI } = await import(join(ROOT, 'src/shell-ui.js'));

    ShellUI.switchTab('k-health');
    const state = ShellUI.getState();
    assert.equal(state.activeTab, 'k-health', 'activeTab이 k-health이어야 함');

    ShellUI.switchTab('k-law');
    const state2 = ShellUI.getState();
    assert.equal(state2.activeTab, 'k-law', 'activeTab이 k-law이어야 함');
  });

  // ── B-08: app.js가 코어를 import하고 domain을 동적 등록한다 ─
  it('B-08: app.js import 구문에 core + domain 모두 포함된다', () => {
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    // import 구문만 추출 (주석 제외)
    const importLines = content.split('\n')
      .filter(l => l.trim().startsWith('import '));

    const hasCore   = importLines.some(l => l.includes('./core/'));
    const hasDomain = importLines.some(l => l.includes('./domains/'));
    const hasUI     = importLines.some(l => l.includes('./shell-ui'));

    assert.ok(hasCore,   'core import 없음');
    assert.ok(hasDomain, 'domain import 없음');
    assert.ok(hasUI,     'shell-ui import 없음');
  });

  // ── B-09: PLATFORM_READY 이벤트 emit 확인 ────────────────
  it('B-09: app.js에 PLATFORM_READY 이벤트 발행 코드가 있다', () => {
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    assert.ok(
      content.includes('PLATFORM_READY') || content.includes('EVENTS.PLATFORM_READY'),
      'PLATFORM_READY 이벤트 발행 없음'
    );
  });

});
