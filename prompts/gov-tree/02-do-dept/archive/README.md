# 02-do-dept 버전 중복 정리 (2026-09-19, 「제주 AI 행정」 SP 정비 세션)

- `SP-DO-COMM_v1.0.md` → v1.1(소통담당관, 구 소통청렴담당관)로 대체됨. spId는
  동일(SP-DO-COMM)하게 유지되므로 페이지·라우팅에는 v1.1만 남긴다.
- `SP-DO-INNOV_v1.1.md` → v1.2(미래산업국, 구 혁신산업국)로 대체됨. 동일하게
  spId(SP-DO-INNOV)는 유지, v1.2만 남긴다.

두 경우 모두 조직명 개편(소통청렴담당관→소통담당관, 혁신산업국→미래산업국)이
있었고 최신 버전에 반영돼 있다. 라이브 디렉토리에는 각 spId당 최신 버전
하나만 남기는 것이 원칙이며, 이후 개편 시에도 이 컨벤션(구버전은 즉시
archive/로 이동, git rm 대신 보존)을 따를 것을 권장.

# 2026-09-22 — 시행규칙 원문(제938호) 확인에 따른 폐지·중복 정리

사용자가 국가법령정보센터에서 시행규칙(제938호, 2026.8.25. 시행)·조례(제4348호) 원문을 직접 확보해 주어,
그동안 언론 보도·누리집 발췌만으로 추정하던 것을 조문으로 확정했다(경위: `prompts/gov-tree/docs/JEJU-DO-ORG-REFORM-2026-08_RECONCILE.md`).

- `SP-DO-AIRPORTSUP_v1.0.md`(공항확충지원단), `SP-DO-AUTONOMY_v1.0.md`(특별자치제도추진단),
  `SP-DO-BALANCE_v1.0.md`(도시균형추진단) → 시행규칙 원문에 본청 조직으로 존재하지 않는다(폐지 확인,
  신뢰도 high). `pages/jeju-gov-automation.html`의 DO_BUREAUS 목록에서도 제거했다.
- `SP-DO-GENERAL_v1.0.md`(총무과) → 독립 국이 아니라 특별자치행정국(SP-DO-JACHI) 소속 과다(시행규칙 제10조).
  이미 `SP-DIV-JACHI-GENERAL`(특별자치행정국의 division)이 같은 내용을 정확히 담당하고 있었으므로,
  최상위 목록의 중복 항목만 제거했다 — division SP는 그대로 유지된다.

같은 날 개칭 5건(SP-DO-INNOV→미래산업국, SP-DO-CLIMATE→환경산림자원국, SP-DO-SAFETY→안전건강실,
SP-DO-COMM→소통ㆍ제2공항담당관, SP-DO-AIGOV→AI혁신추진단)을 spId 유지한 채 이름만 갱신했고,
신설 1건(SP-DO-CLIMATEENERGY, 기후에너지국)을 목록에 추가했다(과 SP 3개는 분장사무 근거인 별표 7을
아직 확보하지 못해 미작성 — 다음 배치 대상).

