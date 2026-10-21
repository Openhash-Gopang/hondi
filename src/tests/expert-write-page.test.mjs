/**
 * expert-write-page.test.mjs — 보건의료 19개 직역 「서류 작성하기」(STEP W) 정적 검사 (2026-10-21)
 * 확인하는 것: 직역 페이지의 헤더 버튼이 존재하는 화면을 가리킴 · 화면이 그 직역을 알고 있음 · 보조 AI SP 에 STEP W(W-1~W-9)와 상태 줄 형식이 있음 ·
 * 화면의 상태 줄 정규식이 SP 형식을 읽음 · 전문 판단·승인·교부·신고·청구·서명은 사람이 한다는 규율과 dpaper 미연동 표기 · §LEGAL-LIMIT 이 직전 버전과 같음 ·
 * expert-chat 이 임베드 모드에서 보조 AI SP 를 읽고 임베드 규약이 화면과 같음. (실제 대화·로그인은 브라우저가 필요해 범위 밖)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const catalog = JSON.parse(read('prompts/sp-catalog.json'));
const JOBS = [
  ['dentist', '치과의사'], ['traditional-medicine-doctor', '한의사'], ['pharmacist', '약사'], ['veterinarian', '수의사'], ['nurse', '간호사'],
  ['physical-therapist', '물리치료사'], ['medical-lab-technologist', '임상병리사'], ['radiologic-technologist', '방사선사'],
  ['dental-hygienist', '치과위생사'], ['occupational-therapist', '작업치료사'], ['dental-technician', '치과기공사'],
  ['advanced-practice-nurse', '전문간호사'], ['dietitian', '영양사'], ['paramedic', '응급구조사'], ['midwife', '조산사'],
  ['speech-language-pathologist', '언어재활사'], ['optician', '안경사'], ['sanitarian', '위생사'], ['health-educator', '보건교육사'],
];
const js = read('assets/expert-write.js');
const html = read('pages/expert-write.html');
const chat = read('pages/expert-chat.html');
const gen = read('scripts/gen-expert-pages.py');
const statusRe = /\[[^\]|]*보조 AI\s*\|\s*서류 작성 트랙\s*\|\s*현재:\s*W-([1-9])([^\]]*)\]/;

for (const [pid, role] of JOBS) {
  describe(`${role} 서류 작성하기`, () => {
    const key = `SP_${pid}-assistant`;
    const file = catalog[key];
    const sp = read('prompts/' + file);
    const page = read(`pages/${pid}.html`);
    it('헤더 버튼이 서류 작성 화면을 가리키고 그 화면이 이 직역을 알고 있다', () => {
      assert.ok(page.includes(`heroButton: { label: '서류 작성하기', href: "/pages/expert-write.html?persona=${pid}"`));
      assert.ok(page.includes(`/pages/expert-write.html?persona=${pid}">서류 작성하기 화면으로 이동`));
      assert.ok(js.includes(`'${pid}': {`) && js.includes(`role: '${role}'`) && js.includes(`back: '/pages/${pid}.html'`));
      assert.ok(html.includes(`/pages/expert-write.html?persona=${pid}">${role} 보조 AI`));
      assert.ok(gen.includes(`'${pid}': '${role}'`), '생성기의 WRITE_TRACK 에도 있어야 다시 만들어도 버튼이 남는다');
    });
    it('카탈로그가 STEP W 가 들어간 v1.1 보조 AI SP 를 가리킨다', () => {
      assert.ok(/_v1_1\.md$/.test(file), file);
      assert.ok(existsSync(join(ROOT, 'prompts', file.replace('_v1_1', '_v1_0'))), '직전 버전 파일은 남겨 둔다');
      assert.ok(sp.split('\n')[0].endsWith(' 보조 AI v1.1'));
    });
    it('SP에 STEP W 9단계와 상태 줄 형식이 있다', () => {
      assert.equal((sp.match(/^## STEP W — 서류 작성 트랙/gm) || []).length, 1);
      for (let n = 1; n <= 9; n++) assert.ok(new RegExp(`^### W-${n}\\. `, 'm').test(sp), `W-${n} 절`);
      assert.ok(sp.includes(`[${role} 보조 AI | 서류 작성 트랙 | 현재: W-n |`));
      const at = (re) => sp.search(re);
      assert.ok(at(/^## STEP D /m) < at(/^## STEP W — /m) && at(/^## STEP W — /m) < at(/^## 부록 A — /m), '절 순서: STEP D → STEP W → 부록 A');
    });
    it('SP가 정한 상태 줄 형식을 화면의 정규식이 읽는다', () => {
      const m = statusRe.exec(`[${role} 보조 AI | 서류 작성 트랙 | 현재: W-6 | 서류: 테스트 | 서식: 신규 | 게이트: 기록 승인 대기]`);
      assert.ok(m && m[1] === '6');
      assert.ok(js.includes('서류 작성 트랙\\s*\\|\\s*현재:\\s*W-([1-9])'));
    });
    it('전문 판단·승인·교부·신고·청구·서명은 사람이 하고 dpaper는 미연동이라고 밝힌다', () => {
      const sec = sp.slice(sp.search(/^## STEP W — /m), sp.search(/^## 부록 A — /m));
      const ll = sp.slice(sp.indexOf('## §LEGAL-LIMIT'), sp.indexOf('## 0. IDENTITY'));
      const n = /\n(\d)\. \*\*서명/.exec(ll)[1];
      assert.ok(sec.includes(`**전문 판단은 ${role}가 한다.**`));
      assert.ok(sec.includes(`저장·교부·신고(W-7)·청구(W-8)와 서명·날인은 ${role}가 자신의 인증으로 직접 하고, 이 도구는 하지 않는다(§LEGAL-LIMIT ${n})`));
      assert.ok(sec.includes('dpaper API 연동은 아직 승인·개통되지 않았다(미연동)'));
      assert.ok(sec.includes('FORM_LOOKUP') && sec.includes('FORM_SAVE_PROPOSAL'));
      assert.ok(sec.includes('직접 수행한 건만 기록한다') && sec.includes('식별정보'));
      for (const m of sec.matchAll(/CONNECT_HUMAN_EXPERT[^\n]*/g)) assert.ok(m[0].includes('출력하지 않는다'), 'STEP W 가 소개·연결 태그를 쓰게 하면 안 됨');
    });
    it('§LEGAL-LIMIT·§0-2·부록 A 는 직전 버전과 같다', () => {
      const prev = read('prompts/' + file.replace('_v1_1', '_v1_0'));
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

describe('서류 작성 화면과 대화 화면 연결', () => {
  it('화면은 dpaper 미연동과 처리 버튼 비활성을 표시한다', () => {
    assert.ok(html.includes('dpaper 연동: 미연동'));
    assert.ok(js.includes('dpaper로 처리 (미연동)') && js.includes('disabled title='));
  });
  it('대화창은 임베드 모드로 열리고, expert-chat 이 19개 직역에 보조 AI SP(-assistant)와 전문가 인증 경로를 적용한다', () => {
    assert.ok(js.includes("'&embed=1'") || js.includes('&embed=1'));
    const set = /const _PRO_WRITE_PERSONAS = new Set\(\[([\s\S]*?)\]\);/.exec(chat);
    assert.ok(set, '_PRO_WRITE_PERSONAS 없음');
    for (const [pid] of JOBS) assert.ok(set[1].includes(`'${pid}'`), `${pid} 가 _PRO_WRITE_PERSONAS 에 없음`);
    assert.ok(chat.includes("_embedOn() && _PRO_WRITE_PERSONAS.has(PERSONA)) ? def.key + '-assistant' : def.key"));
  });
  it('메시지 규약이 두 쪽에서 같다', () => {
    for (const t of ['expert-embed-send', 'expert-embed-reply', 'expert-embed-ready']) { assert.ok(js.includes(t), t + ' (화면)'); assert.ok(chat.includes(t), t + ' (대화)'); }
    assert.ok(chat.includes("_qs.get('embed') === '1'") && chat.includes('e.source !== window.parent'));
  });
  it('9단계가 모두 정의되어 있고 19개 직역이 모두 등록되어 있다', () => {
    for (let n = 1; n <= 9; n++) assert.ok(js.includes(`k: 'W-${n}'`), `W-${n}`);
    assert.equal((js.match(/role: '[^']+', tool: /g) || []).length, JOBS.length);
  });
});
