/**
 * expert-write-c.test.mjs — 계열 C(건축·공학·안전·해사·측량) 12개 직역 「서류 작성하기」(STEP W) 정적 검사 (2026-10-21)
 * 제출형(pages/scrivener-write.html): 건축사·산업안전·보건지도사·소방시설관리사·조경기술사·측량기술사·전기안전기술사·가스기술사. 기록형(pages/expert-write.html): 기술사·조선사·항해사·기관사·기상예보사.
 * 확인하는 것: 헤더 버튼·화면 등록·expert-chat 전문가용 직역 목록 · SP 의 STEP W(W-1~W-9)와 상태 줄 · 사람이 하는 일과 dpaper 미연동 문구 ·
 * §LEGAL-LIMIT·§0-2·부록 A 가 직전 버전과 같음 · 일반인용 SP 에는 STEP W 가 없음. (실제 대화·로그인은 브라우저가 필요해 범위 밖)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const catalog = JSON.parse(read('prompts/sp-catalog.json'));
// [id, 직역, 유형, 직전 버전 파일] — 해사 도선사(marine-pilot)는 보조 AI SP 가 없어 이번 범위에서 제외
const JOBS = [
  ['architect', '건축사', 'submit', 'SP_architect-assistant_v1_0.md'],
  ['industrial-safety-consultant', '산업안전·보건지도사', 'submit', 'SP_industrial-safety-consultant-assistant_v1_0.md'],
  ['fire-safety-manager', '소방시설관리사', 'submit', 'SP_fire-safety-manager-assistant_v1_0.md'],
  ['landscape-engineer', '조경기술사', 'submit', 'SP_landscape-engineer-assistant_v1_0.md'],
  ['surveying-engineer', '측량 및 지형공간정보기술사', 'submit', 'SP_surveying-engineer-assistant_v1_0.md'],
  ['electrical-safety-engineer', '전기안전기술사', 'submit', 'SP_electrical-safety-engineer-assistant_v1_0.md'],
  ['gas-safety-engineer', '가스기술사', 'submit', 'SP_gas-safety-engineer-assistant_v1_0.md'],
  ['professional-engineer', '기술사', 'record', 'SP_professional-engineer-assistant_v1_0.md'],
  ['naval-architect', '조선사', 'record', 'SP_naval-architect-assistant_v1_0.md'],
  ['navigation-officer', '항해사', 'record', 'SP_navigation-officer-assistant_v1_0.md'],
  ['marine-engineer', '기관사(선박)', 'record', 'SP_marine-engineer-assistant_v1_0.md'],
  ['weather-forecaster', '기상예보사', 'record', 'SP_weather-forecaster-assistant_v1_0.md'],
];
const jsSubmit = read('assets/scrivener-write.js');
const jsRecord = read('assets/expert-write.js');
const chat = read('pages/expert-chat.html');
const gen = read('scripts/gen-expert-pages.py');

for (const [pid, role, kind, prevFile] of JOBS) {
  describe(`${role} 서류 작성하기 (${kind})`, () => {
    const file = catalog[`SP_${pid}-assistant`];
    const sp = read('prompts/' + file);
    const prev = read('prompts/' + prevFile);
    const page = read(`pages/${pid}.html`);
    const win = kind === 'submit' ? 'scrivener-write' : 'expert-write';
    it('헤더 버튼과 안내 줄이 서류 작성 화면을 가리키고 그 화면이 이 직역을 알고 있다', () => {
      assert.ok(new RegExp(`heroButton: \\{ label: '서류 작성하기', href: ["']/pages/${win}\\.html\\?persona=${pid}["']`).test(page));
      assert.ok(page.includes(`/pages/${win}.html?persona=${pid}">서류 작성하기 화면으로 이동`));
      assert.ok(existsSync(join(ROOT, `pages/${win}.html`)));
      const js = kind === 'submit' ? jsSubmit : jsRecord;
      assert.ok(js.includes(`'${pid}': {`) && js.includes(`role: '${role}'`) && js.includes(`back: '/pages/${pid}.html'`));
      assert.ok(read(`pages/${win}.html`).includes(`persona=${pid}">${role} 보조 AI`));
      if (kind === 'record') assert.ok(gen.includes(`'${pid}': '${role}'`));
    });
    it('expert-chat 이 이 직역에 보조 AI SP 와 전문가 인증 경로를 적용한다', () => {
      const set = /const _PRO_WRITE_PERSONAS = new Set\(\[([\s\S]*?)\]\);/.exec(chat);
      assert.ok(set && set[1].includes(`'${pid}'`));
    });
    it('카탈로그가 STEP W 가 들어간 새 버전을 가리키고 직전 버전 파일은 남아 있다', () => {
      assert.notEqual(file, prevFile);
      assert.ok(existsSync(join(ROOT, 'prompts', prevFile)));
      const ver = (f) => f.match(/_v(\d+)_(\d+)\.md$/).slice(1).map(Number);
      const [a, b] = ver(file), [c, d] = ver(prevFile);
      assert.ok(a > c || (a === c && b > d));
      assert.ok(sp.split('\n')[0].endsWith(` 보조 AI v${a}.${b}`));
    });
    it('SP에 STEP W 9단계와 상태 줄 형식이 있다', () => {
      assert.equal((sp.match(/^## STEP W — 서류 작성 트랙/gm) || []).length, 1);
      for (let n = 1; n <= 9; n++) assert.ok(new RegExp(`^### W-${n}\\. `, 'm').test(sp), `W-${n} 절`);
      assert.ok(sp.includes(`[${role} 보조 AI | 서류 작성 트랙 | 현재: W-n |`));
      const at = (re) => sp.search(re);
      assert.ok(at(/^## STEP D /m) < at(/^## STEP W — /m) && at(/^## STEP W — /m) < at(/^## 부록 A — /m));
    });
    it('사람이 하는 일을 명시하고 dpaper는 미연동이라고 밝힌다', () => {
      const sec = sp.slice(sp.search(/^## STEP W — /m), sp.search(/^## 부록 A — /m));
      const ll = sp.slice(sp.indexOf('## §LEGAL-LIMIT'), sp.indexOf('## 0. IDENTITY'));
      if (kind === 'submit') {
        const n = /\n(\d)\. \*\*[^*]*제출[^*]*대행[^*]*\*\*/.exec(ll)[1];
        const m = /\n(\d)\. \*\*타인[^*]*서류 대행\*\*/.exec(ll)[1];
        assert.ok(sec.includes(`(§LEGAL-LIMIT ${m}). 타인을 위한 서류`));
        assert.ok(sec.includes(`제출(W-7)·납부(W-8)·기명날인은 ${role} 또는 이용자 본인이 자신의 인증으로 직접 하고, 이 도구는 하지 않는다(§LEGAL-LIMIT ${n})`));
      } else {
        const n = /\n(\d)\. \*\*서명/.exec(ll)[1];
        assert.ok(sec.includes(`**전문 판단은 ${role}가 한다.**`));
        assert.ok(sec.includes(`저장·교부·신고(W-7)·청구(W-8)와 서명·날인은 ${role}가 자신의 인증으로 직접 하고, 이 도구는 하지 않는다(§LEGAL-LIMIT ${n})`));
        const t3 = /\n3\. \*\*([^*]+)\*\*/.exec(ll)[1];
        assert.ok(sec.includes(`§LEGAL-LIMIT 3(${t3})도 이 트랙에 그대로 적용한다.`));
      }
      assert.ok(sec.includes('dpaper API 연동은 아직 승인·개통되지 않았다(미연동)'));
      assert.ok(sec.includes('FORM_LOOKUP') && sec.includes('FORM_SAVE_PROPOSAL'));
      for (const m of sec.matchAll(/CONNECT_HUMAN_EXPERT[^\n]*/g)) assert.ok(m[0].includes('출력하지 않는다'));
    });
    it('§LEGAL-LIMIT·§0-2·부록 A 는 직전 버전과 같다', () => {
      const cut = (t, a, b) => t.slice(t.indexOf(a), t.indexOf(b));
      assert.equal(cut(sp, '## §LEGAL-LIMIT', '## 0. IDENTITY'), cut(prev, '## §LEGAL-LIMIT', '## 0. IDENTITY'));
      assert.equal(cut(sp, '## 0-2.', '## 0-3.'), cut(prev, '## 0-2.', '## 0-3.'));
      assert.equal(sp.slice(sp.indexOf('## 부록 A —'), sp.indexOf('## 윤리 가드레일')), prev.slice(prev.indexOf('## 부록 A —'), prev.indexOf('## 윤리 가드레일')));
    });
    it('일반인용 상담 SP 에는 STEP W 가 들어가지 않았다', () => {
      assert.ok(!/^## STEP W — /m.test(read('prompts/' + catalog[`SP_${pid}`])));
    });
  });
}
