// 나비로 Navi Law(law.hondi.net) 연동 — 대화 화면 임베드 허용, 서비스 메뉴 링크, 초안 우선 시작 문구
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('expert-chat 임베드 — law.hondi.net 허용', () => {
  const chat = read('pages/expert-chat.html');
  it('부모 오리진은 같은 오리진과 law.hondi.net 만 허용한다', () => {
    assert.ok(chat.includes("const _EMBED_PARENT_ORIGINS = [location.origin, 'https://law.hondi.net'];"));
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
    assert.ok(js.includes("/^(judicial-scrivener|lawyer)/.test(PID) ? '모르는 항목은 묻지 말고 빈 칸으로 남긴 뒤 초안 아래 빈 칸 표로 알려 주세요.'"));
  });
  it('다른 직역은 기존 문구(3개 이내로 되묻기)를 그대로 쓴다', () => {
    assert.ok(js.includes("'부족한 항목은 3개 이내로 먼저 물어봐 주세요.'"));
  });
});
