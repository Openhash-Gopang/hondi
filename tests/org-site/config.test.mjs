import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeConfig, parseBlockTags, buildPromptAddon, stableStringify } from '../../src/gopang/gov/org-site-config.js';
import { JTP_DEMO_CONFIG } from '../../src/gopang/gov/demo/jtp-demo-config.js';

test('시연 시드 설정이 검증을 통과한다', () => {
  const r = sanitizeConfig(JTP_DEMO_CONFIG);
  assert.equal(r.ok, true);
  assert.equal(r.config.programs.length, 3);
  assert.ok(r.config.programs.every(p => p.demo));
});

test('모르는 필드·알 수 없는 블록·위험한 URL을 걸러낸다', () => {
  const r = sanitizeConfig({ name: 'A기관', greeting: '안녕', evil: '<script>', blocks: ['programs', 'rm-rf'], programs: [{ title: '사업', url: 'javascript:alert(1)' }] });
  assert.equal(r.ok, false);                       // 알 수 없는 블록은 오류로 알려 준다
  const r2 = sanitizeConfig({ name: 'A기관', greeting: '안녕', evil: 1, blocks: ['programs'], programs: [{ title: '사업', url: 'javascript:alert(1)' }] });
  assert.equal(r2.ok, true);
  assert.equal(r2.config.evil, undefined);
  assert.equal(r2.config.programs[0].url, '');
});

test('이름·인사말이 없으면 거절한다', () => {
  assert.equal(sanitizeConfig({ blocks: [] }).ok, false);
  assert.equal(sanitizeConfig(null).ok, false);
});

test('stableStringify는 키 순서와 무관하다', () => {
  assert.equal(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] }), stableStringify({ a: [{ c: 2, d: 1 }], b: 1 }));
});

test('블록 태그: 켜진 블록만 파싱하고 태그는 본문에서 걷어낸다', () => {
  const reply = '맞는 사업입니다.\n[[BLOCK:programs ids=p1,p2]]\n[[BLOCK:apply-draft program=p1 company="제주 코스메틱" summary="시제품 시험"]]\n[[BLOCK:inquiry dept=c1]]';
  const { text, blocks } = parseBlockTags(reply, ['programs', 'apply-draft']);
  assert.equal(text, '맞는 사업입니다.');
  assert.deepEqual(blocks.map(b => b.type), ['programs', 'apply-draft']);
  assert.equal(blocks[1].args.company, '제주 코스메틱');
  assert.equal(blocks[0].args.ids, 'p1,p2');
});

test('블록 태그: 모르는 종류는 조용히 버린다', () => {
  const { text, blocks } = parseBlockTags('안녕 [[BLOCK:evil x=1]]', ['programs']);
  assert.equal(blocks.length, 0);
  assert.equal(text, '안녕');
});

test('프롬프트 부가 지침에 지식·목록·블록 규칙·시연 표시가 들어간다', () => {
  const c = sanitizeConfig(JTP_DEMO_CONFIG).config;
  const t = buildPromptAddon(c);
  assert.match(t, /76개 항목/);
  assert.match(t, /\(p1\)/);
  assert.match(t, /\[\[BLOCK:programs/);
  assert.match(t, /시연 표시/);
  assert.equal(buildPromptAddon(null), '');
});
