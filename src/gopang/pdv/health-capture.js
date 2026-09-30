/**
 * pdv/health-capture.js — 나만의 AI 비서(AC)가 대화에서 건강 기록을 만들고 갱신하는 경로 (2026-10-01)
 *
 * health-profile.js(저장소)에 값을 채우는 쪽이다. AC의 핵심 프롬프트(AC-PRO-CORE)·call-ai.js를 건드리지 않도록
 * 별도 모듈로 두고, send-message.js가 사용자 메시지마다 fire-and-forget으로 부른다(위험분석 훅과 같은 방식).
 *
 * 흐름: 키워드 게이트(대부분의 메시지는 여기서 끝 → LLM 호출 없음) → 전용 추출 프롬프트(JSON) → 코드 검증
 *       → 이미 있는 값 제외 → 사용자에게 "건강 기록에 저장할까요?" (항목별 체크, 버튼 클릭 전에는 저장 안 함).
 * 원칙
 *  - 사용자 본인이 말한 사실만. 타인(환자·친구·지인)의 병력, 질문·가정, AI가 추정한 병명은 저장하지 않는다.
 *  - 근거 문장(evidence)은 사용자 메시지에 실제로 있는 문장이어야 한다(없으면 버린다 — 모델이 지어낸 항목 차단).
 *  - 저장은 사용자 승인 후에만. 출처는 'ac_conversation'. 거절한 항목은 이 세션에서 다시 묻지 않는다.
 *  - 끄기: localStorage 'gopang_health_capture' = 'off' 또는 gopangHealthPDV.setCapture(false).
 *  - 목록·삭제: "내 건강 기록 보여줘" 명령으로 조회하고 항목별로 지울 수 있다(접근 기록도 함께 보인다).
 */
import { HEALTH_GROUPS, HEALTH_FIELDS, fieldDef, normalizeProposals, isStale } from './health-profile.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 건강 사실이 들어 있을 만한 말이 있을 때만 추출을 시도한다(비용·프라이버시: 대부분의 대화는 LLM에 추가로 보내지 않는다).
const GATE = /알레르기|알러지|앓|지병|기저질환|병력|고혈압|당뇨|고지혈|천식|갑상선|심장병|협심증|뇌졸중|뇌경색|암\s*(?:수술|진단|환자|투병|치료)|수술|입원|복용|먹고\s*있|약을?\s*먹|가족력|아버지|어머니|부모님|할아버지|할머니|형제|유전|담배|흡연|금연|술|음주|운동|수면|잠을|식습관|채식|임신|수유|키가|몸무게|체중|접종|백신|석면|분진|야간\s*근무|교대\s*근무/;
const MIN_LEN = 6;
const MAX_LEN = 1500;

export function shouldExtract(text) {
  const t = String(text ?? '').trim();
  return t.length >= MIN_LEN && GATE.test(t);
}

const FIELD_LINES = HEALTH_FIELDS.map((f) => `- ${f.id}: ${f.label} (${f.type === 'list' ? '문자열 배열' : f.type === 'number' ? '숫자' : '문자열'})`).join('\n');

export const CAPTURE_SYSTEM_PROMPT =
`당신은 사용자의 메시지에서 "사용자 본인의 건강 기록"으로 남길 사실만 뽑는 추출기다. 의사가 아니며 해석·진단·조언을 하지 않는다.

출력은 JSON 배열 하나뿐이다. 설명·코드펜스 금지. 해당 사실이 없으면 [].
각 항목: {"field":"<아래 필드 id>","value":<값>,"evidence":"<사용자 메시지에서 그대로 옮긴 근거 문장>"}

필드:
${FIELD_LINES}

규칙
1. 사용자가 본인에 대해 직접 말한 사실만 뽑는다. 타인(환자·친구·지인·가족의 현재 병)의 이야기, 질문, 가정("만약 ~라면"), 소설·예시, 일반 상식은 뽑지 않는다.
2. health.family_history는 사용자의 혈연 가족(부모·형제자매·조부모 등)의 질환만, "관계: 질환" 형식으로 쓴다(예: "아버지: 당뇨").
3. 없다·아니다는 진술은 목록 필드(conditions·surgeries·medications·allergies·vaccinations·family_history)에는 넣지 않는다. 문자열 필드(smoking·alcohol·exercise·sleep·diet·pregnancy)에는 사용자의 말 그대로("비흡연") 넣을 수 있다.
4. 진단명을 추정하거나 증상으로부터 병명을 만들지 않는다. 사용자가 "진단받았다/앓고 있다"고 말한 것만 health.conditions에 넣는다. 지금 겪는 일시적 증상(감기 기운, 오늘의 두통)은 넣지 않는다.
5. evidence는 사용자 메시지에 실제로 있는 문장을 그대로 쓴다(요약·바꿔 쓰기 금지, 200자 이내).
6. 이름·주민등록번호·연락처·주소는 값에 넣지 않는다.
7. 최대 5개.`;

/** LLM 응답 → 검증된 제안 목록. 근거가 원문에 없으면 버린다. */
export function parseExtraction(raw, userText) {
  let s = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let arr;
  try { arr = JSON.parse(s); } catch {
    const a = s.indexOf('['); const b = s.lastIndexOf(']');
    if (a < 0 || b <= a) return [];
    try { arr = JSON.parse(s.slice(a, b + 1)); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const squash = (x) => String(x ?? '').replace(/\s+/g, '').toLowerCase();
  const src = squash(userText);
  const grounded = arr.filter((p) => p && typeof p.evidence === 'string' && squash(p.evidence).length >= 2 && src.includes(squash(p.evidence)));
  return normalizeProposals(grounded);
}

/** 이미 같은 값이 기록에 있으면 제외한다(목록형은 새 항목만 남긴다). */
export function dropKnown(store, proposals) {
  const out = [];
  for (const p of proposals) {
    const cur = store.get(p.field);
    if (!cur) { out.push(p); continue; }
    if (Array.isArray(p.value)) {
      const have = new Set((Array.isArray(cur.value) ? cur.value : [cur.value]).map((x) => String(x).toLowerCase()));
      const fresh = p.value.filter((x) => !have.has(String(x).toLowerCase()));
      if (fresh.length) out.push({ ...p, value: fresh });
    } else if (String(cur.value) !== String(p.value)) out.push(p);
  }
  return out;
}

const previewValue = (v) => (Array.isArray(v) ? v.join(', ') : String(v));

export function renderCaptureHtml(proposals, bubbleId) {
  return `<div id="${esc(bubbleId)}" class="health-capture">🩺 말씀하신 내용을 <b>내 건강 기록</b>에 저장해 둘까요? <span style="color:var(--sub,#6b7280);font-size:12px">진료 상담(K-Doctor 등)이 요청할 때 내가 승인한 것만 전달됩니다.</span>` +
    `<ul style="margin:6px 0 8px 18px;padding:0">` +
    proposals.map((p, i) => `<li><label><input type="checkbox" data-prop="${i}" checked> <b>${esc(p.label)}</b>: ${esc(previewValue(p.value))}</label></li>`).join('') +
    `</ul><button type="button" data-act="approve" style="margin-right:8px">체크한 항목 저장</button><button type="button" data-act="deny">저장하지 않기</button></div>`;
}

export function isCaptureEnabled(storage = globalThis.localStorage) {
  try { return storage?.getItem('gopang_health_capture') !== 'off'; } catch { return true; }
}

const declined = new Set(); // 이 세션에서 거절한 항목(field|value)
const keyOf = (p) => p.field + '|' + previewValue(p.value).toLowerCase();

/**
 * @param {string} text  사용자 메시지
 * @param {{callLLM:(o:{systemPrompt:string,userMessage:string})=>Promise<string>, store:object, appendBubble:Function, getEl:(id:string)=>Element|null, enabled?:boolean}} ctx
 * @returns {Promise<'skipped'|'disabled'|'none'|'prompted'|'error'>}
 */
export async function captureHealthFromMessage(text, ctx) {
  try {
    if (ctx.enabled === false) return 'disabled';
    if (!shouldExtract(text)) return 'skipped';
    const userText = String(text).trim().slice(0, MAX_LEN);
    const raw = await ctx.callLLM({ systemPrompt: CAPTURE_SYSTEM_PROMPT, userMessage: userText });
    let props = dropKnown(ctx.store, parseExtraction(raw, userText)).filter((p) => !declined.has(keyOf(p)));
    if (!props.length) return 'none';
    const id = 'health-cap-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    ctx.appendBubble('ai', renderCaptureHtml(props, id), true);
    const root = ctx.getEl(id);
    if (!root) return 'error';
    let done = false;
    root.addEventListener('click', (ev) => {
      const act = ev.target?.getAttribute?.('data-act');
      if (!act || done) return;
      done = true;
      const checked = act === 'approve'
        ? [...root.querySelectorAll('input[data-prop]')].filter((i) => i.checked).map((i) => Number(i.getAttribute('data-prop')))
        : [];
      const saved = [];
      props.forEach((p, i) => {
        if (checked.includes(i)) { if (ctx.store.merge(p.field, p.value, { source: 'ac_conversation' }).ok) saved.push(p.label); }
        else declined.add(keyOf(p));
      });
      if (saved.length) ctx.store.appendLog({ service: 'ac', decision: 'ac_capture', applied: saved });
      root.innerHTML = saved.length ? `✅ 내 건강 기록에 저장했습니다: ${esc(saved.join(', '))}` : '저장하지 않았습니다.';
    });
    return 'prompted';
  } catch (e) {
    console.warn('[HealthCapture]', e?.message);
    return 'error';
  }
}

// ─────────────────────────── 조회·삭제 명령 ───────────────────────────

const RECORD_TRIGGERS = ['내 건강 기록', '건강 기록 보여', '건강기록 보여', '내 건강기록', '건강 기록 삭제', '건강기록 삭제', '건강 기록 지워', '건강기록 지워'];
export function isHealthRecordCommand(text) {
  const t = String(text ?? '').trim();
  return t.length <= 40 && RECORD_TRIGGERS.some((k) => t.includes(k));
}

export function renderRecordsHtml(store, bubbleId) {
  const nowMs = store.now();
  const snap = store.snapshot();
  const rows = Object.entries(HEALTH_GROUPS).map(([gid, g]) => {
    const items = HEALTH_FIELDS.filter((f) => f.group === gid && snap[f.id]).map((f) => {
      const e = snap[f.id];
      return `<li>${esc(f.label)}: ${esc(previewValue(e.value))} <span style="color:#6b7280;font-size:12px">(기준일 ${esc(e.asof)}${isStale(f, e, nowMs) ? ' · 오래됨' : ''})</span> <button type="button" data-del="${esc(f.id)}" style="font-size:12px">삭제</button></li>`;
    });
    return items.length ? `<div><b>${esc(g.label)}</b><ul style="margin:4px 0 8px 18px;padding:0">${items.join('')}</ul></div>` : '';
  }).join('');
  const log = store.log().slice(-5).reverse().map((l) => `<li>${esc(String(l.ts).slice(0, 16).replace('T', ' '))} · ${esc(l.service)} · ${esc(l.decision)}${l.provided?.length ? ` (제공 ${l.provided.length}개)` : ''}</li>`).join('');
  return `<div id="${esc(bubbleId)}">🩺 <b>내 건강 기록</b> — 이 기기에만 저장되어 있고, 진료 서비스가 요청할 때 내가 승인한 묶음만 전달됩니다.` +
    (rows || '<br><span style="color:#6b7280">저장된 기록이 없습니다. 대화 중 알려 주시면 저장 여부를 여쭙니다.</span>') +
    (log ? `<div style="margin-top:6px"><b>최근 제공·저장 내역</b><ul style="margin:4px 0 0 18px;padding:0;font-size:12px;color:#6b7280">${log}</ul></div>` : '') + '</div>';
}

export function showHealthRecords({ store, appendBubble, getEl }) {
  const id = 'health-rec-' + Date.now().toString(36);
  appendBubble('ai', renderRecordsHtml(store, id), true);
  const root = getEl(id);
  if (!root) return false;
  root.addEventListener('click', (ev) => {
    const f = ev.target?.getAttribute?.('data-del');
    if (!f || !fieldDef(f)) return;
    store.remove(f);
    store.appendLog({ service: 'ac', decision: 'user_deleted', applied: [f] });
    root.innerHTML = renderRecordsHtml(store, id).replace(/^<div id="[^"]*">/, '').replace(/<\/div>$/, '');
  });
  return true;
}

/** /deepseek(사용자 본인 guid, hondi-flash)를 부르는 호출자 — send-message.js의 Phase 7 호출자와 같은 경로·과금 원칙. */
export function buildCaptureLlmCaller({ endpoint, guid, fetchImpl = globalThis.fetch }) {
  return async ({ systemPrompt, userMessage }) => {
    const res = await fetchImpl(`${String(endpoint).replace(/\/+$/, '')}/deepseek`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'hondi-flash', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: 500, temperature: 0, guid: guid || null }),
    });
    if (!res.ok) throw new Error(`health capture llm http ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  };
}
