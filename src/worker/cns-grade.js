// ═════════════════════════════════════════════════
// cns-grade.js — 나비웹 전문가 인증서(CNS) 시험 서술형 채점
//   POST /cns/grade  { level, round, items:[{id,q,max,rubric:[{p,s}],model,answer}] } + 로그인 증명
//   → { ok, results:[{id, score, max, points, feedback}] }
// SP: AC-CNS-GRADER(prompts/sp-catalog.json). LLM은 항목별 점수(points)만 내고,
// 합계·상한·합격 판단은 이 파일이 한다(LLM이 말한 합계는 쓰지 않는다).
// ═════════════════════════════════════════════════
export const SP_KEY = 'AC-CNS-GRADER';
export const LIMITS = { maxItems: 4, maxAnswer: 600, maxRubric: 8, maxQ: 600 };

function json(obj, status = 200, cors = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}

export function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > LIMITS.maxItems) return 'items는 1~' + LIMITS.maxItems + '개여야 합니다';
  const seen = new Set();
  for (const it of items) {
    if (!it || typeof it.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(it.id) || seen.has(it.id)) return '문항 id가 올바르지 않습니다';
    seen.add(it.id);
    if (typeof it.q !== 'string' || !it.q || it.q.length > LIMITS.maxQ) return '문제가 올바르지 않습니다';
    if (!Number.isInteger(it.max) || it.max < 1 || it.max > 100) return '만점이 올바르지 않습니다';
    if (!Array.isArray(it.rubric) || it.rubric.length < 1 || it.rubric.length > LIMITS.maxRubric) return '채점 기준표가 올바르지 않습니다';
    let sum = 0;
    for (const r of it.rubric) {
      if (!r || typeof r.p !== 'string' || !Number.isInteger(r.s) || r.s < 0 || r.s > it.max) return '채점 기준표 항목이 올바르지 않습니다';
      sum += r.s;
    }
    if (sum !== it.max) return '채점 기준표의 배점 합이 만점과 다릅니다';
    if (typeof it.model !== 'string') return '모범 답안이 필요합니다';
    if (typeof it.answer !== 'string') return '답안이 필요합니다';
  }
  return null;
}

export function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* 앞뒤 군더더기가 있으면 첫 {…} 만 시도 */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

// LLM 응답 → 항목별 점수(정수, 0~배점으로 잘라냄). 형식이 틀리면 null.
export function scoreFromLlm(item, parsed) {
  if (!parsed || !Array.isArray(parsed.points) || parsed.points.length !== item.rubric.length) return null;
  const points = [];
  for (let i = 0; i < item.rubric.length; i++) {
    const v = Number(parsed.points[i]);
    if (!Number.isFinite(v)) return null;
    points.push(Math.max(0, Math.min(item.rubric[i].s, Math.floor(v))));
  }
  const score = Math.min(item.max, points.reduce((a, b) => a + b, 0));
  const feedback = typeof parsed.feedback === 'string' ? parsed.feedback.trim().slice(0, 400) : '';
  return { score, points, feedback };
}

export function makeCnsGradeHandler({ caller, err, fetchSp, deepseekChatText, resolveDeepseekModel }) {
  async function gradeOne(env, sp, item) {
    const answer = item.answer.trim().slice(0, LIMITS.maxAnswer);
    if (!answer) return { id: item.id, score: 0, max: item.max, points: item.rubric.map(() => 0), feedback: '답안이 비어 있습니다.' };
    const user = JSON.stringify({ question: item.q, max: item.max, rubric: item.rubric, model_answer: item.model, answer });
    const text = await deepseekChatText({
      env, model: resolveDeepseekModel('deepseek-v4-flash'),
      messages: [{ role: 'system', content: sp }, { role: 'user', content: user }],
      max_tokens: 600, temperature: 0, timeoutMs: 40000, fallbackText: '',
    });
    const r = scoreFromLlm(item, parseJsonLoose(text));
    if (!r) return null;
    return { id: item.id, score: r.score, max: item.max, points: r.points, feedback: r.feedback };
  }

  return async function cnsGrade(request, env, cors) {
    let body;
    try { body = await request.json(); } catch { return err(400, 'BAD_JSON', '요청 형식이 올바르지 않습니다', cors); }
    const who = await caller(env, body);
    if (!who.ok) return err(401, who.code || 'AUTH_REQUIRED', who.message || '로그인 증명이 필요합니다', cors);
    const bad = validateItems(body.items);
    if (bad) return err(400, 'BAD_ITEMS', bad, cors);
    let sp;
    try { sp = await fetchSp(env); } catch { return err(503, 'SP_UNAVAILABLE', '채점 기준을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요', cors); }
    const out = await Promise.all(body.items.map((it) => gradeOne(env, sp, it).catch(() => null)));
    if (out.some((x) => !x)) return err(502, 'GRADE_FAILED', '채점 결과를 받지 못했습니다. 다시 시도해 주세요', cors);
    return json({ ok: true, results: out }, 200, cors);
  };
}
