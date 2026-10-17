import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// 이 저장소는 package.json 이 type:module 이라 .js 를 require 로 못 읽는다 — 브라우저용 UMD 스크립트를 vm 에서 CommonJS 처럼 실행한다.
const mod = { exports: {} };
vm.runInNewContext(read('assets/suggest-board.js'), { module: mod, Intl, URLSearchParams, console, setTimeout });
const S = mod.exports;
// vm 안에서 만든 배열·객체는 prototype 이 달라 deepStrictEqual 이 실패하므로 JSON 으로 비교한다.
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

test('기록 블록을 답변에서 떼어 내고 검증한다', () => {
  const reply = '정리했습니다.\n[SQ_RECORD]{"kind":"제안","title":"PDF 저장","body":"요약을 PDF로","tags":["법률검토","#화면개선","#a","#b"]}[/SQ_RECORD]';
  const r = S.extractRecord(reply);
  assert.equal(r.text, '정리했습니다.');
  same(r.record, { kind: '제안', title: 'PDF 저장', body: '요약을 PDF로', tags: ['#법률검토', '#화면개선', '#a'] });
});

test('잘못된 기록 블록(구분 오류·빈 제목·깨진 JSON)은 카드로 만들지 않고 화면에서도 숨긴다', () => {
  for (const bad of [
    '[SQ_RECORD]{"kind":"불만","title":"x","body":"y"}[/SQ_RECORD]',
    '[SQ_RECORD]{"kind":"질문","title":"","body":"y"}[/SQ_RECORD]',
    '[SQ_RECORD]{깨진[/SQ_RECORD]',
  ]) {
    const r = S.extractRecord('본문\n' + bad);
    assert.equal(r.record, null);
    assert.equal(r.text, '본문');
  }
  assert.equal(S.extractRecord('본문 [SQ_RECORD]{"kind":"제안"').text, '본문'); // 닫는 표시 없이 잘린 경우
});

test('길이 제한: 제목 40자·본문 800자·태그 3개 12자', () => {
  const r = S.sanitizeRecord({ kind: '질문', title: 'ㄱ'.repeat(60), body: 'ㅏ'.repeat(900), tags: ['#' + 'x'.repeat(30), 'b', 'c', 'd'] });
  assert.equal(r.title.length, 40);
  assert.equal(r.body.length, 800);
  assert.equal(r.tags.length, 3);
  assert.equal(r.tags[0].length, 13); // '#' + 12자
});

test('저장 형식 왕복: encode → parseItem', () => {
  const rec = { kind: '제안', title: '법률 검토 요약 PDF', body: '첫 줄\n---\n둘째 줄', tags: ['#법률검토'] };
  const content = S.encodeContent(rec, 'tax-accountant');
  const p = S.parseItem({ id: 'x', content, handle: 'user-1', created: '2026-10-17 06:00:00.000Z', status: 'pending' });
  assert.equal(p.kind, '제안');
  assert.equal(p.title, '법률 검토 요약 PDF');
  same(p.tags, ['#법률검토']);
  assert.equal(p.from, 'tax-accountant');
  assert.ok(p.body.includes('첫 줄') && p.body.includes('둘째 줄'));
  assert.equal(p.handle, 'user-1');
});

test('기존 일반 제안(형식 아님)은 이 게시판에서 제외, 최신순 정렬', () => {
  const mk = (id, created, content) => ({ id, created, content, handle: 'u' });
  const posts = S.buildBoard([
    mk('1', '2026-10-15 01:00:00.000Z', '[질문] 가\n#a\n---\n본문'),
    mk('2', '2026-09-01 00:00:00.000Z', '그냥 예전 제안'),
    mk('3', '2026-10-17 01:00:00.000Z', '[제안] 나\n#b\n---\n본문'),
  ]);
  same(posts.map((p) => p.id), ['3', '1']);
  same(S.filterBoard(posts, '질문', '').map((p) => p.id), ['1']);
  same(S.filterBoard(posts, '', '#b').map((p) => p.id), ['3']);
});

test('날짜는 한국 시간으로 표시', () => {
  assert.equal(S.formatKst('2026-10-17 06:02:11.000Z'), '2026-10-17 15:02');
});

test('컨텍스트에 저장소 요약·최근 글이 들어가고, 요약이 없으면 추측 금지를 알린다', () => {
  const ctx = S.buildContext('# 요약\n- 갱신: x', [{ kind: '제안', title: '가', created: '2026-10-17 00:00:00.000Z' }], '제안');
  assert.ok(ctx.includes('[저장소 요약') && ctx.includes('# 요약') && ctx.includes('[구분 지정: 제안]') && ctx.includes('[제안] 가'));
  assert.ok(S.buildContext('', [], '').includes('추측하지 말고'));
});

test('SP: 기록 블록·보상 미정·공개 안내·저장소 근거 규칙이 있다', () => {
  const sp = read('prompts/SP_SUGGEST_QUESTION_v1_0.md');
  for (const needle of ['[SQ_RECORD]', '[/SQ_RECORD]', '아직 정해지지 않았다', '공개', '저장소 요약', '2개 이하', '3회 이내', '"kind"']) assert.ok(sp.includes(needle), needle);
  assert.ok(!/SP_[A-Za-z_-]+_v\d/.test(sp), '버전이 박힌 다른 SP 참조 금지');
  assert.ok(!/#\s*상위\s*상속/.test(sp), '상속 선언 없음');
});

test('SP 가 카탈로그에 등록되어 있고 파일이 있다', () => {
  const cat = JSON.parse(read('prompts/sp-catalog.json'));
  assert.equal(cat.SP_SUGGEST_QUESTION, 'SP_SUGGEST_QUESTION_v1_0.md');
  assert.ok(fs.existsSync(path.join(ROOT, 'prompts', cat.SP_SUGGEST_QUESTION)));
});

test('페이지: 같은 SP 키·스크립트·게시판 자리, 게시판은 textContent 로만 그린다', () => {
  const html = read('pages/suggest.html');
  assert.ok(html.includes('/assets/suggest-board.js') && html.includes('id="sqBoard"') && html.includes('id="startChatMount"'));
  const js = read('assets/suggest-board.js');
  assert.ok(js.includes("sp: 'SP_SUGGEST_QUESTION'"));
  assert.ok(!/innerHTML\s*=/.test(js), '사용자 글을 innerHTML 로 넣지 않는다');
});

test('모든 페르소나 페이지 공통 버튼: start-field.js 와 expert-chat.html 이 suggest 로 연결', () => {
  const sf = read('assets/start-field.js');
  assert.ok(sf.includes('sqNavBtn') && sf.includes('/pages/suggest.html'));
  assert.ok(read('assets/pro-doc-page.css').includes('.sq-nav-btn'));
  const ec = read('pages/expert-chat.html');
  assert.ok(ec.includes('id="tb-suggest"') && ec.includes("/pages/suggest.html?from="));
});

test('저장소 요약 워크플로: push·매일·수동 실행, 요약본만 바뀌는 푸시는 무시', () => {
  const y = read('.github/workflows/refresh-repo-digest.yml');
  assert.ok(y.includes('schedule:') && y.includes('workflow_dispatch') && y.includes("paths-ignore") && y.includes('data/repo-digest.md') && y.includes('[skip ci]'));
  assert.ok(fs.existsSync(path.join(ROOT, 'tools/build_repo_digest.mjs')));
});

test('요약본: 크기 제한 안, 비밀처럼 보이는 줄 없음, 갱신 시각 줄 있음', () => {
  const f = path.join(ROOT, 'data/repo-digest.md');
  if (!fs.existsSync(f)) return; // 첫 PR 에서는 스크립트가 만든 파일을 함께 커밋한다
  const d = fs.readFileSync(f, 'utf8');
  assert.ok(d.length <= 14000);
  assert.match(d, /- 갱신: .+KST/);
  assert.ok(!/(api[_-]?key|secret|password|token)\s*[:=]/i.test(d));
});
