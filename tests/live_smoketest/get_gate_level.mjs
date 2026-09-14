// tests/live_smoketest/get_gate_level.mjs (2026-09-14 신설)
//
// dump_leaves.mjs(getLeafDescendants로 전체 리프를 한 번에 flat하게
// 뽑던 방식)를 대체한다. subject-gate.js가 2026-08-10에 flat→계층형으로
// 리팩터된 뒤로 실제 refineToLeaf()는 한 번에 "직계 자식만" 보고 한
// 단계씩 내려가는데, dump_leaves.mjs는 그 리팩터 이전 방식(전체 158+
// 리프를 한 프롬프트에) 그대로 남아 있었다 — 그래서 subject_gate_live_
// smoketest.py가 production과 다른(훨씬 큰) 후보 메뉴로 채점해왔다
// (2026-09-14, professor-06-hard-adjacent가 reasoning_tokens 소진으로
// 빈 응답을 낸 걸 계기로 발견).
//
// 이 스크립트는 주어진 id 하나에 대해 "그 자리에서 refineToLeaf()가
// 실제로 보는 것"만 출력한다 — getConsultableChildren()으로 직계 자식만
// 가져오고, _buildGateCandidates()로 "해당 없음" 항목까지 더한 뒤 그대로
// JSON으로 낸다. Python 하네스가 이걸 매 레벨마다 서브프로세스로 호출해,
// refineToLeaf()의 for 루프를 그대로 재현한다(재구현이 아니라 production
// 함수를 그대로 통과시키는 것 — dump_leaves.mjs와 동일 원칙).
//
// Usage: node get_gate_level.mjs <id>
// 출력: {"kind": "leaf"} | {"kind": "passthrough", "childId": "..."} |
//       {"kind": "gate", "candidates": [{id,label,menuLine,...}, ...]}

globalThis.window = globalThis;
globalThis.location = globalThis.location || { origin: 'https://hondi.net' };
globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});

import { getConsultableChildren } from '../../src/gopang/ai/expert-registry.js';
import { _leafMenuLine, _buildGateCandidates } from '../../src/gopang/ai/subject-gate.js';

const id = process.argv[2];
if (!id) {
  console.error('Usage: node get_gate_level.mjs <id>');
  process.exit(1);
}

// refineToLeaf()의 for 루프 본문과 정확히 동일한 분기(subject-gate.js
// 참고) — children.length에 따라 세 갈래.
const children = getConsultableChildren(id);

let out;
if (children.length === 0) {
  out = { kind: 'leaf' };
} else if (children.length === 1) {
  out = { kind: 'passthrough', childId: children[0].id };
} else {
  const candidates = _buildGateCandidates(id, children);
  out = {
    kind: 'gate',
    candidates: candidates.map((c) => ({ ...c, menuLine: _leafMenuLine(c) })),
  };
}

process.stdout.write(JSON.stringify(out));
