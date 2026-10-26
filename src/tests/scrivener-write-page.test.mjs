/**
 * scrivener-write-page.test.mjs — 법무사·행정사 「서류 작성하기」(STEP W) 정적 검사 (2026-10-21)
 * 확인하는 것: 두 직역 페이지의 헤더 버튼이 존재하는 화면을 가리킴 · SP에 STEP W(W-1~W-9)와 상태 줄 형식이 있음 ·
 * 화면의 상태 줄 정규식이 SP가 정한 형식을 읽음 · 승인·제출·납부를 AI가 하지 않는다는 규율과 dpaper 미연동 표기가 SP·화면에 있음 ·
 * expert-chat 임베드 연결이 화면의 메시지 규약과 같음. (실제 대화·로그인은 브라우저가 필요해 범위 밖)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const catalog = JSON.parse(read('prompts/sp-catalog.json'));
// [직역 id, 카탈로그 키, 직역명, §LEGAL-LIMIT 비교용 직전 SP 파일, 페이지 헤더 버튼 필드]
const JOBS = [
  ['judicial-scrivener', 'SP_judicial-scrivener', '법무사', 'SP_judicial-scrivener_v3_2.md', 'heroButton'],
  ['administrative-scrivener', 'SP_administrative-scrivener', '행정사', 'SP_administrative-scrivener_v1_2.md', 'heroButton'],
  // 2026-10-27 변호사 — 페이지에 이미 버튼 둘(가상 판결문 생성하기·LLM 성능 평가)이 있어 셋째 버튼(heroButton3)으로 붙는다.
  ['lawyer', 'SP_lawyer', '변호사', 'SP_lawyer-assistant_v1_0.md', 'heroButton3'],
];
const js = read('assets/scrivener-write.js');
const html = read('pages/scrivener-write.html');
const chat = read('pages/expert-chat.html');
const statusRe = /\[[^\]|]*보조 AI\s*\|\s*서류 작성 트랙\s*\|\s*현재:\s*W-([1-9])([^\]]*)\]/;

for (const [pid, key, role, prevSp, btn] of JOBS) {
  describe(`${role} 서류 작성하기`, () => {
    const page = read(`pages/${pid}.html`);
    const sp = read('prompts/' + catalog[key + '-assistant']);   // 서류 작성 도구는 전문가용(-assistant) SP 에만 있다(2026-10-21 분리)
    it('헤더 버튼이 서류 작성 화면을 가리키고 그 화면이 이 직역을 알고 있다', () => {
      assert.ok(page.includes(`${btn}: { label: `) && page.includes(`href: "/pages/scrivener-write.html?persona=${pid}"`) || page.includes(`${btn}: { label: '서류 작성하기', href: '/pages/scrivener-write.html?persona=${pid}'`));
      assert.ok(existsSync(join(ROOT, 'pages/scrivener-write.html')));
      assert.ok(js.includes(`'${pid}': {`) && js.includes(`role: '${role}'`));
    });
    it('SP에 STEP W 9단계와 상태 줄 형식이 있다', () => {
      assert.equal((sp.match(/^## STEP W — 서류 작성 트랙/gm) || []).length, 1);
      for (let n = 1; n <= 9; n++) assert.ok(new RegExp(`^### W-${n}\\. `, 'm').test(sp), `W-${n} 절`);
      assert.ok(sp.includes(`[${role} 보조 AI | 서류 작성 트랙 | 현재: W-n |`));
      const at = (re) => sp.search(re);
      assert.ok(at(/^## STEP D /m) < at(/^## STEP W — /m) && at(/^## STEP W — /m) < at(/^## 부록 A — /m), '절 순서: STEP D → STEP W → 부록 A');
    });
    it('SP가 정한 상태 줄 형식을 화면의 정규식이 읽는다', () => {
      const sample = `[${role} 보조 AI | 서류 작성 트랙 | 현재: W-6 | 서류: 테스트서류 | 서식: 신규 | 게이트: 서류 승인 대기]`;
      const m = statusRe.exec(sample);
      assert.ok(m && m[1] === '6');
      assert.ok(js.includes('서류 작성 트랙\\s*\\|\\s*현재:\\s*W-([1-9])'));
    });
    it('승인·제출·납부는 사람이 하고 dpaper는 미연동이라고 밝힌다', () => {
      assert.ok(/제출\(W-7\)·납부\(W-8\)·기명날인은 .+직접 하고, 이 도구는 하지 않는다/.test(sp));
      assert.ok(sp.includes('dpaper API 연동은 아직 승인·개통되지 않았다(미연동)'));
      assert.ok(sp.includes('FORM_LOOKUP') && sp.includes('FORM_SAVE_PROPOSAL'));
      const sec = sp.slice(sp.search(/^## STEP W — /m), sp.search(/^## 부록 A — /m));
      for (const m of sec.matchAll(/CONNECT_HUMAN_EXPERT[^\n]*/g)) assert.ok(m[0].includes('출력하지 않는다'), 'STEP W 가 소개·연결 태그를 쓰게 하면 안 됨');
    });
    it('SP의 §LEGAL-LIMIT 절은 직전 버전과 같다', () => {
      const cut = (t) => t.slice(t.indexOf('## §LEGAL-LIMIT'), t.indexOf('## 0. IDENTITY'));
      assert.equal(cut(sp), cut(read('prompts/' + prevSp)));
    });
  });
}

describe('변호사 서류 작성하기 — 변호사 전용·전문 판단 규율', () => {
  const sp = read('prompts/' + catalog['SP_lawyer-assistant']);
  const sec = sp.slice(sp.search(/^## STEP W — /m), sp.search(/^## 부록 A — /m));
  it('화면이 변호사를 알고, 일반 이용자(본인 사안) 선택지를 두지 않는다', () => {
    assert.ok(js.includes("'lawyer': {") && js.includes("proOnly: true"));
    assert.ok(js.includes('if (P.proOnly)'));
    assert.ok(html.includes('?persona=lawyer'));
  });
  it('서류 작성 대화는 전문가용 SP 로 열리고 서버 게이트 코드가 변호사에 매핑돼 있다', () => {
    assert.ok(/_PRO_WRITE_PERSONAS = new Set\(\[[^\]]*'lawyer'/s.test(chat));
    assert.ok(sp.startsWith('# SP-LAW-01A ·'));
    assert.ok(read('src/worker/assistant-sp-codes.js').includes('"SP-LAW-01A": "lawyer"'));
  });
  it('STEP W 가 변호사 전용·전문 판단 비대행·기한 우선·가상 판결문 참고자료 규율을 담는다', () => {
    assert.ok(sec.includes('변호사 전용 트랙') && sec.includes('L0·L1'));
    assert.ok(sec.includes('전문 판단은 변호사의 것이다') && sec.includes('[변호사 기재: …]'));
    assert.ok(sec.includes('기한이 먼저다'));
    assert.ok(sec.includes('K-Law 가상 판결문은 참고자료일 뿐이다'));
  });
  it('K-Law 고지 문구를 STEP W 안에서 되풀이하지 않는다(한 번만)', () => {
    assert.ok((sec.match(/법률 자문 아님/g) || []).length === 0);
    assert.ok((sec.match(/법적 효력/g) || []).length <= 1);
  });
  it('헤더가 셋째 버튼을 그린다', () => {
    const ph = read('assets/ph-header.js');
    assert.ok(ph.includes('heroButton3') && ph.includes('ph-hero-cta-3'));
  });
});

describe('변호사 세부 분야 서류 작성하기 (2026-10-27)', () => {
  const ids = readdirSync(join(ROOT, 'data/assistant-child-sp')).filter((f) => /^lawyer-.+\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));
  it('세부 분야가 46개이고 데이터에 write(서식 후보·기한)가 있다', () => {
    assert.equal(ids.length, 46);
    for (const id of ids) {
      const d = JSON.parse(read('data/assistant-child-sp/' + id + '.json'));
      assert.ok(d.write && d.write.forms.length >= 5, id + ': forms');
      assert.ok(d.write.deadlines.length >= 1, id + ': deadlines');
      assert.ok(d.write.forms.every((r) => r.length === 3) && d.write.deadlines.every((r) => r.length === 2), id + ': 행 모양');
    }
  });
  it('각 분야 페이지에 서류 작성하기 버튼이 있고, 화면·대화 화면이 그 분야를 안다', () => {
    const js2 = read('assets/scrivener-write.js');
    const chat2 = read('pages/expert-chat.html');
    for (const id of ids) {
      const page = read('pages/' + id + '.html');
      assert.ok(page.includes('heroButton3: { label: "서류 작성하기", href: "/pages/scrivener-write.html?persona=' + id + '"'), id + ': 버튼');
      assert.ok(js2.includes("'" + id + "':"), id + ': 화면 persona');
      assert.ok(chat2.includes("'" + id.slice('lawyer-'.length) + "'"), id + ': 대화 화면');
    }
  });
  it('각 분야 전문가용 SP 가 부모 STEP W 를 담고 부록 A 끝에 보강 절이 있으며 고지 문구를 되풀이하지 않는다', () => {
    for (const id of ids) {
      const f = catalog['SP_' + id + '-assistant'];
      assert.ok(/_v1_1\.md$/.test(f), id + ': v1_1');
      const sp = read('prompts/' + f);
      assert.equal((sp.match(/^## STEP W — 서류 작성 트랙/gm) || []).length, 1, id + ': STEP W');
      assert.ok(/^### A-\d+\. .+ 서류 작성하기 보강/m.test(sp), id + ': 보강 절');
      const sec = sp.slice(sp.search(/^### A-\d+\. .+ 서류 작성하기 보강/m), sp.search(/^## 부록 B/m));
      assert.ok(!/법률 자문 아님|법적 효력/.test(sec), id + ': 고지 반복');
      assert.ok(sp.indexOf('## STEP W') < sp.indexOf('## 부록 A'), id + ': 순서');
    }
  });
});

describe('서류 작성 화면과 대화 화면 연결', () => {
  it('화면은 dpaper 미연동과 제출 버튼 비활성을 표시한다', () => {
    assert.ok(html.includes('dpaper 연동: 미연동'));
    assert.ok(js.includes('dpaper로 제출 (미연동)') && js.includes('disabled title='));
  });
  it('메시지 규약이 두 쪽에서 같다', () => {
    for (const t of ['expert-embed-send', 'expert-embed-reply', 'expert-embed-ready']) { assert.ok(js.includes(t), t + ' (화면)'); assert.ok(chat.includes(t), t + ' (대화)'); }
    assert.ok(chat.includes("_qs.get('embed') === '1'") && chat.includes('e.source !== window.parent'));
    assert.equal((chat.match(/_embedReply\(full\);/g) || []).length, 2);
  });
  it('9단계가 모두 정의되어 있다', () => {
    for (let n = 1; n <= 9; n++) assert.ok(js.includes(`k: 'W-${n}'`), `W-${n}`);
  });
});
