// 나비로 Navi Law(law.hondi.net) 연동 — 대화 화면 임베드 허용, 서비스 메뉴 링크, 초안 우선 시작 문구
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('expert-chat 임베드 — law.hondi.net 허용', () => {
  const chat = read('pages/expert-chat.html');
  it('부모 오리진은 같은 오리진과 law.hondi.net·tax.hondi.net 만 허용한다', () => {
    assert.ok(chat.includes("const _EMBED_PARENT_ORIGINS = [location.origin, 'https://law.hondi.net', 'https://tax.hondi.net', 'https://ip.hondi.net', 'https://doctor.hondi.net'];"));
    assert.ok(chat.includes('!_EMBED_PARENT_ORIGINS.includes(e.origin) || e.source !== window.parent'));
    assert.ok(!/e\.origin !== location\.origin \|\| e\.source !== window\.parent/.test(chat), '예전 같은 오리진 전용 검사가 남아 있다');
  });
  it('부모로 보내는 메시지(준비·답변)는 허용 목록 안의 오리진으로만 보낸다', () => {
    assert.ok(chat.includes("{ type: 'expert-embed-ready' }, _embedParentOrigin()"));
    assert.ok(chat.includes("{ type: 'expert-embed-reply', text: String(text || '') }, _embedParentOrigin()"));
    assert.ok(!chat.includes("type: 'expert-embed-ready' }, '*'") && !chat.includes("}, '*')"), "targetOrigin '*' 금지");
  });
  it('끼운 화면은 10분 무응답에도 부모 사이트를 떠나지 않는다', () => {
    assert.ok(chat.includes('if (!_embedOn()) setTimeout(() => { location.href = RETURN; }, 1500);'));
  });
});

describe('expert-chat 임베드 — 상단바가 대화를 가리지 않는다', () => {
  const chat = read('pages/expert-chat.html');
  it('embed=1 이고 iframe 안일 때만 html 에 embed 클래스를 붙인다(화면이 그려지기 전, head 에서)', () => {
    const head = chat.slice(0, chat.indexOf('</head>'));
    assert.ok(head.includes("get('embed')==='1'&&window.parent!==window)document.documentElement.classList.add('embed')"));
  });
  it('끼운 화면에서는 설명 문구·아이콘·나비로 버튼을 숨기고 상단바를 한 줄 얇게 줄인다', () => {
    assert.ok(chat.includes('html.embed #tb-icon, html.embed #tb-sub, html.embed #tb-back{display:none}'));
    assert.ok(/html\.embed #top-bar\{padding:6px 10px;/.test(chat));
    assert.ok(!/^#top-bar\{[^}]*display:none/m.test(chat), '일반 접속의 상단바는 그대로');
  });
  it('끼운 화면의 제안 및 질문은 새 탭으로 열려 대화창이 바뀌지 않는다', () => {
    assert.ok(chat.includes("_sg.target = '_blank'; _sg.rel = 'noopener';"));
  });
});

describe('hondi.net 서비스 메뉴 — 나비로 Navi Law', () => {
  it('K-Mail 다음에 law.hondi.net 링크가 있다', () => {
    const s = read('desktop.html'), pre = 'var MEGA_MENU_SECTIONS = ', i = s.indexOf(pre), j = s.indexOf(';\n', i);
    const arr = JSON.parse(s.slice(i + pre.length, j));
    const sec = arr.find((x) => x.label === '서비스' && x.items.length > 5);
    const labels = sec.items.map((x) => x.label);
    const k = labels.indexOf('K-Mail 체험하기 ↗');
    assert.equal(sec.items[k + 1].href, 'https://law.hondi.net');
    assert.equal(sec.items[k + 1].target, '_blank');
  });
});

describe('서류 작성 시작 문구 — 법무사·변호사는 초안 우선', () => {
  const js = read('assets/scrivener-write.js');
  it('법무사·변호사 보조 AI 는 묻지 말고 빈 칸으로 남기라고 시작한다', () => {
    assert.ok(js.includes("/^(judicial-scrivener|lawyer|patent-attorney)/.test(PID) ? '모르는 항목은 묻지 말고 빈 칸으로 남긴 뒤 초안 아래 빈 칸 표로 알려 주세요.'"));
  });
  it('다른 직역은 기존 문구(3개 이내로 되묻기)를 그대로 쓴다', () => {
    assert.ok(js.includes("'부족한 항목은 3개 이내로 먼저 물어봐 주세요.'"));
  });
});

describe('GWP — 나비로 Navi Law 등록(PDV 자동 기입 경로)', () => {
  it('registry 에 tab 서비스로 등록되고 PDV·서명 출처 허용 목록에 law.hondi.net 이 있다', () => {
    const reg = read('gwp-registry.js'), k = reg.indexOf("id: 'navilaw'");
    assert.ok(k > 0);
    const block = reg.slice(k, reg.indexOf('},', k));
    assert.match(block, /type: 'tab'/); assert.match(block, /url: 'https:\/\/law\.hondi\.net\/'/); assert.match(block, /status: 'active'/);
    assert.ok(read('src/gopang/gwp/allowed-origins.js').includes("'https://law.hondi.net'"));
  });
});

describe('나비 특허 Navi Patent(ip.hondi.net) 연동', () => {
  it('registry 에 tab 서비스로 등록되고 PDV·서명 출처 허용 목록에 ip.hondi.net 이 있다', () => {
    const reg = read('gwp-registry.js'), k = reg.indexOf("id: 'navipatent'");
    assert.ok(k > 0);
    const block = reg.slice(k, reg.indexOf('},', k));
    assert.match(block, /type: 'tab'/); assert.match(block, /url: 'https:\/\/ip\.hondi\.net\/'/); assert.match(block, /status: 'active'/);
    assert.ok(read('src/gopang/gwp/allowed-origins.js').includes("'https://ip.hondi.net'"));
  });
  it('서비스 메뉴에 ip.hondi.net 링크가 있다', () => {
    const s = read('desktop.html'), pre = 'var MEGA_MENU_SECTIONS = ', i = s.indexOf(pre), j = s.indexOf(';\n', i);
    const arr = JSON.parse(s.slice(i + pre.length, j));
    const it = arr.flatMap((x) => x.items).find((x) => x.href === 'https://ip.hondi.net');
    assert.ok(it && it.target === '_blank');
  });
  it('끼운 서류 작성은 변리사(+세부 분야 10개) 전문가용 SP 를 쓴다', () => {
    const chat = read('pages/expert-chat.html');
    assert.ok(chat.includes("  'patent-attorney',"));
    assert.ok(chat.includes("_PRO_WRITE_PERSONAS.add('patent-attorney-' + s)"));
    for (const f of ['mechanical-electrical', 'chemistry-materials', 'bio-pharma', 'it-software', 'trademark', 'design', 'trial-litigation', 'pct-international', 'ip-strategy', 'licensing']) {
      assert.ok(chat.includes("'" + f + "'"), f);
      assert.ok(existsSync(join(ROOT, 'prompts/SP_patent-attorney-' + f + '-assistant_v1_0.md')), f + ' 보조 SP');
    }
  });
});
