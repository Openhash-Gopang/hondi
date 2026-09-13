#!/usr/bin/env python3
"""
Hondi profile-assistant LIVE smoketest against DeepSeek API — 두 개의
DeepSeek 에이전트(PA 역할 / 가상 가입자 역할)가 서로 멀티턴으로 대화하며
실제 profile-assistant SP(+UNIVERSAL-INTEGRITY+TASK-DELEGATION-GUIDE+
HONDI-CAPABILITIES-COMMON 합성, manifest-loader.js의 _loadSpByKey와 동일
순서)를 라이브로 실행한다. tests/live_smoketest/live_smoketest.py(AC-PRO-CORE
단일턴 라우팅 테스트)와 같은 계열이지만, profile-assistant는 멀티턴
STEP1~STEP-FINAL 흐름이라 별도 하네스로 분리했다.

[TEMPLATE_LOOKUP] 태그는 실제 L1 PocketBase를 호출하지 않고(운영 DB에
스모크테스트가 쓰기/읽기 부하를 주지 않기 위함, 그리고 DB seed 상태에
의존하지 않는 재현 가능한 테스트를 위함) 하네스가 클라이언트를 흉내 내
"(참조 사례 없음 — 최초 사례)"로 즉시 응답한다 — §TEMPLATE-REFERENCE의
계층 조회 자체는 이미 별도로 단위 테스트됐으므로(worker.js), 여기서는
PA의 대화 흐름 자체(STEP 진행·태그 출력 규칙 준수)만 검증한다.

Usage:
  DEEPSEEK_API_KEY=... python3 profile_assistant_smoketest.py \
      --scenarios profile_assistant_scenarios.json \
      --out ../../results/profile-assistant \
      --resume

Resumable: writes results incrementally to <out>/live_results.jsonl.
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-v4-flash"  # 2026-0X-XX 교정 — worker.js HONDI_TIER_MODELS['hondi-flash'].backendModel과 동일한 실제 프로덕션 모델(구값 'deepseek-chat'은 폐기 예정 레거시 별칭)
# 2026-0X-XX 신설 — §ESCALATE-TO-PRO(SP v2.28) 시험 적용. flash가 판단
# 곤란 신호를 내면 하네스도 프로덕션 클라이언트와 동일하게 이 모델로
# 같은 메시지를 재호출한다.
# 2026-0X-XX 신설 — hondi-pro(deepseek-v4-pro)는 thinking 모드가 의도적으로
# 켜져 있어(§ESCALATE-TO-PRO/코드강제 승격 둘 다 model=MODEL_PRO로 호출),
# 최종 답을 내기 전에 추론에 토큰을 먼저 쓴다. flash와 동일한 max_tokens=
# 1600을 그대로 쓰면 추론이 예산을 다 먹어버려 최종 응답이 완전히 빈
# 문자열로 끊기는 사례를 실측으로 확인(68건 재테스트 중 최소 3건 —
# 승격은 정확히 발동했는데 Pro 응답 자체가 비어 대화가 엉뚱하게 흘러간
# 경우). Pro 호출에는 여유 있는 예산을 별도로 준다.
MODEL_PRO = "deepseek-v4-pro"
PRO_MAX_TOKENS = 6000
MAX_TURNS = 20  # STEP1~STEP-FINAL이 정상이면 이 안에 끝나야 함(무한루프 방지).
# 2026-09-13 수정(14 → 20) — diverse-industries #10(복합업종)·
# industry-inference #102(한의원, TIER3) 두 건 모두 무한루프가 아니라
# 정상 흐름인 채로 STEP-FINAL 확인 직후(사용자가 "네, 맞아요"까지 답한
# 뒤) MAX_TURNS(14)에 걸려 PROFILE_SUBMIT 직전에 하네스가 강제 종료시킨
# 게 트랜스크립트로 실측 확인됨. TIER3·복합업종은 진료시간/서비스 상세·
# GDC+계좌(은행·계좌번호·예금주 3턴 분리) 등 §ONE-AT-A-TIME(한 턴 한 질문)
# 원칙상 정상적으로도 14턴을 넘기기 쉽다 — 실제 프로덕션(pages/
# profile-assistant.html)엔 이 턴 상한이 없으므로 사용자에게 영향 없는
# 하네스 전용 여유값 문제. 20은 잠정치이며, 더 복잡한 업종 실측이
# 쌓이면 재조정 필요.
MAX_WORKERS = 4  # 시나리오당 최대 2*MAX_TURNS 호출이 걸릴 수 있어 AC-PRO-CORE보다 낮춤
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3

PARTIAL_SAVE_RE = re.compile(r"\[PARTIAL_SAVE\]\s*(\{.*?\})(?=\n|\[|$)", re.DOTALL)
TEMPLATE_LOOKUP_RE = re.compile(r"\[TEMPLATE_LOOKUP:\s*([^\]]*)\]")
# 2026-0X-XX 수정 — 원래 단일 re.search(첫 매치)였는데, PROFILE_SUBMIT 재시도
# 안전장치의 [INTERNAL: ... PROFILE_SUBMIT { ... } 태그가 빠져서...] 지시문
# 자체를 모델이 그대로 에코(반복 출력)하는 경우가 실측 확인됐다(#92) — 그
# 안내문 안의 예시 "PROFILE_SUBMIT { ... }"가 먼저 매칭돼 진짜 JSON(그
# 뒤에 옴)을 놓치고 잘못된 3글자짜리 텍스트를 파싱하려다 실패했다.
# finditer로 모든 occurrence의 시작 위치를 찾아 _extract_last_valid_
# profile_submit()이 뒤에서부터(진짜 최종 응답에 가까운 순서로) 유효하게
# 파싱되는 첫 케이스를 채택한다.
PROFILE_SUBMIT_ALL_RE = re.compile(r"\[?PROFILE_SUBMIT\]?\s*(?=\{)")


def _extract_last_valid_profile_submit(text: str):
    """PROFILE_SUBMIT 뒤 '{' 시작 위치를 전부 찾아 마지막 것부터 역순으로
    중괄호 균형 매칭 + JSON 파싱을 시도, 처음으로 성공하는 결과를 반환.
    전부 실패하면 None."""
    starts = [m.end() for m in PROFILE_SUBMIT_ALL_RE.finditer(text)]
    for start in reversed(starts):
        raw = text[start:]
        depth, end = 0, None
        for i, ch in enumerate(raw):
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end is None:
            continue
        try:
            return json.loads(raw[:end])
        except (json.JSONDecodeError, ValueError):
            continue
    return None


# (2026-0X-XX 3차 수정) 확인요청 "문장"을 쫓는 접근 자체가 한계였다 —
# "맞으면"→"맞으시면"(존댓말), "눌러주세요"→"말씀해 주세요"(동사 변형)
# 등 자연어 패러프레이즈가 끝없이 이어졌다(10건 파일럿 3회 반복 실측).
# 대신 §PROFILE_CARD가 리터럴로 못박은 선행 이모지(모델이 잘 안 바꾸는
# 부분 — 10건 전부 카드 자체는 정확했음)를 신호로 쓴다. 같은 대화에서
# 이 카드 패턴이 2번째로 나오면(1번째=STEP-FINAL 확인요청, 2번째=완료
# 메시지) 완료 턴으로 간주한다.
CARD_LINE_RE = re.compile(r"^[ \t]*(🏪|👤|🏛|🤝|💻|🚗|🤖)\s", re.MULTILINE)
TERMINAL_TAGS = ["PROFILE_SUBMIT", "[PROFILE_SKIP]", "[PROFILE_INTERRUPT_HANDOFF]"]
FIELD_ADD_RE = re.compile(r"\[FIELD_ADD:")
FIELD_REMOVE_RE = re.compile(r"\[FIELD_REMOVE:")
# 2026-0X-XX 신설 — §ESCALATE-TO-PRO(SP v2.28) 감지용
ESCALATE_RE = re.compile(r"\[ESCALATE_TO_PRO:([^\]]*)\]")

# 2026-0X-XX 신설 — PROFILE_SUBMIT 재시도(클라이언트 patch C+D와 동일 원칙,
# 다만 하네스는 이미 card_seen_count로 "1번째=확인요청 카드/2번째=완료
# 카드"를 정확히 구분하고 있으므로 그 판정을 그대로 재시도 트리거로
# 쓴다 — 클라이언트의 단순 카드감지보다 오탐 위험이 낮다).
MAX_PROFILE_SUBMIT_RETRIES = 2

# 2026-0X-XX 신설 — FIELD_ADD/FIELD_REMOVE 클라이언트 안전장치와 짝을
# 맞추는 하네스 측 감지. PROFILE_SUBMIT과 달리 "카드가 몇 번째로
# 나왔는가" 같은 깔끔한 구조 신호가 없어, 사용자 발화의 추가/삭제 요청
# 어투를 키워드로 잡는 휴리스틱이다 — 완벽하지 않다(다르게 표현하면
# 놓칠 수 있고, 드물게 과잉 트리거될 수 있음). escalation과 마찬가지로
# 발생 빈도를 결과에 기록해 두므로, 실측 후 패턴을 더 다듬을 수 있다.
FIELD_ADD_REQUEST_RE = re.compile(
    r"(넣어\s*주세요|넣어\s*줘|추가해\s*주세요|추가해\s*줘|포함해\s*주세요|"
    r"포함해\s*줘|적어\s*주세요|적어\s*줘|표시해\s*주세요|같이\s*넣어)"
)
FIELD_REMOVE_REQUEST_RE = re.compile(
    r"(빼\s*주세요|빼\s*줘|삭제해\s*주세요|삭제해\s*줘|제외해\s*주세요|"
    r"제외해\s*줘|없애\s*주세요|없애\s*줘|지워\s*주세요|지워\s*줘)"
)

# 2026-0X-XX 신설 — entity_type 판단 오류(300건 실측 대분류 1위 원인)에
# 대한 §ESCALATE-TO-PRO 발동이 거의 안 되는 문제를 발견(모델이 "이건
# 애매하다"고 스스로 자각해야 발동하는 구조라 신호가 약하면 안 걸림).
# 사고실험으로 신뢰도 높다고 판단된 3개 패턴(a·b·c)은 모델의 자각에
# 기대지 않고, 코드가 사용자 발화만 보고 무조건 hondi-pro로 승격시킨다
# (FIELD_ADD/REMOVE 안전장치와 동일 원칙 — 키워드 기반이라 완벽하지
# 않음, 실측 후 다듬을 수 있게 escalations에 [CODE-FORCED] 태그로 기록).
#
# (a) 1차 신분(학생/은퇴/전업주부/구직중)에 겸업이 딸려 나오는 경우 —
#     "가끔 프리랜서 일도 병행해요" 류.
_PRIMARY_STATUS_RE = re.compile(r"(학생|은퇴|전업주부|구직|무직|취준)")
_SECONDARY_WORK_RE = re.compile(r"(프리랜서|겸업|아르바이트|알바|부업|사이드잡)")

# (b) 직업/자격만 단독으로 언급됐는데 고용 상태인지 자영업인지 발화만으론
#     안 갈리는 경우 — "한의사 일 해요" 류. 흔히 자영업 개원이 잦은 전문직
#     명단 + "회사/직장/근무" 등 고용 신호나 "가게/차렸/개업/원장/대표" 등
#     사업 신호가 둘 다 없을 때만 트리거(둘 중 하나라도 있으면 이미 판단
#     가능하므로 승격 불필요).
_PROFESSION_TITLE_RE = re.compile(
    r"(한의사|한약사|약사|의사|치과의사|수의사|변호사|회계사|세무사|법무사|"
    r"노무사|미용사|디자이너|상담사|트레이너|강사|통역사|번역가|건축사|"
    r"감정평가사)"
)
_EMPLOYMENT_MARKER_RE = re.compile(r"(회사|직장|근무|다니|소속|병원에서|약국에서)")
_BUSINESS_MARKER_RE = re.compile(r"(가게|차렸|운영|장사|개업|사업|원장|대표|매장|점포)")

# (c) 사물/개념(무인기기·자율주행차·AI 등)의 프로필인지, 그걸 소유·운영하는
#     사업자 자신의 프로필인지 애매한 경우 — "무인 키오스크...㈜혼디카페
#     운영" 류(소유주체가 명시돼 있어 신호가 강함).
_THING_INDICATOR_RE = re.compile(r"(무인|자율주행|로봇|키오스크|셔틀|AI\s*페르소나|AI\s*에이전트)")
_OWNER_INDICATOR_RE = re.compile(r"(운영|소유|주식회사|\(주\)|㈜)")


def _detect_entity_type_ambiguity(text: str):
    """(a)/(b)/(c) 중 하나라도 매칭되면 (패턴키, 사유) 반환, 아니면 (None, None).
    패턴키('a'/'b'/'c')는 _CODE_FORCED_DIRECTIVES 조회 및 (c) 전용 사후
    강제 오버라이드(#267/#279 실측 대응)에 쓰인다."""
    if _PRIMARY_STATUS_RE.search(text) and _SECONDARY_WORK_RE.search(text):
        return "a", "1차신분+겸업(work_domain 애매)"
    if (_PROFESSION_TITLE_RE.search(text)
            and not _EMPLOYMENT_MARKER_RE.search(text)
            and not _BUSINESS_MARKER_RE.search(text)):
        return "b", "직업단독언급(고용/자영업 애매)"
    if _THING_INDICATOR_RE.search(text) and _OWNER_INDICATOR_RE.search(text):
        return "c", "사물+소유주체명시(thing/business 애매)"
    return None, None


# 2026-0X-XX 신설 — "다시 생각해봐"(단순 승격)가 아니라 "코드가 이미 내린
# 판단을 실행해라"로 바꾼다. #145/#157/#159/#163 실측에서 확인했듯 Pro도
# 처음엔 맞게 판단하고 대화가 진행되며 사용자가 실제로 사업 정보를 스스로
# 제공하면 그때는 재검토해도 된다고 명시 — 무조건 고정시키는 게 아니라
# "지금 이 시점에서 지레짐작하지 말라"는 지시다. (c)는 사용자가 정보를
# 추가로 줘도 판단이 바뀔 이유가 없으므로(사물은 계속 사물) 재검토 여지를
# 언급하지 않는다 — 대신 아래 (c) 전용 사후 강제 오버라이드로 한 번 더
# 못박는다(#267/#279에서 Pro조차 즉시 오판 — 승격만으론 불충분했음).
_CODE_FORCED_DIRECTIVES = {
    "a": (
        "[INTERNAL: 시스템 판단 — 이번 발화는 학생/은퇴/전업주부/구직중 등 "
        "1차 신분에 부차적인 겸업이 붙은 패턴입니다. entity_type은 person으로 "
        "유지하고, 겸업 사실은 work_domain.statuses 배열에만 반영하세요. "
        "사용자가 이후 대화에서 실제로 상호명·영업시간 등 구체적인 사업 운영 "
        "정보를 스스로 제공하면 그때는 그 정보를 반영해 판단을 재검토해도 "
        "됩니다 — 지금 이 시점에서 지레짐작으로 business로 넘기지 마세요.]"
    ),
    "b": (
        "[INTERNAL: 시스템 판단 — 이번 발화는 직업/자격만 단독으로 언급된 "
        "패턴입니다. entity_type은 person으로 유지하고, job_ksco에 직업 정보를 "
        "반영하세요. 사용자가 이후 대화에서 실제로 상호명·영업시간 등 사업 "
        "운영 정보를 스스로 제공하면 그때 반영해 재검토해도 됩니다.]"
    ),
    "c": (
        "[INTERNAL: 시스템 판단 — 이번 발화는 사물(무인기기 등)의 프로필 "
        "요청이며 소유주체가 별도로 언급됐습니다. entity_type은 반드시 thing "
        "으로 설정하세요. 메뉴·가격·결제 정보를 다루더라도 그 사물 자체가 "
        "사업자가 되는 게 아닙니다 — 소유주체는 이 프로필의 등록 대상이 "
        "아닙니다.]"
    ),
}



def _load_composited_sp(repo_root):
    """manifest-loader.js의 _loadSpByKey('profile-assistant', ...)와 동일한
    합성 순서를 로컬 파일에서 재현한다: UNIVERSAL-INTEGRITY + TASK-DELEGATION-
    GUIDE + HONDI-CAPABILITIES-COMMON + profile-assistant SP.
    (2026-0X-XX 수정 배선 반영 — fix_manifest_loader_capabilities_common.py
    적용 이후 상태를 전제로 한다. 아직 적용 전이면 마지막 파츠를 빼고 3파츠만
    합성하도록 --no-capabilities-common 플래그로 이전 동작 재현 가능.)"""
    catalog = json.load(open(os.path.join(repo_root, 'prompts', 'sp-catalog.json'), encoding='utf-8'))
    parts = []
    for key in ('UNIVERSAL-INTEGRITY', 'TASK-DELEGATION-GUIDE', 'HONDI-CAPABILITIES-COMMON'):
        fname = catalog.get(key)
        if fname:
            parts.append(open(os.path.join(repo_root, 'prompts', fname), encoding='utf-8').read())
    pa_fname = catalog['profile-assistant']
    parts.append(open(os.path.join(repo_root, 'prompts', 'profile-assistant', os.path.basename(pa_fname)), encoding='utf-8').read())
    return '\n\n---\n\n'.join(parts)


def _persona_system_prompt(scenario):
    facts = scenario['persona_facts']
    directives = '\n'.join(f'- {d}' for d in scenario['persona_directives'])
    return f"""당신은 혼디(Hondi)라는 앱에서 프로필을 등록하려는 가상의 사용자입니다.
AI 비서(상대방)가 프로필 작성을 도와주는 대화 상대이고, 당신은 실제 사람처럼 자연스럽게 답합니다.

당신의 배경 사실(대화 중 자연스럽게, AI가 물어볼 때만 답하세요 — 먼저 전부 나열하지 마세요):
- entity_type: {scenario['entity_type_expected']}
- 관련 코드/라벨: {facts.get('code_label') or '(해당 없음)'}
- 나이/성별: {facts.get('age_gender') or '(해당 없음)'}

이번 대화에서 반드시 지켜야 할 행동:
{directives}

규칙: 한국어로, 실제 사람처럼 짧고 자연스럽게 답하세요. AI 비서 역할을 절대 하지 말고, 오직 사용자 역할만 하세요.
AI가 프로필 작성을 마쳤다고 확인을 요청하면 "네, 맞아요" 등으로 승인하세요.
AI가 "🎉 프로필 완성됐어요"처럼 완료를 알리면, "네, 감사합니다!" 한 마디로만 짧게 답하고
더 이상 새로운 화제나 인사를 만들지 마세요 — 대화를 길게 끌지 않습니다.
"""


def _call_deepseek(api_key, messages, max_tokens=1600, model=None):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    # 2026-0X-XX 신설 — deepseek-v4-flash를 model로 직접 호출하면 DeepSeek
    # 공식 문서상 thinking이 기본값 enabled(effort high)다. 레거시 별칭
    # deepseek-chat 시절엔 명시적으로 비사고 모드였는데, 정식 ID로 교정하며
    # 이 파라미터를 안 넣어 매 호출이 사고 모드로 도는 바람에 같은 30건이
    # 215초→16분대로 늘어나는 걸 실측(전체 코드베이스 공통 결함 — worker.js
    # 4개 지점 + 공유 deepseek-client.js에도 동일 패치 적용됨). PA/K-Law/Biz/
    # Gov 전부 "Flash 티어=비사고"가 설계 의도이므로 하네스도 프로덕션과
    # 동일하게 명시적으로 비활성화한다. model이 명시적으로 넘어오면(예:
    # §ESCALATE-TO-PRO 승격 재호출) 그 모델을 쓰고, Flash가 아니면(=Pro)
    # 원래 의도대로 사고 모드를 켜둔다.
    use_model = model or MODEL
    payload = {"model": use_model, "temperature": 0.3, "max_tokens": max_tokens, "messages": messages,
               "thinking": {"type": "disabled" if use_model == MODEL else "enabled"}}
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"], data.get("usage", {}), None
            elif resp.status_code == 429:
                time.sleep(RETRY_BASE_SLEEP * attempt); last_err = f"429 (attempt {attempt})"; continue
            else:
                last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"; time.sleep(RETRY_BASE_SLEEP); continue
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"; time.sleep(RETRY_BASE_SLEEP * attempt); continue
    return None, {}, last_err


def _mock_template_lookup_context(pa_reply):
    """실제 /template-lookup 서버 호출 대신, 클라이언트가 하던 일을 하네스가
    대신한다 — 최초 사례로 통일 응답(재현성 우선, DB seed 불필요)."""
    m = TEMPLATE_LOOKUP_RE.search(pa_reply)
    if not m:
        return None
    params = {}
    for part in m.group(1).split(','):
        if '=' in part:
            k, v = part.split('=', 1)
            params[k.strip()] = v.strip()
    blocks = []
    if 'schema_id' in params:
        blocks.append('[CONTEXT: INDUSTRY_TEMPLATE]\n(참조 사례 없음 — 최초 사례)\n[/CONTEXT]')
    if 'job_ksco_code' in params or 'work_domain' in params:
        blocks.append('[CONTEXT: PERSON_TEMPLATE]\n(참조 사례 없음 — 최초 사례)\n[/CONTEXT]')
    return '\n'.join(blocks) if blocks else None


def run_scenario(api_key, pa_system, scenario):
    pa_messages = [{"role": "system", "content": pa_system}]
    persona_messages = [{"role": "system", "content": _persona_system_prompt(scenario)}]

    transcript = []
    partial_saves = {}
    terminal = None
    submit_json = None
    field_add_seen = False
    field_remove_seen = False
    card_seen_count = 0  # §PROFILE_CARD 선행 이모지가 몇 번째 응답에 나왔는지
    # 2026-0X-XX 신설 — §PROFILE_CARD 형식을 안 쓴 채(카드 이모지 라인 없이)
    # 완료를 선언하거나("등록해 드릴게요! ...로 정리해서 등록하겠습니다")
    # 그냥 인사만 주고받으며 멈춘 경우, card_seen_count 신호가 아예 안 잡혀
    # MAX_TURNS까지 같은 응답이 반복되는 걸 실측으로 확인(#92/#257) — 직전
    # PA 응답과 완전히 동일한 응답이 다시 나오면(카드 형식 준수 여부와
    # 무관하게) "멈춰서 반복 중"으로 보고 동일한 재시도 경로를 태운다.
    previous_pa_reply = None
    escalations = []  # 2026-0X-XX 신설 — §ESCALATE-TO-PRO(v2.28) 승격 이력: {turn, reason}
    # 2026-0X-XX 신설 — (c)패턴(사물+소유주체명시) 세션 발동 여부. #267/#279
    # 실측에서 Pro로 승격해도 Pro조차 즉시 "무인으로 운영되는 사업체"라고
    # 오판하는 걸 확인 — 지시문 주입만으론 불충분할 위험에 대비해, 최종
    # PROFILE_SUBMIT의 entity_type을 코드가 사후에 강제 덮어쓰는 안전망을
    # 추가한다(아래 submit_json 파싱부 참조). person/business 계열((a)/(b))은
    # 대화가 진행되며 사용자가 실제로 사업 정보를 줄 수 있어 사후 강제는
    # 하지 않는다 — (c)만 적용.
    saw_pattern_c = False
    entity_type_override_applied = False
    # 2026-0X-XX 신설 — 재시도 안전장치 시도 횟수(성공 여부와 무관하게 카운트,
    # 실측 기반으로 나중에 패턴을 다듬을 수 있도록 전부 기록)
    profile_submit_retries = 0
    field_add_retries = 0
    field_remove_retries = 0
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0}

    user_turn_text = scenario['opening_line']

    for turn in range(MAX_TURNS):
        pa_messages.append({"role": "user", "content": user_turn_text})

        # (2026-0X-XX 신설) entity_type 애매함 코드 강제 승격 — 위 (a)/(b)/(c)
        # 패턴에 해당하면 모델의 자각(§ESCALATE-TO-PRO 태그)을 기다리지 않고
        # 코드가 곧바로 hondi-pro로 부른다. 아래 esc_match 기반(모델 자기신고)
        # 승격과 공존 — 이 경로로 이미 승격했으면 그쪽 체크는 건너뛴다.
        # (2026-0X-XX 2차 수정) "다시 생각해봐"(단순 승격)만으론 부족했다
        # (#145/#157/#159/#163 실측 — Pro도 처음엔 맞게 판단) — 코드가 이미
        # 확신하는 결론을 [INTERNAL] 지시문으로 이번 턴 사용자 메시지에
        # 이어붙여 "판단을 대신 실행하게" 만든다(별도 user 메시지로 추가하지
        # 않고 마지막 메시지에 이어붙임 — 연속된 동일 역할 메시지로 인한
        # API 포맷 이슈 회피).
        _code_forced, _code_forced_reason = _detect_entity_type_ambiguity(user_turn_text)
        if _code_forced:
            escalations.append({"turn": turn, "reason": f"[CODE-FORCED] {_code_forced_reason}"})
            if _code_forced == "c":
                saw_pattern_c = True
            pa_messages[-1]["content"] = (
                pa_messages[-1]["content"] + "\n\n" + _CODE_FORCED_DIRECTIVES[_code_forced]
            )
            pa_reply, usage, err = _call_deepseek(
                api_key, pa_messages, max_tokens=PRO_MAX_TOKENS, model=MODEL_PRO)
        else:
            pa_reply, usage, err = _call_deepseek(api_key, pa_messages, max_tokens=1600)
        if err:
            return _error_result(scenario, transcript, f"PA 호출 실패(turn {turn}): {err}")
        for k in total_usage:
            total_usage[k] += usage.get(k, 0)

        # (2026-0X-XX 신설) §ESCALATE-TO-PRO(v2.28 시험 적용) 감지 — flash가
        # 판단 곤란 신호만 냈으면(SP 지시상 이 턴엔 사용자용 문구가 전혀
        # 없어야 함) 그 응답은 대화 기록에 남기지 않고, 같은 pa_messages로
        # hondi-pro(deepseek-v4-pro)를 재호출해 이번 턴의 진짜 응답을 받는다
        # — 프로덕션 클라이언트(profile-assistant.html)와 동일한 로직.
        # 위 코드 강제 승격이 이미 발동한 턴이면 건너뛴다(이미 pro 응답).
        esc_match = None if _code_forced else ESCALATE_RE.search(pa_reply)
        if esc_match:
            escalations.append({"turn": turn, "reason": esc_match.group(1).strip()})
            pa_reply, pro_usage, pro_err = _call_deepseek(
                api_key, pa_messages, max_tokens=PRO_MAX_TOKENS, model=MODEL_PRO)
            if pro_err:
                return _error_result(scenario, transcript, f"PA 승격 호출 실패(turn {turn}): {pro_err}")
            for k in total_usage:
                total_usage[k] += pro_usage.get(k, 0)

        pa_messages.append({"role": "assistant", "content": pa_reply})
        # (2026-0X-XX 수정) user_turn_text는 오프닝 또는 이전 루프 끝에서 이미
        # "user(persona-next)"로 기록됐으므로 여기서 다시 안 찍는다 — 최초
        # 진입(turn==0)일 때만 오프닝 발화를 여기서 기록한다(그 전엔 기록된 적
        # 없으므로).
        if turn == 0:
            transcript.append({"role": "user(persona)", "content": user_turn_text})
        transcript.append({"role": "assistant(PA)", "content": pa_reply})

        if FIELD_ADD_RE.search(pa_reply):
            field_add_seen = True
        if FIELD_REMOVE_RE.search(pa_reply):
            field_remove_seen = True

        # (2026-0X-XX 신설) FIELD_ADD/FIELD_REMOVE 안전장치 — 이번 턴 사용자
        # 발화가 추가/삭제 요청 어투인데 해당 태그가 안 나왔으면, 화면 문구는
        # 그대로 두고 태그만 다시 내달라고 1회 내부 재요청한다(PROFILE_SUBMIT
        # 재시도와 동일 원칙, §4 참조). 키워드 기반 휴리스틱이라 완벽하지
        # 않음 — 시도 횟수를 결과에 기록해 실측 후 다듬을 수 있게 한다.
        if FIELD_ADD_REQUEST_RE.search(user_turn_text) and not FIELD_ADD_RE.search(pa_reply):
            field_add_retries += 1
            pa_messages.append({"role": "user", "content": (
                "[INTERNAL: 방금 요청하신 필드 추가가 화면 카드에는 반영됐지만 "
                "[FIELD_ADD: ...] 내부 태그가 빠졌습니다. 사용자에게 보일 새 "
                "문구는 만들지 말고, 방금 응답과 동일한 내용으로 "
                "[FIELD_ADD: key=..., label=..., entity_type=..., category=...] "
                "태그만 다시 출력해 주세요.]"
            )})
            retry_reply, retry_usage, retry_err = _call_deepseek(api_key, pa_messages, max_tokens=400)
            if retry_err:
                return _error_result(scenario, transcript, f"FIELD_ADD 재시도 실패(turn {turn}): {retry_err}")
            for k in total_usage:
                total_usage[k] += retry_usage.get(k, 0)
            pa_messages.append({"role": "assistant", "content": retry_reply})
            transcript.append({"role": "assistant(PA-retry-field_add)", "content": retry_reply})
            if FIELD_ADD_RE.search(retry_reply):
                field_add_seen = True

        if FIELD_REMOVE_REQUEST_RE.search(user_turn_text) and not FIELD_REMOVE_RE.search(pa_reply):
            field_remove_retries += 1
            pa_messages.append({"role": "user", "content": (
                "[INTERNAL: 방금 요청하신 필드 삭제가 화면 카드에는 반영됐지만 "
                "[FIELD_REMOVE: ...] 내부 태그가 빠졌습니다. 사용자에게 보일 새 "
                "문구는 만들지 말고, 방금 응답과 동일한 내용으로 "
                "[FIELD_REMOVE: key=..., entity_type=..., category=...] "
                "태그만 다시 출력해 주세요.]"
            )})
            retry_reply, retry_usage, retry_err = _call_deepseek(api_key, pa_messages, max_tokens=400)
            if retry_err:
                return _error_result(scenario, transcript, f"FIELD_REMOVE 재시도 실패(turn {turn}): {retry_err}")
            for k in total_usage:
                total_usage[k] += retry_usage.get(k, 0)
            pa_messages.append({"role": "assistant", "content": retry_reply})
            transcript.append({"role": "assistant(PA-retry-field_remove)", "content": retry_reply})
            if FIELD_REMOVE_RE.search(retry_reply):
                field_remove_seen = True

        for m in PARTIAL_SAVE_RE.finditer(pa_reply):
            try:
                partial_saves.update(json.loads(m.group(1)))
            except (json.JSONDecodeError, ValueError):
                pass

        # 종료 태그 판정
        # (2026-0X-XX 3차 수정) §PROFILE_CARD 선행 이모지가 2번째로 등장한
        # 응답인데 PROFILE_SUBMIT이 없으면 완료 턴으로 간주한다(1번째=
        # STEP-FINAL 확인요청 카드, 2번째=완료 메시지 카드 — SP §4
        # STEP-FINAL 스펙 순서 그대로). 확인요청 "문장"이 아니라 카드
        # "구조"를 세므로 존댓말·동사 변형 등 자연어 패러프레이즈에
        # 영향받지 않는다.
        # (2026-0X-XX 4차 수정) 여기서 곧바로 SOFT_COMPLETION_NO_TAG로
        # 포기하지 않고, 프로덕션 클라이언트(profile-assistant.html)의
        # 재시도 안전장치(patch C+D)와 동일하게 최대 MAX_PROFILE_SUBMIT_RETRIES
        # 회 내부 재요청한다 — 이게 없으면 이 하네스 수치가 실제 사용자
        # 경험보다 훨씬 나빠 보인다(재시도로 구제되는 케이스를 전부
        # 실패로 잡던 문제, 2026-08-01 30건 실측에서 확인).
        if 'PROFILE_SUBMIT' not in pa_reply.upper() and len(CARD_LINE_RE.findall(pa_reply)) >= 1:
            card_seen_count += 1

        # (2026-0X-XX 신설) §PROFILE_CARD 형식을 안 쓴 채(카드 이모지 라인
        # 없이) 완료를 선언하거나 인사만 반복하며 멈추는 경우, 위 card_seen_
        # count 신호가 아예 안 잡혀 MAX_TURNS까지 같은 응답이 그대로 반복되는
        # 걸 실측 확인(#92: "등록해 드릴게요!..." 완전 동일 반복 / #257: "네,
        # 감사합니다!" 인사 루프). 카드 형식 준수 여부와 무관하게, 직전 PA
        # 응답과 이번 응답이 완전히 동일하면 그 자체를 "멈춰서 반복 중"이라는
        # 확실한 신호로 보고 동일한 재시도 경로를 태운다.
        _stuck_repeat = (
            'PROFILE_SUBMIT' not in pa_reply.upper()
            and previous_pa_reply is not None
            and pa_reply == previous_pa_reply
        )

        if 'PROFILE_SUBMIT' not in pa_reply.upper() and (card_seen_count >= 2 or _stuck_repeat):
            retried_ok = False
            while profile_submit_retries < MAX_PROFILE_SUBMIT_RETRIES:
                profile_submit_retries += 1
                pa_messages.append({"role": "user", "content": (
                    "[INTERNAL: PROFILE_SUBMIT 태그 누락 감지 — 사용자에게 "
                    "보이지 않는 내부 신호입니다. 방금 응답에서 완료 카드는 "
                    "정확히 보여주셨지만 PROFILE_SUBMIT { ... } 태그가 빠져서 "
                    "서버에 아직 저장되지 않았습니다. 사용자에게 보일 새 "
                    "안내 문구나 인사말을 만들지 말고, 방금 보여드린 카드와 "
                    "완전히 같은 내용으로 PROFILE_SUBMIT { ... } 태그만 "
                    "그대로 다시 출력해 주세요.]"
                )})
                retry_reply, retry_usage, retry_err = _call_deepseek(api_key, pa_messages, max_tokens=1600)
                if retry_err:
                    return _error_result(scenario, transcript, f"PROFILE_SUBMIT 재시도 실패(turn {turn}): {retry_err}")
                for k in total_usage:
                    total_usage[k] += retry_usage.get(k, 0)
                pa_messages.append({"role": "assistant", "content": retry_reply})
                transcript.append({"role": "assistant(PA-retry-profile_submit)", "content": retry_reply})
                if 'PROFILE_SUBMIT' in retry_reply:
                    pa_reply = retry_reply  # 이후 파싱 로직이 이 값을 그대로 씀
                    retried_ok = True
                    break
                # 재시도 응답에도 카드가 없을 수 있다(지시를 따라 태그만
                # 내려다 실패한 경우) — 그래도 계속 재시도한다(카드
                # 재검출 여부와 무관하게 profile_submit_retries 한도까지).
            if not retried_ok:
                terminal = 'SOFT_COMPLETION_NO_TAG'
                break
        previous_pa_reply = pa_reply  # 다음 턴 반복 감지용 — 이번 턴 최종 확정값으로 갱신
        if 'PROFILE_SUBMIT' in pa_reply:
            terminal = 'PROFILE_SUBMIT'
            submit_json = _extract_last_valid_profile_submit(pa_reply)
            if submit_json is not None:
                # (2026-0X-XX 신설) (c)패턴 사후 강제 오버라이드 — #267/#279
                # 실측에서 Pro로 승격 + 지시문 주입까지 해도 여전히 틀릴
                # 위험을 배제할 수 없어(사물이 실제로 상거래를 다루는
                # 경우 모델이 "이건 사업체다"로 되돌아가려는 경향이 강함),
                # 이 세션에서 (c)패턴이 한 번이라도 발동했으면 코드가
                # entity_type을 무조건 thing으로 덮어쓰고 결제 필드도
                # 함께 정리한다(worker.js의 thing/concept 강제 차단과
                # 동일 원칙 — patch M 참조).
                if saw_pattern_c and submit_json.get('entity_type') != 'thing':
                    submit_json['entity_type'] = 'thing'
                    submit_json['gdc_accepted'] = False
                    submit_json['payout_account'] = None
                    entity_type_override_applied = True
            break
        if '[PROFILE_SKIP]' in pa_reply:
            terminal = 'PROFILE_SKIP'; break
        if '[PROFILE_INTERRUPT_HANDOFF]' in pa_reply:
            terminal = 'PROFILE_INTERRUPT_HANDOFF'; break

        # TEMPLATE_LOOKUP이면 페르소나 턴을 쓰지 않고 하네스가 CONTEXT를 대신 주입
        mocked_ctx = _mock_template_lookup_context(pa_reply)
        if mocked_ctx:
            user_turn_text = mocked_ctx
            transcript.append({"role": "user(mocked-template-context)", "content": user_turn_text})
            continue

        # 페르소나 다음 응답 생성
        persona_messages.append({"role": "user", "content": pa_reply})
        persona_reply, usage2, err2 = _call_deepseek(api_key, persona_messages, max_tokens=300)
        if err2:
            return _error_result(scenario, transcript, f"페르소나 호출 실패(turn {turn}): {err2}")
        for k in total_usage:
            total_usage[k] += usage2.get(k, 0)
        persona_messages.append({"role": "assistant", "content": persona_reply})
        transcript.append({"role": "user(persona-next)", "content": persona_reply})
        user_turn_text = persona_reply

    verdict, notes = _grade(scenario, terminal, submit_json, partial_saves, field_add_seen, field_remove_seen, transcript)

    pa_turn_count = sum(1 for t in transcript if t["role"] == "assistant(PA)")
    return {
        "no": scenario["no"], "entity_type_expected": scenario["entity_type_expected"],
        "edge_case_tags": scenario["edge_case_tags"], "terminal": terminal,
        "turns_used": pa_turn_count, "submit_entity_type": (submit_json or {}).get('entity_type'),
        "verdict": verdict, "notes": notes, "usage": total_usage,
        "escalation_count": len(escalations), "escalations": escalations,
        "profile_submit_retries": profile_submit_retries,
        "field_add_retries": field_add_retries, "field_remove_retries": field_remove_retries,
        "entity_type_override_applied": entity_type_override_applied,
        "transcript": transcript, "submit_json": submit_json,
    }


def _error_result(scenario, transcript, err):
    return {
        "no": scenario["no"], "entity_type_expected": scenario["entity_type_expected"],
        "edge_case_tags": scenario["edge_case_tags"], "terminal": None, "turns_used": len(transcript) // 2,
        "submit_entity_type": None, "verdict": "LIVE-ERROR", "notes": err, "usage": {},
        "escalation_count": 0, "escalations": [],
        "profile_submit_retries": 0, "field_add_retries": 0, "field_remove_retries": 0,
        "entity_type_override_applied": False,
        "transcript": transcript, "submit_json": None,
    }


def _grade(scenario, terminal, submit_json, partial_saves, field_add_seen, field_remove_seen, transcript):
    notes = []
    if terminal is None:
        return "LIVE-FAIL", [f"MAX_TURNS({MAX_TURNS}) 안에 종료 태그 없음 — 무한 루프 또는 STEP 정체 의심"]

    if terminal == 'SOFT_COMPLETION_NO_TAG':
        return "LIVE-NEEDS-REVIEW", [
            "완료 메시지(①)는 나왔으나 PROFILE_SUBMIT 머신 태그(②)가 응답에 없음 — "
            "SP는 두 개를 같은 응답에 함께 내라고 명시하는데 모델이 ②를 누락했을 가능성. "
            "여러 건 반복되면 모델별 SP 준수도 문제로 보고 필요."
        ]

    if terminal == 'PROFILE_INTERRUPT_HANDOFF':
        if any(t in scenario['edge_case_tags'] for t in ('SAFETY_GATE', 'INTERRUPT_A')):
            return "LIVE-PASS", ["의도된 핸드오프 태그(SAFETY_GATE/INTERRUPT_A) 발생 확인"]
        return "LIVE-NEEDS-REVIEW", ["의도치 않은 시점에 PROFILE_INTERRUPT_HANDOFF 발생 — 대화록 확인 필요"]

    if terminal == 'PROFILE_SKIP':
        if 'SKIP_RESUME' in scenario['edge_case_tags']:
            return "LIVE-PASS", ["의도된 SKIP_RESUME 태그 발생 확인"]
        return "LIVE-NEEDS-REVIEW", ["의도치 않은 시점에 PROFILE_SKIP 발생 — 대화록 확인 필요"]

    if terminal == 'PROFILE_SUBMIT':
        if submit_json is None:
            notes.append("PROFILE_SUBMIT 태그는 나왔으나 JSON 파싱 실패 — 형식 확인 필요")
            return "LIVE-NEEDS-REVIEW", notes
        actual_et = submit_json.get('entity_type')
        if actual_et != scenario['entity_type_expected']:
            notes.append(f"entity_type 불일치: 기대 {scenario['entity_type_expected']} vs 실제 {actual_et}")
        if scenario['skip_payment_steps_expected']:
            if submit_json.get('gdc_accepted') or submit_json.get('payout_account'):
                notes.append("person/thing/concept인데 GDC/계좌이체 필드가 채워짐 — STEP3~3A 스킵 원칙 위반 의심")
        if 'FIELD_ADD' in scenario['edge_case_tags'] and not field_add_seen:
            notes.append("FIELD_ADD 유도 지시가 있었는데 [FIELD_ADD:] 태그가 대화록에 없음")
        if 'FIELD_REMOVE' in scenario['edge_case_tags'] and not field_remove_seen:
            notes.append("FIELD_REMOVE 유도 지시가 있었는데 [FIELD_REMOVE:] 태그가 대화록에 없음")
        if notes:
            return "LIVE-FAIL", notes
        return "LIVE-PASS", ["entity_type 일치, 결제STEP 스킵 원칙 위반 없음, 유도된 필드 태그 확인됨(있는 경우)"]

    return "LIVE-NEEDS-REVIEW", ["알 수 없는 종료 상태"]


def load_done_numbers(jsonl_path):
    done = set()
    if os.path.exists(jsonl_path):
        with open(jsonl_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line: continue
                try: done.add(json.loads(line)["no"])
                except (json.JSONDecodeError, KeyError): pass
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="profile_assistant_scenarios.json")
    ap.add_argument("--repo-root", default="../..")
    ap.add_argument("--out", default="../../results/profile-assistant")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY env var not set", file=sys.stderr); sys.exit(1)

    scenarios = json.load(open(args.scenarios, encoding="utf-8"))
    if args.limit:
        scenarios = scenarios[:args.limit]

    pa_system = _load_composited_sp(args.repo_root)
    print(f"PA 시스템 프롬프트 합성 완료: {len(pa_system)} chars")

    os.makedirs(args.out, exist_ok=True)
    jsonl_path = os.path.join(args.out, "live_results.jsonl")
    done = load_done_numbers(jsonl_path) if args.resume else set()
    todo = [s for s in scenarios if s["no"] not in done]
    print(f"{len(scenarios)} total, {len(done)} already done, {len(todo)} to run")

    start = time.time()
    with open(jsonl_path, "a", encoding="utf-8") as out_f:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(run_scenario, api_key, pa_system, s): s for s in todo}
            n = 0
            for fut in as_completed(futures):
                s = futures[fut]
                try:
                    result = fut.result()
                except Exception as e:
                    result = _error_result(s, [], f"unhandled_exception: {e}")
                out_f.write(json.dumps(result, ensure_ascii=False) + "\n")
                out_f.flush()
                n += 1
                if n % 10 == 0:
                    print(f"  ...{n}/{len(todo)} done ({time.time()-start:.0f}s)")

    print(f"Done. {n if todo else 0} results written in {time.time()-start:.0f}s")

    all_results = {}
    with open(jsonl_path, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line); all_results[r["no"]] = r
    final = [all_results[k] for k in sorted(all_results)]
    json.dump(final, open(os.path.join(args.out, "live_results.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    from collections import Counter
    counts = Counter(r["verdict"] for r in final)
    # 2026-0X-XX 신설 — §ESCALATE-TO-PRO(v2.28 시험 적용) 빈도를 요약에도
    # 바로 보이게 한다(로그를 뒤져 JSONL을 안 열어봐도 되도록).
    total_escalations = sum(r.get("escalation_count", 0) for r in final)
    scenarios_with_escalation = sum(1 for r in final if r.get("escalation_count", 0) > 0)
    # 2026-0X-XX 신설 — 재시도 안전장치(PROFILE_SUBMIT/FIELD_ADD/FIELD_REMOVE)
    # 발동 빈도 요약. verdict가 여전히 LIVE-PASS인 케이스 중 재시도가 있었던
    # 건수 = "안전장치가 실제로 구제한 건수"에 가까운 근사치(정확한 인과는
    # 아니지만 규모 파악용으로 충분).
    total_profile_submit_retries = sum(r.get("profile_submit_retries", 0) for r in final)
    total_field_add_retries = sum(r.get("field_add_retries", 0) for r in final)
    total_field_remove_retries = sum(r.get("field_remove_retries", 0) for r in final)
    scenarios_with_any_retry = sum(
        1 for r in final
        if r.get("profile_submit_retries", 0) or r.get("field_add_retries", 0) or r.get("field_remove_retries", 0)
    )
    summary = {
        "total": len(final), "counts": dict(counts), "runtime_seconds": round(time.time() - start),
        "escalate_to_pro": {
            "total_escalations": total_escalations,
            "scenarios_with_escalation": scenarios_with_escalation,
        },
        "retry_safety_nets": {
            "total_profile_submit_retries": total_profile_submit_retries,
            "total_field_add_retries": total_field_add_retries,
            "total_field_remove_retries": total_field_remove_retries,
            "scenarios_with_any_retry": scenarios_with_any_retry,
        },
    }
    json.dump(summary, open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
