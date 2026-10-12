/**
 * @file plugin-interface.js
 * @description 모든 나비 도메인 플러그인이 구현해야 하는 인터페이스 계약
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 새 도메인 플러그인 작성 시:
 *   1. src/domains/_template/ 복사
 *   2. GopangDomainPlugin 상속
 *   3. REQUIRED_FIELDS 모두 구현
 *   4. plugin-validator가 자동 검사
 */

export class GopangDomainPlugin {

  // ── 필수: 메타데이터 ────────────────────────────────────────────────────
  metadata = {
    name:         '',      // 고유 식별자 (예: 'k-law', 'k-health')
    displayName:  '',      // UI 표시명 (예: 'K-Law (사법)')
    version:      '0.0.0', // semver (예: '1.0.0')
    description:  '',      // 플러그인 설명
    icon:         '',      // 이모지 또는 SVG 문자열
    author:       'AI City Inc.',
    legalDomains: [],      // 관할 법령 도메인 목록
  }

  // ── 필수: 법령 분류기 ───────────────────────────────────────────────────
  // AI 비서 Phase 2가 이 분류기를 동적으로 로딩한다.
  // K-Law: CR-1~5, CV-1~4, LB-1~2, CC-1~2
  // K-Health: MED-01~05
  legalClassifier = {
    /**
     * SU 목록을 받아 도메인별 법령 플래그를 반환
     * @param {Array} suList  - Phase 1에서 생성된 의미 단위 목록
     * @returns {Object}      - { flags: string[], scores: Object }
     */
    classify: async (suList) => { throw new Error('classify() 미구현') },

    /**
     * Phase 1.2 Fast-Path 트리거 목록 반환
     * @returns {Array} - [{ id, pattern, score, desc }]
     */
    getFastPathTriggers: () => [],
  }

  // ── 필수: 위험 판정 규칙 목록 ───────────────────────────────────────────
  // 예: [{ id:'CR-1', pattern:/사기/, score:0.80, desc:'사기죄 의심' }]
  riskRules = []

  // ── 필수: UI 컴포넌트 ───────────────────────────────────────────────────
  // Shell UI가 도메인 탭 렌더링 시 사용
  uiComponents = {
    dashboardWidget: null,  // 메인 대시보드 위젯 (HTML 문자열 또는 함수)
    chatBadge:       null,  // 채팅 위험 배지
    reportPanel:     null,  // 상세 보고 패널
  }

  // ── 필수: API 엔드포인트 정의 ───────────────────────────────────────────
  // 실제 HTTP 핸들러 또는 fetch wrapper
  apiEndpoints = {
    analyze: null,   // POST /domain/{name}/analyze
    report:  null,   // GET  /domain/{name}/report/{id}
    verify:  null,   // POST /domain/{name}/verify
  }

  // ── 필수: 데이터 스키마 ─────────────────────────────────────────────────
  // vault.js MessageStore의 도메인 전용 확장 필드
  dataSchema = {
    messageRecord: {},   // 추가 저장 필드
    reportRecord:  {},   // 보고서 스키마
  }

  // ── 필수: 생명주기 훅 ───────────────────────────────────────────────────
  async onLoad()              { /* 플러그인 로드 시 */ }
  async onUnload()            { /* 플러그인 언로드 시 */ }
  async onUpdate(prevVersion) { /* 버전 업데이트 시 */ }

  // ── 선택: 이벤트 구독 목록 ──────────────────────────────────────────────
  // onLoad()에서 EventBus.on()으로 등록된다.
  // 예: [{ event: EVENTS.MSG_RISK_ASSESSED, handler: this.onAssessed }]
  eventSubscriptions = []
}

// 플러그인 유효성 검사기가 확인하는 필수 필드 목록
export const REQUIRED_FIELDS = Object.freeze([
  'metadata.name',
  'metadata.version',
  'metadata.displayName',
  'legalClassifier',
  'legalClassifier.classify',
  'legalClassifier.getFastPathTriggers',
  'riskRules',
  'uiComponents',
  'apiEndpoints',
  'dataSchema',
  'onLoad',
  'onUnload',
  'onUpdate',
])
