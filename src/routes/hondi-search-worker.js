/**
 * ⚠ 이 파일은 삭제 검토 대상이었으나(2026-09-13), 다른 코드가 여전히
 * import하고 있을 가능성을 배제할 수 없어 우선 스텁으로 남긴다.
 *
 * 혼디 검색(/hondi-search)의 실제 구현은 이 레포에 없다 — 별도 저장소/
 * Worker인 Openhash-Gopang/hondi-search-relay(src/hondi-search-worker.js)로
 * 완전히 이관됐다(2026-09-09, docs/HANDOFF_HONDI_SEARCH_RELAY_MIGRATION_20260909_v1_0.md
 * 참고 — Cloudflare Error 1042 회피가 이관 사유).
 *
 * 이전에는 이 파일에 "참고용 사본"이라는 이름으로 실제 서빙 로직의
 * 오래된 복사본이 남아 있었다. 2026-09-13 세션에서 그 사본이 혼동을 낳는
 * 근본 원인 중 하나로 지목돼(다음 사람이 이 파일을 실제 코드로 착각해
 * 여기만 고치고 hondi-search-relay를 빠뜨릴 위험) 전체 삭제했다 —
 * "SP/로직 사본은 단일 소스만 둔다"는 이 레포의 반복된 교훈
 * (HONDI-CAPABILITIES-COMMON, profile-assistant 탭 분리 시 배선 누락
 * 사례 등)과 같은 조치다.
 *
 * hondi-search 로직을 수정하려면 반드시
 * Openhash-Gopang/hondi-search-relay 저장소에서 작업할 것.
 */
export function handleHondiSearch() {
  throw new Error(
    'handleHondiSearch는 이 레포에서 제거됐습니다 — ' +
    'Openhash-Gopang/hondi-search-relay를 사용하세요.'
  );
}
