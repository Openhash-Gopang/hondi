/**
 * expert_pages_start_field.test.js — 전문가 페르소나 페이지 전체의 "시작 영역"(탭 2개 + 늘어나는 입력창 + 방법론 SP 원문) 전수 검사 (2026-10-17)
 *
 * 정적 검사(의존성 없음). 대상: pages/*.html 중 PAGE_HEADER.active 가 'expert-personas' 인 개인 페르소나 페이지 전부
 * (목록 페이지 expert-personas, 문서 페이지 expert-personas-docs 는 제외). 실제 동작(애니메이션·대화)은 브라우저가 필요해 범위 밖이다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const EXCLUDE = new Set(['expert-personas', 'expert-personas-docs']);
const names = readdirSync(join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5))
  .filter((n) => !EXCLUDE.has(n) && /active:\s*'expert-personas'/.test(read(`pages/${n}.html`)));
const catalog = JSON.parse(read('prompts/sp-catalog.json'));
const count = (s, sub) => s.split(sub).length - 1;

describe('전문가 페르소나 페이지 전체 — 시작 영역', () => {
  it('B-00: 대상 페이지가 빠짐없이 잡힌다(143개 이상)', () => {
    assert.ok(names.length >= 143, `대상 페이지 수가 적음: ${names.length}`);
    for (const must of ['appraiser', 'judicial-scrivener', 'lawyer', 'lawyer-civil', 'administrative-scrivener', 'tax-accountant', 'nurse']) assert.ok(names.includes(must), `${must} 누락`);
  });

  for (const n of names) {
    it(`B-01 ${n}`, () => {
      const t = read(`pages/${n}.html`);
      assert.equal(count(t, 'id="startBox"'), 1, '시작 영역(startBox)이 정확히 하나가 아님');
      const iMd = t.indexOf('/assets/md-view.js'), iSf = t.indexOf('/assets/start-field.js');
      assert.ok(iMd > 0 && iSf > iMd && count(t, '/assets/md-view.js') === 1 && count(t, '/assets/start-field.js') === 1, 'md-view.js → start-field.js 순서/중복 문제');
      assert.ok(t.includes('panelMode: "inline"') && t.includes('inlineMount: "#startChatMount"') && t.includes('mic: true') && t.includes('camera: "touch"'), '위젯 inline 설정 없음');
      assert.ok(!/position:\s*"left"/.test(t), '옛 왼쪽 말풍선 설정(position: "left")이 남음');
      assert.ok(!t.includes('expert-chat.html') && !t.includes('말풍선') && !t.includes('대화로 서류 작성 시작하기</a>'), '옛 말풍선/별도 채팅 페이지 안내가 남음');
      assert.ok(t.includes("disclaimerDismissKey: " + (t.includes('disclaimerDismissKey: "') ? JSON.stringify(n) : "'" + n + "'")), '다시 보지 않기 키가 페이지 이름과 다름');
      const sp = (t.match(/sp:\s*"([^"]+)"/) || [])[1];
      assert.ok(sp && catalog[sp], `SP 키(${sp})가 sp-catalog.json 에 없음`);
      assert.ok(read('prompts/' + catalog[sp]).length > 50, 'SP 원문 파일이 비어 있음');
      assert.ok(count(t, 'id="hcw-') === 0, '위젯이 만드는 요소가 페이지에 직접 들어 있음');
    });
  }

  it('B-02: 생성 표시가 있는 페이지는 생성기 출력과 한 글자도 다르지 않다(생성기가 단일 원본)', (t) => {
    const py = spawnSync('python3', ['--version']);
    if (py.status !== 0) return t.skip('python3 없음');
    const tmp = mkdtempSync(join(tmpdir(), 'gen-'));
    mkdirSync(join(tmp, 'prompts')); mkdirSync(join(tmp, 'scripts'));
    cpSync(join(ROOT, 'pages'), join(tmp, 'pages'), { recursive: true });
    cpSync(join(ROOT, 'scripts/gen-expert-pages.py'), join(tmp, 'scripts/gen-expert-pages.py'));
    cpSync(join(ROOT, 'prompts/sp-catalog.json'), join(tmp, 'prompts/sp-catalog.json'));
    // 생성기는 SP 부록 A 에서 서류 목록을 읽는다 — 카탈로그가 가리키는 SP 원문도 함께 복사한다.
    for (const f of new Set(Object.values(catalog))) if (existsSync(join(ROOT, 'prompts', f))) cpSync(join(ROOT, 'prompts', f), join(tmp, 'prompts', f));
    const r = spawnSync('python3', ['scripts/gen-expert-pages.py'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, '생성기 실행 실패: ' + r.stderr);
    let checked = 0;
    for (const n of names) {
      const cur = read(`pages/${n}.html`);
      if (!cur.includes('gen-expert-pages.py')) continue;
      assert.equal(readFileSync(join(tmp, `pages/${n}.html`), 'utf8'), cur, `${n}: 생성기 출력과 다름 — 생성기를 고치고 다시 생성하세요`);
      checked++;
    }
    assert.ok(checked >= 120, `생성 페이지 확인 수가 적음: ${checked}`);
  });

  it('B-04: 서류 목록형으로 생성된 페이지 — 서류 목록이 SP 부록 A와 같고, SP 에 서식 출력 규격(C-2)이 있다', () => {
    let checked = 0;
    for (const n of names) {
      const t = read(`pages/${n}.html`);
      if (!t.includes('gen-expert-pages.py') || !t.includes('window.PRO_DOC_PAGE')) continue;
      const sp = (t.match(/sp:\s*"([^"]+)"/) || [])[1];
      const md = read('prompts/' + catalog[sp]);
      assert.ok(/^#{2,3} (?:STEP )?C-2\.? /m.test(md), `${n}: SP(${sp})에 C-2 서식 출력 규격이 없음`);
      assert.ok(/^## 부록 A/m.test(md), `${n}: SP(${sp})에 부록 A 서류 카탈로그가 없음`);
      assert.ok(t.includes('id="askOther"') && t.includes('id="draftsCard"') && t.includes('id="svcTabs"') && t.includes('/assets/pro-doc-page.js'), `${n}: 서류 목록 요소 누락`);
      assert.ok(t.indexOf('/assets/md-view.js') < t.indexOf('/assets/pro-doc-page.js') && t.indexOf('/assets/pro-doc-page.js') < t.indexOf('/assets/start-field.js'), `${n}: 스크립트 순서`);
      assert.ok(t.includes('transformReply'), `${n}: 작성된 문서 연동(transformReply) 누락`);
      const cfg = JSON.parse(t.match(/window\.PRO_DOC_PAGE = (\{.*\});\n/)[1].replace(/<\\\//g, '</'));
      const tabs = (md.match(/^### A-\d+\./gm) || []).length;
      assert.ok(cfg.catalog.length >= 1 && cfg.catalog.length <= tabs, `${n}: 탭 수 이상`);
      for (const c of cfg.catalog) for (const it of c.items) assert.ok(md.includes(it.t), `${n}: 서류 "${it.t}"가 SP 부록 A에 없음`);
      checked++;
    }
    assert.ok(checked >= 1, '서류 목록형으로 생성된 페이지가 하나도 없음');
  });

  it('B-05: 손으로 만든 서류 목록형 페이지의 서류 목록(항목·설명·안내)이 SP 부록 A와 같다(SP가 정본)', (t) => {
    if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 없음');
    let checked = 0;
    for (const n of names) {
      const h = read(`pages/${n}.html`);
      if (h.includes('gen-expert-pages.py')) continue;
      const m = h.match(/window\.PRO_DOC_PAGE = (\{.*\});\n/);
      if (!m) continue;
      const sp = (h.match(/sp:\s*"([^"]+)"/) || [])[1];
      const r = spawnSync('python3', ['scripts/gen-expert-pages.py', '--catalog-json', join(ROOT, 'prompts', catalog[sp])], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, `${n}: SP 목록 읽기 실패: ${r.stderr}`);
      const fromSp = JSON.parse(r.stdout), onPage = JSON.parse(m[1]).catalog;
      assert.equal(onPage.length, fromSp.length, `${n}: 탭(업무 영역) 수가 SP 부록 A와 다름 — 페이지 ${onPage.length} / SP ${fromSp.length}`);
      for (let i = 0; i < fromSp.length; i++) {
        const a = fromSp[i], b = onPage[i];
        assert.equal(b.id, a.id, `${n}: ${i + 1}번째 탭 id`);
        assert.deepEqual(b.items, a.items, `${n} ${a.id}: 서류 항목이 SP 부록 A와 다름 — SP를 고쳤다면 페이지의 목록도 같이 고치세요`);
        assert.deepEqual(b.notes, a.notes, `${n} ${a.id}: 안내(유의)가 SP 부록 A와 다름`);
        assert.equal(b.lead, a.lead, `${n} ${a.id}: 소개 문단이 SP 부록 A와 다름`);
        assert.equal(b.meta, a.meta, `${n} ${a.id}: 제출처·근거 표시가 SP 부록 A와 다름`);
      }
      checked++;
    }
    assert.ok(checked >= 16, `손으로 만든 목록형 페이지 확인 수가 적음: ${checked}`);
  });

  it('B-03: 생성기가 만들지 않는 페이지(서류 목록형·법무사·감정평가사)는 서류 목록/위젯 연동 기능을 그대로 가진다', () => {
    for (const n of names) {
      const t = read(`pages/${n}.html`);
      if (t.includes('gen-expert-pages.py')) continue;
      assert.ok(t.includes('id="askOther"') && t.includes('id="draftsCard"') && t.includes('id="svcTabs"'), `${n}: 서류 목록 요소가 사라짐`);
    }
  });
});

describe('전문가 페르소나 페이지 전체 — 노란 경고 띠 한 줄', () => {
  for (const n of names) {
    it(`B-09 ${n}: 경고 띠에 초안 사용 조건까지 합쳐 있고, 안내 상자는 없다`, () => {
      const h = read(`pages/${n}.html`);
      const m = h.match(/disclaimer:\s*(['"])(.*?)\1,/);
      assert.ok(m, '경고 띠 문구(문자열)가 없음');
      assert.ok(m[2].startsWith('관계 법령에 따라, 모든 보조 AI는 인간 전문가의 업무를 보조하며'), '공통 문구로 시작해야 함');
      assert.match(m[2], /작성된 초안은 .+의 검토·확정 전에는 사용할 수 없다\.$/);
      const intro = h.slice(h.indexOf('class="doc-intro"'), h.indexOf('id="startBox"') + 400);
      assert.ok(!/svc-callout important/.test(intro.split('id="startBox"')[1] || ''), '입력창 아래에 주황 안내 상자가 남음');
    });
  }
});
