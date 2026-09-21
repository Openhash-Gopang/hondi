/**
 * tests/kaddress-org-handler.test.mjs
 * ------------------------------------------------------------------
 * src/worker/kaddress-org-handler.js의 순수 함수(네트워크 없음) 단위 테스트.
 * 실행: node --test tests/kaddress-org-handler.test.mjs
 *
 * 핸들러 자체(PocketBase 호출)는 로컬 PocketBase 0.22.14에 마이그레이션
 * 1794010001·1794010002를 적용한 통합 테스트로 별도 검증했다(2026-09-21).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOrgName, normalizeAliases, buildPath, orgPathFilterClause, validatePathParam,
  collectSubtree, planSubtreeRewrite, computeExpected, aggregateCounts,
  SEED_TEMPLATE, ORG_MAX_DEPTH, ORG_UNASSIGNED,
} from '../src/worker/kaddress-org-handler.js';

// 테스트용 트리:  학교(1) > 대학(2) > 제주대학교(3) > 컴퓨터공학과(4)
//                                  > 제주대학교병원(3)   (접두어를 공유하는 형제)
const N = (id, name, parent_id, path, depth) => ({ id, name, parent_id, path, depth });
const tree = () => [
  N('a1', '학교', '', '학교', 1),
  N('a2', '대학', 'a1', '학교>대학', 2),
  N('a3', '제주대학교', 'a2', '학교>대학>제주대학교', 3),
  N('a4', '컴퓨터공학과', 'a3', '학교>대학>제주대학교>컴퓨터공학과', 4),
  N('a5', '제주대학교병원', 'a2', '학교>대학>제주대학교병원', 3),
  N('b1', '기업', '', '기업', 1),
];

test('validateOrgName: 정상 입력은 앞뒤 공백 제거·연속 공백 축약', () => {
  assert.deepEqual(validateOrgName('  제주   대학교 '), { ok: true, name: '제주 대학교' });
});
test('validateOrgName: 경로 구분자·LIKE 와일드카드·역슬래시·예약어·빈 값·길이 초과 거부', () => {
  for (const bad of ['가>나', '100%', 'a\\b', '__NONE__', '', '   ', 'x'.repeat(101), 'a\u0001b', 'a\u0000b', 42, null]) {
    assert.equal(validateOrgName(bad).ok, false, `거부돼야 함: ${JSON.stringify(bad)}`);
  }
  assert.equal(validateOrgName('x'.repeat(100)).ok, true);
});
test('validateOrgName: 줄바꿈·탭 같은 공백류는 거부가 아니라 공백 하나로 정규화', () => {
  assert.deepEqual(validateOrgName('제주\n대학교'), { ok: true, name: '제주 대학교' });
  assert.deepEqual(validateOrgName('제주\t\t대학교'), { ok: true, name: '제주 대학교' });
});
test("validateOrgName: 작은따옴표·영문·기호 이름은 허용(예: Children's Hospital)", () => {
  assert.equal(validateOrgName("Children's Hospital").ok, true);
  assert.equal(validateOrgName('정부·공공기관').ok, true);
});
test('normalizeAliases: 중복·공백 정리, 잘못된 항목·개수 초과 거부', () => {
  assert.deepEqual(normalizeAliases([' 제주대 ', '제주대', 'JNU']), { ok: true, aliases: ['제주대', 'JNU'] });
  assert.equal(normalizeAliases('x').ok, false);
  assert.equal(normalizeAliases(['ok', 'a>b']).ok, false);
  assert.equal(normalizeAliases(Array.from({ length: 21 }, (_, i) => `n${i}`)).ok, false);
});
test('buildPath', () => {
  assert.equal(buildPath('', '학교'), '학교');
  assert.equal(buildPath('학교>대학', '제주대학교'), '학교>대학>제주대학교');
});

test('orgPathFilterClause: 정확 일치 OR "경로>" 접두 — 형제 접두어를 잡지 않는 형태', () => {
  assert.equal(orgPathFilterClause('학교>대학>제주대학교'),
    "(org_path='학교>대학>제주대학교' || org_path~'학교>대학>제주대학교>%')");
  // 이스케이프
  assert.match(orgPathFilterClause("O'Neil"), /org_path='O\\'Neil'/);
  // 의미 검증(JS로 같은 규칙을 흉내): 병원은 제외, 자신·하위는 포함
  const X = '학교>대학>제주대학교';
  const match = p => p === X || p.startsWith(X + '>');
  assert.equal(match('학교>대학>제주대학교'), true);
  assert.equal(match('학교>대학>제주대학교>컴퓨터공학과'), true);
  assert.equal(match('학교>대학>제주대학교병원'), false);
});
test('validatePathParam', () => {
  assert.deepEqual(validatePathParam(''), { ok: true, path: '' });
  assert.deepEqual(validatePathParam(ORG_UNASSIGNED), { ok: true, path: ORG_UNASSIGNED });
  assert.deepEqual(validatePathParam(' 학교>대학 '), { ok: true, path: '학교>대학' });
  assert.equal(validatePathParam('a%b').ok, false);
  assert.equal(validatePathParam('a\\b').ok, false);
  assert.equal(validatePathParam('x'.repeat(1001)).ok, false);
});

test('collectSubtree: 루트 + 하위 전부, 부모→자식 순, 형제 접두어 노드는 제외', () => {
  const ids = collectSubtree(tree(), 'a3').map(n => n.id);
  assert.deepEqual(ids, ['a3', 'a4']);
  assert.deepEqual(collectSubtree(tree(), 'zz'), []);
});

test('planSubtreeRewrite: 이름 변경 — 하위 경로 전부 갱신, 병원(형제)은 그대로', () => {
  const plan = planSubtreeRewrite(tree(), 'a3', { name: '제주대' });
  assert.equal(plan.ok, true);
  assert.equal(plan.newRootPath, '학교>대학>제주대');
  assert.deepEqual(plan.entries.map(e => [e.id, e.newPath]),
    [['a3', '학교>대학>제주대'], ['a4', '학교>대학>제주대>컴퓨터공학과']]);
  assert.deepEqual(plan.entries[0].patch, { path: '학교>대학>제주대', name: '제주대' });
  assert.deepEqual(plan.entries[1].patch, { path: '학교>대학>제주대>컴퓨터공학과' }); // depth 그대로
});
test('planSubtreeRewrite: 이동 — 깊이 이동량이 하위에 전파, parent_id는 루트에만', () => {
  // 제주대학교(+컴퓨터공학과)를 기업 아래로: 깊이 3→2, 4→3
  const plan = planSubtreeRewrite(tree(), 'a3', { parent: tree().find(n => n.id === 'b1') });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.entries.map(e => [e.newPath, e.newDepth]),
    [['기업>제주대학교', 2], ['기업>제주대학교>컴퓨터공학과', 3]]);
  assert.equal(plan.entries[0].patch.parent_id, 'b1');
  assert.equal('parent_id' in plan.entries[1].patch, false);
});
test('planSubtreeRewrite: 루트로 이동(parent=null)', () => {
  const plan = planSubtreeRewrite(tree(), 'a3', { parent: null });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.entries.map(e => [e.newPath, e.newDepth]), [['제주대학교', 1], ['제주대학교>컴퓨터공학과', 2]]);
  assert.equal(plan.entries[0].patch.parent_id, '');
});
test('planSubtreeRewrite: 자기 자신·자기 하위로 이동은 CYCLE', () => {
  const t = tree();
  assert.equal(planSubtreeRewrite(t, 'a3', { parent: t.find(n => n.id === 'a3') }).code, 'CYCLE');
  assert.equal(planSubtreeRewrite(t, 'a3', { parent: t.find(n => n.id === 'a4') }).code, 'CYCLE');
});
test('planSubtreeRewrite: 최대 깊이 초과는 TOO_DEEP, 없는 노드는 UNIT_NOT_FOUND', () => {
  const deep = [];
  let parent = '', path = '';
  for (let d = 1; d <= ORG_MAX_DEPTH; d++) {
    path = buildPath(path, `n${d}`);
    deep.push(N(`d${d}`, `n${d}`, parent, path, d));
    parent = `d${d}`;
  }
  const other = N('x1', '다른', '', '다른', 1);
  const nodes = [...deep, other];
  // 다른(깊이1)을 최하위 노드 밑으로 → 깊이 13
  assert.equal(planSubtreeRewrite(nodes, 'x1', { parent: deep[deep.length - 1] }).code, 'TOO_DEEP');
  assert.equal(planSubtreeRewrite(tree(), 'nope', { name: 'x' }).code, 'UNIT_NOT_FOUND');
});
test('planSubtreeRewrite: 변화 없으면 patch가 비어 있다', () => {
  const plan = planSubtreeRewrite(tree(), 'a3', {});
  assert.equal(plan.ok, true);
  assert.ok(plan.entries.every(e => Object.keys(e.patch).length === 0));
});
test('planSubtreeRewrite: path가 어긋난(드리프트) 트리에서도 parent_id 체인 기준으로 계산', () => {
  const t = tree();
  t.find(n => n.id === 'a4').path = '엉뚱한>경로'; // 드리프트
  const plan = planSubtreeRewrite(t, 'a3', { name: '제주대' });
  assert.equal(plan.entries[1].newPath, '학교>대학>제주대>컴퓨터공학과');
});

test('computeExpected: 정상 트리는 저장된 path/depth와 일치', () => {
  const t = tree();
  const { expected, orphans, cycles } = computeExpected(t);
  assert.deepEqual([orphans, cycles], [[], []]);
  for (const n of t) assert.deepEqual(expected.get(n.id), { path: n.path, depth: n.depth });
});
test('computeExpected: 드리프트·고아·순환 탐지', () => {
  const t = tree();
  t.find(n => n.id === 'a4').path = '틀린경로';
  t.find(n => n.id === 'a4').depth = 9;
  t.push(N('o1', '고아', 'ghost', '고아', 2));
  t.push(N('c1', 'C1', 'c2', 'C1', 1), N('c2', 'C2', 'c1', 'C2', 1));
  const { expected, orphans, cycles } = computeExpected(t);
  assert.deepEqual(expected.get('a4'), { path: '학교>대학>제주대학교>컴퓨터공학과', depth: 4 });
  assert.deepEqual(orphans, ['o1']);
  assert.deepEqual(cycles.sort(), ['c1', 'c2']);
  assert.equal(expected.has('o1') || expected.has('c1'), false);
});

test('aggregateCounts: 직접 건수가 모든 조상에 합산', () => {
  const direct = new Map([['a4', 2], ['a3', 1], ['a5', 4]]);
  const sub = aggregateCounts(tree(), direct);
  assert.equal(sub.get('a4'), 2);
  assert.equal(sub.get('a3'), 3);
  assert.equal(sub.get('a5'), 4);
  assert.equal(sub.get('a2'), 7);
  assert.equal(sub.get('a1'), 7);
  assert.equal(sub.has('b1'), false);
});

test('SEED_TEMPLATE: 모든 이름이 검증을 통과하고 경로가 중복되지 않는다', () => {
  const paths = new Set();
  for (const root of SEED_TEMPLATE) {
    assert.equal(validateOrgName(root.name).ok, true, root.name);
    assert.equal(paths.has(root.name), false);
    paths.add(root.name);
    for (const c of root.children) {
      assert.equal(validateOrgName(c).ok, true, c);
      const p = buildPath(root.name, c);
      assert.equal(paths.has(p), false, p);
      paths.add(p);
    }
  }
  assert.equal(paths.size, 23); // 9개 루트 + 14개 하위
});
