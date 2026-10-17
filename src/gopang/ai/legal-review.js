/**
 * ai/legal-review.js — "법률 검토" 모드 시스템 프롬프트 조립 (2026-10-17 신설)
 *
 * 전문가 페르소나 페이지의 [법률 검토] 버튼이 호출한다. 구조는 상속형이다.
 *   공유 상위 계층 → SP_LEGAL_REVIEW_BASE(공통 골격, SP-COMMON-07)
 *                  → SP_legal-review-{직업군 루트 id}(7개 훅만)
 * 세부분야 페르소나(parentKey 보유)는 자기 훅을 갖지 않고 루트 직업군의 훅을 상속한다.
 * 조립 순서 근거: SP_hierarchy_inheritance H2(캐시 프리픽스 고정). EXPERT_BASE는 조립하지 않는다
 * (STEP R 같은 실행 위임 단계가 없는 별개 모드이기 때문 — SP_LEGAL_REVIEW_BASE §2).
 *
 * 순수 함수(legalReviewHookKey)와 로더 의존 함수(_composeLegalReviewPrompt)를 분리해 테스트한다.
 */
import { EXPERT_REGISTRY, UNIVERSAL_INTEGRITY_KEY, COMMON_GUARDRAILS_KEY,
         COMMON_MEDICAL_SAFETY_KEY, CONTROL_TOWER_PRINCIPLE_KEY } from './expert-registry.js';
import { _loadSpByKey, _loadSpRawByKey } from './manifest-loader.js';

export const LEGAL_REVIEW_BASE_KEY = 'SP_LEGAL_REVIEW_BASE';
export const LEGAL_REVIEW_HOOK_PREFIX = 'SP_legal-review-';

// 화면 배너와 동일한 문장(단일출처는 SP_LEGAL_REVIEW_BASE §1). 배너를 "다시 보지 않기"로 닫아도
// 모델은 첫 응답 첫 줄에 이 문장을 항상 출력한다. 테스트가 본문과의 일치를 검증한다.
export const LEGAL_REVIEW_DISCLAIMER =
  '[AI 법률 검토 · 참고용] 이 검토는 인간 변호사의 법률 자문을 대신하지 않으며 법적 효력이 없습니다. 구체적 사건의 법률 판단은 변호사에게 확인하세요.';

const MAX_DEPTH = 6;

/** 페르소나 id → 루트 직업군 id (parentKey를 끝까지 따라 올라간다. 순환·과잉 깊이 방어). */
export function resolveLegalReviewRoot(personaId, registry = EXPERT_REGISTRY) {
  let cur = personaId;
  const seen = new Set();
  for (let i = 0; i < MAX_DEPTH && cur; i++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const def = registry[cur];
    if (!def || !def.parentKey) return cur;
    cur = def.parentKey;
  }
  return cur || personaId;
}

export function legalReviewHookKey(personaId, registry = EXPERT_REGISTRY) {
  return LEGAL_REVIEW_HOOK_PREFIX + resolveLegalReviewRoot(personaId, registry);
}

const _cache = new Map();

/**
 * 법률 검토 모드 시스템 프롬프트 합성.
 * @param {string|{id?:string,key?:string,needsMedicalSafety?:boolean}} persona 페르소나 id 또는 정의
 * @returns {Promise<string|null>} 합성 결과. 공통 골격 로드 실패 시 null(호출부는 버튼을 비활성화한다).
 */
export async function _composeLegalReviewPrompt(personaId, registry = EXPERT_REGISTRY, opts = {}) {
  // serverInjectsUniversal: 서버 릴레이(/ai/chat 등)가 UNIVERSAL-INTEGRITY·UNIVERSAL-common·CONTROL-TOWER-PRINCIPLE를
  // system 앞에 강제로 붙이는 경로(페이지 채팅 위젯)에서는 중복을 피하려고 그 3종을 조립하지 않는다.
  const skipUniversal = !!opts.serverInjectsUniversal;
  const rootId = resolveLegalReviewRoot(personaId, registry);
  const def = registry[personaId] || registry[rootId] || {};
  const needsMed = !!(def.needsMedicalSafety || (registry[rootId] || {}).needsMedicalSafety);
  const cacheKey = rootId + (needsMed ? '|med' : '') + (skipUniversal ? '|srv' : '');
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  const parts = [];
  if (!skipUniversal) {
    try { parts.push(await _loadSpByKey(UNIVERSAL_INTEGRITY_KEY, 'UNIVERSAL-INTEGRITY')); }
    catch (e) { console.warn('[LegalReview] UNIVERSAL-INTEGRITY 로드 실패:', e.message); }
    try { parts.push(await _loadSpByKey(CONTROL_TOWER_PRINCIPLE_KEY, 'CONTROL-TOWER-PRINCIPLE')); }
    catch (e) { console.warn('[LegalReview] CONTROL-TOWER-PRINCIPLE 로드 실패:', e.message); }
  }
  for (const [k, label] of [...(skipUniversal ? [] : [['UNIVERSAL-common', 'UNIVERSAL-common']]),
                            ['PROFESSIONAL-common', 'PROFESSIONAL-common'],
                            [COMMON_GUARDRAILS_KEY, '공통 가드레일']]) {
    try { parts.push(await _loadSpRawByKey(k, label)); }
    catch (e) { console.warn(`[LegalReview] ${label} 로드 실패:`, e.message); }
  }
  if (needsMed) {
    try { parts.push(await _loadSpRawByKey(COMMON_MEDICAL_SAFETY_KEY, '의료 안전모듈')); }
    catch (e) { console.warn('[LegalReview] 의료 안전모듈 로드 실패:', e.message); }
  }

  // 공통 골격 — 없으면 이 모드 자체가 성립하지 않는다(면책·절차·금지선이 모두 여기 있다).
  try { parts.push(await _loadSpRawByKey(LEGAL_REVIEW_BASE_KEY, '법률 검토 공통 골격')); }
  catch (e) { console.warn('[LegalReview] 공통 골격 로드 실패 — 모드 사용 불가:', e.message); return null; }

  // 직업군 훅 — 없으면 골격만으로 동작(SP_LEGAL_REVIEW_BASE §5: 없는 훅을 지어내지 않는다).
  try { parts.push(await _loadSpRawByKey(LEGAL_REVIEW_HOOK_PREFIX + rootId, `${rootId} 법률 검토 훅`)); }
  catch (e) { console.warn(`[LegalReview] ${rootId} 훅 없음 — 공통 골격만 적용:`, e.message); }

  const composed = parts.join('\n\n---\n\n');
  _cache.set(cacheKey, composed);
  return composed;
}

export function _clearLegalReviewCacheForTest() { _cache.clear(); }
