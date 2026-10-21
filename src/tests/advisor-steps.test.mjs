/**
 * advisor-steps.test.mjs — 구매자문(K-Advisor) 「단계별 구매 자문」(STEP K) 정적 검사 (2026-10-21)
 * 확인하는 것: SP 에 §3-9 STEP K(K-0~K-7)와 상태 줄이 있고 §3-8 뒤·§4 앞에 위치 · STEP K/머리 주석/끝 줄을 걷어내면 원래 SP 와 같음(원칙 P1~P4·절대 금지 불변) ·
 * 광고·수수료 이해관계 확인 단계 · 화면이 SP 의 상태 줄 형식과 맞음 · 헤더 버튼·expert-chat 링크 · K-Advisor 는 전문가 인증 목록에 없음.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const catalog = JSON.parse(read('prompts/sp-catalog.json'));
const FILE = 'SP_advisor_v1_3.md';
const SHA = '6c3435fc841d8b84cd08d2b6a721cc2fadded1549ad7d4d812e3dadcef90cbbd'; // STEP K 추가 전 본문(끝 줄바꿈 제외)의 sha256
const sp = read('prompts/' + FILE);
const js = read('assets/advisor-steps.js');
const html = read('pages/advisor-steps.html');
const chat = read('pages/expert-chat.html');
const page = read('pages/advisor.html');
const gen = read('scripts/gen-expert-pages.py');

function stripK(s) {
  const lines = s.split('\n');
  assert.ok(lines[1].startsWith('> 2026-10-21 구매 자문 트랙(§3-9 STEP K) 추가'), '머리 주석');
  lines.splice(1, 1);
  const a = lines.findIndex((l) => l.startsWith('### 3-9. 구매 자문 트랙'));
  assert.ok(a > 0);
  let b = a + 1;
  while (!lines[b].startsWith('## ')) b++;
  lines.splice(a, b - a);
  return lines.join('\n').replace(/\n+\*STEP K 구매 자문 트랙 추가 \(2026-10-21[^\n]*\*\n*$/, '').replace(/\n+$/, '');
}

describe('K-Advisor 단계별 구매 자문', () => {
  it('카탈로그가 이 SP 를 가리키고 §3-9 가 한 번만 있다', () => {
    assert.equal(catalog['SP_advisor'], FILE);
    assert.equal((sp.match(/^### 3-9\. 구매 자문 트랙/gm) || []).length, 1);
  });
  it('K-0~K-7 절과 상태 줄이 있고 §3-8 뒤 §4 앞에 위치한다', () => {
    for (let n = 0; n <= 7; n++) assert.ok(new RegExp(`^#### K-${n}\\. `, 'm').test(sp), `K-${n} 절`);
    assert.ok(sp.includes('[K-Advisor | 구매 자문 트랙 | 현재: K-n |'));
    const at = (re) => sp.search(re);
    assert.ok(at(/^### 3-8\. /m) < at(/^### 3-9\. /m) && at(/^### 3-9\. /m) < at(/^## 4\. 절대 금지/m));
  });
  it('사기 징후 전환·판매자 대가 없음·광고 수수료 확인·조회 규칙·결제정보 거부가 있다', () => {
    const k = sp.slice(sp.search(/^### 3-9\. /m), sp.search(/^## 4\. 절대 금지/m));
    assert.ok(/#### K-1\. 사기 징후·이해관계 확인[\s\S]*트랙을 멈추고 구매 보류 권고/.test(k));
    assert.ok(k.includes('어떤 대가도 받지 않는다(P1)') && k.includes('광고·협찬·제휴 수수료'));
    assert.ok(k.includes('[WEB_SEARCH: query=') && k.includes('[미확인]') && k.includes('NEXT_STEP'));
    assert.ok(k.includes('결제·인증 정보는 받지 않는다'));
    assert.ok(k.includes('거래를 중개하거나 성사시키려 설득하지 않는다'));
  });
  it('STEP K 를 걷어내면 원래 SP 와 같다(원칙·절대 금지 불변)', () => {
    assert.equal(createHash('sha256').update(stripK(sp), 'utf8').digest('hex'), SHA);
  });
  it('화면이 SP 의 상태 줄 형식과 맞고 7단계를 가진다', () => {
    assert.ok(js.includes('\\[K-Advisor\\s*\\|\\s*구매 자문 트랙\\s*\\|\\s*현재:\\s*K-([1-7])'));
    for (let n = 1; n <= 7; n++) assert.ok(js.includes(`k: 'K-${n}'`));
    assert.ok(html.includes('/assets/advisor-steps.js') && js.includes('persona=advisor&embed=1'));
  });
  it('헤더 버튼·생성기·expert-chat 링크가 연결되고 전문가 인증 목록에는 없다', () => {
    assert.ok(page.includes("heroButton: { label: '단계별 구매 자문', href: \"/pages/advisor-steps.html\""));
    assert.ok(gen.includes("STEP_TRACK = {'advisor'"));
    assert.ok(chat.includes("PERSONA === 'advisor'") && chat.includes('/pages/advisor-steps.html'));
    const pro = /const _PRO_WRITE_PERSONAS = new Set\(\[([\s\S]*?)\]\);/.exec(chat);
    assert.ok(pro && !pro[1].includes("'advisor'"));
  });
});
