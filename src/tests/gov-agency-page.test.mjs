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
  const order = ['gov-agency-data.js', 'gov-agency-overrides.js', 'gov-agency-content/index.js', 'gov-agency-tasks.js', 'gov-agency.js', 'ph-header.js', 'chat-widget.js', 'md-view.js', 'pro-doc-page.js'].map((s) => html.indexOf('/assets/' + s));
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

test('내용 파일(gov-agency-content/)은 색인에 올라 있고, 서류·출처·확인 못 한 사항을 빠뜨리지 않는다', () => {
  const dir = path.join(root, 'assets/gov-agency-content');
  const idx = loadWin('assets/gov-agency-content/index.js').GOV_CONTENT_INDEX;
  const idxData = loadWin('assets/gov-agency-data.js').GOV_AGENCIES;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js');
  assert.deepEqual([...new Set(Object.values(idx))].sort(), files.sort(), '색인과 내용 파일 목록이 다릅니다');
  for (const [key, file] of Object.entries(idx)) {
    assert.match(file, /^[A-Za-z0-9._-]+\.js$/, file + ' 파일명 형식');
    const w = loadWin('assets/gov-agency-content/' + file);
    const ov = w.GOV_AGENCY_OVERRIDES[key];
    assert.ok(ov, file + ' 이 ' + key + ' 를 등록하지 않았습니다');
    if (!key.includes('*') && !/^[a-z-]+$/.test(key)) assert.ok(idxData[key], key + ' 는 기관 색인에 없는 코드입니다');
    const ids = new Set();
    assert.ok(ov.catalog.length > 0, key + ' 카탈로그가 비었습니다');
    for (const c of ov.catalog) {
      assert.ok(c.id && c.tab && c.title && c.meta && Array.isArray(c.notes) && Array.isArray(c.items) && c.items.length > 0, key + ' 카탈로그 항목 형식: ' + c.id);
      assert.ok(!ids.has(c.id), key + ' 카탈로그 id 중복 ' + c.id); ids.add(c.id);
      c.items.forEach((it) => assert.ok(it.t && it.d, key + ' 서류 항목에 이름과 설명이 있어야 합니다: ' + c.id));
    }
    assert.ok(ov.lawsUnverified && ov.lawsUnverified.length > 10, key + ': 확인하지 못한 사항(lawsUnverified)을 적어야 합니다');
    assert.ok(ov.sources && ov.sources.length > 0 && ov.sources.every((s) => s.title && /^\d{4}-\d{2}-\d{2}$/.test(s.date)), key + ': 조사 출처와 조회일(YYYY-MM-DD)이 필요합니다');
    const note = file.replace(/\.js$/, '.md');
    assert.ok(fs.existsSync(path.join(root, 'docs/gov-agency-research/notes', note)), '조사 노트가 없습니다: docs/gov-agency-research/notes/' + note);
  }
});

test('SP 업무 초안표 추출기가 제주시 세무과에서 분장사무 9건을 뽑는다', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-extract-'));
  execFileSync('node', [path.join(root, 'tools/extract-gov-sp.cjs'), '--code', 'city-dept:jejusi:SP-CITYDIV-JEJUSI-JACHI-TAX'], { env: { ...process.env, GOV_EXTRACT_OUT: out }, stdio: 'pipe' });
  const j = JSON.parse(fs.readFileSync(path.join(out, 'city-dept_jejusi_SP-CITYDIV-JEJUSI-JACHI-TAX.json'), 'utf8'));
  assert.equal(j.units.length, 1);
  assert.equal(j.units[0].tasks.length, 9);
  assert.ok(j.units[0].legalBasis.length > 0 && j.units[0].referrals.length > 0);
});

test('색인의 SP 경로는 모두 저장소에 실제로 있는 파일이다', () => {
  const missing = Object.entries(loadWin('assets/gov-agency-data.js').GOV_AGENCIES).filter(([, v]) => v[2] && !fs.existsSync(path.join(root, v[2]))).map(([c]) => c);
  assert.deepEqual(missing, [], '없는 SP 경로: ' + missing.slice(0, 5).join(', '));
});

test('접수 연동 task 파일(gov-agency-tasks.js)이 worker.js 레지스트리에서 다시 만든 결과와 같다', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gov-tasks-')), 'tasks.js');
  execFileSync('node', [path.join(root, 'tools/extract-gov-tasks.cjs')], { env: { ...process.env, GOV_TASK_OUT: tmp }, stdio: 'pipe' });
  assert.equal(fs.readFileSync(tmp, 'utf8'), read('assets/gov-agency-tasks.js'),
    'worker.js 의 REQUIRED_DOCUMENTS_REGISTRY 가 바뀌었습니다 — node tools/extract-gov-tasks.cjs 를 실행해 assets/gov-agency-tasks.js 를 갱신하세요.');
});

test('task 연결은 실제 기관 색인의 코드만 가리키고, 모든 task 는 서류를 가진다', () => {
  const w = {}; vm.runInNewContext(read('assets/gov-agency-tasks.js'), { window: w });
  const idx = loadWin('assets/gov-agency-data.js').GOV_AGENCIES;
  for (const [code, keys] of Object.entries(w.GOV_TASK_BY_AGENCY)) {
    assert.ok(idx[code], code + ' 는 기관 색인에 없는 코드입니다');
    keys.forEach((k) => assert.ok(w.GOV_TASKS[k], code + ' 가 없는 task 를 가리킵니다: ' + k));
  }
  for (const [k, t] of Object.entries(w.GOV_TASKS)) {
    assert.ok(t.name && t.agency && Array.isArray(t.docs) && t.docs.length > 0, k + ' task 형식');
    t.docs.forEach((d) => assert.ok(d[0] && (d[1] === 0 || d[1] === 1), k + ' 서류 형식'));
  }
  assert.ok(w.GOV_TASK_BY_AGENCY['city-dept:jejusi:SP-CITYDIV-JEJUSI-JACHI-TAX'].includes('jejusi:tax_objection'));
});

test('추출기는 파이프라인형 SP(도시건설국 건축과)에서 접수 task 를 읽고 레지스트리 미등록을 짚는다', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-extract2-'));
  execFileSync('node', [path.join(root, 'tools/extract-gov-sp.cjs'), '--code', 'city-dept:jejusi:SP-CITYDIV-JEJUSI-URBANCONSTRUCTION-BUILDING'], { env: { ...process.env, GOV_EXTRACT_OUT: out }, stdio: 'pipe' });
  const j = JSON.parse(fs.readFileSync(path.join(out, 'city-dept_jejusi_SP-CITYDIV-JEJUSI-URBANCONSTRUCTION-BUILDING.json'), 'utf8'));
  const u = j.units[0];
  assert.deepEqual(u.pipelineTasks.map((p) => p.taskKey).sort(), ['building_permit', 'occupancy_inspection']);
  assert.ok((u.unregistered || []).includes('jejusi:occupancy_inspection'), '미등록 task 를 짚어야 합니다(열린 문제 #2)');
});

test('task 수동 연결(TASK_AGENCY_OVERRIDE)은 모두 그 기관 SP 본문에 task_key 가 실제로 적혀 있다', () => {
  const src = read('tools/extract-gov-tasks.cjs');
  const block = src.slice(src.indexOf('const TASK_AGENCY_OVERRIDE = {'), src.indexOf('module.exports = module.exports'));
  const pairs = [...block.matchAll(/'([a-z0-9_]+:[a-z0-9_]+)':\s*\[([^\]]*)\]/g)];
  assert.ok(pairs.length >= 12, '수동 연결 항목이 읽히지 않았습니다');
  const idx = loadWin('assets/gov-agency-data.js').GOV_AGENCIES;
  for (const [, key, codes] of pairs) {
    const taskKey = key.split(':')[1];
    for (const code of [...codes.matchAll(/'([^']+)'/g)].map((m) => m[1])) {
      assert.ok(idx[code] && idx[code][2], key + ' → ' + code + ': 기관 색인에 없거나 SP 가 없습니다');
      assert.ok(read(idx[code][2]).includes(taskKey), key + ' → ' + code + ': SP 본문에 task_key 가 적혀 있지 않습니다(근거 없는 연결)');
    }
  }
});
