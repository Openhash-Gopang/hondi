#!/usr/bin/env python3
"""
tools/check_no_embedded_sp.py
------------------------------
SP(시스템 프롬프트)는 반드시 prompts/ 아래 파일 하나(그리고 sp-catalog.json이
가리키는 raw URL)로만 존재해야 한다. 2026-07-05에 webapp.html의
`_PA_SYSTEM_PROMPT`(manifest 로드 실패 시 조용히 대체되던 742자짜리 내장
사본 — 안전장치가 전혀 없고 라우팅 id도 틀려 있었음)가 발견된 뒤 신설.

이 스크립트는 prompts/ 밖의 .html/.js 파일에서 다음 중 하나에 해당하는
긴 문자열 리터럴을 찾으면 실패(exit 1)한다:
  1. 변수/상수 이름에 SYSTEM_PROMPT, SYSTEMPROMPT, _SP_(대문자) 등이
     들어간 선언의 값이 SP_MIN_LEN자 이상인 경우
  2. 이름과 무관하게, 리터럴 안에 SP 특유의 마커 문구(정체성 선언, 라우팅
     표 등)가 하나라도 있고 길이가 SP_MIN_LEN자 이상인 경우

오탐이 있을 수 있다(예: 정당한 긴 안내문). 실제로 SP가 아니라면 선언
바로 앞줄에 `// ALLOW-EMBEDDED-SP: <사유>` 주석을 추가하면 그 리터럴만
예외로 통과시킨다 — 조용히 넘어가지 않고 사유를 남기게 강제한다.

사용법: python3 tools/check_no_embedded_sp.py
CI: .github/workflows/check-no-embedded-sp.yml 에서 push/PR마다 실행.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

# prompts/ 자체(진짜 SP가 사는 곳)와 그 외 정당하게 제외할 경로
EXCLUDE_DIRS = {'.git', 'node_modules', 'prompts', '_archive'}
SCAN_EXTS = {'.html', '.js'}

SP_MIN_LEN = 300  # 이보다 짧으면 SP 전체 사본일 가능성이 낮다고 봄
MAX_SPAN_LINES = 80  # 이보다 길게 걸쳐 있으면 백틱 오짝(가짜 매치)일 가능성이
                      # 훨씬 높다고 본다 — 실제로 발견된 내장 SP는 전부 30줄
                      # 이내였다(_PA_SYSTEM_PROMPT 24줄, CFG.system 6줄).

NAME_PATTERN = re.compile(r'(?:const|let|var)\s+(\w*SYSTEM_?PROMPT\w*|\w*_SP_\w*)\s*=\s*[`\'"]', re.IGNORECASE)

# SP 특유 마커 — AGENT-COMMON/각 서비스 SP들이 공통으로 쓰는 표현들
CONTENT_MARKERS = [
    '당신은 나비', '너는 나비', '나만의 AI 비서', '[정체성]', '[핵심 명제]',
    'AGENT-COMMON', '[GWP:', '[EXPERT:', 'ROUTER-CONFIDENCE',
]

ALLOW_COMMENT = re.compile(r'ALLOW-EMBEDDED-SP\s*:', re.IGNORECASE)

# 백틱/따옴표로 감싼 리터럴을 대략적으로 찾는다(완벽한 JS 파서는 아니지만
# 이 용도엔 충분하다 — 백틱 템플릿 리터럴이 주 타겟이므로 그것 위주로 탐지)
TEMPLATE_LITERAL = re.compile(r'`((?:[^`\\]|\\.)*)`', re.DOTALL)


def find_violations(path: Path) -> list[str]:
    text = path.read_text(encoding='utf-8', errors='ignore')
    lines = text.split('\n')

    # ★ 2026-07-30 개선 — 순수 `//` 주석 줄 안의 백틱(예: 코드 예시를
    # 설명하는 주석 `` `${x}:${y}` ``)까지 실제 템플릿 리터럴 구분자로
    # 세다 보니, 파일 전체의 백틱 홀짝이 깨져서 코드 반대편의 무관한
    # 텍스트끼리 거대한 "가짜 리터럴"로 잘못 짝지어지는 문제가 실사용
    # 중 발견됐다(worker.js에서 실제로 발생·재현 확인, 2026-07-30).
    # 코드 백틱과의 줄 번호 정합성은 유지해야 하므로, 순수 주석 줄(트림
    # 했을 때 //로 시작하는 줄)의 문자만 같은 길이의 공백으로 지워서
    # 매칭용 텍스트를 만든다 — 실제 코드의 백틱 위치·줄 번호는 그대로다.
    masked_lines = [
        (' ' * len(l)) if l.strip().startswith('//') else l
        for l in lines
    ]
    text = '\n'.join(masked_lines)
    violations = []

    for m in TEMPLATE_LITERAL.finditer(text):
        literal = m.group(1)
        if len(literal) < SP_MIN_LEN:
            continue
        if literal.count('\n') > MAX_SPAN_LINES:
            continue  # 백틱 오짝으로 생긴 거대 가짜 매치일 가능성이 높음

        # 이 리터럴이 시작하는 줄 번호와 그 직전 줄(할당 구문 + 앞줄 주석) 확인
        start_line_no = text[:m.start()].count('\n')
        decl_line = lines[start_line_no] if start_line_no < len(lines) else ''

        # 바로 위 연속된 주석 블록 전체를 훑는다(여러 줄 ALLOW 주석 대응)
        allowed = False
        i = start_line_no - 1
        while i >= 0 and lines[i].strip().startswith('//'):
            if ALLOW_COMMENT.search(lines[i]):
                allowed = True
                break
            i -= 1
        if allowed:
            continue

        name_match = NAME_PATTERN.search(decl_line)
        # 마커는 리터럴 "시작부"에 있을 때만 신뢰한다 — 진짜 내장 SP는 항상
        # 정체성 선언으로 곧장 시작한다. 정규식 리터럴 안의 백틱(예:
        # /`([^`]+)`/g)이나 파일 반대편의 무관한 백틱과 잘못 짝지어진
        # 거대한 가짜 리터럴은 마커가 있어도 시작부에서 한참 떨어져 있다.
        marker_hit = any(marker in literal[:200] for marker in CONTENT_MARKERS)

        if name_match or marker_hit:
            reason = f"변수명 패턴({name_match.group(1)})" if name_match else "SP 마커 문구 포함"
            violations.append(
                f"{path.relative_to(ROOT)}:{start_line_no + 1} — {reason}, 길이 {len(literal)}자"
            )
    return violations


def main() -> int:
    all_violations = []
    for path in ROOT.rglob('*'):
        if not path.is_file() or path.suffix not in SCAN_EXTS:
            continue
        if any(part in EXCLUDE_DIRS for part in path.parts):
            continue
        all_violations.extend(find_violations(path))

    if all_violations:
        print("✗ SP로 의심되는 내장 리터럴이 발견됐습니다 — SP는 prompts/ 파일 하나만 정본이어야 합니다:\n")
        for v in all_violations:
            print(" ", v)
        print(
            "\n정말 SP 사본이 아니라면, 선언 바로 앞줄에 "
            "'// ALLOW-EMBEDDED-SP: <사유>' 주석을 추가하세요."
        )
        return 1

    print(f"✓ 내장 SP 사본 없음 ({sum(1 for p in ROOT.rglob('*') if p.is_file() and p.suffix in SCAN_EXTS and not any(x in EXCLUDE_DIRS for x in p.parts))}개 파일 스캔)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
