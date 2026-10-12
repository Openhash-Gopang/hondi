# Navi 산업/직업 분류 데이터 (1차 산출물)

## 현재 상태

### ✅ 완료 — 한국표준산업분류(KSIC) 10차 개정 (대분류 포함)
- 원본: `ksic10.csv` (통계청 고시 10차, GitHub FinanceData/KSIC 배포본) + 대분류(A~U) 레이어는
  통계분류포털(kssc.kostat.go.kr) 공식 엑셀 `한국표준산업분류10차_표.xlsx`(2026-07-23 주피터 업로드)
- 검증: 2,021행 / 대분류 21개, 중분류 77개, 소분류 232개, 세분류 495개, 세세분류 1,196개 —
  공식 엑셀 헤더에 적힌 "대분류(21)/중분류(77)/소분류(232)/세분류(495)/세세분류(1,196)"와 정확히 일치.
  기존(대분류 없이 만들었던) `ksic-tree.json`의 중분류 77개 코드 집합과 이 엑셀의 중분류 코드 집합도
  1:1로 정확히 일치함을 확인한 뒤 씌웠음(코드 체계 불일치 위험 없음).
- 산출물:
  - `ksic-tree.json` — 원본(source of truth), nested JSON, 계층 편집/트리 탐색용(최상위가 이제 대분류)
  - `ksic-flat.csv` — code,name,level,parent_code, 빠른 조회/DB 적재용
  - `ksic-paths.jsonl` — 리프까지 전체 경로를 풀어쓴 한 줄씩("대분류 > 중분류 > ... "), 임베딩/의미매칭용
  - `ksic-menu-tree.json` — right-menu.html 산업 페르소나 지연 로딩용 경량본(id/name/desc/items 스키마)
  - `add_top_level.py` — 위 대분류 레이어를 씌운 실제 스크립트(재현 가능, 멱등적)

### ❌ 미착수 — 한국표준직업분류(KSCO)
- GitHub 등에서 KSIC처럼 정리된 공개 CSV를 찾지 못함
- 통계청 통계분류포털에서 직접 엑셀/코드표를 받아야 함 (사이트가 JS 렌더링이라 자동 수집 불가 — 스크린샷 첨부 문서 참고)
- 파일만 주시면 `build_classification.py`로 동일한 3개 포맷을 즉시 생성 가능 (스크립트는 KSIC/KSCO 공용)

## 재사용
```bash
python3 build_classification.py --input <원본.csv> --prefix ksco --out ./out
```
원본 CSV는 `code,name` 2열 형식이면 됩니다 (헤더 1줄 필요).
