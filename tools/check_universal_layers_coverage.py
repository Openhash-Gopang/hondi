#!/usr/bin/env python3
"""
tools/check_universal_layers_coverage.py
------------------------------------------
"UNIVERSAL-INTEGRITY(+UNIVERSAL-common+CONTROL-TOWER-PRINCIPLE)는 전체 SP
공통 최상위 원칙"이라는 선언이 실제 코드에서 지켜지는지 정적으로 검증한다.

■ 배경 (2026-08-08 전수 감사)
UNIVERSAL-INTEGRITY_v1_0.md 자신이 "적용 범위: 트랙 무관 — 정부·K-서비스·
전문직 페르소나·AGENT-COMMON·AGENT-SUPPLIER 전부"라고 선언하지만, 실사
결과 GWP_REGISTRY의 27개 서비스 중 6개(ktelecom·kestate·kcommerce_seller·
ksearch·kqna·kusers)와 AGENT-SUPPLIER(78개 업종 공급자 AI) 전체가 이 원칙을
상속받지 못하고 있었다. 게다가 klaw·kgov도 각각 한 번씩 "나중에 실사로
발견해서 고쳤다"는 이력이 있다 — 새 K서비스가 추가될 때마다 반복되는
패턴으로 보인다(수동으로 화이트리스트/relay 코드에 챙겨 넣어야 하는
opt-in 구조 자체가 원인).

이 스크립트는 그 재발을 막는 방어선이다 — gwp-registry.js에 새 서비스가
추가될 때마다 CI가 이 스크립트를 돌려서, 그 서비스가 UNIVERSAL 3종을
상속받을 경로가 실제로 있는지 자동 확인한다. 통과 못 하면 빌드가 실패한다
(사람이 "이번엔 안 잊어야지"라고 다짐하는 것에 의존하지 않는다).

■ 판정 로직
gwp-registry.js의 모든 status='active' 항목을 다음 중 하나로 분류한다:
  1. UNIVERSAL_FORCED_K_SERVICES(worker.js) 화이트리스트에 있음 → COVERED
  2. 알려진 전용 relay 보유(klaw/kgov/kregionalgov/kbusiness — worker.js의
     handleKlawRelay/handleGovRelay/handleBusinessRelay가 각각
     _fetchUniversalLayers() 또는 개별 3종 fetch를 실제로 호출하는지까지
     확인) → COVERED
  3. type='tool'이고 sp_url이 없음(대화형 SP가 아닌 순수 함수 도구,
     예: 계산기·웹검색) → N/A(원칙 상속 대상 아님, 결함 아님)
  4. 클라이언트 매니페스트 로더(_loadSpByKey) 사용이 코드로 확인된
     알려진 예외(profile-assistant) → COVERED
  5. 위 어디에도 안 걸림 → **FAIL**

AGENT-SUPPLIER는 worker.js의 합성 함수 하나가 유일한 로딩 경로이므로
화이트리스트 대조가 아니라 "그 함수가 _fetchUniversalLayers()(또는 3종
개별 fetch)를 실제로 호출하는가"만 확인한다.

■ 한계(정직하게 기록)
- 이 스크립트는 gopang 모노레포 안의 코드만 본다 — GWP가 실제로는 별도
  저장소(klaw/school 등)에서 자체 SP를 구성하는 경우, 그 저장소 자신의
  UNIVERSAL 상속 여부는 이 스크립트가 검증하지 못한다(예: K-School은
  school 저장소의 system_prompt.txt가 GitHub raw로 gopang의
  UNIVERSAL-INTEGRITY를 직접 fetch하는 걸 별도로 수동 확인했다 — 이
  패턴을 모든 K서비스 저장소에 자동 확인하려면 check_gov_relay_wiring.py
  처럼 각 저장소를 얕은 클론해서 검사하는 별도 스크립트가 필요하다.
  이건 이번 범위 밖으로 남긴다).
- "코드에 _fetchUniversalLayers 호출이 있다"까지만 확인하고, 그 호출이
  실제로 도달 가능한 코드 경로인지(죽은 코드가 아닌지)는 정적 분석의
  한계로 완벽히 보장 못 한다 — 라이브 스모크테스트가 최종 확인선이다.

■ 종료 코드
  0: 전부 COVERED 또는 N/A
  1: 하나 이상 FAIL
"""
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GWP_REGISTRY_PATH = REPO_ROOT / "gwp-registry.js"
WORKER_PATH = REPO_ROOT / "worker.js"

# 알려진 전용 relay 서비스 — 각 relay 함수가 실제로 UNIVERSAL 3종(또는
# 통합 헬퍼)을 호출하는지는 아래에서 코드로 검증한다(하드코딩 신뢰 아님).
DEDICATED_RELAY_SERVICES = {
    "klaw": "handleKlawRelay",
    "kgov": "handleGovRelay",
    "kregionalgov": "handleGovRelay",  # gov-router.js가 /gov/relay 재사용 확인됨
    "kbusiness": "handleBusinessRelay",
}

# 클라이언트 manifest-loader.js(_loadSpByKey, 자동 상속 확인됨)를 쓰는
# 것으로 코드 확인된 예외 — GWP_REGISTRY엔 있지만 서버 relay 화이트리스트
# 대상이 아닌 이유가 정당한 경우.
CLIENT_LOADER_EXCEPTIONS = {"profile-assistant"}

# 2026-09-11 추가 — kmail은 handleLLMRelay를 거치지 않는 완전히 격리된
# 전용 엔드포인트(/kmail/chat, handleKmailChat)라 위 두 패턴(화이트리스트/
# DEDICATED_RELAY_SERVICES) 어디에도 안 걸려 FAIL로 오탐되고 있었다.
# 실제로는 handleKmailChat 본문이 _fetchUniversalLayers()를 무조건
# 호출한다(2026-09-02 감사로 이미 확인·수정된 지 오래됨) — K-Law의
# handleKlawRelay와 완전히 같은 검증 방식(relay_calls_universal)을
# 그대로 재사용할 수 있어 DEDICATED_RELAY_SERVICES에 추가한다.
DEDICATED_RELAY_SERVICES["kmail"] = "handleKmailChat"


def load_gwp_registry():
    """gwp-registry.js를 Node vm으로 실행해 GWP_REGISTRY 배열을 얻는다."""
    import subprocess

    script = f"""
    const fs = require('fs'); const vm = require('vm');
    const src = fs.readFileSync('{GWP_REGISTRY_PATH}', 'utf8');
    const sandbox = {{ window: {{}}, fetch: async () => ({{ok:false}}), console }};
    vm.createContext(sandbox); vm.runInContext(src, sandbox);
    console.log(JSON.stringify(sandbox.window.GWP_REGISTRY));
    """
    result = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def load_forced_whitelist(worker_src: str):
    m = re.search(r"UNIVERSAL_FORCED_K_SERVICES\s*=\s*new Set\(\[(.*?)\]\)", worker_src, re.S)
    if not m:
        raise RuntimeError("UNIVERSAL_FORCED_K_SERVICES 정의를 worker.js에서 못 찾음 — 변수명이 바뀌었을 수 있음")
    ids = re.findall(r"'([^']+)'", m.group(1))
    return set(ids)


def relay_calls_universal(worker_src: str, fn_name: str) -> bool:
    """해당 relay 함수 본문(다음 'async function' 전까지)에 _fetchUniversalLayers
    또는 3종 개별 fetch 호출이 실제로 있는지 확인한다."""
    pattern = re.compile(
        rf"async function {re.escape(fn_name)}\([^)]*\)\s*{{(.*?)\n}}\n",
        re.S,
    )
    m = pattern.search(worker_src)
    if not m:
        return False
    body = m.group(1)
    has_helper = "_fetchUniversalLayers()" in body
    has_manual = (
        "_fetchUniversalIntegrity()" in body
        and "_fetchUniversalCommon()" in body
        and "_fetchControlTowerPrinciple()" in body
    )
    return has_helper or has_manual


def agent_supplier_covered(worker_src: str) -> bool:
    """AGENT-SUPPLIER 합성 함수가 UNIVERSAL 3종(또는 헬퍼)을 호출하는지 확인.
    마커 문자열 "AGENT-SUPPLIER-{ksic}"이 여러 번 나오므로(주석에서도 언급됨),
    그 함수의 실제 정의(async function ... 로 시작하는 지점)부터 다음 최상위
    함수 정의 전까지를 범위로 잡는다 — 고정폭 윈도우는 실제로 8000자+
    떨어진 사례가 있어 위험하다(2026-08-08 최초 구현에서 4000자로 뒀다가
    이 케이스를 놓쳐 즉시 발견·수정).
    """
    idx = worker_src.find("AGENT-SUPPLIER-{ksic}")
    if idx == -1:
        return False
    # 이 지점 이후 첫 "async function" 정의를 찾아 그 함수 본문 전체를 본다.
    fn_start = worker_src.find("async function", idx)
    if fn_start == -1:
        window = worker_src[idx:]
    else:
        next_fn = worker_src.find("\nasync function ", fn_start + 20)
        window = worker_src[idx: next_fn] if next_fn != -1 else worker_src[idx: idx + 20000]
    return "_fetchUniversalLayers()" in window or (
        "_fetchUniversalIntegrity()" in window
        and "_fetchUniversalCommon()" in window
        and "_fetchControlTowerPrinciple()" in window
    )


def main():
    gwp_list = load_gwp_registry()
    worker_src = WORKER_PATH.read_text(encoding="utf-8")
    forced = load_forced_whitelist(worker_src)

    results = []
    for svc in gwp_list:
        if svc.get("status") != "active":
            continue
        sid = svc["id"]

        if svc.get("type") == "tool" and not svc.get("sp_url") and not svc.get("url"):
            results.append((sid, "N/A", "순수 도구(대화형 SP 아님)"))
            continue

        if sid in forced:
            results.append((sid, "COVERED", "UNIVERSAL_FORCED_K_SERVICES 화이트리스트"))
            continue

        if sid in DEDICATED_RELAY_SERVICES:
            fn = DEDICATED_RELAY_SERVICES[sid]
            if relay_calls_universal(worker_src, fn):
                results.append((sid, "COVERED", f"전용 relay({fn})가 UNIVERSAL 3종 호출 확인"))
            else:
                results.append((sid, "FAIL", f"전용 relay({fn}) 있으나 UNIVERSAL 3종 호출 없음"))
            continue

        if sid in CLIENT_LOADER_EXCEPTIONS:
            results.append((sid, "COVERED", "클라이언트 manifest-loader.js(_loadSpByKey) 사용 확인됨"))
            continue

        results.append((sid, "FAIL", "화이트리스트에도 없고 전용 relay도 없음 — 상속 경로 미확인"))

    # AGENT-SUPPLIER 별도 확인
    if agent_supplier_covered(worker_src):
        results.append(("AGENT-SUPPLIER(78개 업종)", "COVERED", "합성 함수가 UNIVERSAL 3종 호출 확인"))
    else:
        results.append(("AGENT-SUPPLIER(78개 업종)", "FAIL", "합성 함수에 UNIVERSAL 3종 호출 없음"))

    fails = [r for r in results if r[1] == "FAIL"]

    print(f"{'서비스':30s} {'판정':10s} 근거")
    print("-" * 90)
    for sid, verdict, reason in results:
        print(f"{sid:30s} {verdict:10s} {reason}")

    print()
    print(f"총 {len(results)}건 — COVERED {sum(1 for r in results if r[1]=='COVERED')}, "
          f"N/A {sum(1 for r in results if r[1]=='N/A')}, FAIL {len(fails)}")

    if fails:
        print("\n실패 목록:")
        for sid, _, reason in fails:
            print(f"  - {sid}: {reason}")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
