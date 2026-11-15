/**
 * ui/conversation-log.js — SP(대화 상대)별 대화 기록과 재개(2026-11-16, 주피터 지시).
 * "어느 SP와 어떤 대화를 했는지" 이 기기에 남겨 두었다가, 다시 그 SP를 부를 때 이전 대화를 이어서 전달한다.
 *  - 저장·불러오기는 LLM(어느 SP)이 아니라 이 코드가 맡는다. 나비(AC)는 "누구와 이어갈지"만 정한다.
 *  - 저장 위치는 이 기기뿐이다(PDV 원칙: 서버에는 해시만, 원문은 로컬). 서버로 보내지 않는다.
 *    2026-08-20 해시 전용 재설계로 서버의 /owner-pdv/self-history 는 410 이 되었고 "기기 로컬 재구현"이 비어 있었다 — 이 모듈이 그 자리다.
 *  - 순수 함수(저장소를 인자로 받음)라 시험하기 쉽다. 브라우저에서는 localStorage 어댑터를 쓴다.
 * 상대 구분: { kind: 'person'|'expert'|'institution'|'service', id, name }
 */
const KEY_PREFIX = 'hondi_conv_log_v1:';
export const MAX_TURNS = 60;          // 상대 한 명당 보관하는 최근 턴 수
export const MAX_TURN_CHARS = 2000;   // 한 턴 최대 글자 수(넘으면 자른다)
export const MAX_THREADS = 100;       // 목록이 넘치면 오래 안 쓴 상대부터 지운다

export function storageKey(guid) { return KEY_PREFIX + (guid || 'anon'); }
export function counterpartKey(cp) {
  if (!cp || !cp.kind || !cp.id) return '';
  return `${cp.kind}:${String(cp.id).replace(/^@/, '').toLowerCase()}`;
}

function load(storage, guid) {
  try {
    const o = JSON.parse(storage.getItem(storageKey(guid)) || '{}');
    return o && typeof o === 'object' && o.threads && typeof o.threads === 'object' ? o : { threads: {} };
  } catch { return { threads: {} }; }
}
function save(storage, guid, o) {
  const keys = Object.keys(o.threads);
  if (keys.length > MAX_THREADS) {
    keys.sort((a, b) => (o.threads[a].updatedAt || 0) - (o.threads[b].updatedAt || 0))
      .slice(0, keys.length - MAX_THREADS).forEach(k => delete o.threads[k]);
  }
  try { storage.setItem(storageKey(guid), JSON.stringify(o)); return true; }
  catch {                                     // 저장 공간 부족 — 가장 오래된 절반의 턴을 줄여 한 번 더 시도
    for (const k of Object.keys(o.threads)) o.threads[k].turns = (o.threads[k].turns || []).slice(-Math.floor(MAX_TURNS / 3));
    try { storage.setItem(storageKey(guid), JSON.stringify(o)); return true; } catch { return false; }
  }
}

/** 한 턴을 기록한다. role: 'user' | 'assistant'. 글이 아닌 내용(이미지 등)은 호출부가 글로 바꿔 넘긴다. */
export function appendTurn(storage, guid, cp, role, text, now = Date.now()) {
  const key = counterpartKey(cp);
  const t = String(text == null ? '' : text).trim();
  if (!key || !t || (role !== 'user' && role !== 'assistant')) return false;
  const o = load(storage, guid);
  const th = o.threads[key] || { kind: cp.kind, id: String(cp.id), name: cp.name || '', turns: [], summary: '', createdAt: now };
  if (cp.name) th.name = cp.name;
  th.turns.push({ role, text: t.length > MAX_TURN_CHARS ? t.slice(0, MAX_TURN_CHARS) + '…' : t, ts: now });
  if (th.turns.length > MAX_TURNS) th.turns = th.turns.slice(-MAX_TURNS);
  th.updatedAt = now;
  o.threads[key] = th;
  return save(storage, guid, o);
}

/** 이 상대와의 대화 요약을 저장한다(요약은 호출부가 만들어 넘긴다 — 길어진 기록을 줄이는 용도). */
export function setSummary(storage, guid, cp, summary, now = Date.now()) {
  const key = counterpartKey(cp);
  const o = load(storage, guid);
  if (!key || !o.threads[key]) return false;
  o.threads[key].summary = String(summary || '').slice(0, 1500);
  o.threads[key].updatedAt = now;
  return save(storage, guid, o);
}

export function loadThread(storage, guid, cp) {
  const key = counterpartKey(cp);
  return key ? (load(storage, guid).threads[key] || null) : null;
}

/** 최근에 대화한 순서로 상대 목록. */
export function listThreads(storage, guid) {
  const o = load(storage, guid);
  return Object.entries(o.threads)
    .map(([key, th]) => ({ key, kind: th.kind, id: th.id, name: th.name, updatedAt: th.updatedAt || 0, turns: (th.turns || []).length,
                           last: ((th.turns || []).slice(-1)[0] || {}).text || '' }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function forgetThread(storage, guid, cp) {
  const key = counterpartKey(cp);
  const o = load(storage, guid);
  if (!key || !o.threads[key]) return false;
  delete o.threads[key];
  return save(storage, guid, o);
}

/**
 * 다시 그 상대를 부를 때 SP 에 덧붙일 "이전 대화" 글. 기록이 없으면 ''.
 * 요약이 있으면 요약 + 최근 몇 턴, 없으면 최근 몇 턴만. 전체 길이는 maxChars 안으로 맞춘다(오래된 턴부터 버린다).
 */
export function buildResumeContext(thread, { maxTurns = 8, maxChars = 2400 } = {}) {
  if (!thread || !Array.isArray(thread.turns) || !thread.turns.length) return '';
  const label = (r) => (r === 'user' ? '사용자' : (thread.name || '상대'));
  let recent = thread.turns.slice(-maxTurns);
  const head = '[이전 대화 이어가기 — 이 사용자와 이전에 나눈 대화입니다. 처음 만나는 것처럼 인사하지 말고, 맥락을 이어서 답하세요. 기록에 없는 내용은 지어내지 마세요.]\n'
    + (thread.summary ? '요약: ' + thread.summary + '\n' : '');
  const fmt = (turns) => turns.map(t => `${label(t.role)}: ${t.text}`).join('\n');
  let body = fmt(recent);
  while (recent.length > 1 && (head.length + body.length) > maxChars) { recent = recent.slice(1); body = fmt(recent); }
  if ((head.length + body.length) > maxChars) body = body.slice(-(maxChars - head.length));
  return head + '최근 대화:\n' + body;
}
