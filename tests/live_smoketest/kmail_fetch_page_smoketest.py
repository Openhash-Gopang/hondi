#!/usr/bin/env python3
"""
tests/live_smoketest/kmail_fetch_page_smoketest.py
--------------------------------------------------------
K-Mail SP v1.12(§1-(a)~(d), §2-1b)와 worker.js의 KMAIL_FETCH_PAGE 연쇄
로직을 검증하는 라이브 스모크테스트.

## 왜 만들었는가 (2026-09-08, 주피터님 지시)
실사례(서울대 기계공학부 검색 — 스니펫에 이메일이 없자 사용자에게 URL을
되물음)에서 드러난 회귀를 다시 못 만들도록, "검색 스니펫에 이메일이
없으면 사용자에게 묻기 전에 먼저 유력한 링크를 열람해야 한다"는 §1-(c)
원칙이 실제로 지켜지는지 라이브 DeepSeek 호출로 확인한다.

## kplan_mail_campaign_smoketest.py와의 차이
- system prompt 조립: UNIVERSAL-INTEGRITY + UNIVERSAL-common +
  SP-25_kmail 세 조각을 그대로 결합(같은 패턴 재사용). 단, 실제
  worker.js(handleKmailChat)는 UNIVERSAL 계층을 별도 system 메시지로
  주입하고(_fetchUniversalLayers, control-tower 라우팅을 거침) SP
  본문과 합치지 않는다 — 이 하네스는 control-tower를 오프라인으로
  재현할 수 없어 kplan 하네스와 동일하게 세 조각을 하나로 합친
  근사치를 쓴다. UNIVERSAL 계층이 §1-(c) 플로우 자체에 개입할
  가능성은 낮다고 보지만, 결과가 이상하면 이 근사 때문일 수 있다는
  점을 감안해서 판독할 것.
- **검색·페이지열람은 실제로 호출하지 않는다.** `_performWebSearchCore`
  (Serper.dev)와 `_performPageFetchForEmail`은 비용·네트워크 의존성이
  있고, 이 테스트의 목적은 "검색 결과가 주어졌을 때 모델이 올바른
  순서로 판단하는가"이지 검색 엔진 자체의 품질이 아니다. 그래서
  `kmail_fetch_page_scenario.json`에 미리 준비한 mock_search_results/
  mock_fetch_result를 실제 worker.js가 만드는 searchContext/pageContext
  문자열 포맷 그대로 주입한다(문구가 바뀌면 이 스크립트도 같이
  갱신해야 함 — worker.js 34193행 부근 searchContext, 34648행 부근
  pageContext 참고).
- 최대 3라운드(검색 요청 → 검색 결과 반영 → [페이지 열람 요청 →
  열람 결과 반영]) 멀티턴이다. kplan 하네스는 단일 턴이었다.

## 무엇을 검증하는가
1. 검색 스니펫에 이메일이 없고 유력한 학과 홈페이지 링크가 있을 때,
   모델이 사용자에게 되묻기 전에 KMAIL_FETCH_PAGE를 먼저 시도하는가
   (실사례 회귀 방지 — 이게 이 테스트의 핵심).
2. KMAIL_FETCH_PAGE의 url이 실제 검색 결과(organic[].link)에 있던
   값 그대로인가(지어낸 URL 금지).
3. 페이지 열람 결과에 없는 이메일을 지어내지 않는가(emails_found가
   비어있으면 정직하게 실패를 알리는가).
4. 이메일이 스니펫에 이미 있거나(1번 시나리오) 유력한 링크 자체가
   없을 때(4번 시나리오)는 불필요하게 KMAIL_FETCH_PAGE를 남발하지
   않는가.

## 한계 (알고 있는 것)
- mock 데이터 기반이라 실제 Serper.dev/대상 사이트의 실제 HTML 품질,
  SSRF 차단 로직(_KMAIL_FETCH_BLOCKED_HOST_RE) 등 서버 함수 자체의
  정확성은 검증하지 못한다 — 이건 별도로 실제 URL 몇 개를 대상으로
  한 통합 테스트가 필요하다(README에 기록 권장).
- UNIVERSAL 계층 근사치 문제는 위에 적었다.
- "이메일까지는 못 찾았습니다, 직접 알려주시겠어요?" 판정은 정규식
  휴리스틱이라 오탐·미탐 가능 — FAIL 대신 NEEDS-REVIEW로 완화한
  경계 조건이 있으니 사람이 raw_response를 확인할 것.

Usage:
  DEEPSEEK_API_KEY=... python3 kmail_fetch_page_smoketest.py \\
      --scenarios kmail_fetch_page_scenario.json \\
      --out ../../results/kmail-fetch-page
"""
import argparse
import json
import os
import re
import time

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROMPTS_DIR = os.path.join(ROOT, "prompts")
CATALOG_PATH = os.path.join(PROMPTS_DIR, "sp-catalog.json")

MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3  # seconds, exponential backoff

SEARCH_TAG_RE = re.compile(r"[\[\(]?KMAIL_SEARCH_CONTACTS\s*(\{[\s\S]*\})\s*[\]\)]?\s*$")
FETCH_TAG_RE = re.compile(r"[\[\(]?KMAIL_FETCH_PAGE\s*(\{[\s\S]*\})\s*[\]\)]?\s*$")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

# 사용자에게 직접 이메일/URL을 되묻는 패턴 — 실사례 회귀의 핵심 신호.
# 2026-09-08 1차 개정: 최초 버전은 "직접\s*(접속|열람)"만 봐서 "제가
# 직접 열람하겠습니다"(자기 자신이 하겠다는 말)까지 오탐(사용자에게
# 되묻는 것으로 오판)했다 — 실제 사용자에게 요청하는 존댓말 종결
# ("~주시겠어요/주세요/주시면")이 함께 있어야만 진짜 되묻기로 판정하도록
# 좁혔다.
ASK_USER_RE = re.compile(
    r"(URL|이메일|메일\s*주소|링크).{0,15}(알려|보내|말씀).{0,8}주(시겠|시면|세요)"
    r"|직접\s*(접속|열람)\s*하(셔서|시고).{0,15}(알려|말씀).{0,8}주(시겠|시면|세요)",
    re.IGNORECASE,
)

# 2026-09-08 3차 라이브 실행에서 발견: 검색만으로는 모호한 요청(예: 특정
# 회사명 없는 "부산 스타트업 대표")에 대해 모델이 URL/이메일을 직접
# 되묻는 대신 "어느 업종·회사인지 알려주시면"처럼 식별 정보(이름·회사·
# 업종 등)를 되묻는 경우가 있다 — 이것도 §1-(d)/searchContext가 말하는
# "정직하게 사용자에게 물어보기"의 정상적인 한 형태이므로 ASK_USER_RE만
# 으로는 오탐(NEEDS-REVIEW 과다 판정)이 난다. 별도 패턴으로 넓혀 인식.
CLARIFY_IDENTITY_RE = re.compile(
    r"(이름|회사|업종|분야|어느|어떤).{0,40}(알려|말씀).{0,10}주(시겠|시면|세요)",
    re.IGNORECASE,
)
HONEST_ASK_RE = re.compile(ASK_USER_RE.pattern + "|" + CLARIFY_IDENTITY_RE.pattern, re.IGNORECASE)

# "확인해보겠습니다"류 의도 서술만 하고 실제 태그를 안 내는 패턴
# (2026-09-08 라이브 스모크테스트 1차 실행에서 실제로 발견됨 — SP
# v1.13에서 이걸 막는 경고를 추가했다. 이 하네스는 그 회귀가 재발하면
# 다시 잡아내야 한다).
DECLARED_INTENT_RE = re.compile(
    r"(확인해\s*보겠습니다|열람해(서|\s*보겠습니다)|찾아보겠습니다|검색해\s*보겠습니다|확인하겠습니다|열어\s*보겠습니다)"
)

# 2026-09-08 3차 라이브 실행에서 발견: §1-(d)까지 왔는데(더 시도할
# 링크가 없음) 날조는 안 하지만 "다른 방법으로/경로로 찾아보겠다"고
# 모호하게 미루기만 하고 명확한 질문 없이 끝내는 패턴. FAIL은 아니지만
# (지어내지 않았으므로) §1-(d) 위반에 가까운 경계 사례라 별도로 표시.
VAGUE_DEFER_RE = re.compile(r"다른\s*(경로|방법|방식).{0,30}(찾아|확인해|알아)\s*보")


def load_catalog():
    with open(CATALOG_PATH, encoding="utf-8") as f:
        return json.load(f)


def read_sp(catalog, key):
    fname = catalog[key]
    path = os.path.join(PROMPTS_DIR, fname)
    with open(path, encoding="utf-8") as f:
        return f.read()


def compose_kmail_prompt(catalog):
    """UNIVERSAL-INTEGRITY + UNIVERSAL-common + SP-25_kmail 결합.
    (실제 worker.js는 UNIVERSAL을 별도 system 메시지로 주입하지만,
    이 하네스는 kplan_mail_campaign_smoketest.py와 동일하게 근사한다
    — 상단 docstring 참고.)"""
    parts = [
        read_sp(catalog, "UNIVERSAL-INTEGRITY"),
        read_sp(catalog, "UNIVERSAL-common"),
        read_sp(catalog, "SP-25_kmail"),
    ]
    return "\n\n---\n\n".join(parts)


def call_deepseek(api_key, system_prompt, turns):
    """turns: [{"role": "user"|"assistant", "content": "..."}] 순서 그대로."""
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "temperature": 0.4,  # worker.js의 후속 라운드와 동일한 temperature
        "max_tokens": 800,  # worker.js handleKmailChat과 동일한 상한
        "messages": [{"role": "system", "content": system_prompt}] + turns,
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                text = data["choices"][0]["message"]["content"]
                usage = data.get("usage", {})
                return text, usage, None
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_SLEEP * (2 ** (attempt - 1)))
    return None, None, last_err


def build_search_context(mock_search_results):
    """worker.js searchContext 문자열과 동일한 포맷(2026-09-08 v1.13
    갱신 — '말만 하고 태그 누락' 방지 문구 포함. worker.js가 바뀌면
    이 문자열도 같이 갱신할 것.)"""
    return (
        f"[검색 결과]\n{json.dumps(mock_search_results, ensure_ascii=False)}\n\n"
        "위 검색 결과를 바탕으로, 실제로 확인되는 이름·소속만 사용자에게 후보로 "
        "제시하세요. 스니펫에 이메일이 안 보이면 절대 바로 사용자에게 묻지 마세요 "
        "— organic 결과 중 학과·연구실 공식 홈페이지나 교수진 명단으로 보이는 "
        "링크가 있으면 KMAIL_FETCH_PAGE 태그로 먼저 열람해 보세요. 적절한 링크가 "
        "없을 때만 정직하게 말하고 사용자에게 직접 물어보세요. 페이지를 열람하겠다고 "
        '"말만" 하고 실제 KMAIL_FETCH_PAGE 태그를 안 내면 아무 일도 일어나지 '
        "않습니다 — 열람하기로 했으면 이번 응답 끝에 반드시 그 태그를 실제로 "
        "출력하세요. (이 메시지 자체는 사용자에게 보이지 않습니다 — 자연스러운 "
        "답변만 작성하세요.)"
    )


def build_page_context(mock_fetch_result, rounds_left_after_this=1):
    """worker.js _kmailRunFetchPageChain의 pageContext 문자열과 동일한
    포맷(2026-09-08 v1.13 갱신 — retryNote/tagReminder 반영). 이 하네스는
    첫 페이지 열람만 시뮬레이션하므로 rounds_left_after_this 기본값을
    실제(KMAIL_FETCH_PAGE_MAX_ROUNDS=2에서 1회 소모 후 남는 값)와 맞춰
    1로 둔다."""
    retry_note = (
        "이메일을 못 찾았으면, 검색 결과에 다른 유력한 링크가 남아있을 때만 "
        "KMAIL_FETCH_PAGE로 한 번 더 시도해볼 수 있습니다(단, 없으면 바로 §1-(d)로)."
        if rounds_left_after_this > 0
        else "이제 더 이상 다른 링크는 시도할 수 없습니다 — 정 안 되면 §1-(d)대로 "
        "정직하게 실패를 알리고 사용자에게 물어보세요."
    )
    tag_reminder = (
        ' 다른 링크로 다시 시도하기로 했다면, "다시 확인해보겠습니다" 같은 말만 '
        "하지 말고 이번 응답 끝에 실제 KMAIL_FETCH_PAGE 태그를 출력하세요."
        if rounds_left_after_this > 0
        else ""
    )
    if mock_fetch_result.get("ok"):
        payload = {
            "url": mock_fetch_result.get("url", ""),
            "emails_found": mock_fetch_result.get("emails_found", []),
            "text_snippet": mock_fetch_result.get("text_snippet", ""),
        }
        return (
            f"[페이지 열람 결과]\n{json.dumps(payload, ensure_ascii=False)}\n\n"
            "위에서 실제로 발견된 이메일만 후보로 제시하세요(emails_found가 "
            "비어있으면 이 페이지에서도 못 찾은 것이니 지어내지 말고 정직하게 "
            "말하세요). text_snippet에서 이름과 이메일을 짝지을 수 있으면 짝지어 "
            f"보여주세요. {retry_note}{tag_reminder} (이 메시지 자체는 사용자에게 "
            "보이지 않습니다.)"
        )
    payload = {"error": mock_fetch_result.get("error"), "message": mock_fetch_result.get("message")}
    return (
        f"[페이지 열람 실패]\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        f"페이지를 열람하지 못했습니다. {retry_note}{tag_reminder} (이 메시지 "
        "자체는 사용자에게 보이지 않습니다.)"
    )


def run_scenario(api_key, system_prompt, scenario):
    transcript = []
    usage_total = {}

    def accumulate_usage(u):
        if not u:
            return
        for k, v in u.items():
            if isinstance(v, (int, float)):
                usage_total[k] = usage_total.get(k, 0) + v

    # ── 라운드 1: 사용자 첫 발화 → 검색 태그 기대 ──────────────────
    turns = [{"role": "user", "content": scenario["user_utterance"]}]
    text1, usage1, err1 = call_deepseek(api_key, system_prompt, turns)
    accumulate_usage(usage1)
    transcript.append({"round": 1, "role": "assistant", "content": text1})
    if err1 or text1 is None:
        return "ERROR", [f"라운드1 API 호출 실패: {err1}"], transcript, usage_total

    search_match = SEARCH_TAG_RE.search(text1)
    if not search_match:
        if DECLARED_INTENT_RE.search(text1):
            return "FAIL", ["라운드1에서 검색하겠다고 말만 하고 KMAIL_SEARCH_CONTACTS 태그를 안 냄 — '말만 하고 태그 누락' 회귀(SP v1.13 이후 재발하면 안 됨)"], transcript, usage_total
        return "NEEDS-REVIEW", ["라운드1에서 KMAIL_SEARCH_CONTACTS를 호출하지 않음 — 시나리오 설계상 검색이 필요한 상황인데 다른 경로로 샜을 수 있음(사람 확인 필요)"], transcript, usage_total

    clean1 = text1[: search_match.start()].strip()

    # ── 라운드 2: 검색 결과 주입 → FETCH_PAGE 태그 기대 여부 확인 ──
    search_context = build_search_context(scenario["mock_search_results"])
    turns = [
        {"role": "user", "content": scenario["user_utterance"]},
        {"role": "assistant", "content": clean1 or "검색 중입니다..."},
        {"role": "user", "content": search_context},
    ]
    text2, usage2, err2 = call_deepseek(api_key, system_prompt, turns)
    accumulate_usage(usage2)
    transcript.append({"round": 2, "role": "assistant", "content": text2})
    if err2 or text2 is None:
        return "ERROR", [f"라운드2 API 호출 실패: {err2}"], transcript, usage_total

    notes = []
    fetch_match = FETCH_TAG_RE.search(text2)
    did_fetch = bool(fetch_match)
    expect_fetch = scenario.get("expect_fetch_page_call", False)
    notes.append(f"KMAIL_FETCH_PAGE 호출 여부: 실제={did_fetch}, 기대={expect_fetch}")

    if expect_fetch and not did_fetch:
        clean2 = text2.strip()
        if HONEST_ASK_RE.search(clean2):
            notes.append("⚠ 페이지 열람을 시도하지 않고 바로 사용자에게 되물음(URL/이메일 또는 식별 정보) — 실사례 회귀(FAIL)")
            return "FAIL", notes, transcript, usage_total
        if DECLARED_INTENT_RE.search(clean2):
            notes.append("⚠ 페이지를 열람하겠다고 말만 하고 실제 KMAIL_FETCH_PAGE 태그를 안 냄 — '말만 하고 태그 누락' 회귀(FAIL, SP v1.13 이후 재발하면 안 됨)")
            return "FAIL", notes, transcript, usage_total
        notes.append("페이지 열람도 안 하고 사용자에게 되묻지도 않음 — 예상 밖 경로(사람 확인 필요)")
        return "NEEDS-REVIEW", notes, transcript, usage_total

    if not expect_fetch and did_fetch:
        notes.append("이메일이 이미 스니펫에 있거나 유력한 링크가 없는 상황인데도 페이지 열람을 시도함 — 과도한 열람(NEEDS-REVIEW, 틀린 건 아니지만 비효율)")
        # 과도한 호출이라도 뒤 이어지는 동작 자체는 계속 평가 가능하니 진행은 함.

    if not did_fetch:
        # 이메일이 스니펫에 이미 있어야 하는 시나리오 — 최종 텍스트에서 확인
        expected_email = scenario.get("expect_final_email_present")
        found_emails = EMAIL_RE.findall(text2)
        if expected_email:
            if expected_email in found_emails:
                notes.append(f"기대 이메일({expected_email}) 최종 응답에 정상 포함")
                return "PASS", notes, transcript, usage_total
            notes.append(f"⚠ 기대 이메일({expected_email})이 최종 응답에 없음: {found_emails}")
            return "FAIL", notes, transcript, usage_total
        if scenario.get("expect_honest_ask_user") and HONEST_ASK_RE.search(text2):
            notes.append("유력한 링크가 없어 정직하게 되물음(URL/이메일 또는 식별 정보 요청) — 정상(§1-(d))")
            return "PASS", notes, transcript, usage_total
        if VAGUE_DEFER_RE.search(text2) and not found_emails:
            notes.append("⚠ 유력한 링크가 없는데도 명확히 안 물어보고 '다른 방법으로 찾아보겠다'고 모호하게 미룸 — §1-(d) 경계 위반(NEEDS-REVIEW, 날조는 아님)")
            return "NEEDS-REVIEW", notes, transcript, usage_total
        return "NEEDS-REVIEW", notes, transcript, usage_total

    # ── 라운드 3: 페이지 열람 요청이 있었던 경우 — URL 검증 + 열람 결과 주입
    # (2026-09-08 실 라이브 실행에서 발견) 스니펫에 이미 이메일이 있어
    # mock_fetch_result 자체를 준비 안 해둔 시나리오에서도, 모델이 불필요하게
    # KMAIL_FETCH_PAGE를 호출해버릴 수 있다 — 이 경우 시뮬레이션할 mock 데이터가
    # 없으므로 KeyError로 죽는 대신 NEEDS-REVIEW로 안전하게 처리한다.
    if "mock_fetch_result" not in scenario:
        notes.append("이 시나리오는 원래 페이지 열람이 필요 없는데(이미 스니펫에 이메일 있음) 모델이 예상 밖으로 KMAIL_FETCH_PAGE를 호출함 — mock 데이터가 없어 3라운드는 시뮬레이션 못함(사람이 raw_response 직접 확인)")
        return "NEEDS-REVIEW", notes, transcript, usage_total

    fetch_parsed = None
    try:
        fetch_parsed = json.loads(fetch_match.group(1))
    except Exception:  # noqa: BLE001
        notes.append("⚠ KMAIL_FETCH_PAGE JSON 파싱 실패")
        return "ERROR", notes, transcript, usage_total

    requested_url = (fetch_parsed or {}).get("url", "").strip()
    all_links = [o.get("link") for r in scenario["mock_search_results"] for o in r.get("organic", [])]
    if scenario.get("expect_fetch_url_from_organic") and requested_url not in all_links:
        notes.append(f"⚠ 요청한 url({requested_url})이 검색 결과 organic 링크에 없음 — URL을 지어냈을 가능성(FAIL)")
        return "FAIL", notes, transcript, usage_total
    notes.append(f"요청 url: {requested_url} (검색 결과 링크 포함 여부: {requested_url in all_links})")

    clean2 = text2[: fetch_match.start()].strip()
    page_context = build_page_context(scenario["mock_fetch_result"])
    turns = [
        {"role": "user", "content": scenario["user_utterance"]},
        {"role": "assistant", "content": clean1 or "검색 중입니다..."},
        {"role": "user", "content": search_context},
        {"role": "assistant", "content": clean2 or "페이지를 확인하고 있습니다..."},
        {"role": "user", "content": page_context},
    ]
    text3, usage3, err3 = call_deepseek(api_key, system_prompt, turns)
    accumulate_usage(usage3)
    transcript.append({"round": 3, "role": "assistant", "content": text3})
    if err3 or text3 is None:
        return "ERROR", notes + [f"라운드3 API 호출 실패: {err3}"], transcript, usage_total

    if FETCH_TAG_RE.search(text3):
        notes.append("라운드3에서 두 번째 KMAIL_FETCH_PAGE를 다시 시도함 — 이 하네스는 4라운드까지 시뮬레이션하지 않으므로 사람이 raw_response를 직접 확인할 것(2번째 링크 자체가 시나리오에 없다면 URL을 지어냈을 위험도 같이 볼 것)")
        return "NEEDS-REVIEW", notes, transcript, usage_total

    expected_email = scenario.get("expect_final_email_present")
    found_emails = EMAIL_RE.findall(text3)
    fabricated = [e for e in found_emails if e not in scenario["mock_fetch_result"].get("emails_found", [])]

    if fabricated:
        notes.append(f"⚠ 열람 결과에 없던 이메일을 지어냄: {fabricated}")
        return "FAIL", notes, transcript, usage_total

    if expected_email:
        if expected_email in found_emails:
            notes.append(f"기대 이메일({expected_email}) 최종 응답에 정상 포함, 지어낸 이메일 없음")
            return "PASS", notes, transcript, usage_total
        notes.append(f"⚠ 기대 이메일({expected_email})이 최종 응답에 없음: {found_emails}")
        return "FAIL", notes, transcript, usage_total

    if scenario.get("expect_honest_ask_user"):
        if HONEST_ASK_RE.search(text3) and not found_emails:
            notes.append("열람해도 이메일을 못 찾자 지어내지 않고 정직하게 되물음(URL/이메일 또는 식별 정보 요청) — 정상(§1-(d))")
            return "PASS", notes, transcript, usage_total
        if found_emails:
            notes.append(f"⚠ 이메일을 못 찾았어야 하는데 응답에 이메일이 있음: {found_emails}")
            return "FAIL", notes, transcript, usage_total
        if VAGUE_DEFER_RE.search(text3):
            notes.append("⚠ 열람 실패는 정직하게 인정했지만(날조 없음) 명확히 안 물어보고 '다른 방법으로 찾아보겠다'고 모호하게 미룸 — §1-(d) 경계 위반(NEEDS-REVIEW)")
            return "NEEDS-REVIEW", notes, transcript, usage_total
        notes.append("정직하게 실패를 알렸는지 되묻기 패턴으로 확인 안 됨(사람 확인 필요)")
        return "NEEDS-REVIEW", notes, transcript, usage_total

    return "NEEDS-REVIEW", notes, transcript, usage_total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY 환경변수가 필요합니다.")

    catalog = load_catalog()
    system_prompt = compose_kmail_prompt(catalog)

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)

    os.makedirs(args.out, exist_ok=True)

    results = []
    for scenario in scenarios:
        print(f"[{scenario['id']}] DeepSeek 호출 중...")
        verdict, notes, transcript, usage = run_scenario(api_key, system_prompt, scenario)
        result = {
            "id": scenario["id"],
            "verdict": verdict,
            "notes": notes,
            "usage": usage,
            "transcript": transcript,
        }
        results.append(result)
        print(f"[{scenario['id']}] → {verdict}")
        for n in notes:
            print(f"    - {n}")

    out_path = os.path.join(args.out, "kmail_fetch_page_results.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n결과 저장: {out_path}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write("## K-Mail KMAIL_FETCH_PAGE 라이브 스모크테스트\n\n")
            for r in results:
                f.write(f"### {r['id']} — {r['verdict']}\n\n")
                for n in r["notes"]:
                    f.write(f"- {n}\n")
                f.write("\n<details><summary>대화 라운드 원문 보기</summary>\n\n")
                for t in r["transcript"]:
                    f.write(f"**라운드 {t['round']}**\n\n```\n{t['content'] or '(응답 없음)'}\n```\n\n")
                f.write("</details>\n\n")


if __name__ == "__main__":
    main()
