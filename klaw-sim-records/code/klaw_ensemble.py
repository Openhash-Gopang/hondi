"""
klaw_ensemble.py
================
K-Law 다중 LLM 앙상블 모듈.

구조:
  Phase 1  DeepSeek 생성자  → run_verdicts.py 기존 로직 (변경 없음)
  Phase 2  LogicEngine      → 순수 Python, 비LLM, API 호출 없음
  Phase 3  Claude 판단자    → 매트릭스만 입력 (사건 원문 차단)
  Phase 4  ensemble_validate → 앙상블 태그를 verdict 상단에 삽입

사용:
  run_verdicts.py 의 process_case() 에서:
    from klaw_ensemble import ensemble_validate
    verdict, _ = ensemble_validate(verdict, version, anthropic_key, dry_run)

환경변수:
  ANTHROPIC_API_KEY  Claude API 키 (없으면 앙상블 비활성화, 단독 DeepSeek 동작)
"""

import re
import json
import time
import urllib.request
from typing import Optional


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2 — LogicEngine (순수 Python, 비LLM)
# ══════════════════════════════════════════════════════════════════════════════

class LogicEngine:
    """
    DeepSeek 가상 판결문에서 논거·충돌·편향 신호를 추출해
    Claude 판단자에 전달할 구조화 매트릭스(JSON)를 생성한다.
    사건 원문은 전달하지 않는다 — 결론 분리 아키텍처의 핵심.
    """

    CONCLUSION_PATTERNS = {
        "파기환송": r"파기(?:하고|하여|환송)",
        "파기자판": r"파기자판",
        "상고기각": r"상고를?\s*기각",
        "항소기각": r"항소를?\s*기각",
        "원고승":   r"원고(?:의\s*청구를?)?\s*인용|처분\s*취소",
        "판단유보": r"판단\s*유보|정보\s*부족",
    }

    # 판례 맹목적 추종 신호
    PRECEDENT_LOCK = [
        r"전원합의체\s*판례에\s*반할\s*수\s*없",
        r"전원합의체의\s*명시적\s*결론",
        r"기존\s*판례의?\s*변경\s*없음",
        r"확립된\s*판례에\s*따라",
    ]

    # 미해결 쟁점 / 구별 가능성 신호
    UNRESOLVED = [
        r"직접\s*판례\s*(?:미발견|없음|부재)",
        r"구별(?:될\s*수\s*있|가능성)",
        r"이\s*사건의?\s*특수성",
        r"법리\s*(?:신규성|변경\s*가능성)",
        r"반사회성.{0,20}현저",
    ]

    # 역방향 논거 생성 후 억누름 패턴 (self-override)
    OVERRIDE_GENERATE = [
        r"\[B-6\s*반전\s*논거\]",
        r"역방향\s*논거",
        r"파기\s*가능성\s*(?:있음|검토)",
        r"★{3,}",   # ★★★ 이상 반전 강도
    ]
    OVERRIDE_SUPPRESS = [
        r"배척\s*이유",
        r"그러나\s*(?:전원합의체|판례|기존)",
        r"반할\s*수\s*없",
        r"억제\s*이유",
    ]

    CONFIDENCE_RE = re.compile(r"\[법리\s*확신도[：:]\s*(\d+)/10\]")
    RISK_RE       = re.compile(r"합계[：:]\s*(\d+)점\s*/\s*10점")
    DI_RE         = re.compile(r"\bDI[：:]\s*(\d+\.?\d*)")

    def parse(self, verdict: str) -> dict:
        """판결문 → 구조화 매트릭스 dict 반환."""

        # 1. 결론 추출
        conclusion = "불명확"
        for label, pattern in self.CONCLUSION_PATTERNS.items():
            if re.search(pattern, verdict):
                conclusion = label
                break

        # 2. 확신도 / 위험도 / DI
        m = self.CONFIDENCE_RE.search(verdict)
        confidence = int(m.group(1)) if m else -1

        m = self.RISK_RE.search(verdict)
        risk_score = int(m.group(1)) if m else -1

        m = self.DI_RE.search(verdict)
        di = float(m.group(1)) if m else -1.0

        # 3. 편향 신호
        precedent_lock    = any(re.search(p, verdict) for p in self.PRECEDENT_LOCK)
        unresolved_issues = any(re.search(p, verdict) for p in self.UNRESOLVED)

        has_override_generate = any(re.search(p, verdict) for p in self.OVERRIDE_GENERATE)
        has_override_suppress = any(re.search(p, verdict) for p in self.OVERRIDE_SUPPRESS)
        self_override = has_override_generate and has_override_suppress

        # 4. 확신도·위험도 역설 (높은 확신 + 높은 위험)
        confidence_risk_paradox = (confidence >= 8 and risk_score >= 7)

        # 5. 자기검토 수정 건수
        m = re.search(r"수정 항목:\s*(\d+)개", verdict)
        fix_count = int(m.group(1)) if m else 0

        # 6. A-0-S 존재 여부
        has_a0s = bool(re.search(r"\[STEP-A-0-S\]", verdict))

        return {
            "conclusion":              conclusion,
            "confidence":              confidence,
            "risk_score":              risk_score,
            "di":                      di,
            "precedent_lock":          precedent_lock,
            "unresolved_issues":       unresolved_issues,
            "self_override_detected":  self_override,
            "confidence_risk_paradox": confidence_risk_paradox,
            "self_review_fix_count":   fix_count,
            "has_a0s":                 has_a0s,
            # 편향 플래그 합계 (판단자 우선순위 참고용)
            "bias_flag_count": sum([
                precedent_lock,
                unresolved_issues,
                self_override,
                confidence_risk_paradox,
            ]),
        }


# ══════════════════════════════════════════════════════════════════════════════
# Phase 3 — Claude 판단자
# ══════════════════════════════════════════════════════════════════════════════

JUDGE_SYSTEM = """당신은 K-Law 앙상블 판단자(Judge)입니다.
DeepSeek(생성자)가 작성한 가상 판결문의 구조화 매트릭스만을 입력받아,
결론의 신뢰도와 잠재적 편향을 평가합니다.

사건 원문은 제공되지 않습니다. 매트릭스의 수치와 플래그만으로 판단하십시오.

출력 형식 (JSON, 다른 텍스트 없이):
{
  "judge_verdict": "신뢰" | "주의" | "경고",
  "confidence_adjusted": <0~10 실수, 생성자 확신도 조정값>,
  "primary_concern": "<핵심 우려 사항 한 문장>",
  "flags_triggered": ["플래그1", "플래그2"],
  "recommendation": "유지" | "재검토권고" | "재생성요청"
}

판단 기준:
- bias_flag_count >= 3 → 경고
- self_override_detected = true → 주의 이상
- confidence_risk_paradox = true → 주의 이상
- precedent_lock = true AND unresolved_issues = true → 경고
- 이상 없음 → 신뢰
"""


DEEPSEEK_API_KEY = "sk-REDACTED"
DEEPSEEK_MODEL   = "deepseek-v4-pro"


def _call_judge(matrix: dict, api_key: str) -> Optional[dict]:
    """DeepSeek API를 판단자로 호출 → JSON 파싱 결과 반환. 실패 시 None.

    생성자(DeepSeek)와 동일한 API 키를 사용하되,
    별도 인스턴스(다른 messages 컨텍스트)로 호출하여 편향 분리.
    사건 원문은 전달하지 않고 LogicEngine 매트릭스만 입력.
    """
    key = api_key or DEEPSEEK_API_KEY
    url = "https://api.deepseek.com/v1/chat/completions"
    payload = json.dumps({
        "model":      DEEPSEEK_MODEL,
        "max_tokens": 512,
        "thinking":   {"type": "disabled"},   # 판단자는 구조화 매트릭스만 판정 — thinking 불필요
        "messages": [
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user",   "content":
                f"[구조화 매트릭스]\n"
                f"{json.dumps(matrix, ensure_ascii=False, indent=2)}\n\n"
                f"위 매트릭스를 평가하십시오. JSON만 출력하십시오."},
        ],
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type":  "application/json",
        "Authorization": f"Bearer {key}",
    })

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
                text = (data["choices"][0]["message"].get("content") or "").strip()
                text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S).strip()
                return json.loads(text)
        except Exception:
            if attempt == 2:
                return None
            time.sleep(2 ** attempt)


# ══════════════════════════════════════════════════════════════════════════════
# Phase 4 — 공개 인터페이스
# ══════════════════════════════════════════════════════════════════════════════

def ensemble_validate(verdict: str, version: str,
                      api_key: str, dry_run: bool = False
                      ) -> tuple[str, bool, dict]:
    """
    DeepSeek 판결문에 앙상블 검증 태그를 삽입하여 반환.

    생성자와 동일한 DeepSeek api_key를 사용하되,
    사건 원문 없이 LogicEngine 매트릭스만 전달 → 결론 분리 아키텍처 유지.

    Returns:
      (annotated_verdict, changed, log_dict)
      - changed   : True → 판단자가 주의/경고 판정
      - log_dict  : run_verdicts.py 가 콘솔에 출력할 상세 정보
        {
          "phase": "생략됨" | "완료",
          "matrix": dict,          # LogicEngine 출력
          "judgment": dict | None, # 판단자 응답
          "judge_verdict": str,    # 신뢰/주의/경고
          "recommendation": str,
          "confidence_before": int,
          "confidence_after": float,
          "flags": list[str],
          "bias_flag_count": int,
          "concern": str,
          "tag_inserted": str,     # 판결문에 삽입된 태그 전문
          "error": str | None,
        }
    """
    _empty_log = {
        "phase": "생략됨", "matrix": {}, "judgment": None,
        "judge_verdict": "N/A", "recommendation": "N/A",
        "confidence_before": -1, "confidence_after": -1,
        "flags": [], "bias_flag_count": 0,
        "concern": "", "tag_inserted": "", "error": None,
    }

    if dry_run or not api_key:
        _empty_log["error"] = "dry-run 또는 api_key 없음"
        return verdict, False, _empty_log

    engine   = LogicEngine()
    matrix   = engine.parse(verdict)
    judgment = _call_judge(matrix, api_key)

    if judgment is None:
        tag = (
            f"\n[앙상블-오류] 판단자 호출 실패 — 원본 유지\n"
            f"[LogicEngine 매트릭스] {json.dumps(matrix, ensure_ascii=False)}\n\n"
        )
        log = {**_empty_log, "phase": "오류", "matrix": matrix,
               "tag_inserted": tag, "error": "판단자 API 호출 실패"}
        return tag + verdict, False, log

    jv      = judgment.get("judge_verdict", "신뢰")
    rec     = judgment.get("recommendation", "유지")
    adj     = judgment.get("confidence_adjusted", matrix["confidence"])
    concern = judgment.get("primary_concern", "")
    flags   = judgment.get("flags_triggered", [])
    flags_str = ", ".join(flags) if flags else "없음"

    tag = (
        f"[앙상블-{jv}] K-Law {version} | 판단자: DeepSeek(별도 인스턴스)\n"
        f"  확신도 조정: {matrix['confidence']} → {adj}/10 | "
        f"편향 플래그: {matrix['bias_flag_count']}개 ({flags_str})\n"
        f"  주요 우려: {concern}\n"
        f"  권고: {rec}\n\n"
    )

    changed = (jv != "신뢰" or rec != "유지")

    log = {
        "phase":             "완료",
        "matrix":            matrix,
        "judgment":          judgment,
        "judge_verdict":     jv,
        "recommendation":    rec,
        "confidence_before": matrix["confidence"],
        "confidence_after":  adj,
        "flags":             flags,
        "bias_flag_count":   matrix["bias_flag_count"],
        "concern":           concern,
        "tag_inserted":      tag,
        "error":             None,
    }

    return tag + verdict, changed, log
