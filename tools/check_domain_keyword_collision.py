#!/usr/bin/env python3
"""
check_domain_keyword_collision.py — GWP 분야 키워드 충돌 검사 (2026-08-06 신설)

배경(주피터 지적): 나비의 라우팅은 문자열 검색(trigger 표)과 의미 검색
(§CORE의 "분야" 개념 매칭·R1 판정축)의 하이브리드다. 그런데 2026-08-06
세션에서 §CORE 2단계 R1 조항에 "관세 통관도 klaw 영역"이라는 예시를
추가하면서, §CATALOG 표에 klogistics가 이미 "배송·물류·통관"으로 등록해
둔 걸 확인 안 하고(순수 의미론적 판단만 하고 문자열 검색을 생략) 그대로
커밋했다 — 그 결과 klaw·klogistics·customs-broker 세 후보가 충돌해
명확한 위임의도 발화가 [CALL_KINTENT:](오케스트레이션)로 새는 회귀를
만들었다(temperature=0에서 20/20 재현 확인, 별도 라이브 테스트로 검증).

이 스크립트는 그 사고를 되풀이하지 않기 위한 최소 방어망이다: §CATALOG
(GWP) 표의 "분야" 열에서 키워드를 추출해 (1) 표 안에서 같은 키워드를
2개 이상의 id가 동시에 주장하는지, (2) 표 밖(본문 다른 절)에서 그
키워드가 등장하면서 그 키워드의 등록 소유자가 아닌 다른 id와 더 가깝게
붙어 있는지를 검사한다.

## 설계상 한계 (정직하게 남김)
- §CATALOG(GWP)만 다룬다 — §CATALOG-EXPERT(EXPERT 62개)까지 확장하면
  분야 서술이 짧고("법률"처럼 한 단어) 자연히 겹치는 경우가 많아 오탐이
  폭증할 것으로 예상돼 이번 패스에서는 범위 밖으로 남긴다.
- (2)번 검사는 "가장 가까운 다른 id가 등록 소유자와 다르면 의심"이라는
  휴리스틱이다 — 완벽한 문맥 이해가 아니므로 오탐 가능성이 있다. 그래서
  이 스크립트는 발견 즉시 실패시키지 않고 사람이 검토할 목록만 출력한다
  (--strict 옵션을 주면 예외적으로 nonzero exit — CI에서는 기본적으로
  정보 제공만 하고 게이트는 안 건다, check_no_hardcoded_sp_refs.py처럼
  구조적으로 명확한 위반과는 성격이 다르기 때문).
- 조사(을/를/이/가 등)나 흔한 연결어까지 키워드로 뽑히지 않도록 2글자
  이상, 그리고 명백한 불용어 목록으로 최소한만 거른다 — 완벽한 형태소
  분석기가 아니므로 여전히 노이즈가 섞일 수 있다.
"""
import argparse
import re
import sys
from collections import defaultdict

TABLE_ROW_RE = re.compile(r"^  (\S+)\s*\|\s*([^|]+?)\s*\|\s*(.+)$")
SECTION_HEADER_RE = re.compile(r"^§[A-Z_-]+\.")
STOPWORDS = {
    "등", "및", "관련", "국가사무", "지자체", "사무", "행정", "서비스",
    "안내", "기반", "전용", "자체", "직접", "확인", "참고",
    # 2026-08-06 자체 테스트로 추가 — 첫 구현을 버그(위) 버전에 돌려보니
    # 도메인 키워드가 아닌 일반 어휘가 노이즈로 다수 섞였다(예: kgdc의
    # "★ 은행이라는 단어를 쓰지 않는다"류 경고문이 그대로 토큰화됨,
    # kusers/profile-assistant처럼 분야 서술이 완전한 문장인 경우 조사·
    # 동사까지 쪼개짐). 완벽한 형태소 분석 대신 관찰된 노이즈만 최소로
    # 걸러낸다 — 새 노이즈가 또 나오면 이 목록에 추가할 것.
    "쓰지", "않는다", "이용자가", "기관", "검색", "작성", "개인",
    "사용법", "해석",
}


def _extract_table(lines, start_idx):
    """start_idx부터 시작하는 'id | 이름 | 분야' 표를 파싱해
    {id: (name, domain_text)} 딕셔너리와 표가 끝난 다음 줄 인덱스를 반환."""
    rows = {}
    i = start_idx
    while i < len(lines):
        line = lines[i]
        if line.strip() == "" and rows:
            # 표 데이터를 이미 모았는데 빈 줄이 나오면, 다음 줄이 표
            # 연속(괄호 설명 등)인지 한 줄만 더 보고 아니면 종료
            if i + 1 < len(lines) and TABLE_ROW_RE.match(lines[i + 1]):
                i += 1
                continue
            break
        m = TABLE_ROW_RE.match(line)
        if m:
            rid, name, domain = m.group(1), m.group(2).strip(), m.group(3).strip()
            if rid != "id":  # 헤더 행 제외
                rows[rid] = (name, domain)
        elif rows:
            # 표 형식이 아닌 줄이 나오면(다음 섹션 등) 종료
            break
        i += 1
    return rows, i


def _tokenize_domain(text):
    """분야 텍스트에서 키워드 후보를 뽑는다 — 괄호 안 세부설명·★ 경고문
    (이 저장소 전반의 관례 — "★"는 항상 부연 경고이지 분야 정의 자체가
    아님, 자체 테스트로 kgdc/kestate/ktelecom 행에서 확인)은 제외하고,
    ·/,/ 및 공백으로 분리한다."""
    text = text.split("★")[0]  # ★ 이후는 항상 경고/부연 — 도메인 정의 아님
    # 괄호 안 내용 제거(부연 설명이라 키워드로 안 씀 — 오탐 소지 큼)
    text = re.sub(r"\([^)]*\)", "", text)
    text = re.sub(r"—.*$", "", text)  # em-dash 뒤 부연 설명 제거
    parts = re.split(r"[·,/、\s]+", text)
    return [p for p in parts if len(p) >= 2 and p not in STOPWORDS]


def find_table_start(lines, section_name):
    for i, line in enumerate(lines):
        if line.strip().startswith(f"§{section_name}."):
            # 이 섹션 헤더 이후 첫 'id |' 행을 찾는다
            for j in range(i, min(i + 60, len(lines))):
                if TABLE_ROW_RE.match(lines[j]) and lines[j].strip().startswith("id "):
                    return j + 1
    return None


EXPERT_TRIGGER_RE = re.compile(r"triggers:\s*\[([^\]]+)\]", re.S)
EXPERT_ID_RE = re.compile(r"^\s*'?([\w-]+)'?:\s*\{")


def _extract_expert_triggers(expert_registry_path):
    """expert-registry.js를 파싱해 {trigger_string: persona_id} 딕셔너리를
    반환한다 — 2026-08-06 신설(#3 회귀로 발견한 사각지대 메우기). 완전한
    JS 파서가 아니라 이 파일의 실제 포맷(각 persona 블록에 정확히 하나의
    triggers: [...] 배열)에 의존하는 정규식 기반 파싱이다 — 포맷이 크게
    바뀌면 이 함수도 같이 손봐야 한다."""
    try:
        with open(expert_registry_path, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        return {}

    trigger_owner = {}
    # persona 블록 단위로 잘라서 각 블록 안의 id와 triggers를 짝짓는다
    blocks = re.split(r"\n(?=\s*'?[\w-]+'?:\s*\{)", content)
    for block in blocks:
        id_m = EXPERT_ID_RE.match(block)
        trig_m = EXPERT_TRIGGER_RE.search(block)
        if not id_m or not trig_m:
            continue
        pid = id_m.group(1)
        triggers = [t.strip().strip("'\"") for t in trig_m.group(1).split(",")]
        for t in triggers:
            if len(t) >= 2:
                trigger_owner[t] = pid
    return trigger_owner


def check_expert_trigger_collisions(content, expert_registry_path):
    """§CORE 안의 '예시' 문장들이 EXPERT 페르소나의 등록 trigger 문자열을
    그대로(글자 그대로) 재사용하고 있는지 검사 — #3(감정평가/appraiser)
    회귀의 직접 원인이었던 패턴. GWP 표 밖 전체(사실상 §CORE 서술 전체)를
    대상으로, EXPERT trigger 문자열이 '위임의도 없이도 GWP가 기본값'
    이라고 주장하는 문맥(R1/R2류 문단, "광의의...사무이므로" 같은 표현)
    근처에 그대로 등장하면 강한 신호로 본다. 완벽한 문맥 이해는 아니므로
    — 이번에도 사람이 검토할 목록만 낸다."""
    triggers = _extract_expert_triggers(expert_registry_path)
    if not triggers:
        return []

    findings = []
    for trig, pid in triggers.items():
        for m in re.finditer(re.escape(trig), content):
            window = content[max(0, m.start() - 150):m.start()]
            if "GWP" in window and ("기본값" in window or "우선" in window):
                snippet = content[max(0, m.start() - 60):m.start() + 60].replace("\n", " ")
                findings.append((trig, pid, snippet))
    return findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", default="prompts/AC-PRO-CORE_v1_1.txt")
    ap.add_argument("--expert-registry", default="src/gopang/ai/expert-registry.js",
                     help="EXPERT trigger 교차검사에 쓸 expert-registry.js 경로")
    ap.add_argument("--strict", action="store_true",
                     help="교차참조 충돌 발견 시 nonzero exit(기본은 정보 제공만)")
    args = ap.parse_args()

    with open(args.prompt, "r", encoding="utf-8") as f:
        content = f.read()
    lines = content.split("\n")

    start = find_table_start(lines, "CATALOG")
    if start is None:
        print("§CATALOG 표를 못 찾음 — 스크립트가 파일 구조 변경을 못 따라간 것일 수 있음")
        return 1
    table, table_end = _extract_table(lines, start)
    if not table:
        print("§CATALOG 표 파싱 결과가 비어있음 — 정규식이 현재 포맷과 안 맞을 수 있음")
        return 1

    print(f"§CATALOG에서 {len(table)}개 서비스 파싱함")

    # ── (1) 표 안 자체 충돌 — 같은 키워드를 2개 이상 id가 주장 ──────
    keyword_owners = defaultdict(set)
    for rid, (name, domain) in table.items():
        for kw in _tokenize_domain(domain):
            keyword_owners[kw].add(rid)

    intra_collisions = {kw: ids for kw, ids in keyword_owners.items() if len(ids) > 1}
    if intra_collisions:
        print(f"\n[표 안 자체 충돌] {len(intra_collisions)}건 — 참고용(설계상 의도된 중복일 수 있음)")
        for kw, ids in sorted(intra_collisions.items()):
            print(f"  '{kw}' → {sorted(ids)}")
    else:
        print("\n[표 안 자체 충돌] 없음")

    # ── (2) 표 밖 교차참조 — 본문에서 등록 소유자 아닌 다른 id 근처에 등장 ──
    # ★ 첫 구현의 버그(2026-08-06, 같은 세션에서 발견) — 원래 표 "다음"
    # 텍스트만 훑었는데, 실제 사고를 냈던 R1 조항은 §CORE 안에 있어
    # §CATALOG 표보다 앞쪽에 위치한다. 그 결과 이 검사기를 실제 버그
    # 재현 텍스트에 돌려봤더니 정작 그 사고 지점을 못 잡고 무관한 흔한
    # 단어(기관·검색·작성 등) 37건만 노이즈로 쏟아냈다 — 검사기 자체를
    # 만들자마자 자체 테스트로 잡은 버그. 표 앞뒤 전체를 훑도록 수정하고,
    # 불용어도 이번에 걸러진 흔한 단어들을 추가로 보강했다.
    single_owner_kw = {kw: next(iter(ids)) for kw, ids in keyword_owners.items() if len(ids) == 1}
    all_ids = set(table.keys())
    # ★ 두 번째 자체 버그(2026-08-06, 같은 세션) — 처음엔 \b(단어 경계)로
    # id를 찾았는데, "klaw의"처럼 영단어 바로 뒤에 한글 조사가 붙으면
    # \b가 그 경계를 인식 못 한다(파이썬 유니코드 모드에서 한글도 \w로
    # 취급되기 때문 — "klaw"의 "w"와 "의" 사이에 경계가 없다고 판단).
    # 그 결과 실제 사고 재현 텍스트("klaw의 분야는...관세 통관...")에서
    # 바로 앞의 "klaw"조차 못 찾아 정작 표적으로 삼은 사고를 놓쳤다 —
    # 검사기를 만들자마자 자체 테스트로 잡은 두 번째 버그. 영문·숫자만
    # 경계 문자로 보는 lookaround로 교체.
    id_pattern = re.compile(
        r"(?<![A-Za-z0-9_])(" + "|".join(re.escape(i) for i in all_ids) + r")(?![A-Za-z0-9_])"
    )

    table_line_start = start - 1  # 헤더('id | ...') 바로 위 줄부터
    body = "\n".join(lines[:table_line_start]) + "\n" + "\n".join(lines[table_end:])
    # 위에서 표 구간(table_line_start~table_end)을 잘라냈으므로, 그 뒤
    # 오프셋으로 원래 줄 번호를 복원하려면 별도 매핑이 필요하다 — 진단용
    # 정확한 줄 번호보다 "어느 쪽(표 앞/뒤)인지 문맥 스니펫"이 더
    # 유용하므로 여기서는 줄 번호 대신 스니펫만 정확히 낸다.

    cross_findings = []
    for kw, owner in single_owner_kw.items():
        if len(kw) < 2:
            continue
        for m in re.finditer(re.escape(kw), body):
            # 창 크기를 400→200으로 축소(2026-08-06 자체 테스트로 조정) —
            # 400자는 완전히 무관한 앞 문단의 id까지 "근처"로 잡아 노이즈가
            # 컸다. 실제 사고(관세 통관)는 같은 문단·같은 문장 안에서
            # 발생했으므로 200자면 충분히 잡히면서 무관 문단 오염은 준다.
            window_start = max(0, m.start() - 200)
            window = body[window_start:m.start()]
            nearby_ids = id_pattern.findall(window)
            if not nearby_ids:
                continue
            nearest_id = nearby_ids[-1]
            if nearest_id != owner:
                snippet = body[max(0, m.start() - 60):m.start() + 60].replace("\n", " ")
                cross_findings.append((kw, owner, nearest_id, snippet))

    if cross_findings:
        print(f"\n[표 밖 교차참조 의심] {len(cross_findings)}건 — 사람 검토 필요")
        print("(등록 소유자가 아닌 다른 서비스 id 근처에서 그 키워드가 쓰인 경우)")
        for kw, owner, nearest_id, snippet in cross_findings:
            print(f"  '{kw}'는 {owner} 소관인데 {nearest_id} 근처에서 발견")
            print(f"    ...{snippet}...")
    else:
        print("\n[표 밖 교차참조 의심] 없음")

    # ── (3) EXPERT trigger 교차참조 — #3(감정평가) 회귀로 발견한 사각지대 ──
    # (1)(2)는 §CATALOG(GWP)만 봤는데, 실제로는 GWP 문단이 EXPERT의
    # 등록 trigger 문자열을 그대로 재사용해도 충돌이 난다(2026-08-06,
    # appraiser.triggers의 "감정평가"와 R1 예시 문장이 토씨 하나 안 틀리고
    # 일치해 GWP 기본값 지시가 무력화됨). expert-registry.js를 함께 읽어
    # 검사한다.
    expert_findings = check_expert_trigger_collisions(content, args.expert_registry)
    if expert_findings:
        print(f"\n[EXPERT trigger 교차참조 의심] {len(expert_findings)}건 — 사람 검토 필요")
        print("(GWP 기본값을 주장하는 문맥 근처에 EXPERT의 등록 trigger 문자열이 그대로 등장)")
        for trig, pid, snippet in expert_findings:
            print(f"  '{trig}'는 EXPERT:{pid}의 등록 trigger인데 GWP 기본값 문맥 근처에서 발견")
            print(f"    ...{snippet}...")
    else:
        print("\n[EXPERT trigger 교차참조 의심] 없음")

    if (cross_findings or expert_findings) and args.strict:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
