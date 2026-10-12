// src/gopang/profile2.0/physical-scan.js
// ============================================================
// 물리자료 Profile 스캔 모듈
//
// 나비 숫자코드 스캔(src/gopang/gwp/engine.js)과 동일한 패턴을 따른다:
//   캡처 → 인식(비전 AI) → 구조화(JSON) → 사용자 확인 → Profile 필드 병합
//
// 호출 비전 프롬프트: prompts/sp-catalog.json 의 "SP-15-IMG_profile-scan_vision_prompt" 키로 결정
//   (2026-07-09: prompts/manifest.json → prompts/sp-catalog.json 개명, W-16)
//   → 빌드 시 tools/build_manifest.py 가 prompts/ 를 스캔해 최신 파일명을 manifest 에 기록
// 관련 문서: docs/user_profile_authoring_guidelines_v1_0.md §4
//
// 주의: callAI()의 정확한 시그니처(이미지 전달 방식 등)는 src/gopang/ai/call-ai.js의
// 실제 구현에 맞춰 조정이 필요할 수 있다 — 아래는 기존 free-model-pool.js/router.js와
// 동일한 호출 관례를 가정한 예시이며, 통합 시 인자명을 실제 구현과 대조해 주십시오.
// ============================================================

import { callAI } from '../ai/call-ai.js';

// SP-15-IMG 파일명은 sp-catalog.json 에서 결정 — 버전 하드코딩 없음
const _SP15_MANIFEST_KEY = 'SP-15-IMG_profile-scan_vision_prompt';
const VALID_PROFILE_FIELDS = ['name', 'products', 'phone', 'address', 'description', 'hours'];

let _scanPromptCache = null;

/**
 * 비전 프롬프트를 1회만 로드해 캐시한다.
 * sp-catalog.json 에서 최신 파일명을 결정한 뒤 실제 SP 를 fetch 한다.
 */
async function loadScanPrompt() {
  if (_scanPromptCache) return _scanPromptCache;
  const manifestRes = await fetch('/prompts/sp-catalog.json', { cache: 'no-cache' });
  if (!manifestRes.ok) {
    throw new Error(`[physical-scan] manifest fetch 실패: ${manifestRes.status}`);
  }
  const manifest = await manifestRes.json();
  const fname = manifest[_SP15_MANIFEST_KEY];
  if (!fname) {
    throw new Error(`[physical-scan] manifest 에 키 없음: ${_SP15_MANIFEST_KEY}`);
  }
  const res = await fetch('/prompts/' + fname);
  if (!res.ok) {
    throw new Error(`[physical-scan] 비전 프롬프트 로드 실패: ${res.status} (${fname})`);
  }
  _scanPromptCache = await res.text();
  console.info('[physical-scan] SP-15-IMG 로드 완료:', fname);
  return _scanPromptCache;
}

/**
 * File/Blob을 base64 문자열로 변환한다 (data URL 접두사 제거).
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('[physical-scan] 이미지 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

/**
 * AI 응답 텍스트에서 PHYSICAL_SCAN_RESULT { ... } 블록을 파싱한다.
 * 파싱 실패 시 단정하지 않고 confidence:'low' + parseError 플래그로 반환한다
 * (이미지를 잘못 읽었는데 정상인 것처럼 보이는 결과를 만들지 않기 위함).
 */
function parsePhysicalScanResult(rawText) {
  const fallback = {
    doc_type: 'unknown',
    extracted: {},
    uncertain_fields: [],
    confidence: 'low',
    parseError: true,
  };
  if (!rawText) return fallback;

  const match = rawText.match(/PHYSICAL_SCAN_RESULT\s*(\{[\s\S]*\})/);
  if (!match) return fallback;

  try {
    const parsed = JSON.parse(match[1]);
    return {
      doc_type: parsed.doc_type || 'unknown',
      extracted: sanitizeExtracted(parsed.extracted),
      uncertain_fields: Array.isArray(parsed.uncertain_fields) ? parsed.uncertain_fields : [],
      confidence: parsed.confidence || 'low',
      parseError: false,
    };
  } catch (e) {
    return { ...fallback, raw: match[1] };
  }
}

/**
 * 스키마에 정의되지 않은 필드는 버린다 — 비전 AI가 임의 필드명을 만들어내도
 * Profile 스키마를 오염시키지 않도록 하는 방어막.
 */
function sanitizeExtracted(extracted) {
  if (!extracted || typeof extracted !== 'object') return {};
  const clean = {};
  for (const key of VALID_PROFILE_FIELDS) {
    if (extracted[key]) clean[key] = extracted[key];
  }
  return clean;
}

/**
 * 사용자가 촬영·업로드한 물리 자료(메뉴판 등)를 스캔해 Profile 입력 후보를 추출한다.
 *
 * @param {File|Blob} imageFile - 캡처된 이미지
 * @param {object} [context] - 이미 알려진 Profile 정보(entity_type 등). 재질문 방지 +
 *   비전 AI의 추측성 보정을 막기 위해 전달한다.
 * @returns {Promise<{doc_type:string, extracted:object, uncertain_fields:string[], confidence:string}>}
 */
export async function scanPhysicalDocument(imageFile, context = {}) {
  const [prompt, imageBase64] = await Promise.all([
    loadScanPrompt(),
    fileToBase64(imageFile),
  ]);

  const contextBlock = {
    entity_type: context.entity_type || null,
    entity_subtype: context.entity_subtype || null,
  };

  const aiResponse = await callAI({
    promptSystem: prompt,
    contextBlock,
    images: [{ mimeType: imageFile.type || 'image/jpeg', data: imageBase64 }],
  });

  return parsePhysicalScanResult(aiResponse);
}

/**
 * 스캔 결과를 기존 Profile 초안에 병합한다.
 *
 * 원칙(사용자 Profile 작성 지침서 v1.0 §2):
 *  - 이미 사용자가 직접 답해 채워진 필드는 절대 덮어쓰지 않는다(①이 ④보다 항상 우선).
 *  - uncertain_fields는 자동 입력하지 않고, 사용자에게 되묻는 확인 질문으로 변환한다.
 *
 * @param {object} draft - 현재까지의 Profile 초안 (personal-assistant의 수집 상태)
 * @param {object} scanResult - scanPhysicalDocument()의 반환값
 * @returns {{draft:object, confirmQuestions:string[]}}
 */
export function mergeIntoProfileDraft(draft, scanResult) {
  const merged = { ...draft };

  for (const [key, value] of Object.entries(scanResult.extracted || {})) {
    if (!merged[key] && value) {
      merged[key] = value;
    }
    // merged[key]가 이미 있으면(사용자가 직접 답함) 절대 덮어쓰지 않는다.
  }

  const confirmQuestions = (scanResult.uncertain_fields || []).map(
    (field) => `사진에서 "${field}" 부분이 잘 안 보여요. 정확한 값을 알려주시겠어요?`
  );

  return { draft: merged, confirmQuestions };
}

/**
 * personal-assistant SP가 호출하는 진입점.
 * 스캔 + 병합을 한 번에 수행하고, PA가 바로 사용자에게 보여줄 수 있는 형태로 반환한다.
 *
 * @param {File|Blob} imageFile
 * @param {object} currentDraft
 * @returns {Promise<{draft:object, confirmQuestions:string[], doc_type:string, confidence:string}>}
 */
export async function handlePhysicalScanForOnboarding(imageFile, currentDraft) {
  const scanResult = await scanPhysicalDocument(imageFile, currentDraft);
  const { draft, confirmQuestions } = mergeIntoProfileDraft(currentDraft, scanResult);

  return {
    draft,
    confirmQuestions,
    doc_type: scanResult.doc_type,
    confidence: scanResult.confidence,
    parseError: scanResult.parseError || false,
  };
}
