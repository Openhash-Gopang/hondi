"""
run_verdicts.py
===============
K-Law 가상 판결 생성 메인 실행 스크립트.

실행:
  cd ~/Downloads/case_summary
  python run_verdicts.py

옵션:
  --api-key    DeepSeek API 키 (환경변수 DEEPSEEK_API_KEY로도 설정 가능)
               동일 키가 생성자(판결문 작성)·판단자(앙상블 검증) 모두에 사용됨
  --workers    병렬 워커 수 (기본: 10)
  --group      특정 그룹만 실행 (A/B/C/D/E, 기본: 전체)
  --dry-run    API 호출 없이 파이프라인만 테스트

중단 후 재개:
  동일 명령어 재실행 → progress.json 기반으로 미완료 사건만 처리

변경 이력:
  - 배치(batch) 방식으로 전환: 20건씩만 executor에 제출 → 전원 완료 후 정지
  - 판결문 저장 위치: verdicts/{그룹}/ → verdicts/ (순번 기준, 하위 폴더 없음)
  - reasoning 저장 위치: verdicts/reasoning/ (단일 폴더)
  - v14.3+ 앙상블 통합: klaw_ensemble.py 의 ensemble_validate() 를 자기검토 후 호출
    DeepSeek(생성자) → LogicEngine(비LLM) → DeepSeek(판단자) 3단계 결론 분리
"""

import os, sys, json, time, argparse, threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, wait, ALL_COMPLETED
from datetime import datetime

# ── 경로 ──────────────────────────────────────────────────────────────────
BASE_DIR      = Path(__file__).parent
PROCESSED_DIR = BASE_DIR / "processed"
VERDICTS_DIR  = BASE_DIR / "verdicts"
DONE_DIR      = BASE_DIR / "verdicts_evaluated"   # 평가 완료 이동 폴더
REASONING_DIR = VERDICTS_DIR / "reasoning"   # think 추론 전용 (단일 폴더)
PROGRESS_FILE   = BASE_DIR / "progress.json"
EVAL_PROGRESS   = BASE_DIR / "eval_progress.json"   # 평가 회차 관리
METADATA_FILE = BASE_DIR / "cases_metadata.json"
SCORES_DIR    = BASE_DIR / "scores"

VERDICTS_DIR.mkdir(exist_ok=True)
REASONING_DIR.mkdir(exist_ok=True)
SCORES_DIR.mkdir(exist_ok=True)

# ── K-Law 버전 관리 ─────────────────────────────────────────────────────
# 설계 원칙 (수정):
#   progress.json 의 klaw_version 을 단일 출처로 사용.
#   다음 버전은 case_summary/ 에 존재하는 klaw_v*.md 파일을 탐색하여 결정.
#   하드코딩 수식(get_version) 폐기 — total_completed 기반 계산은
#   file_not_found/재평가 등으로 실제 버전과 불일치가 발생했음.

def _parse_ver(ver_str: str) -> tuple:
    """'v13.6' → (13, 6). 파싱 실패 시 (0, 0)."""
    try:
        body = ver_str.lstrip("v")
        major, minor = body.split(".")
        return int(major), int(minor)
    except Exception:
        return (0, 0)


def find_next_version(current: str, base_dir: Path) -> str | None:
    """
    base_dir 에서 klaw_v*.md 파일을 탐색하여
    current 보다 높은 버전 중 가장 낮은 것을 반환.
    없으면 None 반환 (버전 유지).
    """
    cur_key = _parse_ver(current)
    candidates = []
    for f in base_dir.glob("klaw_v*.md"):
        stem    = f.stem                          # klaw_v13_6
        ver_part = stem[len("klaw_"):]            # v13_6
        ver_str  = ver_part.replace("_", ".", 1)  # v13.6
        key = _parse_ver(ver_str)
        if key > cur_key:
            candidates.append((key, f"v{key[0]}.{key[1]}"))
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][1]   # 가장 낮은 상위 버전

# ── DeepSeek API 호출 ─────────────────────────────────────────────────────
import urllib.request

def call_deepseek(system_prompt: str, user_prompt: str,
                  api_key: str, dry_run: bool = False) -> tuple[str, str]:
    """
    Returns:
      (verdict_content, reasoning_content)
    """
    if dry_run:
        return "[DRY-RUN] 가상 판결문 생성 생략", ""

    url     = "https://api.deepseek.com/v1/chat/completions"
    payload = json.dumps({
        "model":      "deepseek-v4-pro",
        "max_tokens": 16000,   # 8K→16K: A-0-S·B-5-A/B/C 생략 방지 (2026-05-14 v14.4)
        "thinking":   {"type": "enabled"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type":  "application/json",
        "Authorization": f"Bearer {api_key}",
    })

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:  # 16K 출력 대비
                data              = json.loads(resp.read())
                msg               = data["choices"][0]["message"]
                content           = (msg.get("content")           or "").strip()
                reasoning_content = (msg.get("reasoning_content") or "").strip()
                return content, reasoning_content
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

# ── progress.json 관리 ────────────────────────────────────────────────────
# -- K-Law 자기검토 강제 ----------------------------------------------------------
SELF_REVIEW_SYSTEM_PROMPT = (
    "당신은 K-Law 방법론 준수 여부를 검토하는 법률 AI 감사자입니다.\n"
    "아래 가상 판결문이 K-Law 방법론의 강제규칙을 준수하였는지 확인하고,\n"
    "미준수 항목이 있으면 판결문을 수정하여 완전한 판결문을 다시 제출하십시오.\n\n"
    "검토 체크리스트:\n"
    "[1] [K-Law vXX.X 적용 | 사건번호: XXXX | 심급: X심] 헤더가 첫 줄에 있는가?\n"
    "[2] STEP 0 -> A -> B -> C 순서가 지켜졌는가? (완료 태그 확인)\n"
    "[3] [STEP-A-0-S] 블록이 출력되었는가? (핵심 단어 문구 의미 해석)\n"
    "[4] [STEP-A-1-COMPLETE] 피고 최강 논거가 300자 이상인가?\n"
    "[5] [STEP-A-2-COMPLETE] 게이트웨이 통과 확인이 있는가?\n"
    "[6] [STEP-B-COMPLETE] 확신도(법리/사실)가 출력되었는가?\n"
    "[7] [STEP-C-COMPLETE] 자기검증 블록([자기 검증])이 있는가?\n"
    "[8] 판결 주문이 법률 용어(인용/기각/각하/파기환송/파기자판)로만 표현되었는가?\n"
    "[9] 파기환송 결론에 승/패 표현이 없는가?\n"
    "[10] 상급심 사건에서 원심 역전 신호 검토가 있는가? (A-1 역전 신호)\n"
    "[11] 판결문 본문의 핵심 사실(청구취지·당사자·과세 세목·사건 유형)이"
    " 입력된 사건 요약과 일치하는가?\n"
    "    불일치 시 → 판결문 전체를 재작성한다. (유사 사건 연속 입력 시 혼동 방지)\n\n"
    "[불일치 위험도 평가]\n"
    "위 체크리스트 검토 후, 아래 5개 위험 신호를 각각 0~2점으로 평가하여"
    " 판결문 맨 끝에 반드시 출력하십시오.\n"
    "형식:\n"
    "[불일치 위험도]\n"
    "① 법리 경합도 (0=단일법리, 1=2개경합, 2=3개이상): X점\n"
    "② 사실 불확실도 (0=명확, 1=일부불명, 2=핵심불명): X점\n"
    "③ 심급 모호도 (0=대법원명확, 1=항소심, 2=불명): X점\n"
    "④ 가치판단 비중 (0=없음, 1=일부, 2=핵심쟁점): X점\n"
    "⑤ 법리 신규성 (0=확립판례, 1=판례희소, 2=신규법리의심): X점\n"
    "합계: X점 / 10점\n"
    "위험 등급: 낮음(0~3) / 중간(4~6) / 높음(7~10)\n\n"
    "지시:\n"
    "- 미준수 항목이 없으면 판결문 그대로 반환하십시오.\n"
    "- 미준수 항목이 있으면 해당 부분을 보완하여 완전한 판결문을 반환하십시오.\n"
    "- [11]번 사건 동일성 불일치 시에는 판결문 전체를 재작성하십시오.\n"
    "- 반환 시 판결문 본문만 출력하고, 검토 결과 설명은 판결문 맨 앞에 1줄로만 기재하십시오.\n"
    "  형식: [자기검토 완료 | 수정 항목: N개 / 수정 없음]"
)


def self_review(verdict: str, version: str,
                api_key: str, dry_run: bool) -> tuple[str, int]:
    """
    K-Law 방법론 준수 여부 자기검토 후 수정된 판결문 반환.
    Returns: (reviewed_verdict, fix_count, risk_score, risk_grade)
    """
    import re as _re

    if dry_run:
        return verdict, 0, -1, "측정불가" 

    user_prompt = (
        f"[검토 대상 가상 판결문]\n"
        f"적용 버전: K-Law {version}\n\n"
        f"--- 판결문 시작 ---\n"
        f"{verdict}\n"
        f"--- 판결문 끝 ---\n\n"
        f"위 판결문을 K-Law {version} 방법론 기준으로 검토하고,\n"
        f"미준수 항목이 있으면 수정한 완전한 판결문을 반환하십시오."
    )

    reviewed, _ = call_deepseek(SELF_REVIEW_SYSTEM_PROMPT, user_prompt,
                                api_key, dry_run)

    # 수정 항목 수 파싱
    fix_count = 0
    m = _re.search(r"수정 항목:\s*(\d+)개", reviewed)
    if m:
        fix_count = int(m.group(1))
    elif "수정 없음" in reviewed:
        fix_count = 0

    # 헤더 줄 제거 후 판결문 본문만 추출
    lines = reviewed.splitlines()
    if lines and lines[0].startswith("[자기검토"):
        reviewed = "\n".join(lines[1:]).lstrip()

    # 불일치 위험도 점수 파싱
    risk_score = -1  # -1 = 파싱 실패
    m2 = _re.search(r"합계[：:]\s*(\d+)점\s*/\s*10점", reviewed)
    if m2:
        risk_score = int(m2.group(1))

    # 위험 등급 문자열
    if risk_score < 0:
        risk_grade = "측정불가"
    elif risk_score <= 3:
        risk_grade = "낮음"
    elif risk_score <= 6:
        risk_grade = "중간"
    else:
        risk_grade = "높음"

    return reviewed, fix_count, risk_score, risk_grade


_progress_lock = threading.Lock()

def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def load_progress(metadata: list) -> dict:
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, encoding="utf-8") as f:
                data = json.load(f)
            if data:  # 빈 dict 방어
                return data
        except (json.JSONDecodeError, ValueError):
            print(f"[WARN] progress.json 파싱 실패 — 초기화하여 재시작합니다.")
            PROGRESS_FILE.unlink(missing_ok=True)
    return {
        "total_completed": 0,
        "klaw_version":    "v13.2",
        "version_history": [{"version": "v13.2", "from_seq": 1, "timestamp": now()}],
        "completed":       [],   # 완료된 filename 목록 (단순 리스트)
        "error":           [],
        "started_at":      now(),
    }

def save_progress(progress: dict):
    with _progress_lock:
        with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
            json.dump(progress, f, ensure_ascii=False, indent=2)

# ── eval_progress.json 회차 관리 ────────────────────────────────────────
def bump_eval_round() -> int:
    """
    evaluate_verdicts.py 와 공유하는 eval_progress.json 의
    current_round 를 +1 한다. run_verdicts.py 가 K-Law 버전을 올릴 때 호출.
    """
    if EVAL_PROGRESS.exists():
        try:
            ep = json.loads(EVAL_PROGRESS.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            ep = {"current_round": 4, "pass_threshold": 7.0, "rounds": {}}
    else:
        ep = {"current_round": 4, "pass_threshold": 7.0, "rounds": {}}

    ep["current_round"] = ep.get("current_round", 4) + 1
    rnd = ep["current_round"]
    ep.setdefault("rounds", {})[str(rnd)] = {
        "klaw_version": None,
        "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "completed_at": None,
        "score_dir": f"scores/{rnd}회차",
        "fail_dir":  f"scores/{rnd}회차 재평가 대상",
    }
    EVAL_PROGRESS.write_text(
        json.dumps(ep, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return rnd


# ── 완료 여부 확인 ────────────────────────────────────────────────────────
def is_done(case: dict) -> bool:
    """
    완료 여부를 두 곳에서 확인:
    1. verdicts/{seq:04d}_{case_id}.txt  (아직 평가 전 생성 완료)
    2. verdicts_evaluated/{seq:04d}_{case_id}.txt  (평가 후 이동 완료)

    수정 전에는 verdicts/ 만 확인하여, 평가 완료 후 이동된 파일을
    미완료로 오인하고 중복 생성하는 버그가 있었음.
    """
    case_id  = case["filename"].replace(".txt", "")
    seq      = case["seq"]
    fname    = f"{seq:04d}_{case_id}.txt"
    return (VERDICTS_DIR / fname).exists() or (DONE_DIR / fname).exists()

# ── 앙상블 상세 로그 출력 ─────────────────────────────────────────────────
def _print_ensemble_log(case_id: str, elog: dict) -> None:
    """
    ensemble_validate() 가 반환한 log_dict 를 콘솔에 구조화하여 출력.
    사용자가 앙상블 적용 과정을 한눈에 파악할 수 있도록 설계.
    """
    phase = elog.get("phase", "생략됨")

    # ── 헤더 ─────────────────────────────────────────────────────────────
    print(f"    ┌─[앙상블 검증] {case_id} ─────────────────────")

    if phase == "생략됨":
        reason = elog.get("error", "")
        print(f"    │  ⏭  건너뜀: {reason}")
        print(f"    └──────────────────────────────────────────")
        return

    if phase == "오류":
        print(f"    │  ❌ 판단자 API 호출 실패: {elog.get('error','')}")
        print(f"    └──────────────────────────────────────────")
        return

    # ── Phase 2: LogicEngine 매트릭스 ────────────────────────────────────
    m = elog.get("matrix", {})
    flag_names = {
        "self_override_detected":  "self_override",
        "precedent_lock":          "precedent_lock",
        "unresolved_issues":       "unresolved",
        "confidence_risk_paradox": "conf_risk_paradox",
    }
    active_flags = [short for key, short in flag_names.items() if m.get(key)]

    print(f"    │  [Phase 2 · LogicEngine]")
    print(f"    │    결론 감지   : {m.get('conclusion','?')}")
    print(f"    │    확신도(원본): {m.get('confidence','?')}/10  "
          f"위험도: {m.get('risk_score','?')}/10  "
          f"DI: {m.get('di','?')}")
    print(f"    │    A-0-S 존재 : {'있음' if m.get('has_a0s') else '없음'}  "
          f"자기검토 수정: {m.get('self_review_fix_count','?')}개")
    if active_flags:
        print(f"    │    🚩 플래그   : {', '.join(active_flags)} "
              f"(총 {m.get('bias_flag_count',0)}개)")
    else:
        print(f"    │    ✅ 플래그   : 없음")

    # ── Phase 3: 판단자 응답 ─────────────────────────────────────────────
    jv  = elog.get("judge_verdict", "?")
    rec = elog.get("recommendation", "?")
    adj = elog.get("confidence_after", "?")
    bef = elog.get("confidence_before", "?")
    concern = elog.get("concern", "")
    flags   = elog.get("flags", [])

    verdict_icon = {"신뢰": "✅", "주의": "⚠️", "경고": "🔴"}.get(jv, "❓")
    rec_icon     = {"유지": "→ 그대로 저장", "재검토권고": "→ 평가 시 주의",
                    "재생성요청": "→ 결론 방향 -0.5점"}.get(rec, "")

    print(f"    │  [Phase 3 · DeepSeek 판단자]")
    print(f"    │    판정       : {verdict_icon} {jv}  |  권고: {rec}  {rec_icon}")
    print(f"    │    확신도 조정: {bef} → {adj}/10")
    if flags:
        print(f"    │    트리거 플래그: {', '.join(flags)}")
    if concern:
        print(f"    │    주요 우려  : {concern}")

    # ── 최종 요약 ─────────────────────────────────────────────────────────
    if jv == "경고":
        print(f"    │  ⛔ 판결문 상단에 [앙상블-경고] 태그 삽입 완료")
    elif jv == "주의":
        print(f"    │  ⚠️  판결문 상단에 [앙상블-주의] 태그 삽입 완료")
    else:
        print(f"    │  ✅ 판결문 상단에 [앙상블-신뢰] 태그 삽입 완료")
    print(f"    └──────────────────────────────────────────")

def _find_proc_file(case: dict) -> Path | None:
    """
    사건번호(6자리)로 파일을 찾는다. 탐색 순서:
      1. PROCESSED_DIR / filename 직접 매칭 (빠른 경로)
      2. PROCESSED_DIR 스캔 (사건번호 기반)
      3. BASE_DIR 루트 스캔 (processed/ 에 없을 때 fallback)
    """
    import re as _re
    raw = case.get("filename", "")
    m = _re.search(r"(?<!\d)(\d{6})(?!\d)", raw)
    if not m:
        return None
    case_num = m.group(1)

    # 1. 빠른 경로
    direct = PROCESSED_DIR / raw
    if direct.exists():
        return direct

    # 2. processed/ 스캔
    for f in PROCESSED_DIR.iterdir():
        if not f.is_file():
            continue
        fm = _re.search(r"(?<!\d)(\d{6})(?!\d)", f.name)
        if fm and fm.group(1) == case_num:
            return f

    # 3. BASE_DIR 루트 스캔 (txt 파일만)
    for f in BASE_DIR.iterdir():
        if not f.is_file() or f.suffix.lower() != ".txt":
            continue
        fm = _re.search(r"(?<!\d)(\d{6})(?!\d)", f.name)
        if fm and fm.group(1) == case_num:
            return f

    return None


# ── 단일 사건 처리 ────────────────────────────────────────────────────────
def process_case(case: dict, version: str, api_key: str, dry_run: bool) -> dict:
    from prompts import build_system_prompt, build_user_prompt

    case_id   = case["filename"].replace(".txt", "")
    seq       = case["seq"]
    proc_file = _find_proc_file(case)

    if proc_file is None or not proc_file.exists():
        return {"case_id": case_id, "seq": seq, "status": "file_not_found"}

    case_text = proc_file.read_text(encoding="utf-8", errors="replace")

    try:
        # ── 단일 호출 (현재 운용 방식) ───────────────────────────────────
        # 방안 1(STEP별 분리)은 klaw_steps.py에 구현 완료.
        # 처리 시간 6배 증가로 현재는 단일 호출 유지.
        # 5월 31일 DeepSeek 프로모 종료 후 방안 2+4로 전환 예정.
        verdict, reasoning = call_deepseek(
            build_system_prompt(version),
            build_user_prompt(case_text, case),
            api_key, dry_run
        )

        # ── K-Law 방법론 준수 자기검토 (강제) ───────────────────────────
        verdict, fix_count, risk_score, risk_grade = self_review(
            verdict, version, api_key, dry_run)
        if not dry_run:
            if fix_count > 0:
                print(f"    [자기검토] {case_id}: {fix_count}개 항목 수정됨")
            if risk_score >= 0:
                print(f"    [위험도] {case_id}: {risk_score}/10 ({risk_grade})")

        # ── 앙상블 검증 (v14.3+) ─────────────────────────────────────────
        try:
            from klaw_ensemble import ensemble_validate
            verdict, ensemble_changed, elog = ensemble_validate(
                verdict, version, api_key, dry_run)
            if not dry_run:
                _print_ensemble_log(case_id, elog)
        except ImportError:
            pass

        # ── 판결문 저장: verdicts/{seq:04d}_{case_id}.txt ─────────────────
        # 순번 4자리 접두사 → 파일 탐색기에서 자동 정렬, 실제 판결문과 1:1 대응
        out_name = f"{seq:04d}_{case_id}.txt"
        out_path = VERDICTS_DIR / out_name
        risk_header = (f"# 불일치 위험도: {risk_score}/10 ({risk_grade})\n"
                       if risk_score >= 0 else "")
        out_path.write_text(
            f"# K-Law {version} 가상 판결\n"
            f"{risk_header}"
            f"# 사건: {case['filename']}\n"
            f"# 도메인: {case['domain']} | 등급: {case['grade']} | 순번: {seq}\n"
            f"# 생성일시: {now()}\n\n"
            + verdict,
            encoding="utf-8"
        )

        # ── think 추론 저장: verdicts/reasoning/{seq:04d}_{case_id}_reasoning.txt
        if reasoning:
            r_path = REASONING_DIR / f"{seq:04d}_{case_id}_reasoning.txt"
            r_path.write_text(
                f"# [Think 추론] K-Law {version}\n"
                f"# 사건: {case['filename']} | 생성일시: {now()}\n\n"
                + reasoning,
                encoding="utf-8"
            )

        return {"case_id": case_id, "seq": seq, "status": "done", "version": version}

    except Exception as e:
        return {"case_id": case_id, "seq": seq, "status": "error", "error": str(e)}

# ── 버전 갱신 안내 + Enter 대기 ───────────────────────────────────────────
def prompt_version_update(progress: dict) -> None:
    """20건 배치 완료 후 메인 스레드에서 호출. 새 버전 파일 확인 후 Enter로 재개."""
    total_done = progress["total_completed"]
    current    = progress["klaw_version"]
    # ── 수정: 하드코딩 수식 대신 파일 탐색으로 다음 버전 결정 ──────────
    expected   = find_next_version(current, BASE_DIR)

    print("\n" + "=" * 60)
    print(f"🔄  K-Law 버전 갱신 포인트 도달!")
    print(f"    완료 건수: {total_done}건")
    if expected is not None:
        print(f"    현재 버전: {current}  →  다음 버전: {expected}")
        fname = f"klaw_{expected.replace('.', '_')}.md"
        print(f"    ※ {fname} 가 case_summary/ 에 있으면 자동 적용됩니다.")
        print(f"    ※ 아직 없다면 직전 20건을 분석하여 {fname} 를 저장하십시오.")
    else:
        print(f"    현재 버전: {current}")
        print(f"    ※ case_summary/ 에 상위 버전 klaw_v*.md 파일이 없습니다.")
        print(f"    ※ 갱신된 방법론 파일을 저장한 뒤 Enter 를 누르십시오.")
        print(f"      (파일이 없으면 현재 버전 {current} 을 계속 사용합니다.)")
    print(f"    준비 완료 후 Enter를 누르면 다음 20건을 시작합니다...")
    print("=" * 60)
    input()

    # Enter 후 파일을 다시 탐색 (Enter 대기 중 파일을 저장했을 수 있음)
    expected = find_next_version(current, BASE_DIR)

    if expected is not None:
        progress["klaw_version"] = expected
        progress["version_history"].append({
            "version":    expected,
            "from_count": total_done + 1,
            "timestamp":  now(),
        })
        save_progress(progress)
        # 평가 회차도 함께 +1 (eval_progress.json)
        new_round = bump_eval_round()
        print(f"▶   버전 갱신 완료: {expected} 적용")
        print(f"▶   평가 회차 갱신: {new_round}회차\n")
    else:
        print(f"▶   버전 유지: {current} (상위 버전 파일 없음)\n")

# ── 메인 ──────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="K-Law 가상 판결 생성")
    parser.add_argument("--api-key", default=os.environ.get("DEEPSEEK_API_KEY",
                                                             "sk-REDACTED"))
    parser.add_argument("--workers", type=int, default=10)
    parser.add_argument("--group",   default=None, help="A/B/C/D/E (기본: 전체)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.api_key and not args.dry_run:
        print("[ERROR] DeepSeek API 키 필요.")
        sys.exit(1)

    if not METADATA_FILE.exists():
        print("[ERROR] cases_metadata.json 없음. 먼저 preprocess.py를 실행하십시오.")
        sys.exit(1)

    with open(METADATA_FILE, encoding="utf-8") as f:
        all_cases: list[dict] = json.load(f)

    progress = load_progress(all_cases)

    # 미완료 사건 목록 (seq 순 정렬 — 배치가 순번대로 처리됨)
    pending = sorted(
        [c for c in all_cases
         if c["generate"]
         and (args.group is None or c["group"] == args.group)
         and not is_done(c)],
        key=lambda c: c["seq"]
    )

    total_target = sum(1 for c in all_cases
                       if c["generate"]
                       and (args.group is None or c["group"] == args.group))
    already_done = total_target - len(pending)

    print("=" * 60)
    print(f"K-Law 가상 판결 생성 시작  ({now()})")
    print(f"  전체 대상: {total_target}건 | 기완료: {already_done}건 | 미완료: {len(pending)}건")
    print(f"  현재 버전: {progress['klaw_version']} | 워커: {args.workers}")
    print(f"  저장 위치: {VERDICTS_DIR}/  (하위 폴더 없음, 순번 정렬)")
    print(f"  앙상블:   활성화 (DeepSeek 생성자 + DeepSeek 판단자, 결론 분리)")
    if args.dry_run:
        print("  ⚠️  DRY-RUN 모드 (API 미호출)")
    print("=" * 60)

    if not pending:
        print("모든 사건 처리 완료!")
        return

    # ── 배치(batch) 실행 루프 ─────────────────────────────────────────────
    # 핵심: 20건씩만 executor에 제출 → wait(ALL_COMPLETED) → 배치 완료 확인
    # → 20의 배수 도달 시 완전 정지 → Enter → 다음 배치 제출
    # 이미 실행 중인 futures가 없으므로 "멈추지 않는" 문제가 원천 차단됨.
    BATCH_SIZE   = 20
    start_time   = time.time()
    success_count = 0
    error_count   = 0
    batch_success = 0   # 현재 배치 내 성공 건수 (정지 조건 판단용)

    with ThreadPoolExecutor(max_workers=args.workers) as executor:

        for batch_start in range(0, len(pending), BATCH_SIZE):
            batch = pending[batch_start : batch_start + BATCH_SIZE]

            version = progress["klaw_version"]
            print(f"\n── 배치 [{batch_start + 1}~{batch_start + len(batch)}] "
                  f"({len(batch)}건) / {version} ──")

            # ❶ 이 배치만 제출 (최대 20개 future)
            futures = {
                executor.submit(process_case, c, version, args.api_key, args.dry_run): c
                for c in batch
            }

            # ❷ 이 배치의 모든 future가 완료될 때까지 블로킹
            wait(futures, return_when=ALL_COMPLETED)

            # ❸ 결과 수집 (이미 전부 완료된 상태)
            batch_success = 0
            for fut, case in futures.items():
                try:
                    result = fut.result()
                except Exception as e:
                    result = {"case_id": case["filename"], "seq": case["seq"],
                              "status": "error", "error": str(e)}

                if result["status"] == "done":
                    success_count += 1
                    batch_success += 1
                    progress["total_completed"] += 1
                    progress["completed"].append(case["filename"])
                    print(f"  ✅ [{progress['total_completed']:3d}] "
                          f"{case['filename'][:50]:50s} ({result.get('version', version)})")

                elif result["status"] == "error":
                    error_count += 1
                    progress["error"].append(case["filename"])
                    print(f"  ❌ [{case['seq']:3d}] {case['filename'][:40]:40s}"
                          f" — {result.get('error','')[:60]}")

                else:  # file_not_found 등
                    print(f"  ⚠️  [{case['seq']:3d}] {case['filename'][:40]:40s}"
                          f" — {result['status']}")

            save_progress(progress)

            # ❹ 아직 남은 배치가 있으면 무조건 정지 (버전 갱신 여부는 내부에서 판단)
            # ※ 수정: total_completed 나머지 연산 방식 폐기.
            #   file_not_found/error 건이 끼면 20의 배수를 영구히 놓쳐
            #   정지 조건이 불발되는 버그가 있었음.
            #   배치 경계마다 무조건 정지하도록 변경.
            remaining_batches = batch_start + BATCH_SIZE < len(pending)

            if remaining_batches:
                # ── 완전 정지: 다음 배치 제출 전에 Enter 대기 ──────────────
                prompt_version_update(progress)

    elapsed = time.time() - start_time
    save_progress(progress)

    print("\n" + "=" * 60)
    print(f"실행 완료  ({now()})")
    print(f"  성공: {success_count}건 | 오류: {error_count}건")
    print(f"  소요시간: {elapsed / 60:.1f}분")
    print(f"  판결문 위치: {VERDICTS_DIR}/")
    print("=" * 60)

if __name__ == "__main__":
    main()
