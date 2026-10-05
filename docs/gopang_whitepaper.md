# 고팡 기술 백서 v1.0
## Gopang: An AI-Parallel World — Architecture, Governance & Infrastructure

> **작성:** AI City Inc. · 팀 주피터 (Team Jupiter)
> **발행일:** 2026년 6월
> **저장소:** https://github.com/orgs/Openhash-Gopang/repositories
> **포털:** https://hondi.net
> **문의:** tensor.city@gmail.com

---

## § 0. 한눈에 보는 고팡

고팡(Gopang)은 현실 세계의 AI 쌍둥이(AI Parallel World)입니다. 사용자가 말 한마디를 건네면 고팡의 AI 비서가 의도를 파악하고, 필요에 따라 전문 AI Agent를 호출하며, 모든 과정을 사용자 본인의 기기에 암호화 기록합니다. 외부 서버는 인덱스만 보관하므로 대규모 해킹의 표적이 존재하지 않습니다.

```
사용자 입력
    │
    ▼
고팡 AI 비서 (hondi.net)
    ├── 직접 처리 → 응답 + PDV 기록
    ├── 전문 Agent 호출 (GWP 라우터)
    │       └── 22개 도메인 Agent 중 매칭
    └── 웹 검색 → 응답 + PDV 기록
                        │
                        ▼
              OpenHash L1~L5 앵커링
              (위변조 원천 차단)
```

**핵심 수치 (2026년 6월 기준)**

| 항목 | 수치 |
|---|---|
| 처리 속도 (OpenHash 단일 노드) | 4,399 TPS |
| AI 비서 Fast-Path 응답 | 0.246ms |
| 에너지 소비 (기존 블록체인 대비) | –98.5% |
| 구현 완료 AI Agent | 22개 |
| 목표 Agent 수 | 50개 |
| 인증 레벨 | L0~L3 (4단계) |
| 오픈소스 라이선스 | GPL v3.0 |

---

## § 1. 철학과 비전 — "AI 평행 세계"

### 1-1. 문제 정의

현대의 디지털 서비스는 세 가지 구조적 결함을 갖습니다.

**첫째, 데이터 중앙화.** 모든 개인 정보가 거대 플랫폼의 서버에 집중됩니다. 해킹 한 번으로 수억 명의 데이터가 유출됩니다. 사용자는 자신의 데이터에 대한 실질적 통제권을 갖지 못합니다.

**둘째, 서비스 파편화.** 음식 주문, 택시 호출, 병원 예약, 세금 신고가 각기 다른 앱에서 이루어집니다. 이들 사이의 연결은 사용자 몫입니다. AI 시대에도 사람이 여전히 "중개자" 역할을 합니다.

**셋째, 거버넌스의 부재.** 플랫폼의 규칙은 소수 주주와 경영진이 결정합니다. 사용자는 약관 변경을 통보받을 뿐, 결정에 참여하지 못합니다.

### 1-2. 고팡의 답

고팡은 이 세 문제에 대해 하나의 통합된 답을 제시합니다.

- **데이터 주권 복원:** 모든 데이터는 사용자 본인의 기기(PDV)에 저장됩니다. 서버에는 검색을 위한 해시 인덱스만 존재합니다.
- **AI 통합 포털:** 사용자는 말 한마디로 모든 서비스를 호출합니다. AI 비서가 의도를 파악하고, 50개 전문 Agent 중 적절한 것을 자동으로 연결합니다.
- **민주적 자치:** 고팡은 주주도 임직원도 없습니다. 운영 비용은 수익자 부담 원칙으로 사용자가 분담하고, 시스템 변경은 DAWN(Democracy is All We Need) 투표로 결정합니다.

### 1-3. "AI 평행 세계"의 의미

고팡에서 모든 사람·기관·사물은 AI 쌍둥이(AI Twin)를 갖습니다. 사람에게는 AI 비서가, 식당에는 AI 점원이, 병원에는 AI 접수원이, 버스에는 AI 운전 보조가 배정됩니다. 이들이 서로 통신하며 현실 세계의 거래와 서비스를 자동화합니다. 인간은 의사결정만 합니다.

---

## § 2. 세 가지 시나리오로 보는 작동 원리

### 2-1. 음식 주문: "짜장면 두 그릇 주문해 줘"

```
사용자 (제주시 한림읍)
    │  "짜장면 두 그릇 주문해 줘"
    ▼
고팡 AI 비서
    ├── 의도 파악: 음식 주문 → K-Market Agent 호출
    │
    ▼
K-Market Agent (market.hondi.net)
    ├── GPS로 현재 위치 파악: 한림읍 금능남로 3
    ├── PDV에서 사용자 식성·선호도 조회
    ├── 등록 업체 중 거리순 + 평점순 중국 음식점 선정
    ├── 해당 업체 AI 점원에게 주문 전달
    │       └── 업체 AI: "짜장면 2그릇, 30분 후 배달"
    │
    ├── GPS 배달 좌표 전달
    ├── GDC 결제 (gdc.hondi.net)
    │       └── ₮24,000 자동 결제 (수수료 0%)
    │
    ├── 실시간 세금 정산 (tax.hondi.net)
    │       └── 부가세·소득세 자동 분리
    │
    ├── 배달 완료 후 사용자 리뷰 요청
    │       └── 별점 → 업체 평가에 반영
    │
    └── PDV 기록 (6하원칙)
            ├── 누가: 사용자 GUID
            ├── 언제: 2026-06-04T13:00:00Z
            ├── 어디서: 한림읍 금능남로 3
            ├── 무엇을: 짜장면 2그릇, ₮24,000
            ├── 어떻게: K-Market AI 자동 주문
            └── 왜: 식사

OpenHash L1 (이도1동 노드) → 앵커링 → 위변조 불가
```

### 2-2. 도시 이동: "내일 오전 9시 제주공항 가야 해"

```
사용자
    │  "내일 오전 9시 제주공항"
    ▼
고팡 AI 비서
    ├── K-Traffic Agent 호출 (traffic.hondi.net)
    │
    ▼
K-Traffic Agent
    ├── 현재 위치 + 목적지 분석
    ├── 고팡 앱 설치 운전자 이동 패턴 분석
    │       ├── 택시 (고팡 등록): ETA 8분, ₮12,000
    │       ├── 카풀 (A씨, 같은 방향): ₮5,000
    │       └── 버스 421번: 오전 8:20 출발
    │
    ├── 사용자 선택: 카풀
    │
    ├── K-Logistics Agent 연동 (logistics.hondi.net)
    │       └── 짐 배송 필요 시 자동 연결
    │
    ├── K-Insurance Agent 연동 (insurance.hondi.net)
    │       └── 탑승 중 자동 여행자 보험 적용
    │
    ├── 차량 내 고팡 블랙박스(스마트폰) 활성화
    │       └── K-Security 감시 (security.hondi.net)
    │               └── 범죄 감지 시 → K-Police 자동 연동
    │
    ├── 도착 후 GDC 자동 결제
    ├── K-Tax 실시간 정산
    └── 전 과정 PDV + OpenHash 앵커링
```

### 2-3. 응급 대응: 교통사고 발생

```
사고 감지 (고팡 블랙박스 또는 사용자 신고)
    │
    ▼
K-119 Agent (911.hondi.net)
    ├── 중증도 자동 분류: 1~4급
    ├── 출동번호 발급: FD-20260604-XXXX
    ├── Haversine 거리로 최근접 소방서·구급대 자동 배치
    ├── 응급처치 가이드 실시간 제공 (AI)
    ├── 가용 응급실 자동 매칭 + 환자 정보 사전 전송
    │
    ├── 범죄 연루 의심 시 → K-Police Agent 자동 연동
    │       └── 경찰 출동번호: KP-20260604-XXXX
    │
    ├── 사건 기록 → K-Law Agent (klaw.hondi.net)
    │       └── 법적 책임 소재 AI 분석 + 예상 판결
    │
    ├── 보험 처리 → K-Insurance (insurance.hondi.net)
    │       └── 자동 청구 서류 생성
    │
    └── 전 과정 PDV + OpenHash 앵커링
            (법적 증거 능력 확보)
```

---

## § 3. 포털 아키텍처 — hondi.net AI 비서

### 3-1. AI 비서의 3단계 판단 로직

사용자의 입력이 고팡에 도달하면 AI 비서는 세 단계를 순차적으로 수행합니다.

**Phase 0: 소통 객체 식별 (Q0.1~Q0.8)**
메시지의 수신자가 누구인지 확인합니다. 사용자 본인인지, 특정 기관인지, 사물인지를 판단합니다.

**Phase 1: Fast-Path 검사 (≤0.81ms)**
즉각 대응이 필요한 S3 위험 신호를 최우선으로 탐지합니다. 폭력·사기·의료 응급 키워드가 감지되면 K-Law·K-Police·K-119 Agent를 즉시 호출합니다. 실측 응답 시간은 0.246ms로 목표치의 3.3배를 초과 달성했습니다.

**Phase 2: GWP 라우터 매칭**
`gwp-registry.js`의 트리거 키워드와 사용자 입력을 대조합니다. 매칭된 Agent를 priority 순으로 정렬하여 최적 Agent를 선택합니다.

**Phase 3: 직접 처리 또는 웹 검색**
등록된 Agent가 없는 요청은 AI 비서가 직접 처리하거나, 실시간 웹 검색으로 답변합니다. 이 경우에도 PDV 기록은 동일하게 수행됩니다.

```
사용자 입력
    │
    ▼ Phase 0
소통 객체 식별 (Q0.1~Q0.8)
    │
    ▼ Phase 1 (≤0.246ms 실측)
Fast-Path: S3 위험 신호?
    ├── YES → K-Law / K-Police / K-119 즉시 호출
    └── NO  → Phase 2
    │
    ▼ Phase 2
gwp-registry.js 트리거 매칭
    ├── 매칭 → GWP Agent 호출 (window.open + postMessage)
    └── 미매칭 → Phase 3
    │
    ▼ Phase 3
AI 직접 처리 or 웹 검색
    │
    ▼
PDV 6하원칙 기록 + OpenHash 앵커링
```

### 3-2. GWP 라우터와 레지스트리

GWP(Gopang Widget Protocol)는 고팡 포털과 전문 Agent 사이의 표준 통신 규약입니다.

**gwp-registry.js 구조:**

```javascript
// 각 Agent는 스스로 "나는 이런 요청을 처리합니다"를 등록
{
  id:          'kemergency',   // 서비스 고유 ID
  name:        'K-119',
  category:    'EMG',          // 긴급·재난
  url:         'https://911.hondi.net/webapp.html',
  minAuth:     'L0',           // 최소 인증 레벨
  priority:    0,              // 0 = 최최우선 (긴급)
  triggers:    ['화재', '심정지', '교통사고', '119', ...],
}
```

**Agent 호출 흐름 (v2.1):**

```
고팡 (hondi.net)                Agent webapp
─────────────────                ─────────────
gwpLaunch(svc, ctx, extra)
  └─ window.open(url?gwp=1)  →  새 탭 로드
  └─ 결과 대기                  GopangWidget 초기화
                                작업 처리
                                gwp.done({ summary, pdvData })
                                  └─ window.opener.postMessage
_onGwpMessage(e)  ←──────────────
  └─ PDV 기록
  └─ 완료 버블 출력
  └─ 탭 닫기
```

cross-origin 통신 문제(hondi.net vs *.hondi.net)를 `window.opener.postMessage`로 해결하여 중계 서버 없이 수십 개 Agent를 연결합니다.

### 3-3. 시스템 프롬프트 계층 구조

```
SP-00-ROUTER.txt     ← 1단계: 의도 파악·라우팅
SP-00_v9.0.txt       ← 2단계: 고팡 AI 비서 본체
    │
    ├── SP-KPOLICE.txt    ← K-Police 전문 프롬프트
    ├── SP-K119.txt       ← K-119 전문 프롬프트
    ├── SP-KLAW.txt       ← K-Law v15.1 판결 예측
    ├── SP-GDC.txt        ← GDC 금융 프롬프트
    └── ... (Agent별 전용 SP)
```

모든 프롬프트 파일은 오픈소스로 공개됩니다. AI 비서의 판단 기준이 투명하게 공개되므로 블랙박스 AI와 달리 사용자가 시스템의 동작 원리를 검증할 수 있습니다.

---

## § 4. AI Agent 생태계 (22개 저장소)

### 4-1. 생태계 연관 다이어그램

```
                    ┌─────────────────────┐
                    │    hondi.net        │
                    │    AI 비서 포털      │
                    └──────────┬──────────┘
                               │ GWP 라우터
           ┌───────────────────┼───────────────────┐
           │                   │                   │
    ┌──────▼──────┐    ┌───────▼──────┐    ┌──────▼──────┐
    │  EMG / JUS  │    │  ECO / GOV   │    │MED/EDU/MKT  │
    │  긴급·사법  │    │  경제·행정   │    │의료·교육·시장│
    └──────┬──────┘    └───────┬──────┘    └──────┬──────┘
           │                   │                   │
   911  police               gdc  tax           health school
   klaw security           stock insurance       market
   democracy public        traffic logistics
           │                   │                   │
           └───────────────────┼───────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   OpenHash L1~L5     │
                    │   분산 원장 네트워크  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   사용자 PDV         │
                    │   (로컬 기기 저장)   │
                    └─────────────────────┘
```

### 4-2. 긴급·안전 Agent (EMG / JUS)

**K-119 — 응급출동 (911.hondi.net)**
화재·구조·구급·자연재해·화학사고 전 유형에 대응하는 AI 구조대원 시스템. 신고 즉시 중증도 1~4급을 자동 분류하고 출동번호(FD-)를 발급합니다. Haversine 거리 계산으로 전국 소방서·구급대를 최적 배치하고, 구급차·헬기·AV 차량에 WebSocket으로 직접 목적지를 전달합니다. 응급처치 가이드를 실시간으로 제공하며 수용 가능한 응급실을 자동 연결합니다.

**K-Police — 치안 (police.hondi.net)**
모든 시민·기관·사물에 전담 AI 경찰관을 배정하는 치안 서비스. GPS·일정·채팅을 종합 분석하여 위험을 사전 감지하고, 신고 즉시 사건번호(KP-)를 발급합니다. 범죄 유형이 확인되면 형사소송 패키지를 자동 생성하고 K-Law 시스템과 연동합니다. 자율주행 이송차량(AV)에 WebSocket으로 출동 명령을 직접 전달합니다.

**K-Law — 법률 AI (klaw.hondi.net)**
고팡의 모든 대화를 백그라운드에서 모니터링하여 법적 리스크를 감지합니다. 이중 역할을 수행합니다. 첫째, 30초 쿨다운 간격으로 모든 대화를 경량 프롬프트로 분석하여 불법·편법 행위를 탐지하고 즉각 경고합니다. 둘째, 사용자 요청 시 전문 판결 예측 서비스(K-Law v15.1)를 제공합니다. 193개국 법률 체계를 지원합니다.

**K-Security — 보안 (security.hondi.net)**
디지털 및 물리적 보안 위협을 통합 감시합니다. CCTV·스마트 잠금장치·차량 블랙박스의 이상 접근을 실시간 감지하고, 해킹·랜섬웨어 피해 시 즉각 대응합니다. K-Police와 자동 연동됩니다.

**K-Democracy — 입법·정책 (democracy.hondi.net)**
고팡 시스템의 변경 사항을 DAWN 투표로 결정하는 민주적 거버넌스 플랫폼. GDC 1단위 이상 보유자는 1인 1표의 투표권을 행사합니다.

### 4-3. 경제·금융 Agent (ECO)

**GDC — 글로벌 디지털 통화 (gdc.hondi.net)**
고팡 생태계의 결제 인프라. 1₮(T) = KRW 1,000원을 기준가로 하며, 사용자가 국적 통화를 입금하는 순간 해당 금액만큼 GDC가 즉시 발행됩니다. 사전 발행이나 중앙 채굴이 없습니다. 193개국 국적 통화를 POOL에 통합하여 수수료 없이 0.1초 내 환전합니다. 각국 POOL 자산은 해당 국가의 Index 증권에 투자되며, 수익은 즉시 GDC 가치에 반영됩니다.

**K-Tax — 세무 (tax.hondi.net)**
모든 거래에서 세금을 실시간 자동 정산합니다. 부가세·소득세·법인세를 거래 즉시 분리하여 국세청 시스템과 연동합니다. 연말정산, 종합소득세 신고가 자동 완료됩니다.

**K-Stock — 투자 (stock.hondi.net)**
GDC POOL 자산의 투자 현황을 관리합니다. 사용자별 위험 성향에 맞는 포트폴리오를 AI가 추천하고 자동 리밸런싱합니다.

**K-Insurance — 보험 (insurance.hondi.net)**
상황 기반 자동 보험 시스템. 카풀 탑승, 해외 여행, 스포츠 활동 등 상황을 감지하여 적합한 보험을 자동 적용하고, 사고 발생 시 청구 서류를 자동 생성합니다.

### 4-4. 사회·인프라 Agent (GOV / TRN)

**K-Public — 행정 (public.hondi.net)**
전국 228개 정부 기관 서비스를 통합합니다. 각종 증명서 발급, 민원 신청, 보조금 조회를 AI 비서 한 마디로 처리합니다.

**K-Traffic — 교통 (traffic.hondi.net)**
고팡 앱을 설치한 운전자의 실시간 이동 패턴을 분석하여 최적 이동 수단을 조합합니다. 택시·카풀·버스·자율주행 차량을 통합 관리하며, 탑승 완료 후 GDC로 자동 결제합니다.

**K-Logistics — 물류 (logistics.hondi.net)**
소화물·화물·음식 배달을 통합하는 물류 플랫폼. K-Traffic과 연동하여 빈 차량을 물류에 활용합니다.

### 4-5. 생활 서비스 Agent (MED / EDU / MKT)

**K-Health — 의료 (health.hondi.net)**
사용자의 건강 데이터(PDV 저장)를 기반으로 AI 주치의 서비스를 제공합니다. 증상 분석, 병원 예약, 약 복용 관리를 통합합니다. 응급 상황 감지 시 K-119와 자동 연동합니다.

**K-School — 교육 (school.hondi.net)**
AI 개인 교사 시스템. 사용자의 학습 수준과 목표를 PDV에서 분석하여 맞춤 커리큘럼을 생성합니다. T2~T7 테스트를 전체 통과한 검증된 시스템입니다.

**K-Market — 시장 (market.hondi.net)**
전 세계 모든 시장을 통합하는 AI 쌍둥이 마켓플레이스. 음식 주문, 제품 구매, 서비스 예약을 자연어로 처리합니다. 등록 업체는 AI 점원(AI Twin)을 배정받습니다.

### 4-6. OpenHash 인프라 노드

OpenHash 분산 원장 네트워크는 5계층 노드로 구성됩니다. 현재 제주도 시범 운영 중입니다.

| 저장소 | 계층 | 역할 | 관할 |
|---|---|---|---|
| openhash-L1-ido1 | L1 (읍면동) | 실제 사용자 인덱스·메시지 큐 | 제주시 이도1동 |
| openhash-L2-jeju-city | L2 (시군구) | 시군구 라우팅 테이블 | 제주시 전체 |
| openhash-L3-jeju | L3 (광역) | 광역 해시체인 노드 | 제주특별자치도 |
| openhash-L4-kr | L4 (국가) | 국가 루트 원장 | 대한민국 |
| openhash-L5-global | L5 (글로벌) | 글로벌 앵커 노드 | 전 세계 |

---

## § 5. 데이터 주권 — PDV (Private Data Vault)

### 5-1. 로컬 저장 원칙

PDV는 사용자 기기(스마트폰·컴퓨터)에 암호화 저장되는 개인 데이터 금고입니다. 고팡 서버에는 다음만 존재합니다.

- OpenHash 해시 인덱스 (데이터 자체가 아닌 지문)
- GWP 라우팅 테이블 (어떤 서비스를 어떻게 호출하는지)
- PDV 6하원칙 요약 (Supabase — 시뮬레이션 백업용)

따라서 고팡 서버가 해킹되더라도 실제 개인 데이터는 유출되지 않습니다. 해커가 얻을 수 있는 것은 SHA-256 해시값뿐이며, 이로부터 원본 데이터를 역산하는 것은 현재 컴퓨팅 기술로 불가능합니다.

### 5-2. 6하원칙 구조

PDV의 모든 기록은 6하원칙(5W1H)을 따릅니다.

```json
{
  "svc":  "market",
  "type": "transaction",
  "who":  {
    "ipv6":       "2601:db80:bd05:...",
    "role":       "user",
    "level":      "L0",
    "recipients": ["gopang-pdv"]
  },
  "when":  {
    "period_start": "2026-06-04T13:00:00Z",
    "period_end":   "2026-06-04T13:30:00Z"
  },
  "where": { "svc_url": "https://market.hondi.net/webapp.html" },
  "what":  { "summary": "짜장면 2그릇 주문, ₮24,000 결제" },
  "how":   { "method": "K-Market AI 자동 주문" },
  "why":   { "goal": "식사" }
}
```

이 구조는 법적 증거 능력을 갖추기 위해 설계됐습니다. K-Law가 분쟁 발생 시 PDV 기록에서 6하원칙을 추출하여 법원 제출용 문서를 자동 생성합니다.

### 5-3. 대규모 해킹 원천 차단 메커니즘

기존 중앙화 서비스에서 해킹이 가능한 이유는 "가치 있는 데이터가 한 곳에 집중"되기 때문입니다. 고팡은 이 전제 자체를 제거합니다.

```
기존 구조:
  사용자 100만 명 → 중앙 서버 (1개) → 해킹 1회 = 100만 명 피해

고팡 구조:
  사용자 100만 명 → 각자 기기 (100만 개) → 해킹 1회 = 1명 피해
                         │
                    OpenHash 해시 인덱스만
                    공유 네트워크에 존재
```

추가로, PDV 데이터는 사용자의 ECDSA 공개키로 암호화됩니다. 개인키 없이는 복호화가 불가능합니다. 고팡 팀조차 사용자의 PDV 내용을 열람할 수 없습니다.

---

## § 6. 위변조 불가 원장 — OpenHash

### 6-1. 5계층 구조 (L1~L5)

OpenHash는 SHA-256 기반 확률론적 계층 분산원장입니다. 기존 블록체인의 에너지 낭비 문제(모든 노드가 모든 거래를 검증)를 해결하기 위해, 거래마다 확률적으로 하나의 노드를 선택합니다.

```
L5: 글로벌 노드 (19개 이상 독립 운영 주체)
 │   확률: 4%  (960~999)
L4: 국가 노드 (최소 13개 독립 기관)
 │   확률: 6%  (900~959)
L3: 광역 노드 (16개 광역시도)  # 2026-07-20 정정: 2026-07-01 전남·광주 통합으로 17→16개
 │   확률: 10% (800~899)
L2: 시군구 노드 (226개)
 │   확률: 20% (600~799)
L1: 읍면동 노드 (~3,500개 × 이중화 = 7,000)
     확률: 60% (0~599)
```

대부분의 거래(60%)는 L1 로컬 노드에서 처리되므로 지연 시간이 최소화됩니다. 전국 단위 거래만 상위 계층으로 전파됩니다.

### 6-2. PLSM — 확률적 계층 선택 메커니즘

```
거래 해시 = SHA-256(거래 데이터)
선택 값 = BigInt(해시) mod 1000

선택 값 0~599   → L1 노드 (60%)
선택 값 600~799  → L2 노드 (20%)
선택 값 800~899  → L3 노드 (10%)
선택 값 900~959  → L4 노드 (6%)
선택 값 960~999  → L5 노드 (4%)
```

이 메커니즘은 결정론적(Deterministic)이면서 예측 불가(Unpredictable)합니다. 거래 해시가 정해지면 어느 계층이 선택될지 확정되지만, 사전에 특정 계층을 유도하려면 해시 역산이 필요합니다.

### 6-3. BIVM — 잔액 불변성 검증

BIVM(Balance Invariant Verification Module)은 Σδ=0 원칙을 모든 거래에 적용합니다. 모든 출금의 합은 모든 입금의 합과 같아야 합니다. 이 조건을 위반하는 거래는 네트워크에서 자동 거부됩니다.

```
Σ(모든 출금) = Σ(모든 입금)
     │
     └── 위반 시: 거래 무효 + 위반 노드 슬래싱
```

### 6-4. ILMV — 양방향 계층 검증

ILMV(Integrated Layer Monitoring and Verification)는 상향(L1→L5)과 하향(L5→L1) 감사를 동시에 수행합니다.

- **하향 감사:** L5가 하위 계층의 데이터 무결성을 주기적으로 검증합니다.
- **상향 모니터링:** L1 노드의 이상 행동을 상위 계층이 실시간 감지합니다.
- **교차 검증:** 동일 계층의 이웃 노드끼리 서로의 데이터를 교차 검증합니다.

### 6-5. 성능

| 지표 | 수치 |
|---|---|
| 단일 노드 TPS | 4,399 TPS |
| L1 평균 지연 | 0.228ms |
| LPBFT 합의 (L1, 4노드) | ≤0.759ms |
| 에너지 소비 (비트코인 대비) | –98.5% |
| AI 비서 Fast-Path | 0.246ms (목표 0.81ms 대비 3.3배) |

---

## § 7. 인증 시스템 — 인증없는 인증

> **v2.0 갱신 (2026-06-16):** Ed25519 서명 메커니즘, 키페어 저장 구조,
> TOFU 설계, 실제 구현 과정에서 발견된 오류 분석 및 해결 방안 추가.

### 7-1. 설계 철학

고팡의 인증 시스템은 "로그인 없이 인증"합니다. 사용자는 아이디와 비밀번호를 기억할 필요가 없습니다. 기기 자체가 신원입니다.

### 7-2. 인증 4단계 (L0~L3)

```
L0: 기기 자동 인식 (IPv6 + 기기 지문)
    │ 일반 조회, AI 상담, 시장 이용
    │ → 로그인 버튼조차 없음. 접속 즉시 인증 완료.

L1: L0 + 얼굴 인증 (Face ID)
    │ 신고 접수, 법률 자문, 고액 결제
    │ → 스마트폰 카메라로 0.3초

L2: L1 + 지문 인증 (WebAuthn)
    │ 진료 기록 열람, 금융 거래, 기밀 문서
    │ → ECDSA 서명 기반. 서버에 지문 저장 없음.

L3: L2 + 4단어 시드 (사람만 아는 기억)
    │ 계정 복원, 최고 보안, 고팡 거버넌스 투표
    │ → "정의의 물결 넘치는 꿈" 같은 4단어
```

### 7-3. SSO 흐름 (subsystem-auth.js)

모든 하위 시스템은 `</body>` 직전에 단 한 줄을 추가합니다.

```html
<script type="module" src="https://hondi.net/auth/subsystem-auth.js"></script>
```

이 한 줄이 삽입되면:

```
1. subsystem-auth.js 로드
2. 경로2A: gopang_token 쿠키 확인 → 유효 → 즉시 인증 완료
3. 경로2B: Silent iframe → hondi.net에서 쿠키 확인
4. 경로3: 신규 기기 → hondi.net 로그인 페이지 리다이렉트
5. 인증 완료 → window._onGopangAuth(user) 콜백 호출
      user.ipv6  : 사용자 GUID
      user.level : 인증 레벨 (L0~L3)
      user.via   : 인증 경로 (session/iframe/gwp)
```

개발자는 `window._onGopangAuth` 콜백 하나만 구현하면 됩니다. 인증 로직 전체가 추상화됩니다.

### 7-4. WebAuthn 지문 인증 (L2)

서버에 지문 데이터가 저장되지 않습니다. FIDO2/WebAuthn 표준을 따릅니다.

```
등록:
  기기 → 공개키/개인키 쌍 생성 (ECDSA)
  개인키: 기기 보안 칩에 저장 (절대 외부 전송 없음)
  공개키: Supabase webauthn_credentials 테이블에 저장

인증:
  서버 → 챌린지(랜덤 32바이트) 전송
  기기 → 개인키로 챌린지 서명
  서버 → 공개키로 서명 검증 → 성공 시 L2 인증 완료
```

### 7-5. 4단어 시드 (L3)

한국어 어휘 목록에서 무작위로 선택된 4단어 조합입니다. 사용자만 알고, 어디에도 저장되지 않습니다. 기기를 잃어버렸을 때 계정을 복원하는 유일한 수단입니다.

```
가능한 조합 수: 50,000^4 = 6.25 × 10^18
무작위 추측 성공 확률: 사실상 0
예시: "정의의 물결 넘치는 꿈"
```

---

### 7-6. Ed25519 서명 메커니즘 — 프로필 인증

프로필 등록·수정 시 서버는 Ed25519 전자서명으로 요청자가 실제 기기 소유자임을 검증합니다. 비밀번호나 세션 토큰 없이 암호학적으로 신원을 증명하는 방식입니다.

#### 7-6-1. 키페어 생성 및 저장 구조

```
GopangWallet.create()
    │
    ▼
Web Crypto API
  crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign','verify'])
    │
    ├── 공개키 (32바이트 raw) → Base64URL 인코딩
    │     저장 위치 1: IndexedDB  'gopang-wallet' DB → 'keys' store → 'ed25519-main'
    │     저장 위치 2: localStorage 'gopang_wallet_pubkey' (빠른 조회용 사본)
    │     저장 위치 3: Supabase user_profiles.pubkey_ed25519 (서버 검증용)
    │
    └── 개인키 (CryptoKey 객체)
          AES-256-GCM 암호화 후 저장
          암호화 키 유도: PBKDF2(기기 고유 entropy + salt 16바이트)
          저장 포맷: salt(16B) + IV(12B) + ciphertext
          저장 위치: IndexedDB 'gopang-wallet' DB → 'keys' store → 'ed25519-main'
          ※ 개인키는 절대 서버로 전송되지 않음
```

| 항목 | 저장 위치 | 형식 | 서버 전송 |
|------|----------|------|----------|
| 개인키 | IndexedDB (AES-256-GCM 암호화) | 바이너리 | ❌ 절대 불가 |
| 공개키 | IndexedDB + localStorage | Base64URL | ✅ 등록 1회 |
| 공개키 (서버) | Supabase user_profiles | Base64URL | — |

#### 7-6-2. 서명 및 검증 흐름

```
[클라이언트 — register-profile.html]

1. wallet._privKey (IndexedDB에서 복호화된 CryptoKey)
2. ts = Date.now().toString()          ← 타임스탬프 (재전송 공격 방지)
3. sigMsg = `${guid}:${pubkey}:${ts}` ← 고정 문자열 (JSON 직렬화 배제)
4. sigBuf = crypto.subtle.sign('Ed25519', privKey, TextEncoder(sigMsg))
5. signature = Base64URL(sigBuf)       ← 86자

POST /profile
  { guid, pubkey, signature, ts, entity_type, name, ... }

─────────────────────────────────────────────────────────

[서버 — Cloudflare Worker]

1. body에서 guid, pubkey, signature, ts 추출
2. sigMsg = `${guid}:${pubkey}:${ts}` ← 클라이언트와 동일
3. pubKeyBytes = Base64URL_decode(pubkey)
4. cryptoKey = importKey('raw', pubKeyBytes, 'Ed25519', ['verify'])
5. ok = crypto.subtle.verify('Ed25519', cryptoKey, sig, TextEncoder(sigMsg))
6. ok === false → 401 INVALID_SIGNATURE
   ok === true  → 프로필 저장 진행
```

#### 7-6-3. 서명 대상을 고정 문자열로 설계한 이유

초기 설계에서는 `JSON.stringify(body without signature)`를 서명 대상으로 사용했습니다. 이론상 클라이언트와 서버가 동일한 JSON을 생성해야 하지만 실제로는 다음 문제가 발생합니다.

```
문제 1 — JSON 키 순서 불일치
  클라이언트: Object.assign()으로 필드를 동적 추가
  서버: request.json() 파싱 순서
  → 브라우저/엔진마다 키 순서가 다를 수 있음

문제 2 — undefined vs null
  JS: JSON.stringify({a: undefined}) → {} (키 제외)
  JS: JSON.stringify({a: null})      → {"a":null} (키 포함)
  → 클라이언트가 undefined로 둔 필드가 서버에서 null로 파싱되면 불일치

문제 3 — 중첩 객체 직렬화
  visibility, hours, custom_fields 등 복잡한 중첩 구조
  → 동일 객체도 직렬화 순서에 따라 다른 문자열 생성 가능
```

**해결:** 서명 대상을 `guid:pubkey:ts` 3개 필드의 단순 문자열 연결로 고정합니다. JSON 직렬화가 전혀 없으므로 어떤 환경에서도 동일한 문자열이 보장됩니다.

```
서명 대상: "2601:db80:...:KY9OLQ...:1749999999999"
           ←─ guid ─→  ←─ pubkey ─→ ←── ts ──→
```

#### 7-6-4. TOFU (Trust On First Use)

TOFU는 최초 등록 시 신뢰를 확립하는 메커니즘입니다.

```
신규 사용자 (DB에 pubkey 없음):
  서명 검증 통과 → pubkey를 DB에 등록 → 신뢰 확립

기존 사용자 (DB에 pubkey 있음):
  서명 검증 통과 → pubkey 갱신 허용
  ※ guid(전화번호 기반 IPv6)가 동일 + 새 privKey로 서명 검증 통과
    = 전화번호 소유 + 기기 소유 동시 증명 → 본인 확인으로 충분
```

**TOFU를 엄격하게 유지하지 않는 이유:** 사용자가 새 기기나 새 브라우저에서 접속하면 IndexedDB가 초기화되어 새 키페어가 생성됩니다. 이때 DB의 이전 pubkey와 불일치가 발생하는데, 이를 무조건 차단하면 정상 사용자가 프로필을 수정할 수 없게 됩니다. guid(전화번호 기반)의 일치 + 서명 검증 통과로 본인 확인이 충분히 이루어지므로 pubkey 갱신을 허용합니다.

#### 7-6-5. 실제 구현에서 발견된 오류와 해결

**오류 1 — gopang-wallet.js 동명 메서드 덮어쓰기**

`GopangWallet` 클래스에 `sign()` 메서드가 두 개 정의되어 있었습니다.

```javascript
class GopangWallet {
  // 메서드 A (488번 줄): 단순 Ed25519 서명 → Base64URL 반환
  async sign(payload) {
    return sign(this._privKey, payload);
  }

  // 메서드 B (590번 줄): UTXO TX 서명 → 객체 반환 (A를 덮어씀!)
  async sign(rawTx) {
    return { tx, tx_hash, buyer_sig, buyer_public_key, prev_settle_hash };
  }
}
```

JS 클래스에서 동명 메서드는 나중에 정의된 것이 앞의 것을 덮어씁니다. 따라서 `wallet.sign(sigMsg)`를 호출하면 메서드 B가 실행되어 문자열 대신 객체를 반환하고, Worker에서 Base64URL 파싱에 실패해 401이 발생했습니다.

**해결:** `wallet.sign()` 대신 `crypto.subtle.sign()`을 직접 호출합니다.

```javascript
// 수정 전 (오류)
payload.signature = await wallet.sign(sigMsg);
// → wallet.sign()이 UTXO 메서드에 덮어쓰여 객체 반환
// → payload.signature = {tx: ..., buyer_sig: ...}  ← 문자열 아님
// → Worker Base64URL 파싱 실패 → 401

// 수정 후 (정상)
const sigBuf = await crypto.subtle.sign(
  'Ed25519', wallet._privKey, new TextEncoder().encode(sigMsg)
);
payload.signature = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
// → 86자 Base64URL 문자열 → Worker 검증 통과 → 200
```

**오류 2 — Cloudflare Worker 자동 배포 미지원**

GitHub에 `worker.js`를 push해도 Cloudflare Worker에 자동 배포되지 않습니다. GitHub Actions CI/CD를 별도로 구성하거나 `wrangler deploy` 명령어로 수동 배포해야 합니다.

```powershell
# Cloudflare Worker 수동 배포
npx wrangler deploy worker.js --name gopang-proxy
```

**오류 3 — gopang-app.js _boot() 중단으로 인한 연쇄 오류**

`webapp.html`에 `status-text`, `status-dot` 요소가 없는 상태에서 `_boot()` catch 블록이 해당 요소에 접근하면 `TypeError`가 발생해 `_boot()`가 완전히 중단됩니다. 이로 인해 이후에 실행될 `window.closeAISettings`, `window.openSettings`, `window.openMyProfile` 등 모든 전역 함수 노출이 누락됩니다.

```javascript
// 수정 전 (오류)
} catch(e) {
  document.getElementById('status-text').textContent = '오프라인 모드'; // null → TypeError
  document.getElementById('status-dot').style.background = 'var(--yellow)';
}
// → _boot() 중단 → 전역 함수 미노출 → AI 패널 닫힘 불가, 설정 버튼 동작 안함

// 수정 후 (정상)
} catch(e) {
  const st = document.getElementById('status-text');
  const sd = document.getElementById('status-dot');
  if (st) st.textContent = '오프라인 모드';
  if (sd) sd.style.background = 'var(--yellow)';
}
```

**오류 4 — AI 활성화 팝업 외부 클릭 닫힘 누락**

`toggle.js`의 `_showAISetupPopup()`이 동적으로 생성하는 `ai-setup-overlay`에 외부 클릭 이벤트가 없었습니다. 이 팝업은 `ai-settings-overlay`(설정 패널)나 `ai-overlay`(AI 카드)와 전혀 다른 별도 요소입니다.

```javascript
// 수정: appendChild 직후 외부 클릭 이벤트 등록
document.body.appendChild(ov);
ov.addEventListener('click', (e) => {
  const sheet = ov.querySelector('div');
  if (sheet && !sheet.contains(e.target)) ov.remove();
});
```

---

## § 8. 법적 감시 — K-Law 상시 모니터

### 8-1. 이중 역할

K-Law는 두 가지 모드로 동작합니다.

**모드 1: 백그라운드 감시 (자동)**
고팡의 모든 대화를 30초 쿨다운 간격으로 경량 프롬프트(`monitor_prompt.txt`)로 분석합니다. 불법·편법·사기·계약 위반 가능성이 감지되면 즉각 경고 메시지를 출력합니다. 사용자가 요청하지 않아도 자동으로 수행됩니다.

```
모든 고팡 대화
    │ (30초 쿨다운)
    ▼
K-Law 경량 모니터 (monitor_prompt.txt)
    ├── 안전 → 대화 계속
    └── 위험 감지
            ├── S1 경미 → 노란 경고 배너
            ├── S2 주의 → 법적 리스크 팝업
            └── S3 즉각 → K-Police/K-119 자동 호출
```

**모드 2: 판결 예측 서비스 (요청 시)**
사용자가 법률 분쟁을 입력하면 K-Law v15.1이 다음을 수행합니다.

- 관련 법조문 자동 검색 (193개국)
- 유사 판례 매칭
- 승소 확률 계산
- 예상 판결문 초안 생성
- 소송 패키지 자동 완성 (K-Police 신고서 연동)

### 8-2. 예방적 법률 시스템 (Preventive Jurisprudence)

고팡의 법철학은 "사후 처벌"이 아닌 "사전 예방"입니다. PDV가 모든 통신과 거래를 6하원칙으로 기록하므로, 분쟁 발생 시 누가 무엇을 했는지 즉시 확인할 수 있습니다. 이 투명성이 불법 행위 자체를 억제합니다.

```
전통 법률 시스템:
  분쟁 발생 → 증거 수집 (어려움) → 재판 → 판결 → 집행

고팡 법률 시스템:
  모든 거래 PDV 기록 → 분쟁 발생 → 증거 자동 추출 → K-Law 판결 예측
                                                              │
                                              90%: 대화로 해결
                                               9%: K-Law 조정
                                               1%: 실제 소송
```

---

## § 9. 안전망 — K-Police · K-119

### 9-1. 통합 안전망 아키텍처

K-Police(치안)와 K-119(응급)는 별개의 시스템이지만, 사건 유형에 따라 자동으로 협력합니다.

```
사건 발생
    │
    ├── 의료 응급 → K-119 주도, K-Police 보조
    ├── 범죄 현장 → K-Police 주도, K-119 보조
    ├── 교통사고 → K-119 + K-Police 동시 출동
    └── 재난 (화재·홍수) → K-119 주도, K-Police 현장 통제
```

### 9-2. PDV 기반 증거 보존

K-Police와 K-119가 처리하는 모든 사건은 PDV에 기록되고 OpenHash에 앵커링됩니다. 이 기록은 다음 특성을 가집니다.

- **불변성:** 앵커링 후 수정·삭제 불가
- **자기완결성:** PDV 기록 + OpenHash 앵커 ref + 삼중 서명으로 법원 증거 제출 가능
- **프라이버시:** 사용자 본인만 열람 가능. 법원 명령 시에만 해시로 진위 확인

```
증거 패키지 3요소:
  1. PDV 암호화 기록 (vault.js)
  2. OpenHash 앵커 참조값 (hashChain.js)
  3. 삼중 서명: 사용자 서명 + AI 에이전트 서명 + OpenHash 참조
```

---

## § 10. 화폐·금융 인프라 — GDC & SEOM

### 10-1. GDC 발행 메커니즘

GDC(Global Digital Currency, 기호: ₮)는 요구불 발행(On-demand Issuance) 방식입니다. 사전 채굴도, 중앙 발행도 없습니다.

```
사용자가 KRW 10,000원을 입금하는 순간
    │
    ▼
교환비: ₮1 = KRW 1,000
    │
    ▼
₮10 즉시 발행 → 사용자 계좌로 귀속
    │
    ▼
KRW 10,000 → 한국 주요 은행 계좌 → 한국 KOSPI Index ETF 투자
    │
    ▼
투자 수익 → GDC 가치 상승
    │
    ▼
사용자가 출금 요청 → ₮10 소각 → KRW + 수익 반환
```

### 10-2. FIAT POOL 구조

193개국의 국적 통화가 각국 POOL에 분산 보관됩니다. 환전은 POOL 간 이동이므로 별도 환전 수수료가 없고 0.1초 내에 완료됩니다.

```
KRW POOL (한국 은행 계좌)  ←→  ₮  ←→  USD POOL (미국 은행 계좌)
JPY POOL (일본 은행 계좌)  ←→  ₮  ←→  EUR POOL (유럽 은행 계좌)
                         ... (193개국)
```

### 10-3. SEOM (Sovereign Equity OpenHash Market)

SEOM은 OpenHash 네트워크 참여자에게 지급되는 보상 단위입니다. L1 노드 운영자, 검증자, 권역 DB 운영자가 SEOM을 획득합니다. SEOM은 GDC 생태계 내에서 수수료 지불과 거버넌스 투표에 활용됩니다.

---

## § 11. 거버넌스 — 비영리·오픈소스·DAWN 민주주의

### 11-1. 주주 없는 시스템

고팡에는 주주·임직원·이사회가 없습니다. 법인 자체가 존재하지 않습니다. 시스템이 곧 조직입니다.

```
전통 기업:
  주주 → 이사회 → CEO → 직원 → 서비스 → 사용자

고팡:
  사용자 = 운영자 = 수혜자
    │
    └── DAWN 투표로 시스템 규칙 변경
    └── OpenHash 노드 운영으로 인프라 유지
    └── 수익자 부담으로 비용 분담
```

### 11-2. 수익자 부담 원칙

고팡의 운영 비용은 서비스를 이용하는 사람들이 분담합니다. 거래 수수료(극소)와 API 사용료가 운영 비용을 충당합니다. 외부 투자자에 대한 수익 배당이 없으므로, 수수료는 최소화됩니다.

```
수익 구조:
  거래 수수료 (₮0.001/건) → 인프라 유지
  API 수수료 (외부 개발자) → 개발 보상
  OpenHash 스테이킹 이자 → 노드 운영자 보상

비용 구조:
  Cloudflare Worker 서버비 (월 $X)
  Supabase 데이터베이스 (월 $X)
  도메인·SSL (연 $X)
  → 전액 수익자 부담으로 자동 충당
```

### 11-3. DAWN 투표 메커니즘

DAWN(Democracy is All We Need)은 고팡의 민주적 의사결정 시스템입니다.

```
시스템 변경 제안 (누구나 가능)
    │
    ▼
K-Democracy (democracy.hondi.net)에 등록
    │
    ▼
공개 토론 기간 (7일)
    │
    ▼
투표 (14일)
    │
    ├── GDC ≥1 단위 보유자: 1인 1표
    ├── OpenHash L1 노드 운영자: 1노드 1표
    └── 비영리 단체 DAWN: 강제 거부권 (반민주적 변경 차단)
    │
    ▼
2/3 이상 찬성 → 자동 적용
    │
    ▼
변경 사항 OpenHash에 앵커링 (영구 기록)
```

### 11-4. 오픈소스 투명성

고팡의 모든 소스코드는 GPL v3.0 라이선스로 공개됩니다.

```
github.com/Openhash-Gopang
    ├── gopang_v2/     ← 포털 전체 소스
    ├── 911/           ← K-119 전체 소스
    ├── police/        ← K-Police 전체 소스
    ├── gdc/           ← GDC 전체 소스
    ├── klaw/          ← K-Law 전체 소스
    └── ... (22개 저장소 전부)
```

AI 시스템 프롬프트(SP 파일)도 공개됩니다. 사용자는 AI 비서가 어떤 기준으로 판단하는지 직접 확인하고 검증할 수 있습니다. 불투명한 AI 블랙박스를 거부합니다.

---

## § 12. 보안 모델 종합

### 12-1. 계층별 보안

| 계층 | 위협 | 대응 |
|---|---|---|
| 사용자 기기 | 기기 분실·탈취 | L3 4단어 시드로 복원. 기기 데이터는 개인키 없이 복호화 불가 |
| 통신 구간 | 중간자 공격 | TLS 1.3 + ECDSA 서명. 모든 메시지에 타임스탬프 서명 |
| PDV 저장 | 무단 열람 | 사용자 공개키 암호화. 고팡 팀조차 열람 불가 |
| OpenHash 노드 | 데이터 위변조 | SHA-256 해시체인 + ILMV 양방향 검증 |
| AI 시스템 | 프롬프트 인젝션 | 입력 검증 + K-Law 백그라운드 모니터 |
| GDC 결제 | 이중 지불 | BIVM Σδ=0 + OpenHash 앵커링 |

### 12-2. Sybil 공격 방지

신규 사용자 등록 시 다음 조건을 충족해야 합니다.

- ECDSA 키 쌍 생성 (계산 비용)
- L1 노드의 신원 검증 (1개 이상 기존 사용자 보증 또는 기관 확인)
- OpenHash 최소 스테이킹 (스팸 방지)
- GUID 유일성 검증 (L4/L5에서 이중 등록 방지)

### 12-3. Eclipse 공격 방지

- 복수 L1 노드에 동시 등록 (이중화)
- Kademlia K-bucket의 XOR 거리 다양성 유지
- ILMV 교차 검증으로 라우팅 테이블 무결성 상시 감사

---

## § 13. 현재 구현 성과 및 로드맵

### 13-1. 현재 구현 완료 (2026년 6월)

| 시스템 | 상태 | 테스트 결과 |
|---|---|---|
| hondi.net 포털 | ✅ 운영 중 | T1~T7 전체 통과 |
| K-119 (911.hondi.net) | ✅ 운영 중 | PDV T1~T6 통과 |
| K-Police (police.hondi.net) | ✅ 운영 중 | PDV T1~T6 통과 |
| K-Law (klaw.hondi.net) | ✅ 운영 중 | 판결 예측 v15.1 |
| K-Market (market.hondi.net) | ✅ 운영 중 | — |
| K-School (school.hondi.net) | ✅ 운영 중 | T2~T7 통과 |
| K-Tax (tax.hondi.net) | ✅ 운영 중 | — |
| GDC (gdc.hondi.net) | ✅ 운영 중 | Whitepaper v1.1 |
| K-Health (health.hondi.net) | ✅ 운영 중 | — |
| K-Traffic (traffic.hondi.net) | ✅ 운영 중 | — |
| K-Logistics (logistics.hondi.net) | ✅ 운영 중 | — |
| K-Stock (stock.hondi.net) | ✅ 운영 중 | — |
| K-Insurance (insurance.hondi.net) | ✅ 운영 중 | — |
| K-Security (security.hondi.net) | ✅ 운영 중 | — |
| K-Democracy (democracy.hondi.net) | ✅ 운영 중 | — |
| K-Public (public.hondi.net) | ✅ 운영 중 | — |
| OpenHash L1~L5 노드 | ✅ 제주 시범 | 4,399 TPS |
| 고팡 SSO (subsystem-auth.js) | ✅ 전 시스템 | 경로2A/2B/3 |
| PDV 6하원칙 기록 | ✅ 전 시스템 | Supabase 연동 |
| GWP 라우터 v2.1 | ✅ 운영 중 | cross-origin OK |

### 13-2. 핵심 성과 수치

```
OpenHash 성능
  단일 노드 TPS:        4,399
  L1 평균 지연:         0.228ms
  에너지 절감 (BTC 대비): –98.5%
  LPBFT 합의 (4노드):   ≤0.759ms

AI 비서 성능
  Fast-Path 응답:       0.246ms (목표 0.81ms 대비 3.3배 초과 달성)
  증거 패키지 생성:     1ms

K-Law 성능
  22라운드 평가 pass-only 평균: 9.57/10
  점수 분포: 0~3점 20%, 8~10점 55%
  대법원 판결 일치도(자체 평가, 최초 평가 평균): 7.44/10 (74%)

구현 저장소: 22개 (목표 50개 진행 중)
```

### 13-3. 로드맵

**2026년 하반기**
- Agent 22개 → 30개 확장 (농업·문화·관광·에너지·환경 추가)
- 고팡 앱 iOS/Android 네이티브 출시
- OpenHash 전국 L1 노드 확장 (제주 시범 → 전국)
- GWP_REGISTRY 원격 JSON 전환 (재배포 없이 Agent 추가)

**2027년**
- OpenHash SCI 논문 최종 게재
- Agent 50개 달성
- 193개국 GDC POOL 개설
- GDUDA(분산 사용자 검색) 상용화

**장기**
- L5 글로벌 노드 19개국 이상 독립 운영
- SEOM 거래소 상장
- UN 디지털 거버넌스 제안서 제출

---

## § 14. 참고문헌 및 저장소 목록

### 14-1. 공개 저장소

| 저장소 | URL | 역할 |
|---|---|---|
| gopang_v2 | github.com/Openhash-Gopang/gopang_v2 | 고팡 포털 |
| 911 | github.com/Openhash-Gopang/911 | K-119 응급 |
| police | github.com/Openhash-Gopang/police | K-Police 치안 |
| klaw | github.com/Openhash-Gopang/klaw | K-Law 법률 |
| gdc | github.com/Openhash-Gopang/gdc | GDC 화폐 |
| market | github.com/Openhash-Gopang/market | K-Market |
| tax | github.com/Openhash-Gopang/tax | K-Tax |
| school | github.com/Openhash-Gopang/school | K-School |
| health | github.com/Openhash-Gopang/health | K-Health |
| traffic | github.com/Openhash-Gopang/traffic | K-Traffic |
| logistics | github.com/Openhash-Gopang/logistics | K-Logistics |
| stock | github.com/Openhash-Gopang/stock | K-Stock |
| insurance | github.com/Openhash-Gopang/insurance | K-Insurance |
| security | github.com/Openhash-Gopang/security | K-Security |
| democracy | github.com/Openhash-Gopang/democracy | K-Democracy |
| public | github.com/Openhash-Gopang/public | K-Public |
| openhash-L1-ido1 | github.com/Openhash-Gopang/openhash-L1-ido1 | L1 노드 |
| openhash-L2-jeju-city | github.com/Openhash-Gopang/openhash-L2-jeju-city | L2 노드 |
| openhash-L3-jeju | github.com/Openhash-Gopang/openhash-L3-jeju | L3 노드 |
| openhash-L4-kr | github.com/Openhash-Gopang/openhash-L4-kr | L4 노드 |
| openhash-L5-global | github.com/Openhash-Gopang/openhash-L5-global | L5 노드 |

### 14-2. 관련 문서

| 문서 | 위치 |
|---|---|
| Gopang Developer Manual v2.0 | gopang_v2/docs/ |
| Gopang PDV Rules | gopang_v2/docs/gopang_pdv_rules.md |
| Gopang Auth Whitepaper | gopang_v2/docs/gopang-auth-whitepaper.md |
| GDC Whitepaper v1.1 | gdc/docs/GDC_WHITEPAPER_v1_1.md |
| K-Market Whitepaper v1.1 | market/docs/K-Market_WhitePaper_v1_1.md |
| K-Tax Whitepaper v1.0 | tax/docs/K-Tax_Whitepaper_v1_0.md |
| OpenHash SCI 논문 v2.2 | (IEEE 심사 중) |
| Subsystem Registry Guide | gopang_v2/docs/SUBSYSTEM_REGISTRY_GUIDE.md |
| GDUDA v1.0 | gopang_v2/docs/Gopang_User_Discovery_Algorithm.md |
| Gopang Address System v1.6 | gopang_v2/docs/Gopang_Address_System_v1_6.md |
| Gopang Manual v5.1 | gopang_v2/GOPANG_MANUAL.md |

### 14-3. 기술 스택

| 구분 | 기술 |
|---|---|
| AI 엔진 | DeepSeek V4 Pro (기본), GPT-4o mini (비전) |
| 프록시 | Cloudflare Worker (gopang-proxy v4.3) |
| 데이터베이스 | Supabase (PostgreSQL) — PDV 백업 인덱스 |
| 인증 | ECDSA, WebAuthn (FIDO2), SameSite=None 쿠키 SSO |
| 원장 | OpenHash (SHA-256 계층 분산원장) |
| 프론트엔드 | HTML/CSS/JS (ES Modules), 프레임워크 없음 |
| 배포 | GitHub Pages + Cloudflare DNS |
| 라이선스 | GPL v3.0 (전 저장소) |

---

## 맺음말

고팡은 기술 프로젝트이기 이전에 사회 실험입니다. "AI가 사람을 대신하는 세상"이 아니라 "AI가 사람을 돕는 세상"을 구현합니다. 데이터 주권을 개인에게 돌려주고, 거버넌스를 시민에게 돌려주며, 수익을 플랫폼이 아닌 참여자에게 돌려줍니다.

22개 저장소, 모든 코드 공개, 실제 작동하는 시스템. 고팡은 말이 아닌 코드로 증명합니다.

---

*© 2026 AI City Inc. (비영리) · DAWN: Democracy is All We Need*
*고팡은 참여하는 시민들이 스스로 통치하는 디지털 민주주의입니다.*
*문의: tensor.city@gmail.com*
