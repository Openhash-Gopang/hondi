// K-FOI 다이제스트(tools/build_kfoi_digest.mjs, src/worker/kfoi-digest.js) 검증 — 2026-09-21.
// 실행: node src/tests/kfoi-digest.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildDigest, parseSp, serialize, toMarkdownChunks, loadPageData } from '../../tools/build_kfoi_digest.mjs';
import { digestQuery, compactEntry } from '../worker/kfoi-digest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`✅ ${name}`); }
  catch (e) { fail++; console.log(`❌ ${name}\n     ${String(e && e.message).split('\n')[0]}`); }
}

const SAMPLE = `# SP-DIV-X
# 문서명    : 경제활력국 경제정책과 — System Prompt
# 버전      : v1.0
## §1. 정체성
당신은 **경제정책과**를 대표하는 AI다.
## §INPUT_SCHEMA / OUTPUT_SCHEMA
- **입력**: 민생경제정책·사회연대경제 관련 문의
- **출력**: 지원사업 결정
## §CAPABILITIES
| 할 수 있는 일 | 수행 방식 |
|---|---|
| 절차·자격 안내 | 직접 수행 |
| 신청 접수 경로 안내 | 직접 수행 |
| 실제 심사·처분 결과 확정 | 수행 불가 — 정식 심사를 통해서만 확정 |
## §2. 완결 처리 업무
- 절차·자격 요건·필요서류를 안내한다.
- 진행 상황·문의처를 안내한다.
## §3. 유의사항
- 지원은 심사를 통해서만 확정된다
- 과 명칭·소관은 재검증되지 않았다 — 초안이다.
`;

await test('parseSp: 다루는 일·결과·직접 처리·할 수 있는 일·못 하는 일·확인하지 못한 것 추출', () => {
  const r = parseSp(SAMPLE, '대체 이름');
  assert.equal(r.name, '경제활력국 경제정책과'); assert.equal(r.version, 'v1.0');
  assert.equal(r.handles, '민생경제정책·사회연대경제 관련 문의'); assert.equal(r.outputs, '지원사업 결정');
  assert.deepEqual(r.does, ['절차·자격 요건·필요서류를 안내한다.', '진행 상황·문의처를 안내한다.']);
  assert.deepEqual(r.can, ['절차·자격 안내', '신청 접수 경로 안내']);
  assert.equal(r.cannot.length, 1); assert.ok(r.cannot[0].startsWith('실제 심사·처분 결과 확정'));
  assert.ok(r.unverified[0].includes('재검증되지 않았다'));
  assert.equal(r.state, 'draft');
});
await test('parseSp: 상태 판정(데이터 공백 표 → gapped, v1.0 아님 → revised)', () => {
  const gapped = SAMPLE + '\n## §6. 데이터 공백\n| field | owner_agency | connected | unavailable_reason | fallback |\n|---|---|---|---|---|\n| 수수료 | 처리시스템 | 아니오 | 연동 없음 | 안내 |\n';
  const g = parseSp(gapped); assert.equal(g.state, 'gapped'); assert.equal(g.data_gaps.length, 1); assert.ok(g.data_gaps[0].startsWith('수수료 ← 처리시스템'));
  assert.equal(parseSp(SAMPLE.replace('v1.0', 'v1.2')).state, 'revised');
  const empty = parseSp('', '이름만'); assert.equal(empty.name, '이름만'); assert.equal(empty.state, 'draft');
});

const digest = buildDigest();
const dataForNameCheck = loadPageData();

const data = loadPageData();
const expected = {
  do: data.DO_BUREAUS.length + data.DO_BUREAUS.reduce((n, b) => n + (b.divisions || []).length, 0),
  agency: data.DO_AGENCIES.length + data.DO_AGENCIES.reduce((n, b) => n + (b.divisions || []).length, 0),
  org: data.DO_ORGS.length + data.DO_ORGS.reduce((n, b) => n + (b.divisions || []).length, 0),
  'jeju-si': data.JEJUSI_BUREAUS.length + data.JEJUSI_BUREAUS.reduce((n, b) => n + (b.divisions || []).length, 0),
  seogwipo: data.SEOGWIPO_BUREAUS.length + data.SEOGWIPO_BUREAUS.reduce((n, b) => n + (b.divisions || []).length, 0),
  emd: data.EMD_LIST.length,
};
await test('제주시 농수축산국·보건소 이름이 영문 자리표시자("agri"·"health")가 아니라 한글 이름이다(2026-09-22 발견한 데이터 결함)', () => {
  const agri = dataForNameCheck.JEJUSI_BUREAUS.find(b => b.spId === 'SP-CITYDO-JEJUSI-AGRI');
  const health = dataForNameCheck.JEJUSI_BUREAUS.find(b => b.spId === 'SP-CITYDO-JEJUSI-HEALTH');
  assert.equal(agri.name, '농수축산국'); assert.equal(health.name, '제주보건소');
});
await test('버그 수정 회귀: current_divisions·legal_basis가 실제로 digest 항목까지 전달된다(2026-09-21에 baseline JSON에는 있었지만 digest 출력에는 빠져 있던 결함)', () => {
  const e = digest.tiers.do.entries.find(x => x.id === 'SP-DO-CLIMATE');
  assert.deepEqual(e.org.current_divisions, ['환경정책과', '물정책과', '자원순환과', '산림녹지과']);
  assert.equal(e.org.legal_basis, '제21조의3');
  const full = compactEntry(e, false);   // 국 하나만 상세 조회(브리프 아님) — current_divisions까지 실림
  assert.deepEqual(full.org.current_divisions, e.org.current_divisions); assert.equal(full.org.legal_basis, e.org.legal_basis);
  const brief = compactEntry(e, true);   // kind:"bureau" 전체 훑기 — current_divisions는 빼서 26개가 한 페이지에 들어가게 한다
  assert.equal(brief.org.legal_basis, e.org.legal_basis); assert.ok(!('current_divisions' in brief.org));
});
await test('서귀포시: 사용자가 제공한 조직도 이미지로 국 10개 전부 확인(전부 일치, 신뢰도 high)', () => {
  const t = digest.tiers.seogwipo;
  assert.equal(t.baseline.org_counts.match, 10); assert.equal(Object.keys(t.baseline.org_counts).length, 1, '불일치 없이 전부 match');
  const clim = t.entries.find(e => e.id === 'SP-CITYDO-SEOGWIPO-CLIMATE');
  assert.deepEqual(clim.org.current_divisions, ['기후환경과', '생활환경과', '공원녹지과', '산림휴양관리소']);
});
await test('제주시: 시행규칙 원문(제72조)으로 청정환경국 과 구성 불일치가 확정됐고, 법령이 확인한 기후환경과가 인벤토리에 추가됐다', () => {
  const t = digest.tiers['jeju-si'];
  assert.equal(t.baseline.org_counts.match, 11); assert.equal(t.baseline.org_counts.name_differs, 1);
  const climate = t.entries.find(e => e.id === 'SP-CITYDO-JEJUSI-CLIMATE');
  assert.equal(climate.org.status, 'name_differs'); assert.equal(climate.org.legal_basis, '제72조');
  assert.deepEqual(climate.org.current_divisions, ['기후환경과', '환경지도과', '생활환경과', '공원녹지과', '절물생태관리소']);
  const divs = t.entries.filter(e => e.kind === 'division' && e.parent === '청정환경국').map(e => e.name);
  assert.ok(divs.some(n => n.includes('기후환경과')), '법령이 확인한 기후환경과가 실제 인벤토리(page data)에 추가됐어야 함');
});
await test('서귀포시: 시행규칙 원문(제76조~제86조)으로 국 10개 전부 신뢰도 high로 확정됐다(이미지 단독 근거에서 격상)', () => {
  const t = digest.tiers.seogwipo;
  assert.equal(t.baseline.org_counts.match, 10);
  const climate = t.entries.find(e => e.id === 'SP-CITYDO-SEOGWIPO-CLIMATE');
  assert.equal(climate.org.confidence, 'high'); assert.equal(climate.org.legal_basis, '제84조');
});
await test('읍·면·동은 baseline_note만 남고(조직 기준표 없음) 다른 유형과 섞이지 않는다', () => {
  assert.ok(digest.tiers.emd.baseline_note && !digest.tiers.emd.baseline);
});
await test('digestQuery: 서귀포시 kind:"bureau"도 한 페이지로 조회되고 org가 실린다(국 10개 전부 match)', () => {
  const r = digestQuery(digest, { tier: 'seogwipo', kind: 'bureau' });
  assert.equal(r.matched, 10); assert.equal(r.next_offset, null);
  assert.ok(r.entries.every(e => e.org && e.org.status === 'match'));
});

await test('소방안전본부(SP-AGY-FIRE)가 직속기관에서 도청(do) 유형으로 이동했다(시행규칙 제21조의4 확인)', () => {
  const inDo = digest.tiers.do.entries.find(e => e.id === 'SP-AGY-FIRE');
  const inAgency = digest.tiers.agency.entries.find(e => e.id === 'SP-AGY-FIRE');
  assert.ok(inDo && inDo.kind === 'bureau', 'do 유형에 bureau로 있어야 함');
  assert.ok(!inAgency, 'agency 유형에는 더 이상 없어야 함');
  const divs = digest.tiers.do.entries.filter(e => e.kind === 'division' && e.parent === '소방안전본부');
  assert.equal(divs.length, 3, '기존 division 3개(실제 내용 있음)는 그대로 옮겨졌어야 함');
});
await test('직속기관·사업소(agency) 조직 기준표: 2026-09-23까지 11개(농업기술원·보건환경연구원·축산생명연구원·한라도서관·자치경찰단·민속자연사박물관·도립미술관·상하수도본부·세계유산본부·공공정책연수원·보훈청) 전부 match로 정리됐다(structure_differs 0)', () => {
  const t = digest.tiers.agency;
  assert.equal(t.baseline.org_counts.structure_differs, undefined, '이제 structure_differs로 남은 기관이 없어야 함');
  assert.equal(t.baseline.org_counts.match, 11);
  const agri = t.entries.find(e => e.id === 'SP-AGY-AGRITECH');
  assert.equal(agri.org.status, 'match'); assert.equal(agri.org.legal_basis, '제23~24조');
  assert.equal(agri.org.current_divisions.length, 9);
  const police = t.entries.find(e => e.id === 'SP-AGY-POLICE');
  assert.equal(police.org.status, 'match'); assert.equal(police.org.current_divisions.length, 6);
  const folk = t.entries.find(e => e.id === 'SP-AGY-FOLKMUSEUM');
  assert.equal(folk.org.status, 'match'); assert.equal(folk.org.current_divisions.length, 2);
  const art = t.entries.find(e => e.id === 'SP-AGY-ARTMUSEUM');
  assert.equal(art.org.status, 'match'); assert.equal(art.org.current_divisions.length, 4);
  const water = t.entries.find(e => e.id === 'SP-AGY-WATER');
  assert.equal(water.org.status, 'match'); assert.equal(water.org.current_divisions.length, 9);
  const heritage = t.entries.find(e => e.id === 'SP-AGY-HERITAGE');
  assert.equal(heritage.org.status, 'match'); assert.equal(heritage.org.confidence, 'medium', '유산정책부 4개는 사무 배정을 원문 재확인 못 해 medium'); assert.equal(heritage.org.current_divisions.length, 10);
  const publicpolicy = t.entries.find(e => e.id === 'SP-AGY-PUBLICPOLICY');
  assert.equal(publicpolicy.org.status, 'match'); assert.equal(publicpolicy.org.legal_basis, '제25~26조'); assert.equal(publicpolicy.org.current_divisions.length, 1);
  const veterans = t.entries.find(e => e.id === 'SP-AGY-VETERANS');
  assert.equal(veterans.org.status, 'match'); assert.equal(veterans.org.legal_basis, '제31~32조'); assert.equal(veterans.org.current_divisions.length, 3);
});
await test('직속기관·사업소 조직 기준표: 법정 기관 23개 중 SP가 없는 13개(누락 10 + 합의제행정기관 3)가 열거된다(2026-09-23 공공정책연수원·보훈청 반영으로 15→13)', () => {
  const t = digest.tiers.agency;
  assert.equal(t.baseline.missing_in_inventory.length, 13);
  assert.ok(!t.baseline.missing_in_inventory.some(m => m.name === '보훈청'), '보훈청은 반영 완료로 missing_in_inventory에서 빠져야 함');
  assert.ok(!t.baseline.missing_in_inventory.some(m => m.name === '공공정책연수원'), '공공정책연수원은 반영 완료로 missing_in_inventory에서 빠져야 함');
  assert.ok(t.baseline.missing_in_inventory.some(m => m.name === '감사위원회' && m.chapter === '합의제행정기관'));
  assert.ok(t.baseline.missing_in_inventory.some(m => m.name === '고용센터'), '2026.8.21. 신설 기관도 반영돼야 함');
});

await test('다이제스트 항목 수가 「제주 AI 행정」 페이지 데이터와 정확히 일치한다', () => {
  for (const [k, n] of Object.entries(expected)) assert.equal(digest.tiers[k].entries.length, n, k);
  assert.deepEqual(Object.keys(digest.tiers).sort(), Object.keys(expected).sort());
});
await test('모든 항목에 이름이 있고, 파일이 있는 항목은 상태가 draft/revised/gapped 중 하나다', () => {
  for (const [k, t] of Object.entries(digest.tiers)) for (const e of t.entries) {
    assert.ok(e.name, `${k}: 이름 없음 ${JSON.stringify(e).slice(0, 80)}`);
    assert.ok(['draft', 'revised', 'gapped', 'template'].includes(e.state), `${k}/${e.name}: state=${e.state}`);
    if (e.file) assert.ok(fs.existsSync(path.join(ROOT, 'prompts/gov-tree', e.file)), `파일 없음 ${e.file}`);
  }
});
await test('SP 본문에서 실제로 뽑아냈다(핵심 필드가 비어 있는 파일 항목이 거의 없다)', () => {
  let files = 0, withHandles = 0;
  for (const t of Object.values(digest.tiers)) for (const e of t.entries) if (e.file) { files++; if (e.handles && e.does) withHandles++; }
  assert.ok(files > 250, `파일 항목 ${files}`); assert.ok(withHandles / files > 0.9, `추출률 ${(withHandles / files * 100).toFixed(0)}%`);
});
await test('결정적이다: 두 번 만들어도 같다 / 저장소에 커밋된 JSON이 최신이다(--check)', () => {
  assert.equal(serialize(buildDigest()), serialize(buildDigest()));
  const out = execFileSync('node', ['tools/build_kfoi_digest.mjs', '--check'], { cwd: ROOT }).toString();
  assert.ok(out.includes('최신'));
});
await test('크기: JSON은 600KB 이하, 유효한 JSON이다', () => {
  const text = serialize(digest); assert.ok(Buffer.byteLength(text) < 600 * 1024, String(Buffer.byteLength(text)));
  assert.equal(JSON.parse(text).tiers.do.entries.length, expected.do);
});

await test('digestQuery: summary는 유형별 규모·상태만', () => {
  const r = digestQuery(digest, { tier: 'summary' });
  assert.equal(Object.keys(r.tiers).length, 6); assert.equal(r.tiers.do.stats.total, expected.do); assert.ok(r.how_to_read.includes('draft'));
  assert.deepEqual(digestQuery(digest, {}), r);
});
await test('digestQuery: 알 수 없는 유형·프로토타입 키는 거부', () => {
  for (const t of ['nope', '__proto__', 'constructor', 'toString']) assert.equal(digestQuery(digest, { tier: t }).error, 'UNKNOWN_TIER', t);
});
await test('digestQuery: 페이지 넘김 — 모든 항목을 중복·누락 없이 한 번씩, 매 응답은 크기 한도 이내', () => {
  const seen = []; let offset = 0; let guard = 0;
  for (;;) {
    const r = digestQuery(digest, { tier: 'org', offset }, 3000);
    assert.ok(JSON.stringify(r.entries).length <= 3000 + 800, '한도 초과');   // 첫 항목은 한도를 넘어도 반드시 실림
    seen.push(...r.entries.map(e => e.name + '|' + (e.parent || '')));
    if (r.next_offset == null) break;
    assert.ok(r.next_offset > offset, '진행 없음'); offset = r.next_offset;
    assert.ok(++guard < 200);
  }
  assert.equal(seen.length, expected.org);
  assert.equal(new Set(seen).size, seen.length, '중복 항목');
});
await test('digestQuery: q로 거른다(부서·업무 낱말), 결과 없으면 matched 0', () => {
  const r = digestQuery(digest, { tier: 'jeju-si', q: '생활환경' });
  assert.ok(r.matched >= 1 && r.matched < digest.tiers['jeju-si'].entries.length, '거르지 않았거나 결과가 없음');
  assert.ok(r.entries.some(e => e.name.includes('생활환경')));
  assert.equal(digestQuery(digest, { tier: 'do', q: 'zzzz없는낱말' }).matched, 0);
});
// ── 현행 조직 대조(2026-09-21 K-FOI 시험에서 SP 목록이 2026.8.25 개편 전 조직으로 드러남) ──
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/gov-tree/kfoi-digest/org-baseline-do.json'), 'utf8'));
await test('조직 기준표: 도청의 모든 국·단 SP가 기준표에 있고, 기준표에 인벤토리에 없는 낡은 항목이 없다', () => {
  const ids = digest.tiers.do.entries.filter(e => e.kind === 'bureau').map(e => e.id);
  for (const id of ids) assert.ok(baseline.mapping[id], `기준표에 없음: ${id} — SP를 추가했다면 org-baseline-do.json에도 판정을 넣으세요`);
  for (const id of Object.keys(baseline.mapping)) assert.ok(ids.includes(id), `기준표에만 있음(인벤토리에서 빠짐): ${id}`);
  for (const e of digest.tiers.do.entries.filter(e => e.kind === 'bureau')) assert.ok(['match', 'renamed', 'name_differs', 'not_in_official_menu', 'unverified', 'abolished', 'is_division_not_bureau', 'structure_differs'].includes(e.org.status), e.id);
});
await test('조직 기준표: 확인된 개칭(혁신산업국→미래산업국, 기후환경국→환경산림자원국)이 요약본에 실리고, 신설된 기후에너지국은 2026-09-22 반영으로 더 이상 missing이 아니다', () => {
  const by = Object.fromEntries(digest.tiers.do.entries.filter(e => e.kind === 'bureau').map(e => [e.id, e]));
  assert.deepEqual([by['SP-DO-INNOV'].org.status, by['SP-DO-INNOV'].org.current_name], ['renamed', '미래산업국']);
  assert.deepEqual([by['SP-DO-CLIMATE'].org.status, by['SP-DO-CLIMATE'].org.current_name], ['renamed', '환경산림자원국']);
  assert.ok(!digest.tiers.do.baseline.missing_in_inventory.some(m => m.name === '기후에너지국'), '반영 완료된 항목은 missing_in_inventory에서 빠져야 함');
  assert.deepEqual([by['SP-DO-CLIMATEENERGY'].org.status, by['SP-DO-CLIMATEENERGY'].org.current_name], ['match', '기후에너지국']);
  const innovDiv = digest.tiers.do.entries.find(e => e.kind === 'division' && e.parent === by['SP-DO-INNOV'].name);
  assert.equal(innovDiv.org.status, 'parent_renamed', '개칭된 국의 과에는 상위 상태가 표시돼야 함');
});
await test('조직 기준표: 원문으로 확인된 과 구성(current_divisions)이 실려 있고, 시행규칙 조문(legal_basis)을 인용한다', () => {
  assert.deepEqual(baseline.mapping['SP-DO-CLIMATE'].current_divisions, ['환경정책과', '물정책과', '자원순환과', '산림녹지과']);
  assert.equal(baseline.mapping['SP-DO-CLIMATE'].legal_basis, '제21조의3');
});
await test('실제 파일 반영(2026-09-22) 회귀: 폐지 3건·중복 1건은 인벤토리·기준표 양쪽에서 빠지고, 실제 SP 파일은 archive/로 이동했다', () => {
  const ids = digest.tiers.do.entries.filter(e => e.kind === 'bureau').map(e => e.id);
  for (const id of ['SP-DO-AIRPORTSUP', 'SP-DO-AUTONOMY', 'SP-DO-BALANCE', 'SP-DO-GENERAL']) {
    assert.ok(!ids.includes(id), `${id}가 인벤토리에 남아 있음`);
    assert.ok(!(id in baseline.mapping), `${id}가 기준표에 남아 있음(반영 후에는 정리돼야 함)`);
    assert.ok(fs.existsSync(path.join(ROOT, 'prompts/gov-tree/02-do-dept/archive', `${id}_v1.0.md`)), `${id} 원본이 archive/에 없음`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/02-do-dept', `${id}_v1.0.md`)), `${id}가 아직 live 디렉터리에 있음`);
  }
});
await test('조직 기준표: 상태 집계가 국·단 수와 일치하고, 실·국 15개는 개편 보도의 실·국 수와 일치한다', () => {
  const total = Object.values(digest.tiers.do.baseline.org_counts).reduce((a, b) => a + b, 0);
  assert.equal(total, digest.tiers.do.entries.filter(e => e.kind === 'bureau').length);
  assert.equal(baseline.official_units.bureaus.length, baseline.expected_counts['실국']);
  assert.ok(baseline.official_units.bureaus.includes('미래산업국') && baseline.official_units.bureaus.includes('기후에너지국') && !baseline.official_units.bureaus.includes('혁신산업국'));
});
await test('조직 기준표: 확인하지 못한 것(열린 질문)이 숨겨지지 않고 요약에 남는다', () => {
  assert.ok(baseline.open_questions.length >= 3 && baseline.confidence_note.includes('확인하지 못했다'));
  assert.ok(baseline.open_questions.some(q => q.includes('분장사무')), '과 단위 분장사무는 아직 확인하지 못했다는 사실이 남아야 함');
  for (const k of ['jeju-si', 'seogwipo']) assert.ok(digest.tiers[k].baseline.confidence_note.includes('확인'), k);
  assert.ok(digest.tiers.emd.baseline_note.includes('확인하지 못했다'));
});
await test('digestQuery: summary에 도청 조직 대조가 실리고, 첫 페이지에만 baseline 전문이 실린다', () => {
  const s = digestQuery(digest, { tier: 'summary' });
  assert.ok(s.tiers.do.org_baseline.org_counts.renamed === digest.tiers.do.baseline.org_counts.renamed);
  assert.ok(!s.tiers.do.org_baseline.missing_in_inventory.includes('기후에너지국'), '2026-09-22 반영 완료로 기후에너지국은 missing_in_inventory에서 빠져야 함');
  assert.ok(s.tiers.do.org_baseline.missing_in_inventory.includes('전국체전기획단'), '아직 반영하지 않은 항목(전국체전기획단, 한시기구)은 남아 있어야 함');
  const p1 = digestQuery(digest, { tier: 'do', offset: 0 }); assert.ok(p1.baseline && p1.baseline.confidence_note);
  const p2 = digestQuery(digest, { tier: 'do', offset: p1.next_offset }); assert.ok(!p2.baseline);
});
await test('digestQuery: kind:"bureau"는 국·단 24개(폐지 3건·중복 1건 반영, 소방안전본부 이동 후)를 한 페이지로 돌려주고 현행 조직 대조를 담는다', () => {
  const r = digestQuery(digest, { tier: 'do', kind: 'bureau' });
  assert.equal(r.matched, 24); assert.equal(r.returned, 24); assert.equal(r.next_offset, null, '한 페이지에 다 실려야 함');
  assert.ok(JSON.stringify(r.entries).length <= 5500);
  assert.ok(r.entries.every(e => e.org && e.org.status));
  assert.equal(r.entries.find(e => e.name === '미래산업국').org.current_name, '미래산업국');
  assert.ok(r.entries.some(e => e.name === '기후에너지국'), '신설 국이 이제 실제로 인벤토리에 있어야 함');
});

await test('compactEntry: 비어 있는 필드는 빼고 긴 문장은 줄인다', () => {
  const c = compactEntry({ name: 'A', state: 'draft', does: ['가'.repeat(200)], cannot: [], unverified: [] });
  assert.deepEqual(Object.keys(c), ['name', 'state', 'does']); assert.ok(c.does[0].length <= 90);
});
await test('마크다운 조각: 각 조각은 대화 창 첨부 한도(파일당 2만 자) 이내이고 모든 항목을 담는다', () => {
  const chunks = toMarkdownChunks(digest);
  for (const c of chunks) assert.ok(c.text.length <= 20000, `${c.name} ${c.text.length}자`);
  const heads = chunks.reduce((n, c) => n + (c.text.match(/^### /gm) || []).length, 0);
  assert.equal(heads, Object.values(expected).reduce((a, b) => a + b, 0));
  assert.equal(new Set(chunks.map(c => c.name)).size, chunks.length);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
