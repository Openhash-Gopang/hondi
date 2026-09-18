# 이 폴더의 파일들 — 아카이브 사유

**2026-09-19, 「제주 AI 행정」 SP 정비 세션에서 이동.**

## 이동 대상
`JEJU-GOV-COMMON_v1_1.md` ~ `v1_5.md` (5개 전 버전)

## 사유 — 어디서도 fetch되지 않는 죽은 문서임을 코드로 직접 확인

`src/gopang/gov/gov-router.js`의 `_loadGovCommon()`을 직접 읽어 확인한 결과,
현재 살아있는 "공통 SP" 체인은 이 파일이 아니라 다음 7개를 조합한 것이다
(전부 실제 fetch 대상이며 존재 확인됨):

1. `prompts/SP-10_kpublic_v3.25.txt` (kgov — 전국 공통 K-Public SP)
2. 코드 내 하드코딩된 전문가 SP 상속 선언문
3. `prompts/SP_common_guardrails_v3_30.md` (SP-COMMON-02)
4. `prompts/gov-tree/08-schema/HUMAN-AUTHORITY-GATE-SCHEMA_v1_4.md`
5. `prompts/gov-tree/00-common/overlays/GOV-COMMON-OVERLAY-TEMPLATE_v1.1.md` + `gov-common-overlay-master-data.json` (도별 오버레이)
6. `prompts/gov-tree/00-common/GOV-TREE-PROTOCOL_v1.0.md`
7. `prompts/AGENCY-AC-COMMON_v1.5.md`

`JEJU-GOV-COMMON_v1_5.md` 자기 자신의 헤더(2026-07-09 작성)에도 이미
"이 문서는 폐기됐고 내용은 kgov + OVERLAY + TREE-PROTOCOL로 분산 재배치됐다"고
명시돼 있었다 — 이번 세션에서 그 주장을 실제 라이브 코드·파일 존재 여부로
재검증했다.

## 내용 검증 — 유실된 원칙이 있는지 확인

v1_5에만 있던 핵심 원칙(§10 정직성·데이터 연동 공백 고지, §11 능동적 역량,
§13 PDV 중개 프로토콜, §14 적극적 보조 원칙)이 실제로 후속 문서에 살아있는지
grep으로 직접 확인:

| 원칙 | 검색어 | 발견 위치 |
|---|---|---|
| §10 정직성 | `정직성` | SP-10_kpublic_v3.25.txt, SP_common_guardrails_v3_30.md 양쪽 |
| §10-5 데이터 연동 공백 | `GAP_LOG` | 위 양쪽 |
| §11 능동적 역량 / §14 적극적 보조 | `능동적 역량`, `적극적 보조` | SP_common_guardrails_v3_30.md |
| §13 PDV 프로토콜 | `PDV_REQUEST` | 위 양쪽 |

추가로 v1_5가 언급한 "UNIVERSAL-common(U1~U9)"도 실재 확인
(`prompts/UNIVERSAL-common_v1_13.md`, 서버측 `handleGovRelay()`가 강제 주입).

**결론: 유실된 원칙 없음 — 반영 작업 불필요, 그대로 archive 처리.**
v1.1~v1.4는 v1.5로 가는 중간 단계(§10→§11→§12→§13→§14 순으로 신설된 이력)일
뿐이므로 v1.5 하나의 검증으로 전부를 대표한다.

## 남은 사소한 부채 (이번 세션에서 발견, 별도 처리 필요)

- `SP_common_guardrails_v3_24/25/27/29.md`가 아카이브 안 되고 최신본(v3_30)
  옆에 그대로 남아있음.
- `UNIVERSAL-common_v1_9/10/11.md`도 동일하게 최신본(v1_13) 옆에 남아있음.
- 위 두 건은 02-do-dept의 버전 중복 문제보다는 훨씬 가볍지만, 같은 패턴이
  반복되고 있다는 신호.
