# ROADMAP — 나비 디지털 여권

각 Phase는 이전 Phase의 신뢰·표준 정합을 전제로 하며, 되돌아가 재작업하지 않는 것을 목표로 한다.
표준 기종은 전 Phase에서 **Galaxy Z Fold 8**로 고정.

---

## Phase 0 — 국내용 신뢰 구축 (제주 → 전국)

**목표**: 국제 확장 이전에 국내에서 "나비 지갑에 담긴 신원 credential이 실제로 신뢰할 만하다"는
실적을 쌓는다. 기존 Navi 인프라(GWP, PDV, device-link 인증)를 재사용한다.

### 0.1 신원 credential 스키마 설계
- W3C Verifiable Credentials 포맷 채택 (국제표준 정합을 염두에 둔 선제 설계)
- 기존 `users` 저장소의 GUID 체계 위에 DID(분산신원) 레이어 추가
- Knox Vault에 서명키 격리 저장 — device-link 인증 흐름(X25519/Ed25519)에서 이미 확립된
  "서버는 개인키를 절대 보지 않는다" 패턴 그대로 승계

### 0.2 지자체 발급 연동
- 제주도청(kgov) 발급 절차와 연동 — G18 HUMAN-AUTHORITY-GATE-SCHEMA(담당부서 확인·승인 게이트) 재사용
- 정부24 연동 시 §REQUIRED-DOCUMENTS 흐름 활용 (kgov SP-10에 이미 존재)

### 0.3 이동수단 실증
- 제주 내 신원 확인이 필요한 서비스(대중교통, 공공시설 출입 등) 1~2개 파일럿
- NFC(eSE) 제시 UX를 Z Fold 8에서 실제 하드웨어로 검증

### 0.4 전국 확장
- 기존 진행 중인 Navi 전국 확장(province-master-data) 작업과 동기화
- 시/도별 발급기관 차이를 흡수하는 어댑터 레이어 설계

**Phase 0 완료 기준**: 최소 1개 지자체에서 발급~검증까지 엔드투엔드 실사용 사례 확보

---

## Phase 1 — 국제표준 참조 구현체화

**목표**: 나비 지갑을 "새로운 시스템"이 아니라 "각국이 이미 합의한 국제표준을 지키는 도구"로
포지셔닝해 각국의 채택 저항을 최소화한다.

### 1.1 표준 정합 작업
| 표준 | 대응 작업 |
|---|---|
| ICAO Doc 9303 / DTC Type 1~3 | credential 구조를 DTC 스키마에 맞춰 매핑 |
| ISO/IEC 18013-5 (mDL) | NFC/BLE 근접 제시 프로토콜 구현 — Z Fold 8 eSE 활용 |
| W3C Verifiable Credentials + DID | Phase 0에서 선제 설계한 스키마를 정식 스펙에 맞춰 검증 |
| eIDAS 2.0 (EU Digital Identity Wallet) | 신뢰목록(Trust List) 상호운용 방식을 참고 모델로 채택 |

### 1.2 PKI 신뢰 구조
- 각국 발급기관 루트 인증서를 ICAO PKD(Public Key Directory)에 등록하는 절차는
  **국가의 몫**으로 남겨둔다 — 나비/오픈해시가 이를 대신 발급하지 않음
- 나비 지갑은 PKD에 등록된 루트만 신뢰하는 검증기(verifier) 역할

### 1.3 생체정보 국경 간 처리
- ZK(영지식증명) 방식 설계: "이 사람이 이 credential의 소유자임"만 증명, 생체정보 원본 미전송
- Knox Vault 내 로컬 생체인증(지문/얼굴)으로 credential 잠금 해제 — 분실 시에도 credential 노출 방지

### 1.4 대외 포지셔닝
- ICAO/eIDAS 워킹그룹 대상 "참조 구현체" 문서 작성 (기술 스펙 + 국내 실적 근거)
- 신규 프로토콜 제안이 아니라 기존 표준의 오픈소스 구현 사례로 제출

**Phase 1 완료 기준**: 최소 1개 국제표준(예: ISO 18013-5)에 대한 상호운용성 테스트 통과

---

## Phase 2 — 오픈해시 감사·투명성 레이어 통합

**목표**: 오픈해시 분산원장을 국가 시스템의 대체물이 아니라 **감사 로그**로만 통합한다.
신원정보 원본은 어떤 경우에도 오픈해시에 기록되지 않는다.

### 2.1 기록 대상 (해시만)
- 분실/도난 신고된 credential의 폐기(revocation) 이력
- 발급기관 루트키 교체/갱신 이력
- 신뢰목록(Trust List) 변경 이력

### 2.2 기록 방식
- 기존 PDV 원칙("서버는 평문을 못 읽는다")을 확장 적용
- K-서비스 소유 PDV의 가명화 해시 패턴(hash(userGuid+salt)) 재사용 검토 —
  단, 여권 폐기 이력은 실시간 전파가 핵심이므로 가명화보다 즉시성 우선 설계 필요

### 2.3 실시간 전파
- 국경 간 실시간 revocation 전파 — 어느 국가 검증기든 최신 폐기 상태를 즉시 조회 가능
- 오픈해시 노드 다운/지연 시에도 각국 로컬 시스템이 fallback 진실源(source of truth) 유지

**Phase 2 완료 기준**: 2개국 이상 검증기가 동일 revocation 이벤트를 오픈해시를 통해 실시간 확인

---

## 저장소 구조 제안

```
Openhash-Gopang/passport/
├── README.md
├── ROADMAP.md
├── docs/
│   ├── PHASE0_domestic-trust.md
│   ├── PHASE1_icao-eidas-conformance.md
│   └── PHASE2_openhash-audit-layer.md
├── schema/
│   └── credential-schema.json      # W3C VC 기반, Phase 1에서 DTC 매핑
├── client/                          # Z Fold 8 대상 지갑 UI/NFC 제시 로직
└── verifier-reference/              # 검증기 참조 구현
```

## 다음 액션 (제안)

Phase 0.1의 credential 스키마 설계부터 시작하는 것을 제안합니다 — 이후 모든 Phase가
이 스키마 위에 얹히므로, 초기에 W3C VC + DTC 매핑을 동시에 고려해 설계해두면
Phase 1에서의 재작업을 줄일 수 있습니다.
