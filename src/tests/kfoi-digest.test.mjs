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
const data = loadPageData();
const expected = {
  do: data.DO_BUREAUS.length + data.DO_BUREAUS.reduce((n, b) => n + (b.divisions || []).length, 0),
  agency: data.DO_AGENCIES.length + data.DO_AGENCIES.reduce((n, b) => n + (b.divisions || []).length, 0),
  org: data.DO_ORGS.length + data.DO_ORGS.reduce((n, b) => n + (b.divisions || []).length, 0),
  'jeju-si': data.JEJUSI_BUREAUS.length + data.JEJUSI_BUREAUS.reduce((n, b) => n + (b.divisions || []).length, 0),
  seogwipo: data.SEOGWIPO_BUREAUS.length + data.SEOGWIPO_BUREAUS.reduce((n, b) => n + (b.divisions || []).length, 0),
  emd: data.EMD_LIST.length,
};
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
