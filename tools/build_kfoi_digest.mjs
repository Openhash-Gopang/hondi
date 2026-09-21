#!/usr/bin/env node
// K-FOI용 「제주 AI 행정」 SP 요약본(다이제스트) 생성기 — 2026-09-21 신설.
//
// 왜 필요한가
//   정보 공개 청구 비서(SP-28_kfoi)가 "기관·부서 SP가 직원 업무를 대행하는 데 필요한 자료"를 청구하려면 그 SP들이 무엇을
//   다루는지 알아야 한다. 그런데 SP 파일은 약 220개(합계 1.1MB)이고, 청구 비서의 조사는 한 번에 파일 하나·최대 8회라
//   저장소를 직접 열람하게 하면 많아야 4%만 볼 수 있다(2026-09-21 첫 실사용에서 0개였다). 그래서 이 스크립트가
//   저장소의 SP를 한 번에 읽어 SP마다 "다루는 일 / 할 수 있는 일 / 못 하는 일 / 확인하지 못한 것 / 데이터 공백 / 상태"만 뽑아
//   prompts/gov-tree/kfoi-digest/gov-digest.json 으로 만든다. Worker의 KFOI_DIGEST 도구가 이 파일을 기관 유형별로 잘라 준다.
//
// 무엇을 뽑는가(SP 본문의 어느 부분에서)
//   name          문서명 줄("문서명 : ○○ — System Prompt") 또는 페이지 데이터의 이름
//   handles/outputs  §INPUT_SCHEMA 의 입력·출력
//   does          §2(완결 처리 업무)의 첫 항목들
//   can/cannot    §CAPABILITIES 표 — "수행 불가" 행이 cannot
//   unverified    본문 곳곳의 "확인하지 못했다·미확인·재검증되지 않았다·정직하게 밝힘" 문장
//   data_gaps     §6 등 "데이터 공백" 표(field ← owner_agency: unavailable_reason). 갱신된 SP에만 있다
//   state         gapped(데이터 공백 표 있음) / revised(v1.0이 아님) / draft(v1.0 초안)
//
// 사용법
//   node tools/build_kfoi_digest.mjs            # 다이제스트 JSON을 (다시) 만든다
//   node tools/build_kfoi_digest.mjs --check    # 저장소의 JSON이 최신인지 확인(오래됐으면 종료코드 1)
//   node tools/build_kfoi_digest.mjs --md <dir> # 기관 유형별 마크다운(각 1.8만 자 이하)을 만든다 — 대화 창 파일 첨부용
//
// 결과는 결정적이다(시각·경로 등 실행마다 달라지는 값을 넣지 않는다) — --check가 성립하도록.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GT = path.join(ROOT, 'prompts/gov-tree');
const PAGE = path.join(ROOT, 'pages/jeju-gov-automation.html');
const OUT = path.join(GT, 'kfoi-digest/gov-digest.json');

export const TIER_LABELS = {
  'do': '제주특별자치도 도청(실·국·과)',
  'jeju-si': '제주시청(국·과)',
  'seogwipo': '서귀포시청(국·과)',
  'agency': '도 직속기관',
  'org': '출자·출연기관',
  'emd': '읍·면·동',
};

// ── 페이지 데이터(=「제주 AI 행정」에 수록된 기관·부서의 정본 목록) ─────────────────────
export function loadPageData() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const s = html.indexOf('const DO_BUREAUS');
  const e = html.indexOf('let activeInstId');
  if (s < 0 || e < 0) throw new Error('pages/jeju-gov-automation.html에서 데이터 배열을 찾지 못했습니다');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(html.slice(s, e).replace(/^const /gm, 'var '), ctx);
  return ctx;
}

// 버전이 붙은 파일을 접두어로 찾는다(같은 spId의 최신 버전 하나만 라이브 디렉터리에 있다는 저장소 규칙).
function findByPrefix(dir, id) {
  const abs = path.join(GT, dir);
  if (!fs.existsSync(abs)) return null;
  const hit = fs.readdirSync(abs).filter(f => f.startsWith(id + '_v') && f.endsWith('.md')).sort().pop();
  return hit ? path.join(abs, hit) : null;
}

// ── SP 본문 파싱 ────────────────────────────────────────────────────────────────
function clip(s, n) { const t = String(s || '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

function sections(md) {
  // "## " 제목 단위로 나눈다. { title, body }
  const out = []; let cur = null;
  for (const line of md.split('\n')) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) { cur = { title: m[1].trim(), body: [] }; out.push(cur); }
    else if (cur) cur.body.push(line);
  }
  return out.map(x => ({ title: x.title, body: x.body.join('\n') }));
}
function tableRows(body) {
  const rows = [];
  for (const line of body.split('\n')) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;   // 구분선
    rows.push(cells);
  }
  return rows.slice(1);   // 머리글 제외
}

export function parseSp(md, fallbackName = '') {
  const sec = sections(md);
  const find = re => sec.find(x => re.test(x.title));
  const nameM = /문서명\s*[:：]\s*(.+?)\s*[—-]\s*System Prompt/.exec(md);
  const verM = /#\s*버전\s*[:：]\s*(v[\d.]+)/.exec(md);
  const out = {
    name: clip(nameM ? nameM[1] : fallbackName, 80),
    version: verM ? verM[1] : '',
    handles: '', outputs: '', does: [], can: [], cannot: [], unverified: [], data_gaps: [],
  };

  const io = find(/INPUT_SCHEMA/);
  if (io) {
    for (const line of io.body.split('\n')) {
      const m = /^[\s\-*]*\**(입력|출력)\**\s*[:：]\s*(.+)$/.exec(line);
      if (m) out[m[1] === '입력' ? 'handles' : 'outputs'] = clip(m[2], 160);
    }
  }
  const s2 = find(/^§?2[\.\s]/);
  if (s2) {
    const lines = s2.body.split('\n').map(l => l.trim()).filter(l => /^[-*]\s+/.test(l) || (l && !l.startsWith('|') && !l.startsWith('#') && !l.startsWith('```')));
    out.does = lines.slice(0, 3).map(l => clip(l.replace(/^[-*]\s+/, ''), 140));
  }
  const cap = find(/CAPABILITIES/);
  if (cap) {
    for (const r of tableRows(cap.body)) {
      if (r.length < 2) continue;
      (/^수행 불가/.test(r[1]) ? out.cannot : out.can).push(clip(r[0], 80) + (/^수행 불가/.test(r[1]) && r[1].length > 6 ? ' — ' + clip(r[1].replace(/^수행 불가\s*[—-]?\s*/, ''), 60) : ''));
    }
    out.can = out.can.slice(0, 6); out.cannot = out.cannot.slice(0, 5);
  }
  for (const line of md.split('\n')) {
    if (/^\s*[-*]\s/.test(line) && /(확인하지 못|미확인|재검증되지 않|정직하게 밝힘)/.test(line)) {
      out.unverified.push(clip(line.replace(/^\s*[-*]\s+/, ''), 140));
      if (out.unverified.length >= 3) break;
    }
  }
  const gap = find(/데이터 공백|DATA_REQUIREMENT/);
  if (gap) {
    for (const r of tableRows(gap.body)) {
      if (r.length < 2 || !r[0]) continue;
      out.data_gaps.push(clip(r[0], 60) + ' ← ' + clip(r[1], 50) + (r[3] ? ': ' + clip(r[3], 60) : ''));
      if (out.data_gaps.length >= 10) break;
    }
  }
  out.state = out.data_gaps.length ? 'gapped' : (out.version && !/^v1\.0$/.test(out.version) ? 'revised' : 'draft');
  return out;
}

function compact(o) { const r = {}; for (const [k, v] of Object.entries(o)) { if (Array.isArray(v) ? v.length : v) r[k] = v; } return r; }

// ── 다이제스트 구성 ─────────────────────────────────────────────────────────────
export function buildDigest(data = loadPageData()) {
  const tiers = {};
  const addTier = key => (tiers[key] = { label: TIER_LABELS[key], entries: [] });

  function entryFrom(tierKey, kind, id, fallbackName, parent, file) {
    let parsed = { name: fallbackName, state: 'template' };
    let bytes = 0;
    if (file && fs.existsSync(file)) {
      const md = fs.readFileSync(file, 'utf8');
      bytes = Buffer.byteLength(md, 'utf8');
      parsed = parseSp(md, fallbackName);
      if (!parsed.name) parsed.name = fallbackName;
    }
    const rel = file ? path.relative(GT, file).split(path.sep).join('/') : '';
    tiers[tierKey].entries.push(compact({ id, kind, ...parsed, name: fallbackName || parsed.name, parent, file: rel, bytes }));
  }

  // 도청 / 직속기관 / 출자출연기관: 국·기관 SP는 정적 파일, 과 SP도 정적 파일
  const staticTiers = [
    ['do', data.DO_BUREAUS, '02-do-dept', 'bureau'],
    ['agency', data.DO_AGENCIES, '03-do-agency', 'institution'],
    ['org', data.DO_ORGS, '07-org', 'institution'],
  ];
  for (const [key, arr, dir, kind] of staticTiers) {
    addTier(key);
    for (const b of arr) {
      entryFrom(key, kind, b.spId, b.name, '', findByPrefix(dir, b.spId));
      for (const d of (b.divisions || [])) entryFrom(key, 'division', d.spId, d.name, b.name, path.join(GT, d.file));
    }
  }
  // 제주시·서귀포시: 국 SP는 템플릿 렌더링(정적 파일 없음), 과 SP는 정적 파일
  for (const [key, arr] of [['jeju-si', data.JEJUSI_BUREAUS], ['seogwipo', data.SEOGWIPO_BUREAUS]]) {
    addTier(key);
    for (const b of arr) {
      entryFrom(key, 'bureau', b.spId, b.name, '', null);
      for (const d of (b.divisions || [])) entryFrom(key, 'division', d.spId, d.name, b.name, path.join(GT, d.file));
    }
  }
  // 읍·면·동: 팀 SP는 5종 템플릿으로 렌더링 — 읍면동별로 팀 목록만 싣는다
  addTier('emd');
  for (const e of data.EMD_LIST) {
    tiers.emd.entries.push(compact({ id: e.spId || '', kind: 'emd', name: e.name, parent: e.parentCity, state: 'template', teams: (e.teams || []).map(t => t.name), }));
  }

  for (const t of Object.values(tiers)) {
    const c = { total: t.entries.length, draft: 0, revised: 0, gapped: 0, template: 0 };
    for (const en of t.entries) c[en.state || 'template']++;
    t.stats = c;
  }
  return { version: 1, source: 'prompts/gov-tree + pages/jeju-gov-automation.html', tiers };
}

// 한 줄에 항목 하나 — git diff가 읽기 쉽다.
export function serialize(digest) {
  const lines = ['{', '"version": ' + digest.version + ',', '"source": ' + JSON.stringify(digest.source) + ',', '"tiers": {'];
  const keys = Object.keys(digest.tiers);
  keys.forEach((k, ti) => {
    const t = digest.tiers[k];
    lines.push(JSON.stringify(k) + ': {"label": ' + JSON.stringify(t.label) + ', "stats": ' + JSON.stringify(t.stats) + ', "entries": [');
    t.entries.forEach((e, i) => lines.push(JSON.stringify(e) + (i < t.entries.length - 1 ? ',' : '')));
    lines.push(']}' + (ti < keys.length - 1 ? ',' : ''));
  });
  lines.push('}', '}', '');
  return lines.join('\n');
}

// ── 마크다운(파일 첨부용) ────────────────────────────────────────────────────────
export function toMarkdownChunks(digest, maxChars = 18000) {
  const chunks = [];
  for (const [key, t] of Object.entries(digest.tiers)) {
    let n = 1, buf = '';
    const head = () => `# ${t.label} — 「제주 AI 행정」 SP 요약 (${key} ${n})\n\n총 ${t.stats.total}건 · 초안(v1.0) ${t.stats.draft} · 갱신됨 ${t.stats.revised} · 데이터 공백 표 있음 ${t.stats.gapped} · 템플릿 ${t.stats.template}\n\n`;
    buf = head();
    for (const e of t.entries) {
      let s = `### ${e.name}${e.parent ? ' (' + e.parent + ')' : ''} — ${e.state}\n`;
      if (e.handles) s += `- 다루는 일(입력): ${e.handles}\n`;
      if (e.outputs) s += `- 결과(출력): ${e.outputs}\n`;
      if (e.does && e.does.length) s += `- 직접 처리: ${e.does.join(' / ')}\n`;
      if (e.cannot && e.cannot.length) s += `- 못 하는 일: ${e.cannot.join(' / ')}\n`;
      if (e.unverified && e.unverified.length) s += `- 확인하지 못한 것: ${e.unverified.join(' / ')}\n`;
      if (e.data_gaps && e.data_gaps.length) s += `- 데이터 공백: ${e.data_gaps.join(' / ')}\n`;
      if (e.teams) s += `- 팀: ${e.teams.join(', ')}\n`;
      s += '\n';
      if (buf.length + s.length > maxChars && buf.length > head().length) { chunks.push({ name: `kfoi-digest_${key}_${n}.md`, text: buf }); n++; buf = head(); }
      buf += s;
    }
    chunks.push({ name: `kfoi-digest_${key}_${n}.md`, text: buf });
  }
  return chunks;
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const digest = buildDigest();
  const text = serialize(digest);
  if (args.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) {
      console.error('✗ kfoi-digest/gov-digest.json 이 오래됐습니다 — `node tools/build_kfoi_digest.mjs` 로 다시 만들어 커밋하세요.');
      process.exit(1);
    }
    console.log('✓ K-FOI 다이제스트가 최신입니다 (' + Object.values(digest.tiers).reduce((n, t) => n + t.stats.total, 0) + '건)');
  } else if (args.includes('--md')) {
    const dir = path.resolve(args[args.indexOf('--md') + 1] || 'kfoi-digest-md');
    fs.mkdirSync(dir, { recursive: true });
    const chunks = toMarkdownChunks(digest);
    for (const c of chunks) fs.writeFileSync(path.join(dir, c.name), c.text);
    console.log(`✓ 마크다운 ${chunks.length}개 → ${dir}`);
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    const total = Object.values(digest.tiers).reduce((n, t) => n + t.stats.total, 0);
    console.log(`✓ ${path.relative(ROOT, OUT)} — ${total}건, ${(Buffer.byteLength(text) / 1024).toFixed(0)}KB`);
    for (const [k, t] of Object.entries(digest.tiers)) console.log(`  ${k.padEnd(9)} ${String(t.stats.total).padStart(3)}건  초안 ${t.stats.draft} · 갱신 ${t.stats.revised} · 데이터공백표 ${t.stats.gapped} · 템플릿 ${t.stats.template}`);
  }
}
