/**
 * k_services_start_field.test.js — K-서비스 페이지(pages/k-services.html)의 시작 영역(대화창) 정적 검사 (2026-10-24)
 *
 * 서비스 탭마다 서비스 제공자 쪽 SP 로 바뀌는 인라인 대화창이 붙어 있는지, 탭별 SP 키가 sp-catalog.json 에 있고 파일이 실재하는지 본다.
 * 실제 동작(탭 전환·대화)은 브라우저가 필요해 여기서 다루지 않는다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const count = (s, sub) => s.split(sub).length - 1;
const html = read('pages/k-services.html');
const catalog = JSON.parse(read('prompts/sp-catalog.json'));
const block = (html.match(/var SVC_CHAT\s*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';

describe('k-services 시작 영역', () => {
  it('시작 영역과 위젯 설정이 하나씩, 올바른 순서로 있다', () => {
    assert.equal(count(html, 'id="startBox"'), 1);
    assert.equal(count(html, '<script src="/assets/chat-widget.js"></script>'), 1, '위젯 include 가 중복됨');
    assert.ok(html.includes('panelMode: "inline"') && html.includes('inlineMount: "#startChatMount"'));
    const iMd = html.indexOf('/assets/md-view.js'), iSf = html.indexOf('/assets/start-field.js');
    assert.ok(iMd > 0 && iSf > iMd, 'md-view.js → start-field.js 순서');
    assert.ok(html.indexOf('/assets/chat-widget.js') < iSf, '위젯이 start-field.js 보다 먼저');
    assert.ok(html.includes('/assets/start-field.css'));
    assert.ok(existsSync(join(ROOT, 'assets/start-field.css')));
  });
  it('모든 서비스 탭에 대응하는 SVC_CHAT 항목이 있다', () => {
    const tabs = [...html.matchAll(/data-svc="([a-z0-9]+)"/g)].map((m) => m[1]);
    assert.ok(tabs.length >= 30);
    for (const t of new Set(tabs)) assert.ok(new RegExp('\\b' + t + ':\\s*\\{').test(block), `SVC_CHAT 에 ${t} 없음`);
  });
  it('탭별 SP 키가 카탈로그와 파일에 실재한다', () => {
    const keys = [...block.matchAll(/sp:\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(keys.length >= 20);
    for (const k of keys) {
      assert.ok(catalog[k], `sp-catalog.json 에 ${k} 없음`);
      assert.ok(existsSync(join(ROOT, 'prompts', catalog[k])), `prompts/${catalog[k]} 없음`);
    }
  });
  it('인프라 SP 6종이 서비스 탭에 연결돼 있다', () => {
    for (const k of ['SP-01_klaw', 'SP-05_kmarket', 'SP-07_ktax', 'SP-08_gdc', 'SP-09_kschool', 'SP-11_kstock']) assert.ok(block.includes(`'${k}'`), k);
  });
  it('start-field.js 가 서비스 전환 API 를 내놓는다', () => {
    const sf = read('assets/start-field.js');
    assert.ok(sf.includes('window.HondiStartField') && sf.includes('setService'));
    assert.ok(html.includes('HondiStartField.setService') && html.includes('syncSvcChat(key)'));
  });
});
