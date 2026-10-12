# -*- coding: utf-8 -*-
"""
check_institution_scope_nationwide_vs_jeju.py — 백필 전에 반드시 확인:
(1) institution 전체가 몇 건인가(267건 근처면 사실상 제주뿐), (2) 주소에
"제주"가 안 들어간(=타 지역 추정) 기관이 이미 있는가.

나비 원칙(2026-08-04 재확인): ①제주 모형 완결 → ②추상 템플릿 도출 →
③지역별 구체 인스턴스 생성. 지금이 어느 단계인지 이 스크립트로 먼저
확인한다.

사용:
  python check_institution_scope_nationwide_vs_jeju.py
"""
import json
import urllib.request
import urllib.parse

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
L1_BASE = "https://l1-hanlim.hondi.net"


def l1_query(filt, per_page=5):
    url = "{}/api/collections/profiles/records?filter={}&perPage={}".format(
        L1_BASE, urllib.parse.quote(filt), per_page)
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    d = l1_query("entity_type = 'institution'", per_page=1)
    total = d.get("totalItems")
    print("institution 전체 건수:", total)
    print("(267건 근처면 사실상 제주뿐 — 1단계도 아직 미완결 가능성)")
    print()

    d2 = l1_query("entity_type = 'institution' && address !~ '제주'", per_page=10)
    other_total = d2.get("totalItems")
    print("주소에 '제주' 안 들어간(=타 지역 추정) 건수:", other_total)
    for p in d2.get("items", []):
        extra = p.get("extra") or {}
        identity = (extra.get("public") or {}).get("identity") or {}
        print(" -", p.get("name"), "|", p.get("address"), "|", identity.get("entity_subtype"))


if __name__ == "__main__":
    main()
