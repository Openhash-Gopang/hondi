#!/usr/bin/env python3
"""
tools/build_manifest.py
-----------------------
prompts/ 디렉터리를 스캔해 prompts/sp-catalog.json 을 자동 생성한다.
CI(GitHub Actions)가 push 마다 실행 — 개발자는 SP 파일만 추가하면 된다.

■ manifest 키 규칙
  · "AGENT-COMMON"          → prompts/AGENT-COMMON_*.txt 중 최신
  · "AC-PRO-CORE"           → prompts/AC-PRO-CORE_*.txt 중 최신 (2026-07-29 추가)
  · "AC-FLASH-EXECUTOR"     → prompts/AC-FLASH-EXECUTOR_*.txt 중 최신 (2026-07-29 추가)
  · "AC-SHADOW-CORE"        → prompts/AC-SHADOW-CORE_*.txt 중 최신 (2026-0X-XX 추가)
  · "SP-TREE-REGISTRY"      → prompts/SP-TREE-REGISTRY_*.md 중 최신 (2026-0X-XX 추가)
  · "SP-TREE-GUARDIAN"      → prompts/SP-TREE-GUARDIAN_*.md 중 최신 (2026-0X-XX 추가)
  · "SP-00-ROUTER"          → prompts/SP-00-ROUTER-v*.txt 중 최신
  · "profile-assistant"     → prompts/profile-assistant/profile-assistant-v*.txt 중 최신
                               (2026-07-08: personal-assistant에서 개명·분리 — 프로필
                               작성 기능만 다루는 SP. 구 폴더 prompts/personal-assistant/
                               는 더 이상 스캔하지 않음 — 죽은 폴더로 남음, 수동 정리 대상)
  · "SP-NN_slug"            → prompts/SP-NN_slug_v*.txt 중 최신
                               같은 번호라도 slug 가 다르면 독립 키 (SP-14 중복 대응)
  · "AGENT-SUPPLIER-NN"     → prompts/AGENT-SUPPLIER-NN_*.txt 중 최신
                               동점(동일 버전)이면 파일명이 긴 쪽 선택

■ 버전 비교
  파일명 안의 vMAJOR[._]MINOR[._]PATCH 를 파싱해 숫자 튜플로 비교.
  AGENT-COMMON 처럼 vX_Y 표기도 지원.
  버전 표기 없으면 (0,0,0).

■ *-LATEST.txt 포인터 파일
  스캔 대상에서 제외 (manifest 로 완전 대체).
  기존 파일은 삭제하지 않아도 무방하나 JS 에서는 참조하지 않는다.

■ 잔여 파일 자기검증 (2026-07-29 신설 — 재발 방지 근본 수정)
  이 스크립트는 지금까지 "새 명명 패턴의 프롬프트 파일을 추가했는데
  스캔 블록을 깜빡함 → manifest에서 조용히 누락 → 며칠 뒤 런타임에서야
  발견"이 최소 5번 반복됐다(UNIVERSAL-common, PROFESSIONAL-common,
  K-Public_common/k-business/business-kr, SP-INDUSTRY-TRANSFORM-COMMON,
  그리고 AC-PRO-CORE/AC-FLASH-EXECUTOR). 매번 사후 발견 후 "다음엔
  안 그래야지"로 넘어갔지만 사람이 매번 기억하긴 어렵다는 게 근본
  문제였다. 그래서 이 스크립트가 스스로 "내가 아는 패턴 목록"을
  들고 있다가, prompts/ 최상위(하위 폴더 제외)의 .md/.txt 파일 중
  그 어떤 패턴에도 안 걸리는 게 있으면 — 카탈로그 등록 대상이 아닌
  설계도·감사록류(ALLOWLIST_PREFIXES)가 아닌 한 — 스크립트 자체를
  비정상 종료(exit 1)시킨다. CI가 그 자리에서 빨갛게 죽으므로,
  "새 파일 추가 + 스캔 블록 깜빡"이 병합 전에 반드시 드러난다.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT    = Path(__file__).parent.parent   # 저장소 루트
PROMPTS = ROOT / 'prompts'
OUT     = PROMPTS / 'sp-catalog.json'

# ── 버전 파싱 ──────────────────────────────────────────────────────────
def parse_version(fname: str) -> tuple:
    m = re.search(r'v(\d+)[._](\d+)(?:[._](\d+))?', fname)
    if not m:
        return (0, 0, 0)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))

def best(files: list[str]) -> str:
    """버전 내림차순, 동점이면 파일명 길이 내림차순으로 최신 선택."""
    return max(files, key=lambda f: (parse_version(f), len(f)))

# ── 파일 스캔 ──────────────────────────────────────────────────────────
manifest: dict[str, str] = {}

# 이 스크립트가 인식하는 모든 명명 패턴의 정규식을 여기 모은다. 아래 각
# 스캔 블록은 반드시 이 리스트에 자기 패턴을 등록해야 한다 — 맨 끝의
# 자기검증 블록이 이 목록에 없는 패턴의 파일을 "아무도 모르는 파일"로
# 간주해 스크립트를 실패시킨다.
RECOGNIZED_PATTERNS: list[str] = []

def _scan_single(pattern: str, ext: str, key: str) -> None:
    """단일 키(그룹 없음) 패턴 — 매칭되는 파일 중 최신 하나를 manifest[key]에."""
    RECOGNIZED_PATTERNS.append(pattern)
    files = [
        f.name for f in PROMPTS.iterdir()
        if re.match(pattern, f.name) and f.name.endswith(ext)
    ]
    if files:
        manifest[key] = best(files)

# 1) AGENT-COMMON — prompts/AGENT-COMMON_vX_Y.txt
_scan_single(r'^AGENT-COMMON_v', '.txt', 'AGENT-COMMON')

# 1-a) AC-PRO-CORE — prompts/AC-PRO-CORE_vX_Y.txt (2026-07-29 신설)
#      2026-07-28 "Pro/Flash 아키텍처 재설계"(commit c2831361)에서 새로
#      만든 기본 프롬프트인데, 이 파일을 스캔하는 블록이 없어 바로 다음
#      CI 재생성(902aa4f1)에서 manifest 키가 통째로 빠졌다 — 아래 §잔여
#      파일 검사가 원래 이 시점에 잡아야 했을 정확한 사례. AGENT-COMMON과
#      동일한 명명 규칙(단일 키, vX_Y, .txt)이라 스캔 패턴도 동일 형태.
_scan_single(r'^AC-PRO-CORE_v', '.txt', 'AC-PRO-CORE')

# 1-b) AC-FLASH-EXECUTOR — prompts/AC-FLASH-EXECUTOR_vX_Y.txt (2026-07-29 신설)
#      AC-PRO-CORE와 같은 재설계에서 함께 도입된 짝. 같은 원인으로 함께
#      누락돼 있었다.
_scan_single(r'^AC-FLASH-EXECUTOR_v', '.txt', 'AC-FLASH-EXECUTOR')

# 1-b-1) AC-SHADOW-CORE — prompts/AC-SHADOW-CORE_vX_Y.txt (2026-0X-XX 신설)
#      worker.js가 manifest['AC-SHADOW-CORE']로 실제 런타임에 읽고 있고
#      sp-catalog.json에도 수동으로 키가 이미 있었는데, 이 스캔 블록이
#      없어 이 자기검증이 push마다 계속 실패하고 있었다(AC-PRO-CORE/
#      AC-FLASH-EXECUTOR와 동일한 계보의 누락 — 2026-0X-XX 발견).
_scan_single(r'^AC-SHADOW-CORE_v', '.txt', 'AC-SHADOW-CORE')

# 1-c) AGENT-SUPPLIER-COMMON — prompts/AGENT-SUPPLIER-COMMON_vX.Y.txt
#      2026-06-30: 누락돼 있던 키. AGENT-SUPPLIER-NN 정규식은 '_' 뒤에
#      숫자가 와야 매칭되므로(AGENT-SUPPLIER-(\d+)_) "COMMON"은 거기서
#      잡히지 않는다 — 별도 스캔 필요.
_scan_single(r'^AGENT-SUPPLIER-COMMON_v', '.txt', 'AGENT-SUPPLIER-COMMON')

# 2) SP-00-ROUTER — prompts/SP-00-ROUTER-vX_Y.txt
_scan_single(r'^SP-00-ROUTER-v', '.txt', 'SP-00-ROUTER')

# 2-b) HONDI_VISITOR_SP — prompts/hondi_visitor_sp_vX_Y.txt
#      2026-07-08 신설: 기존엔 이 SP가 manifest 체계 밖에 있어서 desktop.html
#      에 전문이 직접 박혀 있었다(check_no_embedded_sp.py 사각지대). 다른
#      SP들과 동일하게 manifest 기반 fetch로 전환하며 스캔 대상에 추가.
_scan_single(r'^hondi_visitor_sp_v', '.txt', 'HONDI_VISITOR_SP')

# 2-c) UNIVERSAL-INTEGRITY — prompts/UNIVERSAL-INTEGRITY_vX_Y.md
#      2026-07-09 신설: expert-registry.js가 하드코딩된 URL로 이 파일을
#      직접 fetch()하던 것을 manifest 체계로 통합(SP_lawyer가 v3.2에
#      몇 주간 고정돼 있던 것과 동일한 종류의 staleness 위험 방지).
_scan_single(r'^UNIVERSAL-INTEGRITY_v', '.md', 'UNIVERSAL-INTEGRITY')

# 2-c-0) SP-TREE-REGISTRY / SP-TREE-GUARDIAN — prompts/SP-TREE-*_vX_Y.md
#      (2026-0X-XX 신설) worker.js(_runSpTreeGuardianAudit)가 두 키 모두
#      manifest에서 조회해 실제 런타임(주간 감사 트리거)에 읽는다.
#      sp-catalog.json엔 이미 수동으로 키가 있었지만 스캔 블록이 없어
#      build_manifest.py 자기검증이 push마다 계속 실패하고 있었다 —
#      UNIVERSAL-common이 처음 겪었던 것과 동일한 누락 패턴.
_scan_single(r'^SP-TREE-REGISTRY_v', '.md', 'SP-TREE-REGISTRY')
_scan_single(r'^SP-TREE-GUARDIAN_v', '.md', 'SP-TREE-GUARDIAN')

# 2-c-1) UNIVERSAL-common — prompts/UNIVERSAL-common_vX_Y.md
#      2026-07-19 신설(사용자 지시로 발견된 결함 수정): expert-session.js의
#      _composeExpertPrompt()가 UNIVERSAL-common(U0 의도특정·U1 권한의 한계·
#      U7 업무처리파이프라인 — "안내로 끝내지 않는다"는 원칙의 실제 본문)을
#      상수 문자열 'UNIVERSAL-common'으로 조회하는데, 이 파일이 SP_ 접두사가
#      아니라서(SP_{slug} 정규식 미매칭) manifest에 전혀 등재되지 않고 있었다
#      — 60개 EXPERT 페르소나 전원이 이 원칙 없이 구동되던 근본 원인. 수동
#      으로 키를 추가해도 다음 push 때 이 스크립트가 재생성하며 조용히
#      지워버렸다(실제로 1회 발생 — commit f111f85). UNIVERSAL-INTEGRITY와
#      동일한 스캔 패턴을 그대로 적용해 재발을 원천 차단한다.
_scan_single(r'^UNIVERSAL-common_v', '.md', 'UNIVERSAL-common')

# 2-c-1-b) PROFESSIONAL-common — prompts/PROFESSIONAL-common_vX_Y.md
#      2026-07-19 신설(위 UNIVERSAL-common과 동일 사유) — 전문가 보조 모듈
#      (EXPERT 페르소나) 전용 정체성 계층("특정 전문가를 사칭하지 않는다",
#      "최종 판단은 감독 전문가 전속" 등). 마찬가지로 SP_ 접두사가 아니라
#      스캔 대상에서 누락돼 있었다.
_scan_single(r'^PROFESSIONAL-common_v', '.md', 'PROFESSIONAL-common')

# 2-c-1-c) K-Public_common / k-business / business-kr
#      2026-07-20 신설(사용자 지시로 발견된 결함 수정 — UNIVERSAL-common과
#      정확히 동일한 사고 패턴): worker.js가 이 세 문서를 하드코딩 URL로
#      직접 fetch()하고 있어 K-Public_common이 v1_0에 몇 주간 박제돼 있던
#      것을 발견, sp-catalog.json에 수동으로 키를 추가해 manifest 기반
#      조회로 전환했다. 그런데 이 스크립트가 SP_ 접두사가 아닌 이 세
#      파일을 스캔하는 블록이 없어(UNIVERSAL-common이 처음 겪었던 것과
#      동일 원인), 다음 push 때 수동 추가한 키가 조용히 다시 지워지는
#      회귀가 실제로 발생했다(2026-07-20 실사로 확인). UNIVERSAL-common·
#      PROFESSIONAL-common과 동일한 스캔 패턴을 추가해 재발을 원천 차단한다.
_scan_single(r'^K-Public_common_v', '.md', 'K-Public_common')
_scan_single(r'^k-business_v', '.md', 'k-business')
_scan_single(r'^business-kr_v', '.md', 'business-kr')

# 2-c-2) UNIVERSAL-job-assist — prompts/UNIVERSAL-job-assist_vX_Y.md
#      2026-07-15 신설: call-ai.js가 처음엔 UNIVERSAL_COMMON_URL 하드코딩
#      패턴(worker.js, v1_3에 박제된 채 실제 최신 v1_5를 못 읽고 있던 걸
#      같은 날 발견)을 그대로 따라가려다, 바로 위 UNIVERSAL-INTEGRITY
#      항목이 정확히 이 문제를 막으려고 만들어진 선례라는 걸 확인하고
#      대신 이 매니페스트 규칙을 추가했다 — call-ai.js는
#      _loadSpByKey('UNIVERSAL-job-assist', ...)로 읽는다.
_scan_single(r'^UNIVERSAL-job-assist_v', '.md', 'UNIVERSAL-job-assist')

# 2-c-3) TASK-DELEGATION-GUIDE — prompts/TASK-DELEGATION-GUIDE_vX_Y.md
#      2026-07-17 신설(주피터님 지시): "혼디는 안내가 아니라 업무 대행이
#      본래 용도" 제1원칙을 모든 SP에 강제 주입하기 위해 UNIVERSAL-
#      INTEGRITY와 동일한 패턴으로 추가. UNIVERSAL-INTEGRITY 바로 다음에
#      결합된다(manifest-loader.js _loadSpByKey 참조) — 판단이 애매할 때
#      참조할 구체적 서비스별 대행 방법 목록(등본 발급 등)을 담는다.
_scan_single(r'^TASK-DELEGATION-GUIDE_v', '.md', 'TASK-DELEGATION-GUIDE')

# 2-c-3-b) CONTROL-TOWER-PRINCIPLE — prompts/CONTROL-TOWER-PRINCIPLE_vX_Y.md
#      2026-09-20 신설(Phase 2 구조감사 + content-quality live-smoketest
#      세션에서 공동 발견) — 이 파일은 ALLOWLIST_PREFIXES에 "카탈로그
#      등록 아닌 설계 문서"로 잘못 분류돼 있었으나, 실제로는 worker.js
#      (_fetchByManifestKeyFromGithub('CONTROL-TOWER-PRINCIPLE'))와
#      manifest-loader.js(_loadSpByKey)가 둘 다 런타임에 manifest 키로
#      직접 조회하는 실사용 문서다 — UNIVERSAL-INTEGRITY·TASK-DELEGATION-
#      GUIDE와 정확히 동일한 위상. 그 결과 sp-catalog.json에 키 자체가
#      한 번도 생성된 적이 없어, 프로덕션에서 이 문서 전문이 항상 로드
#      실패 후 빈 문자열로 대체되고 있었다(gov-router.js가 별도로 붙이는
#      짧은 리마인더 덕에 형식 준수만 그럭저럭 유지됨). UNIVERSAL-INTEGRITY와
#      동일한 스캔 패턴을 추가하고, ALLOWLIST_PREFIXES에서도 제거한다.
_scan_single(r'^CONTROL-TOWER-PRINCIPLE_v', '.md', 'CONTROL-TOWER-PRINCIPLE')

# 2-c-4) HONDI-CAPABILITIES-COMMON — prompts/HONDI-CAPABILITIES-COMMON_vX_Y.md
#      2026-07-27 신설(config.js loadPersonalAssistantSP()가 manifest 조회
#      로 사용 — §DIGITAL-BRIDGE). 이 스캔 블록이 처음부터 없어서
#      sp-catalog.json에 한 번도 등재된 적이 없었다 — try/catch로 조용히
#      무시되도록 짜여 있어(§ "fetch 실패(무시, PA SP는 정상 로드)") 화면이
#      죽지는 않았지만, profile-assistant가 이 문서 없이 계속 동작하고
#      있었던 것으로 보인다. 2026-07-29 잔여 파일 자기검증 블록을 도입한
#      직후 바로 이 파일이 걸려 발견됨 — 이 블록이 잡아야 할 정확한 사례.
_scan_single(r'^HONDI-CAPABILITIES-COMMON_v', '.md', 'HONDI-CAPABILITIES-COMMON')

# 2-d) SP_{slug} 계열(.md) — EXPERT 페르소나(SP_lawyer 등) + 공통 가드레일
#      (SP_common_guardrails·SP_common_medical_safety) — prompts/SP_{slug}_v{ver}.md
#      2026-07-09 신설: expert-registry.js/expert-session.js가 이 파일들을
#      전부 하드코딩 경로로 직접 fetch()하고 있어, 새 버전을 만들어도 이
#      경로를 안 고치면 조용히 구버전을 계속 쓰는 문제가 실제로 있었다
#      (SP_lawyer v3.2 고정 사례로 발견). 아래 4)의 "SP-NN_slug"(하이픈+숫자,
#      .txt) 계열과는 별개 명명 규칙(SP_slug, 밑줄, .md)이라 정규식을
#      공유하지 않는다 — slug 자체에 밑줄이 들어갈 수 있어(예:
#      SP_common_guardrails) 비탐욕(non-greedy) 매칭으로 마지막
#      "_v숫자[_숫자...]" 조각만 버전으로 떼어낸다.
_SP_UNDERSCORE_PAT = r'^(SP_.+?)_v[\d_]+\.md$'
RECOGNIZED_PATTERNS.append(_SP_UNDERSCORE_PAT)
sp_underscore_groups: dict[str, list[str]] = defaultdict(list)
for f in PROMPTS.iterdir():
    name = f.name
    if not name.endswith('.md') or 'LATEST' in name:
        continue
    m = re.match(_SP_UNDERSCORE_PAT, name)
    if m:
        sp_underscore_groups[m.group(1)].append(name)

for key in sorted(sp_underscore_groups):
    manifest[key] = best(sp_underscore_groups[key])

# 3) profile-assistant — prompts/profile-assistant/profile-assistant-vX.Y.txt
#    (2026-07-08: personal-assistant → profile-assistant 개명·분리)
#    하위 디렉터리 전용이라 잔여 파일 검사(prompts/ 최상위만 봄) 대상이
#    아니지만, 일관성을 위해 패턴은 그대로 등록해둔다.
RECOGNIZED_PATTERNS.append(r'^profile-assistant/profile-assistant-v')
pa_dir = PROMPTS / 'profile-assistant'
if pa_dir.is_dir():
    pa_files = [
        f.name for f in pa_dir.iterdir()
        if re.match(r'^profile-assistant-v', f.name) and f.name.endswith('.txt')
    ]
    if pa_files:
        # 값은 하위 디렉터리 포함 경로로 저장
        manifest['profile-assistant'] = 'profile-assistant/' + best(pa_files)

# 3-a) gov-tree/08-schema/{NAME}[_vX_Y].md — worker.js가
#      _fetchByManifestKeyFromGithub()로 실제 런타임에 조회하는 스키마
#      문서들(HUMAN-AUTHORITY-GATE-SCHEMA, PDV-TRANSFER-PROTOCOL 등).
#      2026-0X-XX 발견 — 하위 폴더라 최상위 잔여 파일 자기검증 대상이
#      아니어서(prompts/ 최상위만 스캔) 지금까지 아무 스캔 블록도 없이
#      sp-catalog.json에 수동으로만 키가 있었다 — 이 스크립트가 전체
#      재생성될 때마다 7개 키가 통째로 조용히 삭제될 뻔한 상태였다(로컬
#      재현으로 발견). profile-assistant와 동일하게 하위 폴더 전용 스캔을
#      추가한다. 값은 'gov-tree/08-schema/파일명' 형태로 저장한다.
RECOGNIZED_PATTERNS.append(r'^gov-tree/08-schema/')
schema_dir = PROMPTS / 'gov-tree' / '08-schema'
if schema_dir.is_dir():
    schema_groups: dict[str, list[str]] = defaultdict(list)
    for f in schema_dir.iterdir():
        if not f.name.endswith('.md'):
            continue
        m = re.match(r'^(.+?)(?:_v[\d_]+)?\.md$', f.name)
        if m:
            schema_groups[m.group(1)].append(f.name)
    for key in sorted(schema_groups):
        manifest[key] = 'gov-tree/08-schema/' + best(schema_groups[key])

# 3-b) gov-tree 여러 하위 폴더에 흩어진 단일 키 문서들 — gov-router.js/
#      worker.js가 _fetchByManifestKey(FromGithub)로 실제 조회한다
#      (2026-0X-XX 발견 — 08-schema와 동일한 계보의 누락, 이 5개는 폴더가
#      제각각이라 범용 헬퍼로 처리). 지금까지 sp-catalog.json에 수동으로만
#      있었고 스캔 블록이 없어 전체 재생성 때마다 조용히 삭제될 뻔했다.
def _scan_single_subdir(subdir: str, pattern: str, ext: str, key: str) -> None:
    """단일 키 패턴을 prompts/{subdir}/ 안에서만 스캔 — 값은 '{subdir}/파일명'으로 저장."""
    RECOGNIZED_PATTERNS.append(f'^{re.escape(subdir)}/{pattern}')
    d = PROMPTS / subdir
    if not d.is_dir():
        return
    files = [f.name for f in d.iterdir() if re.match(pattern, f.name) and f.name.endswith(ext)]
    if files:
        manifest[key] = subdir + '/' + best(files)

_scan_single_subdir('gov-tree/00-common', r'^GOV-TREE-PROTOCOL_v', '.md', 'GOV-TREE-PROTOCOL')
_scan_single_subdir('gov-tree/00-common/overlays', r'^GOV-COMMON-OVERLAY-TEMPLATE_v', '.md', 'GOV-COMMON-OVERLAY-TEMPLATE')
_scan_single_subdir('gov-tree/01-do/templates', r'^SP-PROVINCE-TEMPLATE_v', '.md', 'SP-PROVINCE-TEMPLATE')
_scan_single_subdir('gov-tree/09-national', r'^NATIONAL-SP-CORE_v', '.md', 'NATIONAL-SP-CORE')
_scan_single_subdir('gov-tree/09-national/overlays', r'^NATIONAL-SP-OVERLAY-TEMPLATE_v', '.md', 'NATIONAL-SP-OVERLAY-TEMPLATE')

# 4) SP-NN 계열 — prompts/SP-NN_slug_vX.Y.txt (또는 vX_Y.txt)
#    2026-0X-XX 수정 — 버전 구분자로 점(.)만 허용했더니(_v[\d.]+) K119·
#    kpolice·khealth·ktraffic·kdemocracy·klogistics·kinsurance 7개 파일은
#    밑줄 구분 버전(_v3_0)을 써서 이 옵션 그룹이 매치를 못 하고, 그 결과
#    "_v3_0"까지 통째로 슬러그(group 2)에 흡수돼 manifest 키가
#    "SP-02_k119_v3_0"처럼 버전까지 낀 이름으로 오염되고 있었다(parse_version
#    자체는 점·밑줄 모두 허용해 최신판 선택은 정상이었지만, 키 이름 오염은
#    별개 문제 — 로컬 재현으로 발견). 밑줄도 허용해 슬러그와 버전이 항상
#    정확히 분리되도록 한다.
_SP_NN_PAT = r'^(SP-[\d]+-?(?:IMG)?)_(.+?)(?:_v[\d._]+)?\.txt$'
RECOGNIZED_PATTERNS.append(_SP_NN_PAT)
sp_groups: dict[str, list[str]] = defaultdict(list)
for f in PROMPTS.iterdir():
    name = f.name
    if not name.endswith('.txt') or 'LATEST' in name:
        continue
    m = re.match(_SP_NN_PAT, name)
    if m:
        key = f"{m.group(1)}_{m.group(2)}"
        sp_groups[key].append(name)

for key in sorted(sp_groups):
    manifest[key] = best(sp_groups[key])

# 5) AGENT-SUPPLIER-NN 계열
_AGENT_SUPPLIER_PAT = r'^(AGENT-SUPPLIER-(\d+))_'
RECOGNIZED_PATTERNS.append(_AGENT_SUPPLIER_PAT)
supplier_groups: dict[str, list[str]] = defaultdict(list)
for f in PROMPTS.iterdir():
    name = f.name
    if not name.endswith('.txt') or 'LATEST' in name:
        continue
    m = re.match(_AGENT_SUPPLIER_PAT, name)
    if m:
        supplier_groups[m.group(2)].append(name)

for code in sorted(supplier_groups):
    manifest[f'AGENT-SUPPLIER-{code}'] = best(supplier_groups[code])

# 6) SP-INDUSTRY-TRANSFORM-COMMON — prompts/SP-INDUSTRY-TRANSFORM-COMMON_vX.Y.md
#    2026-07-23 신설(사용자 지시로 발견된 결함 수정 — UNIVERSAL-common·
#    K-Public_common과 정확히 동일한 사고 패턴): worker.js의 실시간 SP 생성
#    기능이 이 문서를 manifest로 조회하는데, 이 스크립트에 스캔 블록이 없어
#    수동으로 추가한 키가 매 push마다(이 스크립트가 파일을 완전히 재생성
#    하므로) 조용히 지워지는 회귀가 실제로 2회 발생했다(PR #63·#64 모두
#    같은 원인으로 무력화됨, 2026-07-23 실사로 확인). AGENT-SUPPLIER-COMMON과
#    동일한 스캔 패턴을 추가해 재발을 원천 차단한다.
_scan_single(r'^SP-INDUSTRY-TRANSFORM-COMMON_v', '.md', 'SP-INDUSTRY-TRANSFORM-COMMON')

# 6-b) SP-INDUSTRY-TRANSFORM-NN 계열 — prompts/SP-INDUSTRY-TRANSFORM-NN_slug_vX.Y.txt
#      AGENT-SUPPLIER-NN과 동일한 스캔 패턴(코드만 다름).
_INDUSTRY_TRANSFORM_PAT = r'^(SP-INDUSTRY-TRANSFORM-(\d+))_'
RECOGNIZED_PATTERNS.append(_INDUSTRY_TRANSFORM_PAT)
industry_transform_groups: dict[str, list[str]] = defaultdict(list)
for f in PROMPTS.iterdir():
    name = f.name
    if not name.endswith('.txt') or 'LATEST' in name:
        continue
    m = re.match(_INDUSTRY_TRANSFORM_PAT, name)
    if m:
        industry_transform_groups[m.group(2)].append(name)

for code in sorted(industry_transform_groups):
    manifest[f'SP-INDUSTRY-TRANSFORM-{code}'] = best(industry_transform_groups[code])

# ── 잔여 파일 자기검증 (2026-07-29 신설) ────────────────────────────────
# prompts/ 최상위(하위 폴더 제외)의 .md/.txt 파일 중 위 어떤 패턴에도
# 안 걸리는 게 있으면, 카탈로그 대상이 원래 아닌 문서(설계도·감사록 등,
# ALLOWLIST_PREFIXES)가 아닌 한 스크립트를 실패시킨다. archive_old_prompts.py
# 가 이 스크립트보다 먼저 돌아 계열당 최신 KEEP_LATEST(5)개만 prompts/에
# 남기므로, 여기 걸리는 파일은 "버전이 오래돼서"가 아니라 "패턴 자체를
# 모른다"는 뜻 — 그래서 정확히 우리가 원하는 신호만 남는다.
ALLOWLIST_PREFIXES = (
    'SP-ARCHITECTURE-MAP', 'SP-AUTHOR', 'SP-CATALOG_v1_0', 'EXPERT-INDEX',
    'AC-EVOLUTION', 'GOV-TIER-IO-SCHEMA', 'GOV_TASK', 'PDV-TRANSFER-PROTOCOL',
    'AGENCY-AC-COMMON', 'AC-AUTHOR', 'AGENCY-COMMON-TEMPLATE',
    'DEPRECATED_', 'GLOBAL-LOCAL-COMPLIANCE', 'ROUTER-PRIORITY',
    'K-Case', 'jeju-gov-sp-hierarchy', 'README',
    # 2026-09-01 추가 — K-Mail SP 등록 작업 중 발견: 이 스크립트가 이미
    # 이 8개 파일 때문에 실패(exit 1) 중이었다. manifest.yml은 push마다
    # 이 스크립트를 돌리는데, 실패하면 sp-catalog.json 커밋 자체가
    # 안 되므로 — 이 파일들이 추가된 시점 이후 prompts/에 어떤 변경이
    # 있었든 전부 조용히 미반영 상태였을 가능성이 있다(SP-25_kmail도
    # 이 상태에서 추가했다면 똑같이 새지 않고 반영됐을 것). 아래 8개는
    # 설계도·검토 문서로 보이나(카탈로그 서비스가 아니라 계획서 성격),
    # k-plan/k-social-match/k-watch 세 개는 실제 서비스 기획 문서일
    # 가능성도 있어 이후 확인이 필요함(현재는 안전한 기본값으로 보수적
    # 배제만 함 — 카탈로그 등록이 아니라 문서 취급).
    'GOV-TASK-POST-ACCEPTANCE-REVIEW',
    'ROUTING-BRANCH-REFERENCE', 'k-plan_v1_0', 'k-social-match_v1_0',
    'k-watch_v1_0',
    # ★ 2026-09-20: CONTROL-TOWER-PRINCIPLE는 여기서 제거 — 실제로는
    # 런타임이 manifest 키로 조회하는 카탈로그 대상 문서였다(위 2-c-3-b
    # 스캔 블록 참고). 설계도로 오분류돼 있던 것이 원인.
)

unrecognized = []
for f in sorted(PROMPTS.iterdir()):
    if not f.is_file() or f.suffix not in ('.md', '.txt'):
        continue
    name = f.name
    if 'LATEST' in name:
        continue
    if name.startswith(ALLOWLIST_PREFIXES):
        continue
    if any(re.match(pat, name) for pat in RECOGNIZED_PATTERNS):
        continue
    unrecognized.append(name)

if unrecognized:
    print('✗ build_manifest.py: 아무 스캔 패턴에도 안 걸리는 파일 발견 — '
          '새 명명 규칙이면 이 스크립트에 스캔 블록을, 카탈로그 대상이 '
          '아닌 문서면 ALLOWLIST_PREFIXES에 추가하세요:', file=sys.stderr)
    for name in unrecognized:
        print('  -', name, file=sys.stderr)
    sys.exit(1)

# ── 출력 ──────────────────────────────────────────────────────────────
for key, fname in manifest.items():
    print(f'  {key}: {fname}')

OUT.write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
    encoding='utf-8'
)
print(f'\n✓  {OUT}  ({len(manifest)} 항목)')
