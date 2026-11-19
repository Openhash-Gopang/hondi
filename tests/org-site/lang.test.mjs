import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLang, localizedGreeting, languageInstruction, SUPPORTED_VISITOR_LANGS, LANG_NAMES } from '../../src/gopang/gov/site-lang.js';

test('언어 코드 정규화', () => {
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('zh-Hant-TW'), 'zh');
  assert.equal(normalizeLang('ja_JP'), 'ja');
  assert.equal(normalizeLang(''), 'ko');
  assert.equal(normalizeLang(undefined), 'ko');
  assert.equal(normalizeLang('???'), 'ko');
});
test('인사말: 지원 언어마다 이름이 들어가고, 표에 없는 언어는 영어', () => {
  for (const l of SUPPORTED_VISITOR_LANGS) assert.ok(localizedGreeting('나비 연습 식당', l).includes('나비 연습 식당'), l);
  assert.match(localizedGreeting('X', 'ko'), /무엇을 도와드릴까요/);
  assert.match(localizedGreeting('X', 'sw'), /^Hello/);
});
test('시연용 고지가 붙는다', () => {
  assert.match(localizedGreeting('X', 'ko', { demo: true }), /시연용/);
  assert.match(localizedGreeting('X', 'en', { demo: true }), /Demo/);
  assert.match(localizedGreeting('X', 'ja', { demo: true }), /デモ/);
  assert.match(localizedGreeting('X', 'vi', { demo: true }), /Demo/);   // 표에 없으면 영어 고지
});
test('AI 지시문: 한국어 폰은 비어 있고 외국어 폰은 그 언어를 지정', () => {
  assert.equal(languageInstruction('ko-KR'), '');
  assert.match(languageInstruction('en-GB'), /English\(en\)/);
  assert.match(languageInstruction('zh-CN'), /简体中文\(zh\)/);
  assert.match(languageInstruction('sw'), /\(sw\)/);
});
test('지원 언어 이름표가 모두 있다', () => {
  for (const l of SUPPORTED_VISITOR_LANGS) assert.ok(LANG_NAMES[l], l);
});
