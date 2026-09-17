# -*- coding: utf-8 -*-
"""
tests/live_smoketest/gen_scenarios_full_routing_20260917.py
-------------------------------------------------------------
scenarios_full_routing_20260917.json 생성기 — SP 전수 목록 파악 후 각 SP당
"named"(SP/전문가 명칭을 사용자가 직접 언급) 1건 + "implied"(명칭 언급 없이
증상/필요만 말함) 1건, 총 2건씩 라이브 라우팅 스모크테스트 시나리오를
프로그램적으로 생성한다.

배경(2026-09-17 주피터 지시): "SP 목록을 파악하고, 각 SP마다 최소 2건의
발화 시나리오를 작성하되, 사용자가 SP 명칭을 언급하는 경우와 하지 않는
경우를 각기 하나씩 할당"

## 대상 SP 목록 확정 근거
"라우팅 테스트"(1단계 AC 라우팅 정확도)의 대상은 AC-PRO-CORE/subject-gate가
실제로 라우팅 판단을 내리는 두 축 — GWP_REGISTRY(K-서비스)와
EXPERT_REGISTRY(전문가 페르소나, top-level + subject-gate 리프)다.
gov-tree 산하 정부기관 SP(약 1,200여 개, prompts/gov-tree/)는 이미
gov24_corpus_live_smoketest.mjs(정부24 실제 민원 350건 기반)라는 별도
방법론으로 다뤄지고 있어(docs/HANDOFF_2026-09-14_routing-precision-testing.md
§3단계) 이 배치에서는 의도적으로 제외한다 — 기관 SP는 "명칭을 아느냐
모르느냐"가 아니라 "실제 민원 문구가 올바른 창구로 가느냐"가 핵심 질문이라
named/implied 이분법 자체가 잘 안 맞기도 한다.

확정된 SP 목록(2026-09-17 소스 대조 기준, gwp-registry.js/
expert-registry-*.js 파싱):
  - K-서비스(GWP_REGISTRY):      31개
  - 전문가 페르소나 최상위(top):  63개  (HANDOFF_2026-09-14의 "63개
    상위카테고리"와 일치 — 파서 정확성 교차검증됨)
  - 전문가 페르소나 세부리프(leaf): 443개 (subject-gate.js 2단계 게이트 대상)
  합계 537개 SP × 2건 = 1,074건 (사용자 지시 "1,000건"에 근접한 자연스러운
  경계 — 정확히 500개로 맞추려 임의로 SP를 잘라내는 대신 실제 등록부
  전수를 그대로 반영했다).

## 품질에 대한 알려진 한계 (다음 세션이 반드시 알아야 함)
이 스크립트는 **템플릿 로테이션 기반**으로 1,074건을 생성한다 —
gen_scenarios_batch2.py가 300건을 사람이 한 줄씩 손으로 쓴 것과 달리,
이 규모(537개 SP)에서는 전량 수작업이 현실적이지 않았다. 구체적으로:

  - "named" 발화는 label(예: "의사(피부과)"→"피부과 의사")을 5종
    문장 틀에 로테이션 삽입.
  - "implied" 발화는 등록된 triggers 배열에서 실제 단어를 뽑아 5종
    문장 틀에 삽입 — trigger 원문을 그대로 노출하는 경우가 gen_scenarios_
    batch2.py가 경계했던 "콜로키얼 패러프레이즈 부재" 문제에 해당할 수
    있다. 즉 라우팅이 "실패"로 나와도 그게 진짜 결함인지, 발화가 부자연
    스러워서인지 구분이 안 될 위험이 있다 — LIVE-FAIL 항목은 반드시
    raw_response와 발화 자연스러움을 함께 사람이 확인할 것.
  - triggers가 없는 노드(professor 중계열 47개 — subject-gate.js의
    GATE_SYNONYM_HINTS로만 라우팅되는 중간 계층)는 label의 괄호 안
    세부분야명을 대신 사용했다 — 이 경우 implied 발화가 named와 거의
    구분 안 될 만큼 유사해질 수 있다(중계열 자체가 이름 없이는 설명하기
    어려운 추상 카테고리라는 구조적 한계).
  - 이 세트는 채점 기준이 되는 expect_tag를 top-level 기준으로만 단다
    (leaf 항목도 tier는 harness 규약대로 "expert"로 통일하고, expect_tag는
    실제로 라이브 단일호출로 확인 가능한 1단계 부모 태그
    `[EXPERT: <parent_id>]`만 넣었다. 진짜 리프 기대값은 별도
    `leaf_target_id`/`leaf_note` 필드에 담아뒀다 — subject-gate 2단계
    게이트는 클라이언트 사이드 2차 호출이라 **1단계 AC 응답만 보는 라이브
    API 호출로는 검증 불가**하기 때문. leaf 항목이 LIVE-PASS로 나와도
    "부모까지만 확인됐다"는 뜻이지 리프까지 맞았다는 보장은 아니다 —
    리프까지의 실제 채점은 get_gate_level.mjs류의 계층형 재현 방식이
    필요하다. 이 파일은 우선 "발화 세트 자체"를 만드는 게 목적이고,
    leaf 전용 채점 스크립트는 별도 필요.)

## 사용법 (생성 + 라이브 실행)
    python3 gen_scenarios_full_routing_20260917.py
    # tests/live_smoketest/ 아래에 4개 파일 생성:
    #   scenarios_full_routing_20260917.json        (1,074건 전체)
    #   scenarios_full_routing_20260917_kservice.json    (62건 — K-서비스)
    #   scenarios_full_routing_20260917_expert-top.json  (126건 — 전문가 최상위)
    #   scenarios_full_routing_20260917_expert-leaf.json (886건 — 전문가 세부리프)
    #
    # 실행은 기존 routing_ABmention_live_smoketest.py를 그대로 재사용한다
    # (tier가 "kservice"/"expert"/"institution" 중 하나여야 채점되므로,
    #  이 생성기는 top/leaf 구분을 tier가 아니라 level 필드에 담아 규약을
    #  맞춰뒀다). 비용·시간을 아끼려면 규모가 작은 것부터 단계적으로:
    #
    #   cd tests/live_smoketest
    #   export DEEPSEEK_API_KEY=sk-xxxx
    #   python3 routing_ABmention_live_smoketest.py \
    #       --scenarios scenarios_full_routing_20260917_kservice.json \
    #       --out ../../results/routing-full/kservice
    #   python3 routing_ABmention_live_smoketest.py \
    #       --scenarios scenarios_full_routing_20260917_expert-top.json \
    #       --out ../../results/routing-full/expert-top
    #   # 위 두 개(총 188건)에서 큰 문제가 없는 걸 먼저 확인한 뒤, 규모가
    #   # 훨씬 큰(886건) leaf를 마지막에 실행 — LIVE-PASS는 "부모 태그까지만
    #   # 맞았다"는 뜻이므로 리프 자체 확인은 별도라는 점을 잊지 말 것.
    #   python3 routing_ABmention_live_smoketest.py \
    #       --scenarios scenarios_full_routing_20260917_expert-leaf.json \
    #       --out ../../results/routing-full/expert-leaf
"""
import json
import re
import os
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

def parse_kservices():
    with open(os.path.join(REPO_ROOT, 'gwp-registry.js'), encoding='utf-8') as f:
        content = f.read()
    start = content.find('const GWP_REGISTRY = [')
    end = content.find('\nconst', start + 10)
    if end == -1:
        end = content.find('\nexport', start + 10)
    snippet = content[start:end]
    out = []
    for m in re.finditer(r"\{\s*id:\s*'([a-zA-Z0-9_-]+)',\s*name:\s*'([^']*)',.*?\}", snippet, re.S):
        block = m.group(0)
        desc_m = re.search(r"description:\s*'([^']*)'", block)
        trig_m = re.search(r"triggers:\s*\[(.*?)\]", block, re.S)
        triggers = re.findall(r"'([^']+)'", trig_m.group(1)) if trig_m else []
        out.append({
            'id': m.group(1), 'name': m.group(2),
            'desc': desc_m.group(1) if desc_m else '',
            'triggers': triggers,
        })
    return out

def parse_expert_file(fn):
    with open(fn, encoding='utf-8') as f:
        content = f.read()
    lines = content.split('\n')
    entries, cur_id, cur_lines, depth = [], None, [], 0
    for line in lines:
        m = re.match(r"^\s*'?([a-zA-Z][a-zA-Z0-9_-]*)'?:\s*\{\s*$", line)
        if m and depth == 0:
            cur_id, cur_lines, depth = m.group(1), [line], 1
            continue
        if cur_id is not None:
            cur_lines.append(line)
            depth += line.count('{') - line.count('}')
            if depth <= 0:
                entries.append((cur_id, '\n'.join(cur_lines)))
                cur_id = None
    out = []
    for idv, body in entries:
        label_m = re.search(r"label:\s*'([^']*)'", body)
        label = label_m.group(1) if label_m else idv
        parent_m = re.search(r"parentKey:\s*'([^']*)'", body)
        trig_m = re.search(r"triggers:\s*\[(.*?)\]", body, re.S)
        triggers = re.findall(r"'([^']+)'", trig_m.group(1)) if trig_m else []
        out.append({'id': idv, 'label': label, 'parentKey': parent_m.group(1) if parent_m else None,
                    'triggers': triggers})
    return out

def parse_experts():
    files = [
        'src/gopang/ai/expert-registry-core.js',
        'src/gopang/ai/expert-registry-lawyer.js',
        'src/gopang/ai/expert-registry-physician.js',
        'src/gopang/ai/expert-registry-professor.js',
    ]
    out = []
    for fn in files:
        out.extend(parse_expert_file(os.path.join(REPO_ROOT, fn)))
    return out

def display_name(label):
    """'의사(피부과)' -> '피부과 의사' / '법무사' -> '법무사'"""
    m = re.match(r'^(.+?)\((.+)\)$', label)
    if m:
        base, detail = m.group(1), m.group(2)
        return f'{detail} {base}'
    return label

NAMED_TEMPLATES_EXPERT = [
    '{name} AI 불러줘',
    '{name}한테 상담받고 싶어요',
    '{name} 전문가랑 연결해 주세요',
    '{name} 쪽으로 문의드리고 싶습니다',
    '혼디야, {name} 불러줄 수 있어?',
]
IMPLIED_TEMPLATES_EXPERT = [
    '{kw} 문제로 고민 중인데 도와줄 사람 있을까요',
    '{kw} 때문에 어디에 물어봐야 할지 모르겠어요',
    '{kw} 관련해서 상담받고 싶은데 연결해 주세요',
    '요즘 {kw} 일로 계속 신경 쓰이는데 이런 것도 물어볼 수 있나요',
    '{kw} 이거 저 혼자 해결이 안 되는데 좀 도와주세요',
]
NAMED_TEMPLATES_KSERVICE = [
    '{name} 실행해줘',
    '{name} 열어줘',
    '{name} 서비스 이용하고 싶어요',
    '혼디야, {name} 불러줘',
    '{name} 쪽으로 연결해 주세요',
]
IMPLIED_TEMPLATES_KSERVICE = [
    '{kw} 관련해서 도와줄 수 있어?',
    '{kw} 때문에 그러는데 어떻게 해야 하나요',
    '{kw} 이거 좀 처리하고 싶은데요',
    '{kw} 문제가 생겼는데 상담받고 싶어요',
    '{kw} 관련 문의 좀 드릴게요',
]

def build_scenarios():
    kservices = parse_kservices()
    experts = parse_experts()
    rows = []
    no = 0

    for i, k in enumerate(kservices):
        no += 1
        t = NAMED_TEMPLATES_KSERVICE[i % len(NAMED_TEMPLATES_KSERVICE)]
        rows.append({
            'no': no, 'id': f"kservice-{k['id']}-named", 'tier': 'kservice',
            'target_id': k['id'], 'target_name': k['name'], 'variant': 'named',
            'utterance': t.format(name=k['name']),
            'expect_tag': f"[GWP: {k['id']}]",
        })
        no += 1
        cand = [t for t in k['triggers'] if t != k['name']] or k['triggers']
        kw = cand[i % len(cand)] if cand else k['desc'][:6]
        t2 = IMPLIED_TEMPLATES_KSERVICE[i % len(IMPLIED_TEMPLATES_KSERVICE)]
        rows.append({
            'no': no, 'id': f"kservice-{k['id']}-implied", 'tier': 'kservice',
            'target_id': k['id'], 'target_name': k['name'], 'variant': 'implied',
            'utterance': t2.format(kw=kw),
            'expect_tag': f"[GWP: {k['id']}]",
        })

    for i, e in enumerate(experts):
        dname = display_name(e['label'])
        level = 'leaf' if e['parentKey'] else 'top'
        # routing_ABmention_live_smoketest.py는 tier가 정확히 "kservice"/
        # "expert"/"institution" 셋 중 하나여야 채점 분기를 탄다(그 외 값은
        # 전부 LIVE-NEEDS-REVIEW로 새어버림) — level은 별도 필드로 보존.
        ac_expect_tag = f"[EXPERT: {e['id']}]" if level == 'top' else f"[EXPERT: {e['parentKey']}]"
        leaf_note = (
            None if level == 'top' else
            f"2단계 게이트에서 리프 {e['id']} 기대 — 1단계 AC 응답만 보는 "
            f"이 하네스로는 미검증, get_gate_level.mjs류 별도 하네스 필요"
        )
        no += 1
        t = NAMED_TEMPLATES_EXPERT[i % len(NAMED_TEMPLATES_EXPERT)]
        rows.append({
            'no': no, 'id': f"expert-{e['id']}-named", 'tier': 'expert', 'level': level,
            'target_id': e['id'], 'target_name': dname, 'variant': 'named',
            'parent_id': e['parentKey'],
            'utterance': t.format(name=dname),
            'expect_tag': ac_expect_tag,
            'leaf_target_id': e['id'] if level == 'leaf' else None,
            'leaf_note': leaf_note,
        })
        no += 1
        name_parts = {dname, e['label'], e['id']}
        cand = [t for t in e['triggers'] if t not in name_parts]
        if cand:
            kw = cand[i % len(cand)]
        elif e['triggers']:
            kw = e['triggers'][i % len(e['triggers'])]
        else:
            m = re.match(r'^(.+?)\((.+)\)$', e['label'])
            kw = m.group(2) if m else e['label']
        t2 = IMPLIED_TEMPLATES_EXPERT[i % len(IMPLIED_TEMPLATES_EXPERT)]
        rows.append({
            'no': no, 'id': f"expert-{e['id']}-implied", 'tier': 'expert', 'level': level,
            'target_id': e['id'], 'target_name': dname, 'variant': 'implied',
            'parent_id': e['parentKey'],
            'utterance': t2.format(kw=kw),
            'expect_tag': ac_expect_tag,
            'leaf_target_id': e['id'] if level == 'leaf' else None,
            'leaf_note': leaf_note,
        })

    return rows

if __name__ == '__main__':
    rows = build_scenarios()
    out_dir = os.path.join(REPO_ROOT, 'tests', 'live_smoketest')
    full_path = os.path.join(out_dir, 'scenarios_full_routing_20260917.json')
    with open(full_path, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f'{len(rows)}건 생성 -> {full_path}')

    splits = {
        'kservice': [r for r in rows if r['tier'] == 'kservice'],
        'expert-top': [r for r in rows if r['tier'] == 'expert' and r['level'] == 'top'],
        'expert-leaf': [r for r in rows if r['tier'] == 'expert' and r['level'] == 'leaf'],
    }
    for name, subset in splits.items():
        p = os.path.join(out_dir, f'scenarios_full_routing_20260917_{name}.json')
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(subset, f, ensure_ascii=False, indent=2)
        print(f'  - {name}: {len(subset)}건 -> {p}')
