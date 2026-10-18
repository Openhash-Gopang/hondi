// pages/gov-agency.html(행정기관 공통 페이지) 회귀 테스트 (2026-10-19 신설)
//  1) assets/gov-agency-data.js 가 pages/k-government.html 의 기관 목록과 어긋나지 않았는지(목록이 바뀌었는데 색인을 안 만든 경우를 잡는다)
//  2) K-정부 목록의 모든 기관 행이 새 공통 페이지로 연결되고, 그 govCode 가 색인에 전부 있는지
//  3) 기관별 customization 표(overrides)의 기본 구조, 법률 검토 훅 SP 등록
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const loadWin = (p) => { const w = {}; vm.runInNewContext(read(p), { window: w }); return w; };

test('기관 색인(gov-agency-data.js)이 k-government.html 에서 다시 만든 결과와 같다', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gov-agency-')), 'data.js');
  execFileSync('node', [path.join(root, 'tools/build-gov-agencies.cjs')], { env: { ...process.env, GOV_AGENCY_OUT: tmp }, stdio: 'pipe' });
  assert.equal(fs.readFileSync(tmp, 'utf8'), read('assets/gov-agency-data.js'),
    'k-government.html 의 기관 목록이 바뀌었습니다 — node tools/build-gov-agencies.cjs 를 실행해 assets/gov-agency-data.js 를 갱신하세요.');
});

test('K-정부 목록의 기관 행은 gov-agency.html 로 연결되고, 색인에 없는 govCode 가 없다', () => {
  const kg = read('pages/k-government.html');
  assert.ok(kg.includes('/pages/gov-agency.html?gov_code='), '기관 행 링크가 gov-agency.html 이어야 합니다');
  assert.ok(!kg.includes('/pages/regional-gov.html?gov_code='), '기관 행이 옛 regional-gov.html 을 가리키면 안 됩니다');
  const idx = loadWin('assets/gov-agency-data.js').GOV_AGENCIES;
  const codes = new Set([...kg.matchAll(/"govCode":\s*"([^"]+)"/g)].map((m) => m[1]));
  assert.ok(codes.size > 200, 'govCode 가 너무 적게 잡혔습니다: ' + codes.size);
  const missing = [...codes].filter((c) => !idx[c]);
  assert.deepEqual(missing, [], '색인에 없는 govCode: ' + missing.slice(0, 5).join(', '));
  for (const [c, v] of Object.entries(idx)) {
    assert.ok(Array.isArray(v) && typeof v[0] === 'string' && v[0] && typeof v[1] === 'string', c + ' 형식 오류');
  }
});

test('기관별 customization 표는 비어 있어도 안전하고, 공통 페이지는 필요한 스크립트를 올바른 순서로 싣는다', () => {
  const w = loadWin('assets/gov-agency-overrides.js');
  assert.equal(typeof w.GOV_AGENCY_OVERRIDES, 'object'); assert.equal(typeof w.GOV_TIER_OVERRIDES, 'object');   // 비어 있거나 기관이 추가돼도 객체여야 한다
  const html = read('pages/gov-agency.html');
  const order = ['gov-agency-data.js', 'gov-agency-overrides.js', 'gov-agency.js', 'ph-header.js', 'chat-widget.js', 'md-view.js', 'pro-doc-page.js'].map((s) => html.indexOf('/assets/' + s));
  assert.ok(order.every((i) => i > 0), '필요한 스크립트가 빠졌습니다');
  assert.deepEqual([...order], [...order].sort((a, b) => a - b), '스크립트 로드 순서가 바뀌었습니다(헤더 설정이 ph-header.js 보다 먼저여야 함)');
  for (const id of ['startBox', 'govHow', 'askOther', 'svcTabs', 'svcContent', 'draftsCard', 'draftsList', 'govLawRows', 'govLimits', 'govFooter']) {
    assert.ok(html.includes('id="' + id + '"'), id + ' 요소가 없습니다');
  }
});

test('법률 검토 훅 SP(gov-agency)가 카탈로그에 등록되고 파일이 있다', () => {
  const cat = JSON.parse(read('prompts/sp-catalog.json'));
  const f = cat['SP_legal-review-gov-agency'];
  assert.ok(f, 'SP_legal-review-gov-agency 가 sp-catalog.json 에 없습니다');
  assert.ok(fs.existsSync(path.join(root, 'prompts', f)), f + ' 파일이 없습니다');
  assert.ok(read('prompts/' + f).includes('[CONNECT_HUMAN_EXPERT]'));
});

test('regional-gov.html 임베드 모드는 같은 오리진·부모 창 메시지만 받고, 비임베드 동작을 바꾸지 않는다', () => {
  const rg = read('pages/regional-gov.html');
  assert.ok(rg.includes("_qs.get('embed') === '1' && window.parent !== window"));
  assert.ok(rg.includes('e.origin !== location.origin || e.source !== window.parent'));
  assert.ok(rg.includes("html.embed #bottom-dock"));
  assert.ok(rg.startsWith('\uFEFF<!DOCTYPE') && !rg.startsWith('\uFEFF\uFEFF'), 'BOM 이 이중이면 문서가 호환 모드(quirks)로 열립니다');
});
