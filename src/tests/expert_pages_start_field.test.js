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
