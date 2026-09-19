# 02-do-dept/divisions 버전 중복 정리

- `SP-DIV-TOURISM-TOURISMPOLICY_v1.0.md` → v1.1(CT-0054 대응 — §2에
  "관광사업 등록·허가는 시청 관광진흥과 소관" 혼동 주의 항목 추가)로 대체됨.
  spId는 동일(SP-DIV-TOURISM-TOURISMPOLICY)하게 유지.
- `SP-DIV-OCEAN-MARINEPOLICY_v1.0.md` → v1.1(CT-0064 대응 — §2에 근거 없는
  예시 생성 금지 문구 추가)로 대체됨. spId는 동일(SP-DIV-OCEAN-MARINEPOLICY)
  하게 유지.

두 경우 모두 나머지 111개 do-dept division과 공유하는 근본 원인(§2 템플릿이
너무 일반적이라 인접 부서 업무·근거 없는 예시를 지어내기 쉬움)의 개별 대증
치료다 — 전면 재작성(§2 템플릿 근본수정 패치 병합 후 112개 배치)까지는
잠정 조치. 02-do-dept/archive/README.md와 동일한 컨벤션(구버전은 즉시
archive/로 이동, git rm 대신 보존)을 따른다.
