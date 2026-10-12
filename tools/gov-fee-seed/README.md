# 나비 정부 수수료 기준표 — PocketBase 연동 시드

## 구성
- `schema/gov_fee_schedule.collection.json` — PocketBase 컬렉션 스키마 (Admin UI > Settings > Import collections 로 가져오기)
- `scripts/gov_fee_calc.mjs` — 순수 계산 함수 (formula_json 기반, 하드코딩 세율표 없음). gov-router.js 등에서 import해서 재사용.
- `scripts/seed_gov_fee_schedule.mjs` — 엑셀(나비_정부수수료_기준표_초안.xlsx) → PocketBase 레코드 변환/upsert

## 설계 요약
- GDC 청구액은 **나비 서비스 수수료 전용**입니다 (2026-08-15 결정). 정부에 실제로 납부하는 금액은
  포함하지 않으며, 사용자가 공식 채널로 직접 납부합니다.
- `hondi_service_fee = gov_reference_fee × gdc_multiplier` (기본 배율 2, 과금 원칙 ③).
- `scope: national` (인지세·법원 인지대·송달료)은 지역 무관 전국 공통이며, `formula_json`에 구간표를
  저장해 요율 개정 시 코드 재배포 없이 데이터만 갱신하면 됩니다.
- `scope: regional`(민원사무편람 기반)은 `region_code`별로 분리 저장합니다. **`region_code='baseline'`은
  특정 지역이 아니라 "지역 중립 기준점"입니다** — 지금은 가장 먼저 확보한 천안시 편람 값을 그대로
  복제해서 채워뒀을 뿐이고, 그 외 실제 지역(예: `chungnam_cheonan`)은 그 지역 고유 편람에서 나온
  진짜 REAL 데이터입니다. 새 지역을 추가하려면 [지역 온보딩](#지역-온보딩) 참조.
- `status`
  - `REAL`: 숫자로 확인된 금액 (무료 포함)
  - `NEEDS_REVIEW`: 원문에 금액이 있으나 자동 파싱 실패, 또는 조례/별표 참조라 실제 숫자를 별도 확인해야 함
  - `MISSING`: 원본 편람에 수수료 정보 자체가 없음
  - **NEEDS_REVIEW/MISSING 건은 자동으로 과금하면 안 됩니다** — 사용자에게 "확인 필요"로 안내하고 승인 흐름으로 유도하십시오.

## 지역 온보딩

새 지역(예: 제주시)을 추가하려면:

1. 그 지역 지자체 홈페이지의 "민원사무편람" 게시판에서 엑셀을 받는다(각 지자체가 자체 게시 —
   `나비_정부수수료_기준표_초안.xlsx`와 같은 컬럼 구조를 갖는지 먼저 확인, 다르면 스크립트의
   `parseBaselineSheet()` 컬럼 매핑을 그 파일에 맞게 조정 필요).
2. 그 지역 고유의 `--region` 코드로 시드한다 — **반드시 `gov-router.js`의 실제 시코드와 일치시킬 것**
   (도코드 접두 형태, 예: 제주시는 `jeju_jejusi`). `gov-router.js`의 `_makeMetroCityTable`/
   `PROVINCE_TABLES` 참조.
   ```bash
   node scripts/seed_gov_fee_schedule.mjs --file ./jeju_baseline.xlsx --region jeju_jejusi --multiplier 2 \
     --embed --worker-url https://hondi-proxy.tensor-city.workers.dev
   ```
3. 이 지역이 커버하지 못하는 항목(그 지역 편람에 없는 민원)은 자동으로 `region_code='baseline'`
   폴백을 타되, `resolveGovFee()`가 `status: 'NEEDS_APPROVAL'`을 반환해 **사용자 승인 없이는
   과금되지 않습니다** — "이 지역 데이터가 아직 없어 전국 기준값을 씁니다" 안내와 함께.
4. BASELINE 자체를 갱신/교체하고 싶으면(더 대표성 있는 데이터로) `--region baseline`으로 시드하면
   됩니다 — 특정 지역 전용이 아니라 전국 잠정 기준값 슬롯이므로, 어떤 지역 데이터를 baseline으로
   쓸지는 언제든 바꿀 수 있습니다.

## 사용법
```bash
npm install
# 1) 먼저 dry-run으로 파싱 결과만 확인 (PocketBase 연결 없이)
node scripts/seed_gov_fee_schedule.mjs --file ./나비_정부수수료_기준표_초안.xlsx --dry-run

# 2) 실제 반영 (BASELINE 자체를 시드/갱신하는 경우)
export POCKETBASE_URL=https://your-l1-node
export POCKETBASE_ADMIN_EMAIL=admin@example.com
export POCKETBASE_ADMIN_PASSWORD=********
node scripts/seed_gov_fee_schedule.mjs --file ./나비_정부수수료_기준표_초안.xlsx --region baseline --multiplier 2

# 2-1) 천안시 자신의 실제 지역 데이터로도 별도 시드 (baseline과는 독립된 레코드)
node scripts/seed_gov_fee_schedule.mjs --file ./나비_정부수수료_기준표_초안.xlsx --region chungnam_cheonan --multiplier 2
```

## 조회 우선순위 (런타임 로직 — gov-fee-lookup.js에 이미 구현됨)
1. 사용자 관할 `region_code`(실제 시코드)의 `status=REAL` 레코드가 있으면 사용
2. `scope=national`이면 지역 무관하게 바로 사용
3. 둘 다 없으면 `region_code='baseline'`의 REAL 레코드를 사용하되,
   "이 지역 정확한 금액은 미확인이며 전국 기준값(BASELINE)입니다"를 사용자에게 고지하고 승인 필수
4. `NEEDS_REVIEW`/`MISSING`이면 자동 과금 금지, 사람 확인 큐로 전달

## 알려진 제한
- `exceljs`가 `uuid` 패키지를 통해 moderate severity 취약점을 transitively 포함합니다
  (문서 메타데이터 생성용, 파싱 경로와 무관 — `npm audit` 참고).
- 천안시 편람 원문 중 "9,000원~67,500원(건축물 규모별)"처럼 조건부 범위는 min/max만 잡히고
  조건 로직 자체는 저장하지 않습니다 — 이런 항목은 실제 사용 전 raw_fee_text를 사람이 확인해야 합니다.
