# 작업 이력 인덱스 (WORKLOG_INDEX)

> **작성일**: 2026-07-23
> **목적**: 날짜가 찍힌 일회성 작업 기록(WORKLOG류)을 한 곳에 모읍니다.
> 이런 기록은 매뉴얼이 아니라 **이력**이라, `desktop.html` 사이드바에
> 개별 항목으로 하나씩 추가하면 세션이 쌓일수록 사이드바가 무한정
> 길어집니다 — 그래서 사이드바에는 이 인덱스 하나만 링크하고, 개별
> 기록은 여기 표에 추가합니다.
>
> **새 작업 기록을 추가할 때**: 파일은 `docs/`에 그대로 두고, 아래
> 표 맨 위(최신)에 한 줄만 추가하세요. `desktop.html`은 건드릴 필요
> 없습니다.

---

## 작업 기록 목록 (최신순)

| 날짜 | 문서 | 요약 |
|---|---|---|
| 2026-10-17 | [`SESSION_SUMMARY_DOCFORM_REWARD_MARINE_PILOT_20261017_v1_0.md`](./SESSION_SUMMARY_DOCFORM_REWARD_MARINE_PILOT_20261017_v1_0.md) | 도선사 서류 조사 반영(SP_marine-pilot v3.5) + 서식 공유·평가·GDC 보상 알고리즘(SP_DOC_FORM v1.3, PR #647). 정책 [`DOC_FORM_REWARD_정책_20261017.md`](./DOC_FORM_REWARD_정책_20261017.md), 엔드포인트 [`API_REFERENCE_worker_v1_0.md`](./API_REFERENCE_worker_v1_0.md) §3.8 |
| 2026-07-27 | [`WORKLOG_MANUAL_2026_07_27.md`](./WORKLOG_MANUAL_2026_07_27.md) | 프로필 사진저장·§IMAGE-SCAN 확장·계좌이체 원칙·§DIGITAL-BRIDGE·§PROFILE-UPDATE-MODE·AC-PA 실시간 채널·OSS 피드백 파이프라인 완성. 신규 매뉴얼 [`PROFILE_ASSISTANT_MANUAL_v1_0.md`](./PROFILE_ASSISTANT_MANUAL_v1_0.md) 신설 |
| 2026-07-25 | [`DOCUMENTATION_SWEEP_2026_07_25.md`](./DOCUMENTATION_SWEEP_2026_07_25.md) | 문서 생태계 점검(일반 사용자·개발자 커버리지) — MANUAL_INDEX 최종수정 갱신, 버그 로그 BUG-012~021 소급 반영, 시스템맵에 저장소 토폴로지(jeju 별도 저장소) 신설 |
| 2026-07-23 | [`PUSH_SUBSCRIPTION_MULTIDEVICE_2026_07_23.md`](./PUSH_SUBSCRIPTION_MULTIDEVICE_2026_07_23.md) | device-link 알림 PC 오발송 근본 수정 — push_subscription을 기기별 배열로 변경(§PUSH_SUBSCRIPTION_HIJACK_2026_07_21.md §4 후속) |
| 2026-07-23 | [`GDC_CHARGE_MANUAL_v1_0.md`](./GDC_CHARGE_MANUAL_v1_0.md) | 가입 축하 충전(0.1GDC)·사용량 차감·저잔액 알림 신설, `charge.html` 신설, B안(무료한도 0원) 채택 |
| 2026-07-23 | [`GDC_GIT_EXPOSURE_INCIDENT_2026_07_23.md`](./GDC_GIT_EXPOSURE_INCIDENT_2026_07_23.md) | gdc 저장소 wrangler 배포 시 `.git` 폴더 전체 공개 노출 사고·수정 |
| 2026-07-22 | [`WORKLOG_MANUAL_2026_07_22.md`](./WORKLOG_MANUAL_2026_07_22.md) | device-link 안정화·GWP 채팅 UI 공용화·지갑 CDN 개편 작업기록 |
| 2026-07-21 | [`MARKET_PROXY_INTEGRATION_LOG_2026_07_21.md`](./MARKET_PROXY_INTEGRATION_LOG_2026_07_21.md) | market-proxy 원장통합 작업기록 |

---

## 이 인덱스 자체의 관리 원칙

1. 표는 **최신이 맨 위**입니다.
2. 작업 기록이 특정 기능의 정식 매뉴얼(예: `GDC_CHARGE_MANUAL_v1_0.md`)로
   흡수되면, 그 사실만 이 표의 "요약" 칸에 한 줄 추가하고 원본은
   삭제하지 않습니다(감사 이력 보존).
3. 이 인덱스에 실리는 문서는 "그 시점에 무슨 일이 있었는지"를 다루는
   글입니다. 지금도 유효한 절차·개념 설명이 필요하면
   [`MANUAL_INDEX.md`](./MANUAL_INDEX.md)가 관리하는 정식 매뉴얼
   쪽으로 옮기는 걸 고려하세요.
