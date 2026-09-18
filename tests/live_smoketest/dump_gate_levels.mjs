// tests/live_smoketest/dump_gate_levels.mjs (2026-08-10 신설)
//
// subject-gate.js가 2026-08-10에 flat(전체 리프 후보 한 방)에서
// 계층형(직계 자식만 단계별로)으로 리팩터된 뒤 신설. dump_leaves.mjs는
// 여전히 유효하다(특정 root 아래 "전체 리프 카탈로그"를 뽑는 용도는
// 리팩터와 무관하게 그대로 필요 — 문서화·감사용). 이 스크립트는 그와
// 별개로, production의 실제 게이트 동작(각 단계에서 정확히 어떤 후보
// 목록을 모델에게 보여주는지)을 그대로 재현한다 — subject-gate.js의
// _buildGateCandidates와 expert-registry.js의 getConsultableChildren을
// 직접 import해서 쓴다(재구현 아님, 이전 세션과 동일 원칙).
//
// 출력: 주어진 root부터 BFS로 트리 전체를 순회하며, 직계 자식이 2개
// 이상인(=실제로 게이트 호출이 발생하는) 모든 노드에 대해
// { nodeId, nodeLabel, candidateCount, candidates: [...] }를 낸다.
// candidateCount가 너무 큰(예: 20+) 노드가 있으면 그 지점이 다음
// max_tokens/정확도 조정 우선순위다 — 실사 전에 이 스크립트로 먼저
// 구조적 규모부터 확인할 것.
//
// Usage: node dump_gate_levels.mjs professor

globalThis.window = globalThis;
globalThis.location = globalThis.location || { origin: 'https://hondi.net' };
globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});

import { getConsultableChildren, EXPERT_REGISTRY } from '../../src/gopang/ai/expert-registry.js';
import { _buildGateCandidates, _leafMenuLine, LEAF_SYNONYMS } from '../../src/gopang/ai/subject-gate.js';

const roots = process.argv.slice(2);
const gateLevels = [];

function walk(nodeId) {
  const children = getConsultableChildren(nodeId);
  if (children.length <= 1) {
    // 게이트 호출 없음(0개=리프, 1개=통과) — 자식이 있으면 계속 내려간다.
    if (children.length === 1) walk(children[0].id);
    return;
  }
  const candidates = _buildGateCandidates(nodeId, children);
  gateLevels.push({
    nodeId,
    nodeLabel: (EXPERT_REGISTRY[nodeId] || {}).label || null,
    candidateCount: candidates.length,
    candidates: candidates.map((c) => ({
      id: c.id,
      // 2026-09-18 추가 — runnerUp 2차 확인 호출(subject-gate.js의
      // _confirmRunnerUpFits)이 EXPERT_REGISTRY[id].label을 그대로 쓰므로,
      // 하네스가 같은 라벨을 재구현 없이 그대로 쓸 수 있게 여기서도 노출한다.
      label: (EXPERT_REGISTRY[c.id] || {}).label || null,
      menuLine: _leafMenuLine(c),
      hasSynonyms: Boolean(LEAF_SYNONYMS[c.id]),
    })),
  });
  for (const child of children) walk(child.id);
}

for (const root of roots) walk(root);

// 규모 요약을 맨 위에 얹어 max_tokens 우선순위를 한눈에 보게 한다.
const summary = gateLevels
  .map((g) => ({ nodeId: g.nodeId, candidateCount: g.candidateCount }))
  .sort((a, b) => b.candidateCount - a.candidateCount);

process.stdout.write(JSON.stringify({ summary, gateLevels }, null, 0));
