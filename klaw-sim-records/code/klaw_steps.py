"""
klaw_steps.py
=============
K-Law 방법론 v14.4 — STEP별 강제 실행 엔진 (방안 1).

설계 원칙:
  - 단일 API 호출 대신 STEP 0 → A → B → C 를 개별 호출로 분리
  - 각 STEP의 완료 태그([STEP-X-COMPLETE])를 Python 코드로 검증
  - 태그 누락 시 해당 STEP만 최대 MAX_RETRY회 재시도
  - 이전 STEP 출력을 다음 STEP 컨텍스트로 누적 전달
  - v14.4 강제규칙 22(다수의견 확인) 및 공리 J 포스트프로세서 내장

5월 31일 이후 방안 2+4 전환 시:
  - 이 파일의 step_pipeline() 대신 단일 호출로 교체
  - StepValidator와 AxiomJFilter만 유지
"""

import re
import time
import json
from typing import Optional

# ── 설정 ──────────────────────────────────────────────────────────────────
MAX_RETRY   = 1      # STEP별 최대 재시도 횟수 (태그 누락 시 1회만 재시도)
STEP_TOKENS = {      # STEP별 max_tokens (출력량 기준)
    "0": 1500,
    "A": 4000,
    "B": 4000,
    "C": 1500,
}

# ── STEP별 완료 태그 정의 ─────────────────────────────────────────────────
STEP_TAGS = {
    # STEP 0: 완료 태그 1개
    "0": [r"\[STEP-0-COMPLETE"],

    # STEP A: 시작(A-0)과 끝(A-5) 태그만 검증
    # → 중간 태그(A-1~A-4)는 프롬프트 지시로 강제, Python 재시도는 불필요
    # → [다수의견 확인]은 형식 자유로워 태그 검증 제외, 프롬프트 강제로 대체
    "A": [
        r"\[STEP-A-0-COMPLETE",
        r"\[STEP-A-5-COMPLETE",
    ],

    # STEP B: 완료 태그 1개
    "B": [r"\[STEP-B-COMPLETE"],

    # STEP C: 완료 태그 + 확신도 출력 확인
    "C": [
        r"\[STEP-C-COMPLETE",
        r"법리 확신도",
    ],
}

# ── 공리 J 포스트프로세서 ─────────────────────────────────────────────────
_CASE_NUM_RE = re.compile(
    r"대법원\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*선고\s*\d{4}[가-힣]{1,5}\d{3,6}"
    r"|\d{4}[가-힣]{1,5}\d{4,6}\s*판결"
    r"|\d{4}두\d{4,6}"
    r"|\d{4}다\d{4,6}"
    r"|\d{4}도\d{4,6}"
    r"|\d{4}마\d{4,6}"
    r"|\d{4}바\d{4,6}"
)

def enforce_axiom_j(text: str) -> tuple[str, int]:
    """판례번호를 원칙 수준 서술로 자동 치환. (정제된 텍스트, 위반 건수) 반환."""
    violations = _CASE_NUM_RE.findall(text)
    cleaned = _CASE_NUM_RE.sub("[관련 판례의 법리]", text)
    return cleaned, len(violations)


# ── STEP별 시스템 프롬프트 ────────────────────────────────────────────────

def _system_base(version: str) -> str:
    return (
        f"당신은 K-Law {version} 방법론을 적용하는 법률 AI 판사입니다.\n"
        "반드시 지시된 STEP만 수행하고, 완료 태그를 출력하십시오.\n"
        "판례 번호를 직접 인용하지 마십시오 (공리 J). "
        "관련 판례의 법리만 원칙 수준으로 서술하십시오.\n\n"
    )


def _prompt_step0(version: str) -> str:
    return _system_base(version) + """[STEP 0 수행 지시]
이 단계에서만 수행하십시오:

1. [응답 헤더] 출력: [K-Law vXX.X 적용 | 사건번호: XXXX | 심급: X심]
2. [0-α 직관]: 원고 유리 / 피고 유리 / 불명확 — 근거 3가지 (입증책임·신뢰보호·결과수긍)
3. [0-β 격리]: 이전 결론 방향 격리 선언
4. [명제] 총 N쌍 — 제1층위(소송 요건) / 제2층위(법적 성격) / 제3층위(본안)
5. 완료 태그 출력: [STEP-0-COMPLETE | 명제 N쌍 | 0-α: X유리 | 0-β: 해당/없음]

STEP A는 수행하지 마십시오."""


def _prompt_step_a(version: str) -> str:
    return _system_base(version) + """[STEP A 수행 지시]
STEP 0 결과를 이어받아 아래 순서대로 수행하십시오:

A-0: 판례 법리 군 수집 (3건 이상, 강제규칙 12 — 3건 미만 시 -2점) + 전원합의체 검색 + 완료 태그
    ※ 변경 법리 확인 필수: 판례 변경이 있으면 "구 법리 인용 금지" 선언 출력
A-0-S: 핵심 단어 의미 해석 + 특별법 감지 + 형식-실질 구별 + 완료 태그

[다수의견 확인 — 강제규칙 22]
전원합의체·다수/소수의견 분리 여부를 반드시 확인하십시오.
형식: [다수의견 확인] 전원합의체: 해당/없음 | 견해대립: 있음/없음 | 공법영역: 해당/없음
→ 견해대립 있음 또는 공법영역: B-5-A 자동 발동 예약
→ 소수의견 채택 시: 확신도 -2 조정 필수

A-1: 역방향 추론
    - 피고 최강 논거: 300자 이상, 법원칙 1건 이상 (공리 B)
    - 반대 논거 ① ② ③ 열거
    - 입증책임: [원고/피고] 부담 — 근거 명시 (강제규칙 필수)
    - 원고 대응 논거: 피고 논거와 동등 분량
    + 완료 태그

A-2: 법률관계 확정 (게이트웨이 통과 확인, 강제규칙 2)
    [A-2-0] 특별법 감지: 존재 시 강제규칙 14 [A-4] 발동
    [A-2-1] 법령 시제: 적용 법령명 + 시행일 기준 명시. 개정 연혁 확인.
    [A-2-2] 복잡도: [N/10] — 법리중복/판례일관/사실다층/가치충돌 4축 각각 수치 기재
    [A-2-3] 공격·방어 목록화: 원고 N개 / 피고 N개
    + 완료 태그

A-3: 인과 분해 (공리 E) — 8축 전부 (강제규칙 준수)
    ① 채권·채무 발생 원인  ② 이익 귀속 관계  ③ 제3자 역할
    ④ 사후 행태·시간적 흐름  ⑤ 의무의 근원법령(공리 C §3)
    ⑥ 행정처분 연계성(공리 C §4)
    ⑦ 행위의 구체적 태양 (v14.4 신설)
    ⑧ 법률환경 변화 (v14.4 신설)
    + 완료 태그

A-4: 명제 정교화 — 숨은 명제 탐지 (부록 B 체크리스트·예외 법리 트리거) + 완료 태그

A-5: 충돌 지점 식별
    - 충돌 유형: 법리 해석 차이 / 사실 인정 차이 / 입증책임 차이
    - 상식(0-α) ↔ 법리 예상 일치 여부 반드시 비교
    - 불일치 시 강제규칙 3-1 발동 선언 필수
    + 완료 태그

STEP B는 수행하지 마십시오."""


def _prompt_step_b(version: str) -> str:
    return _system_base(version) + """[STEP B 수행 지시]
STEP 0·A 결과를 이어받아 아래 순서대로 수행하십시오:

B-1: 법률관계 최종 확정
    - 강행규정 확인: 해당 조문·요건 충족 여부
    - B-1-1: 특별법 우선 적용 최종 확인 (일반법 보충 범위 명시)

B-2: 쟁점 계층적 처리 (귀속 주체 확인 완료)
    - B-2-1: 행정처분 연계성 — 전제 처분 취소 시 후속 처분 효력 분석

B-3: 법률행위 해석
    [사실관계 매트릭스 8축 — v14.4]
    ① 채권·채무 발생 원인  ② 이익 귀속 관계  ③ 제3자 역할
    ④ 사후 행태·시간적 흐름  ⑤ 의무의 근원법령
    ⑥ 행정처분 연계성  ⑦ 행위의 구체적 태양  ⑧ 법률환경 변화

    [계약 해석 5대 요소 — 공리 I, 강제규칙 필수]
    계약 관련 사건인 경우 반드시 적용:
    ① 문언의 통상적 의미  ② 당사자의 진정한 의사
    ③ 계약의 목적  ④ 거래 관행  ⑤ 신의성실 원칙
    ※ A-0-S 부칙 5: '정산약정·공제약정' 감지 시 자동/수동 효과 분기 판단

B-4: 해석 우선순위 (공리 H 적용 흔적 명시 — 강제규칙 4)
    적용 순위: 제1.5우선(문언 명확성 게이트) → 제1.6우선(특별법) →
               제1우선(제재규범 엄격해석) → 제2우선(실질 우선)
    근거: "공리 H [해당 우선순위]에 따라 [조문]은 [해석 내용]."

    [B-4-α 제재규범 이중 해석 — 강제규칙 11]
    제재·의무부과 규범인 경우 반드시 수행:
    엄격해석 결과: [요약] vs 확장해석 결과: [요약]
    최종 채택: [엄격/확장] — 근거 명시

    [형식-실질 비교 분석 — 강제규칙 13]
    [문언 명확성 게이트]: 명확 / 불명확
    (불명확 시)
      형식적 해석: [요약] → 결론: [요약]
      실질적 해석: [요약] → 결론: [요약]
      최종 선택 근거: 공리 C 선행 확인 순서 N항

    [특별법-일반법 관계 분석 — 강제규칙 14, 조건부]
    A-2-0에서 특별법 존재 시 반드시 수행:
      해당 영역: [행정/조세/...]
      일반법: [법률명] / 특별법: [법률명]
      특별법 우선 적용 여부 + 배제 범위 명시

    [B-4 법리오해-결론 정당성 분리 심사 — v14.4 신설]
    법리오해 감지 시: "법리오해가 있더라도 결론 유지 가능성" 별도 심사
    법리오해 ≠ 항상 파기사유 (파기사유 = 법리오해 AND 결론에 영향)

B-5: 손해액 산정 (해당 없음 / 금액·책임 제한 비율 명시)

[B-5-A: 역방향 판결 초안 — 강제규칙 15, 조건부]
발동 조건: A-5 충돌 지점 감지 / 강제규칙 3-1 경고 / 복잡도 6 이상
           또는 공법·견해대립·전원합의체 (v14.4 확대)
[역방향 판결 초안]
  주문: [정반대 결론]
  핵심 법리: [반대 결론 지지 법리]
  사실관계 해석: [반대 결론 지지 해석]
  [비교 분석]: 법리 해석 차이 / 사실 인정 차이 / 입증책임 분배 차이
  역방향이 더 설득력 있는 지점: [있음/없음]
  최종 결론 유지 근거: [공리 B 반전 논거 배척 논리]

[B-5-B: 국제 비교 법원칙 — 강제규칙 16, 조건부]
발동 조건: B-5-A 트리거 AND 공법·행정법·조세법·형사법·계약법 해당
  해당 영역 / 참조 법체계 / 수렴 확인 / 핵심 원칙 / 결론
  K-Law와 비교: 일치/불일치 + 불일치 원인

[B-5-C: 통합 비교 분석 — B-5-A 또는 B-5-B 발동 시]
  K-Law / 역방향 / 국제 법원칙 3자 비교표
  의사결정 규칙 판정 (1)(2)(3) 중 해당 선택
  최종 결론 + 확신도 조정

B-6: 상식 필터·반전 논거 (공리 D·B·K)
    반전 논거: [결론을 뒤집을 가장 강력한 단일 법리 논거]
    배척 이유: [배척 논리]

    [B-6-가: 원심 판단구조 분석 — v14.4 신설]
    감지 패턴: "가사 ~라 하더라도", "설령 ~라도", "부가적으로"
    → 부가적·가정적 판단을 독립 논증 층위로 분리 저장

B-7: 최종 판결문 (강제규칙 5)
    [B-7-0] 공격·방어 방법 누락 검증 (공리 M):
    원고 N개 전부 판단 완료 / 피고 N개 전부 판단 완료

완료 태그: [STEP-B-COMPLETE | 판결문 완료 | 확신도 포함]

STEP C는 수행하지 마십시오."""


def _prompt_step_c(version: str) -> str:
    return _system_base(version) + """[STEP C 수행 지시]
STEP 0·A·B 결과를 이어받아 아래를 수행하십시오:

C-1: 인권 보호 항목 점검 (공리 F)
    위법수집증거 / 자백 임의성 / 절차적 약자 조치 각각 판단

C-2: 판례 인용 5단계 검증 + 하위 판단 요소 완전성 확인
    (1) 판례 실재 여부  (2) 사안 유사성  (3) 법리 적용 적절성
    (4) 변경 판례 존재 여부  (5) 인용 방식 (원칙 수준 서술 확인)

C-3: 출력 형식 확인
    주문: 인용/기각/각하/파기환송/파기자판 중 하나
    '승/패' 표현 미사용 확인

C-4: 자기 갱신 트리거 점검
    공리 O (gg)(hh) 포함 전체 트리거 발동 여부 확인

[C-α 완결 게이트웨이] — 전 항목 완료 확인 후 출력
(1) 명제-판단 일치 완전성: 완료
(2) 확신도 출력: 완료
(3) 자기 평가 출력: 완료
(4) 판례 인용 검증: 완료
(5) 강제규칙 1~16 + 22 준수: 완료
(6) 반대 의견 생성 및 배척: 완료
(7) 특별법 감지 비교 분석: 완료 / 해당 없음
(8) 행정처분 연계성 분석: 완료 / 해당 없음
(9) 역방향 판결 초안: 완료 / 해당 없음
(10) 국제 비교 법원칙 검증: 완료 / 해당 없음
(11) 앙상블 검증 태그 삽입: 완료 / 해당 없음
[STEP-C-α-COMPLETE | 전 항목 완료]

[확신도 및 자기 평가 — 강제규칙 5·6]
[법리 확신도: X/10] [사실 확신도: Y/10]
[종합 확신도: min(X,Y)/10]
[결론 유형: 판단유보 / 조건부 / 확정적 / 절차적 환송]
(절차적 환송 시) 환송 취지: 추가 심리 필요 / 법리 재검토 / 사실관계 재확인

[AI 예측 일치도: XX%]
[사건 복잡도: X/10]

[자기 검증 — 강제규칙 9]
==============================
□ 강제규칙 1~16 + 22 모두 준수: 예 / 아니오
□ 준수하지 않은 규칙: 없음 / (번호 및 사유 명시)
□ 독립적 재판단 선언 출력 여부 (2안 이상 시): 출력 / 해당 없음
□ 재생성 필요 여부: 불필요 / 필요
==============================

[판결 요약] 판결의 핵심 내용 2~3문장. 주문·핵심 법리·확신도 포함.

완료 태그: [STEP-C-COMPLETE | C-α 완료 후 최종 출력]"""


# ── STEP별 사용자 프롬프트 ────────────────────────────────────────────────

def _user_step0(case_text: str, case: dict) -> str:
    return (
        f"[사건 요약]\n{case_text[:4000]}\n\n"
        f"[사건 메타데이터]\n"
        f"도메인: {case.get('domain','?')} | 등급: {case.get('grade','?')} | "
        f"사건번호: {case.get('filename','?')}\n\n"
        "위 사건에 대해 STEP 0을 수행하십시오."
    )


def _user_step_a(case_text: str, step0_out: str) -> str:
    return (
        f"[사건 요약]\n{case_text[:3000]}\n\n"
        f"[STEP 0 완료 결과]\n{step0_out}\n\n"
        "위 결과를 이어받아 STEP A 전체를 수행하십시오.\n"
        "강제규칙 22: 다수의견 확인을 반드시 먼저 수행하십시오."
    )


def _user_step_b(case_text: str, step0_out: str, step_a_out: str) -> str:
    return (
        f"[사건 요약]\n{case_text[:2000]}\n\n"
        f"[STEP 0]\n{step0_out[:800]}\n\n"
        f"[STEP A]\n{step_a_out}\n\n"
        "위 결과를 이어받아 STEP B 전체를 수행하십시오."
    )


def _user_step_c(step0_out: str, step_a_out: str, step_b_out: str) -> str:
    # STEP C는 사건 원문 불필요 — 결론 편향 차단
    return (
        f"[STEP 0]\n{step0_out[:600]}\n\n"
        f"[STEP A 요약]\n{step_a_out[:800]}\n\n"
        f"[STEP B]\n{step_b_out}\n\n"
        "위 결과를 이어받아 STEP C를 수행하십시오."
    )


# ── 태그 검증기 ───────────────────────────────────────────────────────────

def _validate_tags(step: str, output: str) -> list[str]:
    """누락된 완료 태그 목록 반환. 빈 리스트면 통과."""
    return [
        tag for tag in STEP_TAGS[step]
        if not re.search(tag, output)
    ]


def _retry_message(step: str, missing: list[str], output: str) -> str:
    """재시도 시 LLM에 전달할 보완 요청 메시지."""
    tag_names = ", ".join(t.strip(r"\[") for t in missing)
    return (
        f"[재수행 요청] STEP {step}의 다음 완료 태그가 누락되었습니다: {tag_names}\n"
        f"아래는 지금까지 출력된 내용입니다. 누락된 부분만 보완하여 완전한 STEP {step}를 다시 출력하십시오.\n\n"
        f"[기존 출력]\n{output}"
    )


# ── 메인 파이프라인 ───────────────────────────────────────────────────────

def step_pipeline(
    case_text: str,
    case: dict,
    version: str,
    api_key: str,
    call_fn,          # call_deepseek(system, user, api_key, dry_run) → (content, reasoning)
    dry_run: bool = False,
) -> tuple[str, str, dict]:
    """
    STEP 0 → A → B → C 순서로 개별 API 호출.

    Returns:
      (final_verdict, reasoning_combined, step_log)
      step_log: 각 STEP의 출력·재시도 횟수·태그 통과 여부
    """
    if dry_run:
        fake = (
            f"[K-Law {version} 적용 | DRY-RUN]\n"
            "[STEP-0-COMPLETE | 명제 1쌍 | 0-α: 불명확 | 0-β: 없음]\n"
            "[STEP-A-0-COMPLETE | 판례 0건 | 하위 판단 요소 0개]\n"
            "[STEP-A-0-S-COMPLETE | 해석 0개 | 판례 인용 없음 | 특별법: 부존재]\n"
            "[STEP-A-1-COMPLETE | 피고 최강: DRY-RUN]\n"
            "[STEP-A-2-COMPLETE | 게이트웨이 통과 | 특별법: 부존재]\n"
            "[STEP-A-3-COMPLETE | 분해 층위 6개]\n"
            "[STEP-A-4-COMPLETE | 최종 명제 1개(숨은 명제 0개 포함)]\n"
            "[STEP-A-5-COMPLETE | 충돌 지점 0개]\n"
            "[STEP-B-COMPLETE | 판결문 완료 | 확신도 포함]\n"
            "[STEP-C-α-COMPLETE | 전 항목 완료]\n"
            "[STEP-C-COMPLETE | C-α 완료 후 최종 출력]\n"
            "[법리 확신도: 5/10] [사실 확신도: 5/10]\n"
            "판결 요약: DRY-RUN 모드로 생략됨.\n"
        )
        return fake, "", {s: {"output": "DRY-RUN", "retries": 0, "passed": True}
                         for s in ["0", "A", "B", "C"]}

    step_log   = {}
    reasoning_parts = []

    prompts = {
        "0": (_prompt_step0(version),  lambda: _user_step0(case_text, case)),
        "A": (_prompt_step_a(version), lambda: _user_step_a(case_text, step_outputs["0"])),
        "B": (_prompt_step_b(version), lambda: _user_step_b(case_text, step_outputs["0"], step_outputs["A"])),
        "C": (_prompt_step_c(version), lambda: _user_step_c(step_outputs["0"], step_outputs["A"], step_outputs["B"])),
    }

    step_outputs = {}

    for step in ["0", "A", "B", "C"]:
        system_prompt, user_fn = prompts[step]
        user_prompt = user_fn()
        output   = ""
        retries  = 0
        passed   = False

        for attempt in range(MAX_RETRY + 1):
            if attempt == 0:
                content, reasoning = call_fn(
                    system_prompt, user_prompt, api_key, dry_run)
            else:
                # 재시도: 누락 태그 보완 요청
                content, reasoning = call_fn(
                    system_prompt,
                    _retry_message(step, missing_tags, output),
                    api_key, dry_run)
                retries += 1

            output += ("\n" if output else "") + content
            if reasoning:
                reasoning_parts.append(f"[STEP {step} reasoning]\n{reasoning}")

            missing_tags = _validate_tags(step, output)
            if not missing_tags:
                passed = True
                break

            if attempt < MAX_RETRY:
                time.sleep(1)

        # 공리 J 포스트프로세서 적용
        output, j_violations = enforce_axiom_j(output)
        if j_violations > 0:
            output += f"\n[공리-J-필터] 판례번호 {j_violations}건 자동 치환됨"

        step_outputs[step] = output
        step_log[step] = {
            "output":   output,
            "retries":  retries,
            "passed":   passed,
            "j_viol":   j_violations,
            "missing":  missing_tags if not passed else [],
        }

    # 전체 판결문 조합
    final_verdict = "\n\n".join([
        f"── STEP {s} ──\n{step_outputs[s]}"
        for s in ["0", "A", "B", "C"]
    ])
    reasoning_combined = "\n\n".join(reasoning_parts)

    return final_verdict, reasoning_combined, step_log


def format_step_log(step_log: dict) -> str:
    """step_log를 콘솔 출력용 문자열로 변환."""
    lines = []
    for step, info in step_log.items():
        status = "✅" if info["passed"] else "⚠️ "
        retry_str = f" (재시도 {info['retries']}회)" if info["retries"] > 0 else ""
        j_str = f" | 공리J {info['j_viol']}건 치환" if info.get("j_viol", 0) > 0 else ""
        miss_str = ""
        if not info["passed"] and info.get("missing"):
            miss_str = f" | 누락: {', '.join(t.strip(chr(92)+'[') for t in info['missing'])}"
        lines.append(f"    │  STEP {step}: {status}{retry_str}{j_str}{miss_str}")
    return "\n".join(lines)
