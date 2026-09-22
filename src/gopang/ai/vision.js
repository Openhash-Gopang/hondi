/**
 * ai/vision.js — Gemini Vision (K-Clean 이미지 분석·EXIF)
 */
// ── DeepSeek API 호출 ───────────────────────────────────
// ── 모델별 비전 지원 여부 ────────────────────────────────
// DeepSeek Vision 지원: deepseek-chat(V3)만 이미지 지원
// deepseek-v4-pro / deepseek-v4-flash 는 텍스트 전용 (이미지 불가)
const VISION_MODELS = new Set([
  'deepseek-chat',        // DeepSeek V3 — Vision 지원 (유일)
  'gpt-4o', 'gpt-4o-mini',
  'claude-sonnet-4-20250514', 'claude-opus-4-20250514',
  'gemini-2.0-flash', 'gemini-1.5-pro',
]);
function _modelSupportsVision(model) {
  return VISION_MODELS.has(model);
}

// 이미지 File → base64 data URL 변환
export function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);   // "data:image/jpeg;base64,..."
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── EXIF GPS·시간 추출 (순수 JS, 외부 라이브러리 불필요) ────
// ── Gemini Vision 호출 — K-Clean 이미지 분석 전담 ─────────
// SP-14-IMG v1.0 system prompt 기반으로 구조화된 JSON 반환
// ── Gemini 분석 중 Progress Bar 헬퍼 ────────────────────────
export function _showGeminiProgress() {
  const list = document.getElementById('message-list');
  const row  = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = 'gemini-progress-row';

  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble-ai gemini-progress-wrap';
  bubble.innerHTML = `
    <div class="gemini-progress-label">
      <div class="gp-spinner"></div>
      <span id="gemini-progress-text">📸 현장 이미지 분석 중…</span>
    </div>
    <div class="gemini-progress-bar-bg">
      <div class="gemini-progress-bar-fill" id="gemini-progress-fill"></div>
    </div>`;

  row.appendChild(bubble);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;

  // 15초 기준 자동 진행 (실제 완료 시 _hideGeminiProgress 호출)
  let pct = 0;
  const fill = document.getElementById('gemini-progress-fill');
  const textEl = document.getElementById('gemini-progress-text');
  const STEPS = [
    { at: 10,  label: '📸 이미지 해상도 분석 중…' },
    { at: 25,  label: '🔍 폐기물 성분 식별 중…' },
    { at: 45,  label: '📊 규모 및 중량 추정 중…' },
    { at: 65,  label: '📍 지형·위험도 판단 중…' },
    { at: 80,  label: '✅ 분석 마무리 중…' },
    { at: 92,  label: '✅ 분석 완료 직전…' },
  ];

  const timer = setInterval(() => {
    pct = Math.min(pct + 1.2, 92);  // 최대 92%까지 (완료 시 100%)
    if (fill) fill.style.width = pct + '%';
    const step = STEPS.filter(s => pct >= s.at).pop();
    if (step && textEl) textEl.textContent = step.label;
    if (pct >= 92) clearInterval(timer);
  }, 180);  // ~15초에 92% 도달

  return timer;
}

export function _hideGeminiProgress(timer) {
  if (timer) clearInterval(timer);
  const fill = document.getElementById('gemini-progress-fill');
  if (fill) fill.style.width = '100%';
  setTimeout(() => {
    document.getElementById('gemini-progress-row')?.remove();
  }, 400);  // 100% 도달 애니메이션 후 제거
}

export async function _callGeminiVision(imageFile, geminiKey) {
  const GEMINI_VISION_SYSTEM = `당신은 환경 현장 사진을 분석하는 객관적 데이터 추출 전문가다.
사진에서 보이는 사실만 수치로 추출한다. 판단·해석·견적·보고서 작성은 절대 하지 않는다.
결과는 반드시 아래 JSON 형식으로만 출력한다. JSON 외 어떠한 텍스트도 출력하지 않는다.
8대 성분: ST=스티로폼 PL=경질플라스틱 VI=비닐 GL=유리병 ME=금속캔 NT=폐어구 WD=목재 EX=기타
(ratio_pct 합계 반드시 100. 보이지 않는 성분은 0/false)
규모: XS(<50kg모래) S(50~200kg암반) M(200~400kg) L(400~1000kg) XL(1000kg↑)
지형: SAND|ROCK|CLIFF|WATER|FOREST|UNKNOWN
위험도: S0(일반) S1(대량) S2(오염위험) S3(유해물질)
출력: JSON만. 설명·인사·부연 절대 금지.`;

  const dataUrl  = await _fileToBase64(imageFile);
  const mimeType = imageFile.type || 'image/jpeg';
  const base64   = dataUrl.split(',')[1];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
  const body = {
    system_instruction: { parts: [{ text: GEMINI_VISION_SYSTEM }] },
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: '이 이미지를 분석하여 아래 JSON 형식으로만 출력하라:\n{"analysis_version":"SP-14-IMG-v1.0","image_quality":"GOOD|FAIR|POOR","confidence":0.85,"components":{"ST":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"PL":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"VI":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"GL":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"ME":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"NT":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"WD":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"EX":{"ratio_pct":0,"weight_kg_est":null,"visible":false}},"total_weight_kg_est":null,"scale":"S","terrain":"ROCK","risk_level":"S1","hazard_detected":false,"hazard_notes":null,"area_est_m2":null,"coastline_length_est_m":null,"notable_items":[],"exif":{"lat":null,"lng":null,"datetime":null,"altitude_m":null},"scene_description":""}' }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${err.slice(0,200)}`);
  }

  const data  = await res.json();
  const text  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── SP-00-GEN: 전용 SP 없을 때 Gemini 범용 이미지 분석 ────
export async function _callGeminiGeneral(imageFile, geminiKey, userText) {
  const systemPrompt =
    `당신은 친절하고 유능한 AI 비서다. 사용자가 보낸 이미지를 분석하고 사용자의 요청을 파악하여 도움을 제공한다.\n` +
    `반드시 아래 JSON 형식으로만 출력하라. JSON 외 텍스트 금지.\n` +
    `{\n` +
    `  "scene_type": "사진 유형",\n` +
    `  "main_subject": "주요 피사체",\n` +
    `  "objects_detected": ["감지된 물체 목록"],\n` +
    `  "user_intent": "사용자 요청/의도 파악",\n` +
    `  "response": "사용자 요청에 대한 친절한 답변 2~4문장",\n` +
    `  "actions": ["권고 또는 안내 사항 1", "권고 또는 안내 사항 2"],\n` +
    `  "urgency": "낮음|보통|높음|긴급",\n` +
    `  "scene_description": "이미지 객관적 설명 2~3문장"\n` +
    `}`;

  const dataUrl  = await _fileToBase64(imageFile);
  const mimeType = imageFile.type || 'image/jpeg';
  const base64   = dataUrl.split(',')[1];

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: userText ? `사용자 메시지: "${userText}"\n이미지와 메시지를 함께 분석하여 JSON으로 응답하라.`
                         : '이미지를 분석하여 사용자의 의도를 파악하고 JSON으로 응답하라.' }
      ]
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Gemini GEN API ${res.status}`);
  const data  = await res.json();
  const text  = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();
  const result = JSON.parse(clean);
  result._sp_code   = 'SP-00-GEN';
  result.risk_level = { '낮음':'S0','보통':'S1','높음':'S2','긴급':'S3' }[result.urgency] || 'S0';
  return result;
}

// Gemini 분석 결과 → DeepSeek 전달용 요약 텍스트 변환
export function _geminiResultToText(result, userText) {
  // SP-00-GEN: 범용 분석 결과 → 그대로 response 반환
  if (result._sp_code === 'SP-00-GEN') {
    const intentGuide = userText
      ? `사용자원문: ${userText}`
      : `(텍스트 없음 — 이미지만 전송)`;
    return `[Gemini 범용 이미지 분석 결과 — SP-00-GEN]\n` +
      `사진유형: ${result.scene_type||'미상'}\n` +
      `주요피사체: ${result.main_subject||'미상'}\n` +
      `감지물체: ${(result.objects_detected||[]).join(', ')||'없음'}\n` +
      `사용자의도: ${result.user_intent||'미상'}\n` +
      `AI응답: ${result.response||'없음'}\n` +
      `권고사항: ${(result.actions||[]).join(' / ')||'없음'}\n` +
      `설명: ${result.scene_description||''}\n` +
      `---\n${intentGuide}\n` +
      `위 분석을 바탕으로 사용자의 요청에 맞는 친절하고 실용적인 답변을 제공하라.`;
  }

  // SP-14-IMG: 해양쓰레기 분석 결과
  const c     = result.components || {};
  const parts = Object.entries(c)
    .filter(([, v]) => v.visible && v.ratio_pct > 0)
    .map(([k, v]) => `${k}(${v.ratio_pct}%·${v.weight_kg_est||'?'}kg)`)
    .join(', ');

  // 사용자가 텍스트를 입력하지 않은 경우 — 이미지만으로 의도 자율 파악
  const intentGuide = userText
    ? `사용자원문: ${userText}\n위 Gemini 분석 결과를 바탕으로 K-Clean v1.2 방법론에 따라 수거견적서와 환경신고서를 작성하라.`
    : `사용자원문: (없음 — 텍스트 없이 이미지만 전송됨)\n\n[자율 의도 파악 지시]\n사용자가 별도 설명 없이 이미지만 전송했다. 아래 순서로 처리하라:\n① 이미지 내용에서 사용자의 목적·요구를 스스로 판단한다.\n② 환경 오염·쓰레기 현장 사진이면 → K-Clean v1.2 신고·견적 절차를 자동 실행한다.\n③ 환경 외 사진(음식·문서·사람·사물 등)이면 → 사진에서 파악한 맥락에 맞는 적절한 도움을 제공한다.\n④ 불명확한 경우에만 한 가지 확인 질문을 한다. 단, 환경 신고 가능성이 조금이라도 있으면 먼저 신고·견적을 진행하고 추가 확인은 이후에 한다.`;

  return `[Gemini Vision 현장 분석 결과 — SP-14-IMG-v1.0]
신뢰도: ${Math.round((result.confidence||0)*100)}% | 이미지품질: ${result.image_quality||'?'}
규모: ${result.scale} | 지형: ${result.terrain} | 위험도: ${result.risk_level}
추정중량: ${result.total_weight_kg_est||'?'}kg | 면적: ${result.area_est_m2||'?'}㎡ | 해안선: ${result.coastline_length_est_m||'?'}m
성분구성: ${parts||'분석불가'}
주목항목: ${result.notable_items?.join(', ')||'없음'}
현장설명: ${result.scene_description||''}
위험물감지: ${result.hazard_detected ? '⚠️ '+result.risk_level : '없음'}
GPS(EXIF): ${result.exif?.lat ? result.exif.lat+', '+result.exif.lng : '없음'}
---
${intentGuide}`;
}

export async function _extractExif(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf  = e.target.result;
        const view = new DataView(buf);
        const result = { lat: null, lng: null, datetime: null, altitude: null };

        // JPEG 확인 (FFD8)
        if (view.getUint16(0) !== 0xFFD8) { resolve(result); return; }

        let offset = 2;
        while (offset < buf.byteLength - 2) {
          const marker = view.getUint16(offset);
          offset += 2;
          if (marker === 0xFFE1) { // APP1 (EXIF)
            const segLen = view.getUint16(offset);
            const exifHeader = String.fromCharCode(
              view.getUint8(offset+2), view.getUint8(offset+3),
              view.getUint8(offset+4), view.getUint8(offset+5)
            );
            if (exifHeader === 'Exif') {
              const tiffStart = offset + 8;
              const littleEndian = view.getUint16(tiffStart) === 0x4949;
              const getUint = (o, s=2) => s===4
                ? (littleEndian ? view.getUint32(tiffStart+o, true) : view.getUint32(tiffStart+o, false))
                : (littleEndian ? view.getUint16(tiffStart+o, true) : view.getUint16(tiffStart+o, false));

              const ifd0 = getUint(4, 4);
              const entries = getUint(ifd0);
              let gpsIfdPtr = null;

              for (let i = 0; i < entries; i++) {
                const e0 = ifd0 + 2 + i * 12;
                const tag = getUint(e0);
                if (tag === 0x8825) gpsIfdPtr = getUint(e0+8, 4); // GPSInfo
                if (tag === 0x9003 || tag === 0x0132) { // DateTimeOriginal / DateTime
                  const strOff = getUint(e0+8, 4);
                  let dt = '';
                  for (let j = 0; j < 19; j++)
                    dt += String.fromCharCode(view.getUint8(tiffStart + strOff + j));
                  result.datetime = dt; // "2026:05:23 14:30:22"
                }
              }

              if (gpsIfdPtr) {
                const gpsEntries = getUint(gpsIfdPtr);
                const gpsData = {};
                for (let i = 0; i < gpsEntries; i++) {
                  const ge = gpsIfdPtr + 2 + i * 12;
                  const gtag = getUint(ge);
                  const goff = getUint(ge+8, 4);
                  const readRat = (o) => {
                    const num = getUint(o, 4);
                    const den = getUint(o+4, 4);
                    return den ? num / den : 0;
                  };
                  if ([1,2,3,4,5,6].includes(gtag)) gpsData[gtag] = { off: goff, type: getUint(ge+2) };
                }
                const toDD = (ratOff) => {
                  const d = readRat(tiffStart + ratOff);
                  const m = readRat(tiffStart + ratOff + 8);
                  const s2 = readRat(tiffStart + ratOff + 16);
                  return d + m/60 + s2/3600;
                };
                const readRat = (o) => {
                  const num = view.getUint32(tiffStart + o, littleEndian);
                  const den = view.getUint32(tiffStart + o + 4, littleEndian);
                  return den ? num / den : 0;
                };
                if (gpsData[2]) {
                  const lat = toDD(gpsData[2].off);
                  const latRef = view.getUint8(tiffStart + (gpsData[1]?.off || 0));
                  result.lat = (latRef === 83) ? -lat : lat; // 'S' = 83
                }
                if (gpsData[4]) {
                  const lng = toDD(gpsData[4].off);
                  const lngRef = view.getUint8(tiffStart + (gpsData[3]?.off || 0));
                  result.lng = (lngRef === 87) ? -lng : lng; // 'W' = 87
                }
                if (gpsData[6]) result.altitude = readRat(gpsData[6].off);
              }
            }
            break;
          }
          if ((marker & 0xFF00) !== 0xFF00) break;
          offset += view.getUint16(offset);
        }
        resolve(result);
      } catch { resolve({ lat: null, lng: null, datetime: null, altitude: null }); }
    };
    reader.onerror = () => resolve({ lat: null, lng: null, datetime: null, altitude: null });
    reader.readAsArrayBuffer(file);
  });
}

// ── 카카오 역지오코딩 — GPS 좌표 → 행정구역 주소 변환 ──────────
// API: https://dapi.kakao.com/v2/local/geo/coord2address.json
// 반환: { roadAddress, jibunAddress, region } 또는 null
