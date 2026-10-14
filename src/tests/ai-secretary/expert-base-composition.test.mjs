// expert-base-composition.test.mjs (2026-08-07 신설)
// 실행: node --experimental-test-module-mocks --test src/tests/ai-secretary/expert-base-composition.test.mjs
//
// HANDOFF_2026-08-07_SP-EXPERT-BASE-전체롤아웃계획 §6-2·6-3·6-4 검증.
// 기존 expert-session-switch.test.mjs는 2026-08-06 아카이브된
// startExpertSession 등 same-thread 함수를 여전히 import하고 있어
// (expert-session.js 파일 헤더 참조) 그 부분이 이미 실패 상태다 — 이
// 파일은 그와 무관하게 _composeExpertPrompt()만 독립적으로 검증한다.
//
// 검증 대상:
// ① EXPERT_BASE가 공통 가드레일(및 의료 안전모듈) 다음, 개별 SP 이전에
//    정확히 한 번 결합되는가(H2 캐시 프리픽스 순서, SP_EXPERT_BASE §6).
// ② def.parentKey가 있으면 EXPERT_BASE 다음·리프 SP 이전에 부모 SP
//    원문이 삽입되는가(SP_EXPERT_BASE §5).
// ③ parentKey가 없는 기존 62개 페르소나는 EXPERT_BASE 삽입 외에
//    조립 동작이 그대로인가(회귀 없음).
// ④ 부모 SP 자신이 또 parentKey를 갖는 잘못된 등록(3단 초과)은
//    경고만 내고 2단째 부모를 건너뛰는가(무한 재귀 방지).

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = {
  addEventListener: () => {}, getElementById: () => null,
  createElement: () => ({}), querySelector: () => null,
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const SP_FILES = {
  'sp-catalog.json': JSON.stringify({
    'UNIVERSAL-INTEGRITY': 'UNIVERSAL-INTEGRITY_v1_0.md',
    'TASK-DELEGATION-GUIDE': 'TASK-DELEGATION-GUIDE_v1_0.md',
    'CONTROL-TOWER-PRINCIPLE': 'CONTROL-TOWER-PRINCIPLE_v1_0.md',
    'UNIVERSAL-common': 'UNIVERSAL-common_v1_0.md',
    'PROFESSIONAL-common': 'PROFESSIONAL-common_v1_0.md',
    'SP_common_guardrails': 'SP_common_guardrails_v1_0.md',
    'SP_common_medical_safety': 'SP_common_medical_safety_v1_0.md',
    'SP_EXPERT_BASE': 'SP_EXPERT_BASE_v1_0.md',
    'SP_DOC_FORM': 'SP_DOC_FORM_v1_0.md',
    'SP_physician': 'SP_physician_v1_0.md',
    'SP_physician-internal-medicine': 'SP_physician-internal-medicine_v1_0.md',
    'SP_lawyer': 'SP_lawyer_v4_8.md',
    'SP_lawyer-criminal': 'SP_lawyer-criminal_v1_0.md',
    // §6-4 경고 케이스(부모의 부모) 검증용 가상 픽스처
    'SP_grandparent': 'SP_grandparent_v1_0.md',
    'SP_parent-with-own-parent': 'SP_parent-with-own-parent_v1_0.md',
    'SP_child-of-bad-parent': 'SP_child-of-bad-parent_v1_0.md',
  }),
  'UNIVERSAL-INTEGRITY_v1_0.md': '[UNIVERSAL-INTEGRITY 원문]',
  'TASK-DELEGATION-GUIDE_v1_0.md': '[TASK-DELEGATION-GUIDE 원문]',
  'CONTROL-TOWER-PRINCIPLE_v1_0.md': '[CONTROL-TOWER-PRINCIPLE 원문]',
  'UNIVERSAL-common_v1_0.md': '[UNIVERSAL-common 원문]',
  'PROFESSIONAL-common_v1_0.md': '[PROFESSIONAL-common 원문]',
  'SP_common_guardrails_v1_0.md': '[공통 가드레일 원문]',
  'SP_common_medical_safety_v1_0.md': '[의료 안전모듈 원문]',
  'SP_EXPERT_BASE_v1_0.md': '[EXPERT_BASE 골격 원문]',
  'SP_DOC_FORM_v1_0.md': '[서식 SP 원문]',
  'SP_physician_v1_0.md': '[의사(부모) SP 원문]',
  'SP_physician-internal-medicine_v1_0.md': '[내과(자식) SP 원문]',
  'SP_lawyer_v4_8.md': '[변호사 페르소나 SP 원문]',
  'SP_lawyer-criminal_v1_0.md': '[형사법(변호사 자식) SP 원문]',
  'SP_grandparent_v1_0.md': '[조부모 SP 원문 — 로드되면 안 됨]',
  'SP_parent-with-own-parent_v1_0.md': '[부모(자기도 parentKey 있음) SP 원문]',
  'SP_child-of-bad-parent_v1_0.md': '[자식(3단 초과 케이스) SP 원문]',
};

globalThis.fetch = async (url) => {
  const u = String(url);
  const fname = u.split('/').pop();
  const content = SP_FILES[fname];
  if (content == null) return { ok: false, status: 404 };
  return { ok: true, text: async () => content, json: async () => JSON.parse(content) };
};

mock.module(new URL('../../gopang/pdv/record.js', import.meta.url), {
  namedExports: { _recordPDV: async () => ({ ok: true }) },
});
mock.module(new URL('../../gopang/ai/report-utils.js', import.meta.url), {
  namedExports: {
    summarizeTranscript6W: async () => ({ who: 'u', when: 't', where: 'w', what: '', how: 'h', why: 'y' }),
    summarizeHandoffContext6W: async () => null,
  },
});
mock.module(new URL('../../gopang/gwp/engine.js', import.meta.url), {
  namedExports: { _gwpLaunch: () => {} },
});

const { _composeExpertPrompt } = await import(new URL('../../gopang/ai/expert-session.js', import.meta.url));
const { EXPERT_REGISTRY } = await import(new URL('../../gopang/ai/expert-registry.js', import.meta.url));

describe('§6-2 — EXPERT_BASE 조립 순서', () => {
  test('일반 페르소나(부모 없음): 가드레일 → EXPERT_BASE → 개별 SP 순서로 정확히 1회씩 결합', async () => {
    const def = { key: 'SP_lawyer', label: '변호사', needsMedicalSafety: false };
    const composed = await _composeExpertPrompt(def);

    assert.ok(composed.includes('EXPERT_BASE 골격 원문'), 'EXPERT_BASE가 조립에서 빠짐');
    assert.ok(composed.includes('변호사 페르소나 SP 원문'), '리프 SP가 조립에서 빠짐');

    const idxGuardrails = composed.indexOf('공통 가드레일 원문');
    const idxBase = composed.indexOf('EXPERT_BASE 골격 원문');
    const idxLeaf = composed.indexOf('변호사 페르소나 SP 원문');
    assert.ok(idxGuardrails < idxBase, 'EXPERT_BASE가 공통 가드레일보다 먼저 옴 — 순서 위반');
    assert.ok(idxBase < idxLeaf, 'EXPERT_BASE가 리프 SP보다 뒤에 옴 — 순서 위반');

    const baseCount = composed.split('EXPERT_BASE 골격 원문').length - 1;
    assert.equal(baseCount, 1, `EXPERT_BASE가 ${baseCount}회 삽입됨 — 정확히 1회여야 함`);
  });

  test('의료 페르소나: 의료 안전모듈 → EXPERT_BASE 순서 유지', async () => {
    const def = { key: 'SP_physician', label: '의사', needsMedicalSafety: true };
    const composed = await _composeExpertPrompt(def);

    const idxMed = composed.indexOf('의료 안전모듈 원문');
    const idxBase = composed.indexOf('EXPERT_BASE 골격 원문');
    assert.ok(idxMed >= 0, '의료 안전모듈이 조립에서 빠짐');
    assert.ok(idxMed < idxBase, 'EXPERT_BASE가 의료 안전모듈보다 먼저 옴 — 순서 위반');
  });
});

describe('§6-3·6-4 — parentKey 재귀 상속(세부분야 SP)', () => {
  test('parentKey가 있으면 EXPERT_BASE 다음·리프 SP 이전에 부모 SP 원문이 삽입됨', async () => {
    // physician-internal-medicine이 실제로 EXPERT_REGISTRY에 등록돼 있지
    // 않아도(§7 순서상 아직 미착수), _composeExpertPrompt는 def 자체와
    // EXPERT_REGISTRY[def.parentKey] 조회만으로 동작해야 한다 — 여기서는
    // 가상 def로 메커니즘만 검증한다(실제 physician-internal-medicine SP
    // 작성은 §5 착수 시점에 별도 진행).
    const originalPhysician = EXPERT_REGISTRY.physician;
    EXPERT_REGISTRY.physician = { key: 'SP_physician', label: '의사', needsMedicalSafety: true };
    try {
      const childDef = {
        key: 'SP_physician-internal-medicine', label: '의사(내과)',
        needsMedicalSafety: true, parentKey: 'physician',
      };
      const composed = await _composeExpertPrompt(childDef);

      const idxBase = composed.indexOf('EXPERT_BASE 골격 원문');
      const idxParent = composed.indexOf('의사(부모) SP 원문');
      const idxChild = composed.indexOf('내과(자식) SP 원문');
      assert.ok(idxBase >= 0 && idxParent >= 0 && idxChild >= 0, '3단 중 일부가 조립에서 누락됨');
      assert.ok(idxBase < idxParent, 'EXPERT_BASE가 부모 SP보다 뒤에 옴 — 순서 위반');
      assert.ok(idxParent < idxChild, '부모 SP가 자식(리프) SP보다 뒤에 옴 — 순서 위반');
    } finally {
      EXPERT_REGISTRY.physician = originalPhysician;
    }
  });

  test('parentKey가 미등록 id를 가리키면 경고만 내고 조립은 계속됨(부모 없이 진행)', async () => {
    const def = {
      key: 'SP_lawyer', label: '고아 SP', needsMedicalSafety: false,
      parentKey: 'nonexistent-parent-id',
    };
    const composed = await _composeExpertPrompt(def);
    assert.ok(composed.includes('변호사 페르소나 SP 원문'), '부모 미등록이어도 리프 SP는 로드돼야 함');
  });

  test('2026-08-08 개정: 부모 SP가 또 parentKey를 가지면(3단 이상) 루트부터 순서대로 전부 로드됨', async () => {
    // 구 동작(§6-4 구판): 2단째 부모는 경고만 내고 건너뜀.
    // 신 동작(§6-4 N단 재귀 개정, HANDOFF_교수-교과계열-계층설계): professor
    // → 중계열 → 소계열 같은 3단 이상 체인을 실제로 전부 조립해야 하므로,
    // 조상을 전부 루트부터 순서대로 삽입하도록 바뀌었다 — 이 테스트는 그
    // 새 동작을 검증한다(구 테스트를 대체).
    EXPERT_REGISTRY['parent-with-own-parent'] = {
      key: 'SP_parent-with-own-parent', label: '중간부모',
      needsMedicalSafety: false, parentKey: 'grandparent',
    };
    EXPERT_REGISTRY['grandparent'] = {
      key: 'SP_grandparent', label: '조부모', needsMedicalSafety: false,
    };
    try {
      const childDef = {
        key: 'SP_child-of-bad-parent', label: '3단 자식',
        needsMedicalSafety: false, parentKey: 'parent-with-own-parent',
      };
      const composed = await _composeExpertPrompt(childDef);

      const idxBase = composed.indexOf('EXPERT_BASE 골격 원문');
      const idxGrandparent = composed.indexOf('조부모 SP 원문');
      const idxParent = composed.indexOf('부모(자기도 parentKey 있음) SP 원문');
      const idxChild = composed.indexOf('자식(3단 초과 케이스) SP 원문');

      assert.ok(idxGrandparent >= 0, '조부모(루트 조상)가 조립에서 빠짐 — N단 재귀 미동작');
      assert.ok(idxParent >= 0, '중간부모가 조립에서 빠짐');
      assert.ok(idxChild >= 0, '리프(자식) SP가 조립에서 빠짐');
      assert.ok(idxBase < idxGrandparent, 'EXPERT_BASE가 최상위 조상보다 뒤에 옴 — 순서 위반');
      assert.ok(idxGrandparent < idxParent, '조부모가 중간부모보다 뒤에 옴 — 루트부터 순서로 안 실림');
      assert.ok(idxParent < idxChild, '중간부모가 리프보다 뒤에 옴 — 순서 위반');
    } finally {
      delete EXPERT_REGISTRY['parent-with-own-parent'];
      delete EXPERT_REGISTRY['grandparent'];
    }
  });

  test('순환 참조(A→B→A)는 무한루프 없이 경고 후 중단, 리프 SP는 그래도 로드됨', async () => {
    EXPERT_REGISTRY['cycle-a'] = { key: 'SP_cycle-a', label: '순환A', needsMedicalSafety: false, parentKey: 'cycle-b' };
    EXPERT_REGISTRY['cycle-b'] = { key: 'SP_cycle-b', label: '순환B', needsMedicalSafety: false, parentKey: 'cycle-a' };
    try {
      const childDef = {
        key: 'SP_child-of-bad-parent', label: '순환참조 자식',
        needsMedicalSafety: false, parentKey: 'cycle-a',
      };
      const composed = await _composeExpertPrompt(childDef);
      assert.ok(composed.includes('자식(3단 초과 케이스) SP 원문'), '순환 참조가 있어도 리프 SP는 로드돼야 함');
    } finally {
      delete EXPERT_REGISTRY['cycle-a'];
      delete EXPERT_REGISTRY['cycle-b'];
    }
  });

  test('조상 체인이 최대 깊이(5단)를 넘으면 그 이후 조상은 무시하고 리프는 로드됨', async () => {
    // L1←L2←L3←L4←L5←L6←leaf : 조상만 6단이라 깊이 초과
    const levels = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
    levels.forEach((key, i) => {
      EXPERT_REGISTRY[key] = {
        key: `SP_${key}`, label: key, needsMedicalSafety: false,
        parentKey: i > 0 ? levels[i - 1] : undefined,
      };
    });
    try {
      const childDef = {
        key: 'SP_child-of-bad-parent', label: '깊이초과 자식',
        needsMedicalSafety: false, parentKey: 'l6',
      };
      const composed = await _composeExpertPrompt(childDef);
      assert.ok(composed.includes('자식(3단 초과 케이스) SP 원문'), '깊이 초과해도 리프 SP는 로드돼야 함');
    } finally {
      levels.forEach((key) => delete EXPERT_REGISTRY[key]);
    }
  });
});

describe('§6-2 회귀 — 기존 조립 동작 유지', () => {
  test('UNIVERSAL-INTEGRITY·UNIVERSAL-common·PROFESSIONAL-common·공통가드레일 전부 여전히 결합됨', async () => {
    const def = { key: 'SP_lawyer', label: '변호사', needsMedicalSafety: false };
    const composed = await _composeExpertPrompt(def);
    for (const marker of [
      'UNIVERSAL-INTEGRITY 원문', 'UNIVERSAL-common 원문',
      'PROFESSIONAL-common 원문', '공통 가드레일 원문',
    ]) {
      assert.ok(composed.includes(marker), `${marker} 결합이 EXPERT_BASE 신설로 인해 깨짐 — 회귀`);
    }
  });
});

describe('SP-COMMON-07 — 서식 SP(SP_DOC_FORM) 조립', () => {
  test('서류 작성 페르소나(변호사): EXPERT_BASE → 서식 SP → 리프 SP 순서로 정확히 1회 결합', async () => {
    const def = { key: 'SP_lawyer', label: '변호사', needsMedicalSafety: false };
    const composed = await _composeExpertPrompt(def);
    const idxBase = composed.indexOf('EXPERT_BASE 골격 원문');
    const idxForm = composed.indexOf('서식 SP 원문');
    const idxLeaf = composed.indexOf('변호사 페르소나 SP 원문');
    assert.ok(idxForm >= 0, '서식 SP가 조립에서 빠짐');
    assert.ok(idxBase < idxForm, '서식 SP가 EXPERT_BASE보다 먼저 옴 — 순서 위반');
    assert.ok(idxForm < idxLeaf, '서식 SP가 리프 SP보다 뒤에 옴 — 순서 위반');
    assert.equal(composed.split('서식 SP 원문').length - 1, 1, '서식 SP는 정확히 1회여야 함');
  });

  test('서류 작성 직역의 세부분야(parentKey 체인): 서식 SP가 부모 SP 앞에 결합', async () => {
    const childDef = { key: 'SP_lawyer-criminal', label: '변호사(형사법)', needsMedicalSafety: false, parentKey: 'lawyer' };
    const composed = await _composeExpertPrompt(childDef);
    const idxForm = composed.indexOf('서식 SP 원문');
    const idxParent = composed.indexOf('변호사 페르소나 SP 원문');
    assert.ok(idxForm >= 0, '세부분야에 서식 SP가 결합되지 않음');
    assert.ok(idxForm < idxParent, '서식 SP가 부모 SP보다 뒤에 옴 — 순서 위반');
    assert.equal(composed.split('서식 SP 원문').length - 1, 1, '서식 SP는 정확히 1회여야 함');
  });

  test('서식 학습형 직역(의사): 서식 SP를 결합(서류 목록을 이용자가 알려 주는 직역)', async () => {
    const def = { key: 'SP_physician', label: '의사', needsMedicalSafety: true };
    const composed = await _composeExpertPrompt(def);
    assert.ok(composed.includes('서식 SP 원문'), '서식 학습형 직역에 서식 SP가 결합되지 않음');
    assert.equal(composed.split('서식 SP 원문').length - 1, 1, '서식 SP는 정확히 1회여야 함');
  });

  test('서식 작업 대상이 아닌 페르소나(교수): 서식 SP를 결합하지 않음', async () => {
    const def = { key: 'SP_professor-law', label: '법학 교수', needsMedicalSafety: false };
    const composed = await _composeExpertPrompt(def);
    assert.ok(!composed.includes('서식 SP 원문'), '교수 페르소나에 서식 SP가 결합됨');
  });
});
