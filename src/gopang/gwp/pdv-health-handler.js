/**
 * gwp/pdv-health-handler.js — 건강 기록 PDV 요청·갱신 제안의 AC(나만의 AI 비서) 쪽 처리 (2026-10-01)
 *
 * engine.js의 postMessage 수신부가 GWP_PDV_REQUEST(health.* 필드 포함)·GWP_PDV_UPDATE_PROPOSAL을 이 모듈로 넘긴다.
 * origin 검증(등록된 서비스 오리진)은 engine.js가 이미 했다. 여기서는 그 위에 한 겹을 더한다:
 *   - 건강 기록은 HEALTH_DATA_REQUESTERS(서비스 id + origin + 목적)에 있는 서비스만 요청할 수 있다(기본 거부).
 *   - 그룹 단위로 사용자가 승인하고, 기록에 없는 항목은 그 자리에서 직접 입력할 수 있다(→ PDV에 user_stated로 저장).
 *   - 모든 제공·거부는 access log에 남는다.
 * DOM 이벤트는 인라인 onclick이 아니라 addEventListener로 묶는다.
 */
import {
  HEALTH_GROUPS, HEALTH_FIELDS, isHealthField, fieldDef, isPermittedRequester, answerHealthRequest,
  normalizeProposals, applyProposals, createHealthStore, localStorageAdapter, isStale,
} from '../pdv/health-profile.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function getAcHealthStore() {
  if (!globalThis.__gopangHealthStore) {
    const store = createHealthStore({
      records: localStorageAdapter('gopang_health_v1'),
      access: localStorageAdapter('gopang_health_access_v1'),
    });
    globalThis.__gopangHealthStore = store;
    // AC(나만의 AI 비서)가 대화 중 건강 기록을 만들고 갱신할 때 쓰는 진입점. 서비스 탭은 이 객체에 접근할 수 없다(탭 간 전역 분리).
    globalThis.gopangHealthPDV = {
      get: (id) => store.get(id), set: (id, v, meta) => store.set(id, v, meta), merge: (id, v, meta) => store.merge(id, v, meta),
      remove: (id) => store.remove(id), snapshot: () => store.snapshot(), log: () => store.log(),
      // 대화 중 건강 사실 자동 추출(health-capture.js) 켜기/끄기 — 기본 켜짐, 저장은 항상 사용자 승인 후
      setCapture: (on) => { try { globalThis.localStorage.setItem('gopang_health_capture', on ? 'on' : 'off'); } catch { /* 저장소 불가 시 무시 */ } },
    };
  }
  return globalThis.__gopangHealthStore;
}

const cleanId = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null);

export function requestedHealthFields(fields) {
  return [...new Set(Array.isArray(fields) ? fields : [])].filter((f) => typeof f === 'string' && isHealthField(f)).slice(0, 20);
}

// ─────────────────────────── 모델·HTML ───────────────────────────

export function previewValue(v) {
  const s = Array.isArray(v) ? v.join(', ') : String(v);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

export function buildRequestModel(store, fields, reason, svcName) {
  const nowMs = store.now();
  const groups = Object.entries(HEALTH_GROUPS).map(([id, g]) => ({
    id, label: g.label,
    fields: fields.filter((f) => fieldDef(f).group === id).map((f) => {
      const def = fieldDef(f); const e = store.get(f);
      return { id: f, label: def.label, filled: !!e, preview: e ? previewValue(e.value) : '', asof: e?.asof ?? null, stale: e ? isStale(def, e, nowMs) : false, type: def.type };
    }),
  })).filter((g) => g.fields.length);
  return { svcName, reason: String(reason ?? '').slice(0, 200), groups };
}

export function renderRequestHtml(model, bubbleId) {
  const rows = model.groups.map((g) =>
    `<div class="pdv-h-group"><label><input type="checkbox" data-group="${esc(g.id)}" checked> <b>${esc(g.label)}</b></label><ul style="margin:4px 0 8px 18px;padding:0">` +
    g.fields.map((f) => `<li>${esc(f.label)}: ` + (f.filled
      ? `${esc(f.preview)} <span style="color:#6b7280;font-size:12px">(기준일 ${esc(f.asof)}${f.stale ? ' · 오래됨 — 받는 쪽에서 다시 확인합니다' : ''})</span>`
      : `<span style="color:#6b7280">기록 없음</span> <input type="text" data-field="${esc(f.id)}" placeholder="지금 입력(선택)" style="margin-left:6px;padding:2px 6px;font-size:12px;width:150px">`) + '</li>').join('') +
    '</ul></div>').join('');
  return `<div id="${esc(bubbleId)}" class="pdv-health-req">🔒 <b>${esc(model.svcName)}</b>이(가) 진단 참고를 위해 건강 기록을 요청합니다.<br>` +
    `<span style="color:var(--sub,#6b7280);font-size:13px">사유: ${esc(model.reason || '(사유 미제공)')}</span><br><br>${rows}` +
    `<div style="color:var(--sub,#6b7280);font-size:12px;margin-bottom:8px">체크한 묶음만 전달됩니다. 기록에 없는 항목은 "없음"이 아니라 "기록 없음"으로 전달되고, 전달 내역은 접근 기록에 남습니다.</div>` +
    `<button type="button" data-act="approve" style="margin-right:8px">선택한 항목 제공</button><button type="button" data-act="deny">거부하기</button></div>`;
}

export function readForm(root) {
  const approvedGroups = [...root.querySelectorAll('input[data-group]')].filter((i) => i.checked).map((i) => i.getAttribute('data-group'));
  const typed = {};
  for (const i of root.querySelectorAll('input[data-field]')) { const v = String(i.value ?? '').trim(); if (v) typed[i.getAttribute('data-field')] = v; }
  return { approvedGroups, typed };
}

// ─────────────────────────── 요청 처리 ───────────────────────────

/**
 * @param {{msg:object, source:Window, origin:string, service:{id:string,name?:string}|null, appendBubble:Function,
 *          getEl:(id:string)=>Element|null, store:object}} ctx
 * @returns {'denied_service'|'invalid'|'prompted'}
 */
export function handleHealthPdvRequest({ msg, source, origin, service, appendBubble, getEl, store }) {
  const request_id = cleanId(msg?.request_id);
  const reply = (extra) => source.postMessage({ type: 'GWP_PDV_RESPONSE', request_id, ...extra }, origin);
  if (!request_id) return 'invalid';
  const fields = requestedHealthFields(msg.fields);
  const purpose = typeof msg.purpose === 'string' ? msg.purpose : 'diagnosis_support';
  const svcName = service?.name || origin;
  if (!fields.length) { reply({ approved: false, values: null, reason: 'no_valid_fields' }); return 'invalid'; }
  if (!service || !isPermittedRequester(service.id, origin, purpose)) {
    store.appendLog({ service: service?.id ?? origin, decision: 'auto_denied_service', provided: [], withheld: fields, reason: 'service_not_permitted' });
    appendBubble('ai', `🚫 <b>${esc(svcName)}</b>이(가) 건강 기록을 요청했지만, 이 서비스는 건강 기록을 받을 수 있는 서비스가 아니라서 자동으로 거부했습니다.`, true);
    reply({ approved: false, values: null, reason: 'service_not_permitted' });
    return 'denied_service';
  }
  const bubbleId = 'pdv-health-' + request_id;
  const model = buildRequestModel(store, fields, msg.reason, svcName);
  appendBubble('ai', renderRequestHtml(model, bubbleId), true);
  const root = getEl(bubbleId);
  if (!root) { reply({ approved: false, values: null, reason: 'ui_unavailable' }); return 'invalid'; }
  let done = false;
  root.addEventListener('click', (ev) => {
    const act = ev.target?.getAttribute?.('data-act');
    if (!act || done) return;
    done = true;
    if (act === 'deny') {
      store.appendLog({ service: service.id, decision: 'denied', provided: [], withheld: fields, reason: model.reason });
      root.innerHTML = '🚫 건강 기록 제공을 거부했습니다.';
      reply({ approved: false, values: null });
      return;
    }
    const { approvedGroups, typed } = readForm(root);
    const saved = []; const rejectedInput = [];
    for (const [id, raw] of Object.entries(typed)) {
      if (!fields.includes(id) || !approvedGroups.includes(fieldDef(id).group)) continue;
      const r = store.set(id, raw, { source: 'user_stated' });
      (r.ok ? saved : rejectedInput).push(fieldDef(id).label);
    }
    const ans = answerHealthRequest(store, fields, approvedGroups);
    store.appendLog({ service: service.id, decision: approvedGroups.length ? 'approved' : 'denied', provided: ans.provided, withheld: ans.withheld, missing: ans.missing, reason: model.reason });
    root.innerHTML = `✅ 건강 기록을 제공했습니다: ${esc(ans.provided.map((f) => fieldDef(f).label).join(', ') || '없음')}` +
      (ans.missing.length ? `<br><span style="color:#6b7280;font-size:13px">기록 없음: ${esc(ans.missing.map((f) => fieldDef(f).label).join(', '))}</span>` : '') +
      (saved.length ? `<br><span style="color:#6b7280;font-size:13px">방금 입력한 ${esc(saved.join(', '))}은(는) 내 건강 기록에 저장했습니다.</span>` : '') +
      (rejectedInput.length ? `<br><span style="color:#92400e;font-size:13px">형식이 맞지 않아 저장하지 못함: ${esc(rejectedInput.join(', '))}</span>` : '');
    reply({ approved: approvedGroups.length > 0, approved_groups: approvedGroups, values: approvedGroups.length ? ans.values : null });
  });
  return 'prompted';
}

// ─────────────────────────── 갱신 제안 처리 ───────────────────────────

export function renderProposalHtml(proposals, svcName, reason, bubbleId) {
  return `<div id="${esc(bubbleId)}">📝 <b>${esc(svcName)}</b>이(가) 이번 상담에서 말씀하신 내용을 내 건강 기록에 저장하자고 제안합니다.<br>` +
    `<span style="color:var(--sub,#6b7280);font-size:13px">${esc(String(reason ?? '').slice(0, 200))}</span><ul style="margin:6px 0 8px 18px;padding:0">` +
    proposals.map((p, i) => `<li><label><input type="checkbox" data-prop="${i}"> <b>${esc(p.label)}</b>: ${esc(previewValue(p.value))} <span style="color:#6b7280;font-size:12px">(근거: ${esc(p.evidence)})</span></label></li>`).join('') +
    `</ul><div style="color:var(--sub,#6b7280);font-size:12px;margin-bottom:8px">체크한 항목만 저장됩니다. 진단 참고나 추정 병명은 저장되지 않습니다.</div>` +
    `<button type="button" data-act="approve" style="margin-right:8px">체크한 항목 저장</button><button type="button" data-act="deny">저장하지 않기</button></div>`;
}

export function handleHealthUpdateProposal({ msg, source, origin, service, appendBubble, getEl, store }) {
  const request_id = cleanId(msg?.request_id);
  const reply = (extra) => source.postMessage({ type: 'GWP_PDV_UPDATE_RESULT', request_id, ...extra }, origin);
  if (!request_id) return 'invalid';
  if (!service || !isPermittedRequester(service.id, origin, 'diagnosis_support')) {
    reply({ applied: [], rejected: [], reason: 'service_not_permitted' });
    return 'denied_service';
  }
  const proposals = normalizeProposals(msg.proposals);
  if (!proposals.length) { reply({ applied: [], rejected: [], reason: 'no_valid_proposals' }); return 'invalid'; }
  const bubbleId = 'pdv-prop-' + request_id;
  appendBubble('ai', renderProposalHtml(proposals, service.name || origin, msg.reason, bubbleId), true);
  const root = getEl(bubbleId);
  if (!root) { reply({ applied: [], rejected: proposals.map((p) => p.field), reason: 'ui_unavailable' }); return 'invalid'; }
  let done = false;
  root.addEventListener('click', (ev) => {
    const act = ev.target?.getAttribute?.('data-act');
    if (!act || done) return;
    done = true;
    const checked = act === 'approve'
      ? [...root.querySelectorAll('input[data-prop]')].filter((i) => i.checked).map((i) => proposals[Number(i.getAttribute('data-prop'))].field)
      : [];
    const res = applyProposals(store, proposals, checked);
    store.appendLog({ service: service.id, decision: 'update_proposal', applied: res.applied, declined: proposals.map((p) => p.field).filter((f) => !res.applied.includes(f)) });
    root.innerHTML = res.applied.length ? `✅ 내 건강 기록에 저장했습니다: ${esc(res.applied.map((f) => fieldDef(f).label).join(', '))}` : '🚫 저장하지 않았습니다.';
    reply({ applied: res.applied, rejected: res.rejected });
  });
  return 'prompted';
}
