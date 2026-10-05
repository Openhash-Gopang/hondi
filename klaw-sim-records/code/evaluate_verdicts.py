"""
evaluate_verdicts.py
====================
K-Law 가상 판결문 ↔ 실제 판결문 일치도 평가 + 방법론 갱신 제안서 생성.

평가 기준: 일치도_평가_기준_v1.6
  - 결론 방향 일치도 4점
  - 핵심 법리 일치도 3점
  - 세부 논증 일치도 3점 (A-0-S 정합성 0.5점 포함)
  - 합계 10점

실행:
  cd C:\\Users\\주피터\\Downloads\\case_summary
  python evaluate_verdicts.py

옵션:
  --verdicts-dir    가상 판결문 폴더  (기본: ./verdicts)
  --real-dir        실제 판결문 폴더  (기본: C:\\Users\\주피터\\Downloads\\판결문)
  --output-dir      평가 결과 저장    (기본: ./scores)
  --done-dir        평가 완료 이동    (기본: ./verdicts_evaluated)
  --api-key         DeepSeek API 키   (또는 환경변수 DEEPSEEK_API_KEY)
  --batch           한 번에 처리할 건수 (기본: 20)
  --dry-run         API 미호출 테스트
  --reset           scores/ 폴더의 기존 평가 결과를 모두 삭제하고 재평가

매핑 방식:
  파일명에 포함된 6자리 숫자 사건번호로 가상·실제 판결문을 1:1 매핑합니다.
  예) 0005_가사_239085_손해배상(기)_요약.txt  →  사건번호 239085
      가사_239085_손해배상(기).txt           →  사건번호 239085  →  매칭

흐름:
  1. verdicts/ 에서 미평가 가상 판결문 목록 수집
  2. 파일명의 6자리 사건번호로 실제 판결문(판결문/ 폴더) 매핑
  3. DeepSeek API 에 일치도 평가 요청 (v1.6 기준)
  4. 평가 결과 → scores/{N회차}/{case_id}_score.txt 저장
  5. 점수 기준 분기:
       7.0점 이상 → scores/{N회차}/           (그대로 유지)
       7.0점 미만·N/A → scores/{N회차} 재평가 대상/  (이동)
  6. 방법론 갱신 제안서 → scores/{N회차}/renewal_proposal_{날짜}.txt 생성
  7. 평가 완료 가상 판결문 → verdicts_evaluated/ 이동
  8. 회차 정보는 eval_progress.json 에서 읽고, run_verdicts.py 가 버전 갱신 시 +1
"""

import os, sys, json, re, shutil, argparse, time, urllib.request, threading
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, wait, ALL_COMPLETED

# ── 경로 기본값 ───────────────────────────────────────────────────────────
BASE_DIR         = Path(__file__).parent
DEFAULT_VERDICTS = BASE_DIR / "verdicts"
DEFAULT_REAL     = Path(r"C:\Users\주피터\Downloads\판결문")
DEFAULT_OUTPUT   = BASE_DIR / "scores"
DEFAULT_DONE     = BASE_DIR / "verdicts_evaluated"
EVAL_PROGRESS    = BASE_DIR / "eval_progress.json"   # 회차 관리 파일

# ── 일치도 평가 기준 v1.6 요약 (시스템 프롬프트에 삽입) ──────────────────
EVAL_CRITERIA = """
[일치도 평가 기준 v1.6 요약]

배점 구조 (10점 만점):
  ① 결론 방향 일치도  : 4점  (인용/기각/각하/파기/환송 방향 일치 여부)
  ② 핵심 법리 일치도  : 3점  (핵심 쟁점 법리 적용·해석 일치 여부)
  ③ 세부 논증 일치도  : 3점  (하위 항목 3개로 구성)
     ③-1 사실 평가·논증 구조    : 1.5점
     ③-2 보조 법리·판례 적용    : 1.0점
     ③-3 A-0-S 의미 해석 정합성 : 0.5점 (가상 판결문에 A-0-S 출력 없으면 N/A)

등급:
  완전 일치  9.0~10.0 / 대체로 일치 7.0~8.9 / 부분 일치 5.0~6.9
  불일치     3.0~4.9  / 완전 불일치 0.0~2.9

면책 조항:
  - 공리 G에 따라 확신도 < 4이고 STEP B-7에서 [판단 유보] 명시 시 결론·논증 면책
  - 확신도 4~6이고 [조건부 결론] 출력 시 결론 4점 면책, 법리+논증만 평가
  - 4대 정보(청구취지·당사자·발생일시·원심판단) 모두 제공 시 판단유보 면책 불가
  - 판례 미인용 자체는 감점 없음 (허위 판례 생성은 감점)

다층 검증 모듈(B-5-A/B/C) 반영:
  - 발동 조건 해당인데 출력 누락 → 강제규칙 15/16 위반, 세부 논증 -0.5점
  - B-5-C (3) 역방향+국제법원칙 모두 동일 → 세부 논증 +0.5점 가산 가능
  - B-5-B에서 판례 번호 인용 → 공리 J 위반, 핵심 법리 -0.5점

1심·2심 결론 유추:
  - 상고인용+파기환송 → 원심=반대 방향
  - 상고기각         → 원심=대법원과 동일
  - 상고각하         → 원심 N/A

정보 부족 가산점 (최대 +1.5점, 10점 초과 불가):
  ② K-Law가 정보 부족 인지·추가 요청 → +0.5점
  ③ 사실관계에 해당 정보 애초 없음   → +0.5점
  ④ 정보 부족 정도가 중대             → +1.0점
  ⑤ 구조적 부재 기인                 → +0.5점

강제규칙 1~16 준수 현황: 위반 여부 명시 (없으면 "없음")

앙상블 검증 태그 반영 (v14.3):
  - [앙상블-경고] + 재생성요청 → 결론 방향 점수에서 -0.5점 적용
  - [앙상블-주의] + 재검토권고 → 방법론 갱신 필요성 항목에 앙상블 우려 필수 기재
  - [앙상블-신뢰] → 앙상블 관련 감점 없음
  - 앙상블 태그 없음(구버전) → 해당 없음으로 처리, 감점 없음

출력 형식 (모든 항목 필수):
  [다툼의 요지]
  [K-Law vs 대법원 평가]
    결론 방향: X/4점 또는 [면책]
    핵심 법리: X/3점
    세부 논증: X/3점
      - A-0-S 정합성: X/0.5점 또는 N/A
    종합 점수: X.X/10점 (등급: ...)
    면책 사유: (해당 시)
  [B-5-A/B/C 결과 반영] 발동: [해당/미해당] → 감점/가산: [±X점/없음]
  [1심(유추) vs 대법원] ...
  [2심(유추) vs 대법원] ...
  [종합 비교] K-Law: X.X점 / 1심: X.X점 / 2심: X.X점 / 더 일치: [K-Law/1심/2심/면책]
  [정보 부족 가산점] 적용: [예/아니오] / ①②③④⑤ / 가산: +X점 / 최종: X.X점
  [구조 이해도 C-α] C-α (1)~(10) 완료율 [N/10] / 세부 논증 가감: ±X점
  [방법론 갱신 필요성] 종합점수 < 7 시 필수 / 갱신 트리거 / 미흡 지점 / 개선 제안
  [강제규칙 준수] 강제규칙 1~16: [없음 / 위반 규칙 번호]
  [앙상블 검증 반영] 태그: [신뢰/주의/경고/없음] / 감점: [-0.5점/없음] / 비고: [내용]
""".strip()

SYSTEM_PROMPT_EVAL = f"""당신은 한국 법률 AI 판결 평가 전문가입니다.
아래 [일치도 평가 기준 v1.6]에 따라 K-Law 가상 판결문과 실제 판결문을 비교 평가하십시오.

{EVAL_CRITERIA}

규칙:
1. 출력 형식의 모든 항목을 빠짐없이 작성하십시오.
2. 점수는 기준 항목별로 정확히 숫자로 기재하십시오.
3. 면책·가산점 적용 여부를 명확히 표시하십시오.
4. 방법론 갱신 필요성 분석은 종합 점수 < 7일 때 반드시 포함하십시오.
5. 외부 검색 없이 제공된 두 판결문만으로 평가하십시오.
"""

RENEWAL_SYSTEM_PROMPT = """당신은 K-Law 법률 AI 방법론 연구자입니다.
제공된 일치도 평가 결과들을 분석하여 K-Law 방법론 갱신 제안서를 작성하십시오.

제안서 구성 (모든 섹션 필수):
1. 평가 배치 요약
   - 평가 건수, 평균 점수, 등급 분포
   - 면책 건수 / 정상 평가 건수 / 평가 불가 건수
2. 핵심 문제 패턴
   - 자주 발생한 오판 유형 (결론 역전 / 법리 오적용 / 논증 누락 등)
   - 강제규칙 위반 빈도 상위 항목
3. 방법론 갱신 제안
   - 갱신 트리거 발동 여부 (평균 < 7.0)
   - 항목별 구체적 개선안 (쟁점 유형별)
   - 다음 K-Law 버전에서 수정·보완할 조항
4. 데이터 보완 요청 사항
   - 판결 정확도 향상을 위해 필요한 추가 입력 정보
5. 결론 및 다음 배치 목표
"""

# ── API 호출 ──────────────────────────────────────────────────────────────
def call_api(system: str, user: str, api_key: str, dry_run: bool = False,
             max_tokens: int = 4000) -> str:
    if dry_run:
        return "[DRY-RUN] 평가 생략"

    url     = "https://api.deepseek.com/v1/chat/completions"
    payload = json.dumps({
        "model":      "deepseek-v4-pro",
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type":  "application/json",
        "Authorization": f"Bearer {api_key}",
    })

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read())
                msg  = data["choices"][0]["message"]
                return (msg.get("content") or "").strip()
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

# ── 유틸 ──────────────────────────────────────────────────────────────────
def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def now_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def extract_case_id(filename: str) -> str | None:
    """
    파일명에서 6자리 숫자 사건번호 추출 (가상·실제 판결문 공통).
    예) '0005_가사_239085_손해배상(기)_요약.txt' → '239085'
        '가사_239085_손해배상(기).txt'           → '239085'
    6자리 숫자가 여러 개이면 첫 번째를 사용합니다.

    주의: \b(단어 경계)는 언더스코어(_)나 한글 앞뒤에서 작동하지 않으므로
    비숫자 문자 또는 문자열 시작/끝을 경계로 사용합니다.
    """
    # 앞뒤가 숫자가 아닌 문자(또는 시작/끝)로 둘러싸인 정확히 6자리 숫자
    m = re.search(r"(?<!\d)(\d{6})(?!\d)", filename)
    return m.group(1) if m else None

# ── 실제 판결문 인덱스 구축 (폴더 1회 스캔) ──────────────────────────────
def build_real_index(real_dir: Path) -> dict[str, Path]:
    """
    실제 판결문 폴더를 스캔해 {사건번호(6자리): Path} 딕셔너리를 반환합니다.
    파일명에 6자리 숫자가 없으면 건너뜁니다.
    """
    index: dict[str, Path] = {}
    if not real_dir.exists():
        return index

    for f in real_dir.iterdir():
        if not f.is_file():
            continue
        if f.suffix.lower() not in (".txt", ".md", ".docx"):
            continue
        cid = extract_case_id(f.name)
        if cid and cid not in index:
            index[cid] = f
        elif cid and cid in index:
            # 중복 사건번호 경고 (첫 번째 파일 유지)
            print(f"  [WARN] 사건번호 중복: {cid} → {index[cid].name} / {f.name} (첫 번째 파일 사용)")

    return index

def read_file(path: Path) -> str:
    """txt/md는 직접 읽기, docx는 zipfile로 XML 텍스트 추출"""
    if path.suffix.lower() == ".docx":
        import zipfile
        try:
            with zipfile.ZipFile(path) as z:
                xml = z.read("word/document.xml").decode("utf-8")
            return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", xml)).strip()
        except Exception as e:
            return f"[docx 읽기 오류: {e}]"
    return path.read_text(encoding="utf-8", errors="replace")

# ── 회차(eval_progress.json) 관리 ──────────────────────────────────────────
def load_eval_progress() -> dict:
    """eval_progress.json 로드. 없으면 기본값(4회차) 반환."""
    if EVAL_PROGRESS.exists():
        try:
            return json.loads(EVAL_PROGRESS.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            print("[WARN] eval_progress.json 파싱 실패 — 기본값(4회차) 사용")
    return {
        "current_round": 4,
        "pass_threshold": 7.0,
        "rounds": {}
    }


def save_eval_progress(ep: dict) -> None:
    EVAL_PROGRESS.write_text(
        json.dumps(ep, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def bump_eval_round(base_dir: Path) -> int:
    """current_round += 1 후 저장. run_verdicts.py 가 버전 갱신 시 호출."""
    ep = load_eval_progress()
    ep["current_round"] = ep.get("current_round", 4) + 1
    rnd = ep["current_round"]
    # 새 회차 메타 초기화
    ep.setdefault("rounds", {})[str(rnd)] = {
        "klaw_version": None,
        "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "completed_at": None,
        "score_dir": f"scores/{rnd}회차",
        "fail_dir": f"scores/{rnd}회차 재평가 대상",
    }
    save_eval_progress(ep)
    return rnd


def get_round_dirs(base_dir: Path, round_no: int,
                   pass_threshold: float = 7.0) -> tuple[Path, Path]:
    """
    (pass_dir, fail_dir) 반환 및 생성.
    pass_dir : scores/{N회차}/
    fail_dir : scores/{N회차} 재평가 대상/
    """
    pass_dir = base_dir / "scores" / f"{round_no}회차"
    fail_dir = base_dir / "scores" / f"{round_no}회차 재평가 대상"
    pass_dir.mkdir(parents=True, exist_ok=True)
    fail_dir.mkdir(parents=True, exist_ok=True)
    return pass_dir, fail_dir


# ── 앙상블 태그 파싱 ─────────────────────────────────────────────────────
def parse_ensemble_tag(verdict_text: str) -> dict:
    """
    klaw_ensemble.py 가 삽입한 앙상블 태그를 파싱.
    태그 형식:
      [앙상블-{신뢰|주의|경고}] K-Law vXX.X | 판단자: ...
        확신도 조정: X → Y/10 | 편향 플래그: N개 (...)
        주요 우려: ...
        권고: {유지|재검토권고|재생성요청}

    Returns:
      {
        "found": bool,
        "verdict": "신뢰"|"주의"|"경고"|None,
        "recommendation": "유지"|"재검토권고"|"재생성요청"|None,
        "bias_flags": int,
        "concern": str,
        "score_penalty": float,   # 평가 점수 감점값 (결론 방향)
        "note": str,              # 평가 결과에 삽입할 참고 문구
      }
    """
    result = {
        "found": False,
        "verdict": None,
        "recommendation": None,
        "bias_flags": 0,
        "concern": "",
        "score_penalty": 0.0,
        "note": "",
    }

    # 태그 존재 여부 확인
    m = re.search(r"\[앙상블-(신뢰|주의|경고)\]", verdict_text)
    if not m:
        result["note"] = "[앙상블 태그 없음 — 구버전 판결문 또는 앙상블 미실행]"
        return result

    result["found"]   = True
    result["verdict"] = m.group(1)

    # 권고 파싱
    m2 = re.search(r"권고:\s*(유지|재검토권고|재생성요청)", verdict_text)
    if m2:
        result["recommendation"] = m2.group(1)

    # 편향 플래그 수 파싱
    m3 = re.search(r"편향 플래그:\s*(\d+)개", verdict_text)
    if m3:
        result["bias_flags"] = int(m3.group(1))

    # 주요 우려 파싱
    m4 = re.search(r"주요 우려:\s*(.+)", verdict_text)
    if m4:
        result["concern"] = m4.group(1).strip()

    # 감점 및 참고 문구 결정
    v   = result["verdict"]
    rec = result["recommendation"]

    if v == "경고" and rec == "재생성요청":
        result["score_penalty"] = 0.5
        result["note"] = (
            f"[앙상블-경고 반영] 결론 방향 -0.5점 적용 "
            f"(편향 플래그 {result['bias_flags']}개 / 우려: {result['concern']})"
        )
    elif v == "주의" and rec == "재검토권고":
        result["score_penalty"] = 0.0
        result["note"] = (
            f"[앙상블-주의 반영] 감점 없음. 방법론 갱신 필요성 항목에 "
            f"앙상블 우려 사항 필수 기재 (우려: {result['concern']})"
        )
    else:  # 신뢰
        result["score_penalty"] = 0.0
        result["note"] = f"[앙상블-신뢰] 앙상블 관련 감점 없음."

    return result


# ── 종합 점수 파싱 ────────────────────────────────────────────────────────
def parse_total_score(eval_text: str) -> float | None:
    """평가 텍스트에서 종합 점수 숫자 추출"""
    patterns = [
        r"최종\s*[:：]\s*([0-9.]+)\s*점",
        r"종합\s*점수\s*[:：]\s*([0-9.]+)",
        r"([0-9]+(?:\.[0-9]+)?)\s*/\s*10\s*점",
        r"총점\s*[:：]\s*([0-9.]+)",
    ]
    for p in patterns:
        m = re.search(p, eval_text)
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                continue
    return None

# ── 단일 사건 평가 ────────────────────────────────────────────────────────
def evaluate_one(verdict_path: Path, real_index: dict[str, Path],
                 output_dir: Path, done_dir: Path,
                 api_key: str, dry_run: bool) -> dict:
    """
    사건번호(6자리)로 실제 판결문을 매핑하여 평가합니다.

    Returns:
      {filename, case_id, status, score, score_path, real_file}
    """
    filename = verdict_path.name
    case_id  = extract_case_id(filename)

    if case_id is None:
        return {"filename": filename, "case_id": None,
                "status": "skip_no_case_id", "score": None,
                "error": "파일명에 6자리 사건번호 없음"}

    # 이미 평가된 파일 건너뜀
    score_path = output_dir / f"{case_id}_score.txt"
    if score_path.exists():
        return {"filename": filename, "case_id": case_id,
                "status": "already_done", "score": None,
                "score_path": score_path}

    # ── 사건번호로 실제 판결문 매핑 ──────────────────────────────────────
    real_path = real_index.get(case_id)
    if real_path is None:
        return {"filename": filename, "case_id": case_id,
                "status": "no_real_verdict", "score": None,
                "error": f"사건번호 {case_id}에 대응하는 실제 판결문 없음"}

    # 파일 내용 읽기
    virtual_text = read_file(verdict_path)
    real_text    = read_file(real_path)

    # ── 앙상블 태그 파싱 (v14.3) ─────────────────────────────────────────
    ensemble = parse_ensemble_tag(virtual_text)

    user_prompt = f"""[가상 판결문]
파일: {filename}
사건번호: {case_id}
─────────────────────────────────────────
{virtual_text[:6000]}
─────────────────────────────────────────

[실제 판결문]
파일: {real_path.name}
사건번호: {case_id}
─────────────────────────────────────────
{real_text[:6000]}
─────────────────────────────────────────

[앙상블 검증 정보 (v14.3)]
{ensemble['note']}
앙상블 판단: {ensemble['verdict'] or '없음'} | 권고: {ensemble['recommendation'] or '없음'}
편향 플래그: {ensemble['bias_flags']}개 | 주요 우려: {ensemble['concern'] or '없음'}
{"→ 결론 방향 점수에서 -0.5점을 적용하십시오." if ensemble['score_penalty'] > 0 else "→ 앙상블 관련 감점 없음."}

위 두 판결문을 일치도 평가 기준 v1.6에 따라 평가하십시오.
모든 항목(결론 방향 / 핵심 법리 / 세부 논증 / 면책 / B-5 반영 /
1심·2심 유추 / 종합 비교 / 정보 부족 가산점 / C-α 완료율 /
방법론 갱신 필요성 / 강제규칙 준수 / 앙상블 검증 반영)을 빠짐없이 출력하십시오."""

    try:
        eval_result = call_api(SYSTEM_PROMPT_EVAL, user_prompt,
                               api_key, dry_run, max_tokens=4000)

        score = parse_total_score(eval_result)

        # 앙상블 감점 적용
        if score is not None and ensemble["score_penalty"] > 0:
            score = max(0.0, score - ensemble["score_penalty"])

        # 평가 결과 저장
        ensemble_line = (
            f"# 앙상블: {ensemble['verdict'] or '없음'} | "
            f"권고: {ensemble['recommendation'] or '없음'} | "
            f"감점: -{ensemble['score_penalty']:.1f}점\n"
        ) if ensemble["found"] else "# 앙상블: 태그 없음 (구버전)\n"

        header = (
            f"# 일치도 평가 결과 (v1.6 + 앙상블 v14.3)\n"
            f"# 가상 판결문: {filename}\n"
            f"# 실제 판결문: {real_path.name}\n"
            f"# 사건번호: {case_id} | 평가일시: {now()}\n"
            f"# 종합 점수: {score if score is not None else 'N/A'}/10\n"
            f"{ensemble_line}\n"
        )
        score_path.write_text(header + eval_result, encoding="utf-8")

        return {"filename": filename, "case_id": case_id,
                "status": "done", "score": score,
                "score_path": score_path,
                "real_file": real_path.name}

    except Exception as e:
        return {"filename": filename, "case_id": case_id,
                "status": "error", "score": None, "error": str(e)}

# ── 방법론 갱신 제안서 생성 ───────────────────────────────────────────────
def generate_renewal_proposal(results: list[dict], output_dir: Path,
                              api_key: str, dry_run: bool) -> Path:
    """배치 평가 완료 후 갱신 제안서 생성"""

    # N/A 건을 0점으로 산입하여 전수 평균 산출
    na_results = [r for r in results if r.get("is_na")]
    scored     = [r for r in results if not r.get("is_na") and r.get("score") is not None]
    all_scores = [r["score"] for r in scored] + [0.0] * len(na_results)
    avg        = sum(all_scores) / len(all_scores) if all_scores else 0.0

    # 평가 결과 요약문 조합
    summaries = []
    for r in results:
        if r["status"] == "done" and r.get("score_path"):
            text = Path(r["score_path"]).read_text(encoding="utf-8", errors="replace")
            summaries.append(f"=== {r['filename']} (점수: {r['score']}) ===\n{text[:1500]}")

    batch_summary = "\n\n".join(summaries[:20])  # 최대 20건

    user_prompt = f"""아래는 이번 평가 배치(총 {len(results)}건)의 결과입니다.

[배치 통계]
- 평가 성공: {len(scored)}건
- 평균 점수: {avg:.2f}/10
- 갱신 트리거: {'발동 (평균 < 7.0)' if avg < 7.0 else '미발동 (평균 ≥ 7.0)'}
- 오류/미매핑: {sum(1 for r in results if r['status'] not in ('done','already_done'))}건

[개별 평가 요약]
{batch_summary}

위 결과를 바탕으로 K-Law 방법론 갱신 제안서를 작성하십시오.
(1) 평가 배치 요약 (2) 핵심 문제 패턴 (3) 방법론 갱신 제안
(4) 데이터 보완 요청 (5) 결론 및 다음 배치 목표 — 전 섹션 필수."""

    proposal_text = call_api(RENEWAL_SYSTEM_PROMPT, user_prompt,
                             api_key, dry_run, max_tokens=6000)

    proposal_path = output_dir / f"renewal_proposal_{now_tag()}.txt"
    header = (
        f"# K-Law 방법론 갱신 제안서\n"
        f"# 생성일시: {now()}\n"
        f"# 평가 건수: {len(results)}건 | 평균 점수: {avg:.2f}/10 (N/A {len(na_results)}건 0점 산입)\n"
        f"# 갱신 트리거: {'발동' if avg < 7.0 else '미발동'}\n\n"
    )
    proposal_path.write_text(header + proposal_text, encoding="utf-8")
    return proposal_path

# ── 메인 ──────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="K-Law 일치도 평가")
    parser.add_argument("--verdicts-dir", type=Path, default=DEFAULT_VERDICTS)
    parser.add_argument("--real-dir",     type=Path, default=DEFAULT_REAL)
    parser.add_argument("--output-dir",   type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--done-dir",     type=Path, default=DEFAULT_DONE)
    parser.add_argument("--api-key",
                        default=os.environ.get("DEEPSEEK_API_KEY",
                                               "sk-REDACTED"))
    parser.add_argument("--round",   type=int, default=None,
                        help="평가 회차 번호 (미지정 시 eval_progress.json에서 자동 읽음)")
    parser.add_argument("--batch",   type=int, default=20)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--reset",   action="store_true",
                        help="scores/ 폴더의 기존 평가 결과를 모두 삭제하고 재평가합니다.")
    args = parser.parse_args()

    # 폴더 생성
    args.output_dir.mkdir(exist_ok=True)
    args.done_dir.mkdir(exist_ok=True)

    # ── 회차 결정 ─────────────────────────────────────────────────────────
    ep          = load_eval_progress()
    round_no    = args.round if args.round is not None else ep.get("current_round", 4)
    threshold   = float(ep.get("pass_threshold", 7.0))
    pass_dir, fail_dir = get_round_dirs(BASE_DIR, round_no, threshold)

    # 새 회차 메타가 없으면 초기화
    ep.setdefault("rounds", {}).setdefault(str(round_no), {
        "klaw_version": None,
        "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "completed_at": None,
        "score_dir": f"scores/{round_no}회차",
        "fail_dir": f"scores/{round_no}회차 재평가 대상",
    })
    save_eval_progress(ep)
    print(f"  평가 회차: {round_no}회차 "
          f"(합격 기준 {threshold}점 이상 → {pass_dir.name}/ "
          f"/ 미달 → {fail_dir.name}/)")

    # ── --reset: 기존 평가 결과 삭제 ─────────────────────────────────────
    if args.reset:
        score_files = list(args.output_dir.glob("*_score.txt"))
        if score_files:
            print(f"[RESET] scores/ 폴더의 기존 평가 결과 {len(score_files)}건을 삭제합니다.")
            for sf in score_files:
                sf.unlink()
            print(f"[RESET] 삭제 완료.")
        else:
            print("[RESET] 삭제할 평가 결과가 없습니다.")

    # ── 실제 판결문 인덱스 구축 (사건번호 → Path) ───────────────────────
    if not args.real_dir.exists():
        print(f"[ERROR] 실제 판결문 폴더가 없습니다: {args.real_dir}")
        sys.exit(1)

    real_index = build_real_index(args.real_dir)
    print(f"  실제 판결문 인덱스: {len(real_index)}건 (사건번호 기준)")

    # ── 미평가 가상 판결문 수집 ──────────────────────────────────────────
    # verdicts/ 의 직접 자식 txt 파일만 (reasoning/ 하위 폴더 제외)
    all_verdicts = sorted(
        [f for f in args.verdicts_dir.iterdir()
         if f.is_file() and f.suffix == ".txt"],
        key=lambda f: f.name
    )

    # 이미 평가 완료된 파일 제외 (사건번호 기반 score 파일 존재 여부로 판단)
    pending = []
    for f in all_verdicts:
        cid = extract_case_id(f.name)
        if cid is None:
            print(f"  [WARN] 사건번호 없음, 건너뜀: {f.name}")
            continue
        # 4회차 pass_dir 또는 fail_dir 어디에든 score 파일이 있으면 건너뜀
        score_pass = pass_dir / f"{cid}_score.txt"
        score_fail = fail_dir / f"{cid}_score.txt"
        if not score_pass.exists() and not score_fail.exists():
            pending.append(f)

    print("=" * 60)
    print(f"K-Law 일치도 평가 시작  ({now()})")
    print(f"  가상 판결문: {args.verdicts_dir}  ({len(all_verdicts)}건)")
    print(f"  실제 판결문: {args.real_dir}  (인덱스 {len(real_index)}건)")
    print(f"  미평가 대상: {len(pending)}건 | 배치 크기: {args.batch}건")
    print(f"  매핑 방식:   6자리 사건번호 기반 1:1 매핑")
    print(f"  평가 결과:   {args.output_dir}")
    print(f"  완료 이동:   {args.done_dir}")
    if args.dry_run:
        print("  ⚠️  DRY-RUN 모드")
    if args.reset:
        print("  🔄  RESET 모드 (기존 결과 삭제 후 재평가)")
    print("=" * 60)

    if not pending:
        print("평가할 파일이 없습니다.")
        return

    # ── 배치 루프 ─────────────────────────────────────────────────────────
    total_success = 0
    total_error   = 0
    print_lock    = threading.Lock()

    for batch_start in range(0, len(pending), args.batch):
        batch = pending[batch_start : batch_start + args.batch]

        print(f"\n── 배치 [{batch_start + 1}~{batch_start + len(batch)}] "
              f"({len(batch)}건) ──")

        batch_results = []
        results_lock  = threading.Lock()

        def eval_worker(vpath: Path):
            r = evaluate_one(
                vpath, real_index, pass_dir, args.done_dir,
                args.api_key, args.dry_run
            )
            with results_lock:
                batch_results.append(r)
            with print_lock:
                cid_tag = f"[{r['case_id']}]" if r.get('case_id') else "[??????]"
                if r["status"] == "done":
                    score_str = f"{r['score']:.1f}" if r['score'] is not None else "N/A"
                    print(f"  ✅ {cid_tag} {vpath.name[:45]:45s} → {score_str}/10")
                elif r["status"] == "already_done":
                    print(f"  ⏭  {cid_tag} {vpath.name[:45]:45s} (기평가)")
                elif r["status"] == "no_real_verdict":
                    print(f"  ⚠️  {cid_tag} {vpath.name[:45]:45s} — 실제 판결문 없음")
                elif r["status"] == "skip_no_case_id":
                    print(f"  ⚠️  [??????] {vpath.name[:45]:45s} — 사건번호 없음")
                else:
                    print(f"  ❌ {cid_tag} {vpath.name[:45]:45s} — {r.get('error','')[:50]}")

        # 배치 내 병렬 실행
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(eval_worker, v): v for v in batch}
            wait(futures, return_when=ALL_COMPLETED)

        # ── 배치 결과 집계 ────────────────────────────────────────────────
        done_in_batch  = [r for r in batch_results if r["status"] == "done"]
        error_in_batch = [r for r in batch_results if r["status"] == "error"]
        total_success += len(done_in_batch)
        total_error   += len(error_in_batch)

        # 평균 계산: 정상 점수 건 + N/A 건을 0점으로 산입 (전수 포함)
        # ※ N/A(면책) 건을 제외하면 평균이 과대 산출되므로 0점으로 포함
        na_in_batch    = [r for r in done_in_batch if r.get("is_na")]
        scored         = [r for r in done_in_batch if not r.get("is_na") and r.get("score") is not None]
        all_scores     = [r["score"] for r in scored] + [0.0] * len(na_in_batch)
        avg            = sum(all_scores) / len(all_scores) if all_scores else 0.0

        print(f"\n  배치 완료 — 성공: {len(done_in_batch)}건 | 오류: {len(error_in_batch)}건 | 평균: {avg:.2f}/10 (N/A {len(na_in_batch)}건 0점 산입)")

        # ── 점수 기준 분기: fail_dir로 이동 (7점 미만·N/A) ──────────────
        pass_count = fail_count = 0
        for r in done_in_batch:
            if not r.get("score_path"):
                continue
            sp = Path(r["score_path"])
            if not sp.exists():
                continue
            is_fail = r.get("is_na") or r.get("score") is None or                       (r.get("score") is not None and r["score"] < threshold)
            if is_fail:
                dst = fail_dir / sp.name
                try:
                    shutil.move(str(sp), str(dst))
                    r["score_path"] = dst   # 경로 갱신
                    fail_count += 1
                except Exception as e:
                    print(f"  [WARN] fail_dir 이동 실패: {sp.name} — {e}")
            else:
                pass_count += 1
        if pass_count or fail_count:
            print(f"  📊 점수 분류 — "
                  f"합격({threshold:.0f}점↑): {pass_count}건 → {pass_dir.name}/ | "
                  f"재평가 대상: {fail_count}건 → {fail_dir.name}/")

        # ── 방법론 갱신 제안서 생성 ───────────────────────────────────────
        if done_in_batch:
            print(f"  방법론 갱신 제안서 생성 중...")
            try:
                proposal_path = generate_renewal_proposal(
                    batch_results, pass_dir, args.api_key, args.dry_run
                )
                print(f"  📄 제안서: {proposal_path.name}")
            except Exception as e:
                print(f"  [ERROR] 제안서 생성 실패: {e}")

        # ── 평가 완료 파일 이동 (verdicts/ → verdicts_evaluated/) ─────────
        moved = 0
        for r in done_in_batch:
            src = args.verdicts_dir / r["filename"]
            dst = args.done_dir    / r["filename"]
            if src.exists():
                try:
                    shutil.move(str(src), str(dst))
                    moved += 1
                except Exception as e:
                    print(f"  [WARN] 이동 실패: {r['filename']} — {e}")
        if moved:
            print(f"  📁 {moved}건 → {args.done_dir.name}/ 이동 완료")

        # ── 다음 배치가 있으면 Enter 대기 + 회차 자동 bump ─────────────
        remaining = batch_start + args.batch < len(pending)
        if remaining:
            print(f"\n{'=' * 60}")
            print(f"  이번 배치({len(done_in_batch)}건) 평가 완료.")
            print(f"  평가 결과와 갱신 제안서를 검토한 후 Enter를 누르면")
            print(f"  다음 배치({args.batch}건)를 시작합니다...")
            print(f"{'=' * 60}")
            input()

            # ── 회차 자동 bump ────────────────────────────────────────────
            ep_cur = load_eval_progress()
            ep_cur["rounds"][str(round_no)]["completed_at"] = \
                datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            round_no += 1
            ep_cur["current_round"] = round_no
            ep_cur.setdefault("rounds", {})[str(round_no)] = {
                "klaw_version": None,
                "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "completed_at": None,
                "score_dir": f"scores/{round_no}회차",
                "fail_dir":  f"scores/{round_no}회차 재평가 대상",
            }
            save_eval_progress(ep_cur)
            pass_dir, fail_dir = get_round_dirs(BASE_DIR, round_no, threshold)
            print(f"▶   평가 회차 자동 갱신: {round_no}회차 시작\n")

    # ── 최종 요약 + eval_progress.json completed_at 기록 ────────────────
    ep = load_eval_progress()
    if str(round_no) in ep.get("rounds", {}):
        ep["rounds"][str(round_no)]["completed_at"] =             datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    save_eval_progress(ep)

    print(f"\n{'=' * 60}")
    print(f"전체 평가 완료  ({now()})")
    print(f"  회차: {round_no}회차")
    print(f"  성공: {total_success}건 | 오류: {total_error}건")
    print(f"  합격 ({threshold:.0f}점↑): {pass_dir}/")
    print(f"  재평가 대상:    {fail_dir}/")
    print(f"  완료 이동:      {args.done_dir}/")
    print(f"{'=' * 60}")

if __name__ == "__main__":
    main()
