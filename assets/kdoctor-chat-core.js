/**
 * kdoctor-chat-core.js — K-Doctor 상담 창의 순수 로직 (2026-09-30)
 *
 * 브라우저 위젯(kdoctor-chat-widget.js)과 Node 유닛 테스트가 함께 쓴다. DOM·fetch에 의존하지 않고,
 * LLM 호출·SP 로딩·검증기는 deps로 주입받는다.
 *
 * 하는 일:
 *   1) 총괄 SP(SP-29)의 응답에서 [CONSULT_SPECIALIST: id=…, question=…]을 찾아 과목 SP를 대신 호출하고
 *      [CONSULT_SPECIALIST 결과 — …]로 되돌려 준다(서버에 이 프로토콜을 처리하는 코드가 없어 위젯이 대행).
 *      한 턴에 협진은 최대 MAX_CONSULTS_PER_TURN회. 레지스트리에 없는 id는 호출하지 않고 오류 결과를 돌려준다.
 *   2) [DIAGNOSIS_REPORT] JSON을 추출해 hondi-doctor-verdict.js로 재계산·제한하고 그 결과만 화면에 그린다.
 *      검증 실패는 1회 재생성 요청 후에도 실패하면 페일세이프(판단 유보 + 대면 진료 + 119 안내).
 *   3) 내부 태그·JSON 원문은 사용자에게 보이지 않게 걷어낸다.
 *
 * 하지 않는 것: 임상 판단. 저장(localStorage 등)도 하지 않는다 — 대화는 메모리에만 있다.
 */

export const MAX_CONSULTS_PER_TURN = 3;
export const MAX_CONSULT_ROUNDS = 3;
export const MAX_RETRY_ON_INVALID = 1;

export const FAILSAFE_TEXT =
  '지금은 결과를 안전하게 확인하지 못했습니다. 대면 진료를 받아 보세요. 숨쉬기 어렵거나 의식이 흐리거나 가슴이 조이는 등 위급하면 즉시 119에 연락하세요. 자해·자살 생각이 있으면 자살예방상담전화 109(24시간)에 연락하세요.';

// ─────────────── 파싱 ───────────────

export function parseConsults(text) {
  const out = [];
  const re = /\[CONSULT_SPECIALIST:\s*id=([A-Za-z0-9-]+)\s*,\s*question=([^\]]*)\]/g;
  let m;
  while ((m = re.exec(String(text ?? ''))) !== null) out.push({ id: m[1].trim(), question: m[2].trim() });
  return out;
}

export function extractReport(text) {
  const m = /\[DIAGNOSIS_REPORT\]([\s\S]*?)\[\/DIAGNOSIS_REPORT\]/.exec(String(text ?? ''));
  if (!m) return { found: false, report: null, error: null };
  let body = m[1].trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return { found: true, report: JSON.parse(body), error: null }; }
  catch (e) { return { found: true, report: null, error: 'json_parse_failed' }; }
}

/** 사용자에게 보이면 안 되는 내부 표식을 제거한다. */
export function stripInternal(text) {
  return String(text ?? '')
    .replace(/\[DIAGNOSIS_REPORT\][\s\S]*?\[\/DIAGNOSIS_REPORT\]/g, '')
    .replace(/\[CASE_STATE\][\s\S]*?\[\/CASE_STATE\]/g, '')
    .replace(/\[CONSULT_SPECIALIST:[^\]]*\]/g, '')
    .replace(/\[STEP-[^\]]*\]/g, '')
    .replace(/^\[K-Doctor v[^\]]*\]\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────── 과목 SP 조립(assemble-specialist.mjs와 같은 규칙) ───────────────

export const INCLUDE_MARK = '@@BASE_INCLUDE@@';

export function baseBody(baseText) {
  const i = baseText.indexOf('[조립 규칙]');
  if (i < 0) return baseText;
  const cut = baseText.lastIndexOf('====', i);
  return baseText.slice(0, cut > 0 ? cut : i).trimEnd() + '\n';
}

export function assembleSpecialist(specText, baseText) {
  if (!specText.includes(INCLUDE_MARK)) throw new Error('include_mark_missing');
  return specText.replace(INCLUDE_MARK, baseBody(baseText));
}

// ─────────────── 렌더링(HTML 문자열, 모든 값은 이스케이프) ───────────────

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderMarkdown(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>.+<\/li>\n?)+/g, (m) => '<ul>' + m + '</ul>');
  return s.split(/\n{2,}/).map((b) => {
    b = b.trim();
    if (!b) return '';
    if (/^<ul/.test(b)) return b;
    return '<p>' + b.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
}

const KIND_LABEL = {
  emergency_referral: '응급 안내', deferred: '판단 유보', conditional: '조건부 진단 참고', confirmed: '가능성이 가장 높은 진단 참고',
};
const TRIAGE_LABEL = { emergency: '응급', urgent: '24~48시간 내 진료 권고', routine: '일반' };
const TX_LABEL = { self_care: '자가 관리', otc: '일반의약품 수준 정보', prescription_drug: '전문의약품 계열', procedure: '시술·처치', referral: '의뢰' };
const BAND_LABEL = { high: '가능성 높음', medium: '가능성 중간', low: '가능성 낮음' };

/** view = audienceView() 반환값 { view, report }, validated = validateDiagnosis() 반환값 */
export function renderReportHtml(view, validated) {
  const r = view.report;
  const clin = view.view === 'clinician';
  const kind = validated.kind;
  const e = escapeHtml;
  let h = '<div class="kd-report">';
  if (kind === 'emergency_referral') {
    h += '<div class="kd-alert">⚠️ 지금 119에 연락하거나 가까운 응급실로 가십시오. 상담을 이어 가기 전에 먼저 도움을 받으세요.</div>';
  }
  h += `<div class="kd-kind kd-kind-${e(kind)}">${e(KIND_LABEL[kind] ?? kind)}</div>`;
  if (r.triage) {
    h += `<div class="kd-row"><span class="kd-k">긴급도</span><span class="kd-v">${e(TRIAGE_LABEL[r.triage.level] ?? r.triage.level)}</span></div>`;
    for (const f of r.triage.red_flags ?? []) h += `<div class="kd-flag">위험 신호 ${e(f.id)} — ${e(f.evidence)}</div>`;
  }
  const p = r.final?.primary;
  if (p?.name && (kind === 'confirmed' || kind === 'conditional')) {
    h += `<div class="kd-row"><span class="kd-k">진단 참고</span><span class="kd-v"><strong>${e(p.name)}</strong>${clin && p.icd10 ? ' (' + e(p.icd10) + ')' : ''}</span></div>`;
  }
  const alts = (r.final?.alternatives ?? []).filter((a) => a?.name);
  if (alts.length) h += `<div class="kd-row"><span class="kd-k">함께 고려</span><span class="kd-v">${alts.map((a) => e(a.name) + (clin && a.icd10 ? ' (' + e(a.icd10) + ')' : '')).join(', ')}</span></div>`;
  if ((r.hypotheses ?? []).length) {
    h += '<details class="kd-det"><summary>감별 가설' + (clin ? '과 근거' : '') + '</summary><ul>';
    for (const x of r.hypotheses) {
      h += `<li><strong>${e(x.name)}</strong>${clin && x.icd10 ? ' (' + e(x.icd10) + ')' : ''} — ${e(BAND_LABEL[x.probability_band] ?? '')}${x.must_not_miss ? ' · 놓치면 안 되는 진단' : ''}`;
      if (clin) {
        if ((x.supports ?? []).length) h += '<br>지지: ' + x.supports.map((s) => e(s.text) + ' <em>[' + e(s.basis) + ']</em>').join('; ');
        if ((x.against ?? []).length) h += '<br>반대: ' + x.against.map((s) => e(s.text) + ' <em>[' + e(s.basis) + ']</em>').join('; ');
      }
      h += '</li>';
    }
    h += '</ul></details>';
  }
  const tests = r.plan?.tests ?? [];
  if (tests.length) h += '<div class="kd-sec">검사 제안</div><ul>' + tests.map((t) => `<li>${e(t.name)} — ${e(t.purpose)}${t.urgency ? ' (' + e(t.urgency) + ')' : ''}</li>`).join('') + '</ul>';
  const txs = r.plan?.treatments ?? [];
  if (txs.length) {
    h += '<div class="kd-sec">처방/처치 제안</div><ul>';
    for (const t of txs) {
      h += `<li><em>${e(TX_LABEL[t.kind] ?? t.kind)}</em> — ${e(t.description)}${t.requires_clinician ? ' <span class="kd-tag">의사 판단 필요</span>' : ''}`;
      if (clin && t.dose) h += `<br>용량: ${e(t.dose.text)} <em>(출처: ${e(t.dose.source)}, 조회일 ${e(t.dose.asof)})</em>`;
      h += '</li>';
    }
    h += '</ul>';
  }
  const ret = r.plan?.followup?.return_if ?? [];
  if (ret.length || r.plan?.followup?.reassess_in_days) {
    h += '<div class="kd-sec">경과 관찰</div>';
    if (r.plan.followup.reassess_in_days) h += `<div>${e(r.plan.followup.reassess_in_days)}일 뒤 다시 상담하세요.</div>`;
    if (ret.length) h += '<div>이런 경우 바로 내원:</div><ul>' + ret.map((x) => `<li>${e(x)}</li>`).join('') + '</ul>';
  }
  const c = r.confidence;
  if (c) h += `<div class="kd-conf">확신도 — 임상 ${e(c.clinical)} · 정보 ${e(c.information)} · 종합 ${e(c.overall)} (코드가 재계산)</div>`;
  // 요약(임상/쉬운 말)
  h += '<div class="kd-sum">';
  if (clin && r.summary_clinical) h += `<div class="kd-sec">임상 요약</div><p>${e(r.summary_clinical)}</p>`;
  if (r.summary_plain) h += `<div class="kd-sec">쉬운 말 요약</div><p>${e(r.summary_plain)}</p>`;
  h += '</div>';
  if ((validated.changes ?? []).length) h += '<details class="kd-det"><summary>코드가 조정한 내역</summary><ul>' + validated.changes.map((x) => `<li>${e(x)}</li>`).join('') + '</ul></details>';
  if ((r.warnings ?? []).length) h += '<div class="kd-warn">' + r.warnings.map(e).join(' · ') + '</div>';
  h += '<div class="kd-foot">진단서·처방전이 아니며, 실제 진단·처방·처치는 진료하는 의사가 합니다.</div></div>';
  return h;
}

// ─────────────── 한 턴 실행 ───────────────

/**
 * deps: {
 *   callLLM(system, messages, maxTokens) → Promise<string>,
 *   orchestratorSP: string,
 *   loadSpecialist(id) → Promise<string>  // 조립된 과목 SP 본문
 *   registry: { specialties:[{id,name_ko,...}] },
 *   validate(report, audience) → validated,
 *   audienceView(validated, audience) → view,
 * }
 * @returns {{ history, view: {type:'text'|'report'|'failsafe', text?, html?, consults:[{id,ok}]} }}
 */
export async function runTurn(history, userText, deps) {
  const registry = new Map((deps.registry?.specialties ?? []).map((s) => [s.id, s]));
  const work = [...history, { role: 'user', content: userText }];
  const consultLog = [];
  let calls = 0;
  let reply = '';

  for (let round = 0; round <= MAX_CONSULT_ROUNDS; round++) {
    reply = await deps.callLLM(deps.orchestratorSP, work, 3500);
    const wanted = parseConsults(reply);
    if (!wanted.length || round === MAX_CONSULT_ROUNDS) break;
    work.push({ role: 'assistant', content: reply });
    const results = [];
    const seen = new Set();
    for (const w of wanted) {
      const key = w.id + '|' + w.question;
      if (seen.has(key)) continue;
      seen.add(key);
      if (calls >= MAX_CONSULTS_PER_TURN) { results.push('[CONSULT_SPECIALIST 결과 — 호출 한도]\n이 턴의 협진 호출 한도(' + MAX_CONSULTS_PER_TURN + '회)를 넘어 호출하지 않았다. 지금까지의 소견으로 결론을 내라.'); continue; }
      const spec = registry.get(w.id);
      if (!spec) { consultLog.push({ id: w.id, ok: false }); results.push(`[CONSULT_SPECIALIST 결과 — 오류]\n존재하지 않는 과목 id: ${w.id}. 등록된 과목만 호출할 수 있다.`); continue; }
      calls++;
      try {
        const sp = await deps.loadSpecialist(w.id);
        const out = await deps.callLLM(sp, [{ role: 'user', content: w.question }], 2500);
        consultLog.push({ id: w.id, ok: true });
        results.push(`[CONSULT_SPECIALIST 결과 — ${spec.name_ko}]\n${String(out).slice(0, 6000)}`);
      } catch (err) {
        consultLog.push({ id: w.id, ok: false });
        results.push(`[CONSULT_SPECIALIST 결과 — 오류]\n${spec.name_ko} 협진 호출 실패. 이 과목 소견 없이 판단하고 그 사실을 결과에 밝혀라.`);
      }
    }
    work.push({ role: 'user', content: results.join('\n\n') });
  }

  // 보고서 검증(무효면 1회 재생성)
  let ex = extractReport(reply);
  if (!ex.found) {
    const text = stripInternal(reply) || FAILSAFE_TEXT;
    return { history: [...history, { role: 'user', content: userText }, { role: 'assistant', content: reply }], view: { type: 'text', text, consults: consultLog } };
  }
  let validated = ex.report ? deps.validate(ex.report, deps.audience) : null;
  for (let retry = 0; retry < MAX_RETRY_ON_INVALID && (!validated || !validated.ok); retry++) {
    const why = !ex.report ? ex.error : validated.errors.join(', ');
    work.push({ role: 'assistant', content: reply });
    work.push({ role: 'user', content: `[시스템] 결과 검증 실패(${why}). 부록 A 형식과 강제규칙을 지켜 [DIAGNOSIS_REPORT]를 다시 내라. 금지 표현(확진·진단서·처방전·퇴원·완치 판정)을 쓰지 말고, 복귀 기준(return_if)을 포함하라.` });
    reply = await deps.callLLM(deps.orchestratorSP, work, 3500);
    ex = extractReport(reply);
    validated = ex.report ? deps.validate(ex.report, deps.audience) : null;
  }
  const newHistory = [...history, { role: 'user', content: userText }];
  if (!validated || !validated.ok) {
    // 페일세이프. 검증에 실패한 원문은 사용자에게 보이지 않고 대화 이력에도 넣지 않는다.
    newHistory.push({ role: 'assistant', content: '(결과 검증 실패로 표시하지 않음 — 판단 유보, 대면 진료 권고)' });
    return { history: newHistory, view: { type: 'failsafe', text: FAILSAFE_TEXT, consults: consultLog } };
  }
  newHistory.push({ role: 'assistant', content: reply });
  const view = deps.audienceView(validated, deps.audience);
  // 카드만 보여 준다: 검증기가 다시 계산·제한한 값이므로, 원문 자연어 요약(미검증 표현이 섞일 수 있음)은 숨긴다.
  return { history: newHistory, view: { type: 'report', html: renderReportHtml(view, validated), kind: validated.kind, consults: consultLog } };
}
