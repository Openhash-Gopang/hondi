// ═════════════════════════════════════════════════
// 서식 DB 클라이언트 (2026-10-14 신설) — 전문가 페르소나 채팅(expert-chat)이 SP_DOC_FORM 태그를 실행하는 쪽.
//
//   [FORM_LOOKUP: agency=대법원 | name=이혼 소장 | form_no=]          → 서식 DB 조회 (/doc-form/find)
//   [FORM_SAVE_PROPOSAL: agency=… | name=… | form_no=… | class=A | version_date=2026-01 | source=user_attached]
//   …빈 서식 본문(개인·사안 값을 모두 지운 것)…
//   [/FORM_SAVE_PROPOSAL]                                              → 이용자 동의 후 저장 (/doc-form/save)
//
// 순수 함수 + 주입형 fetch/지갑이라 node 테스트가 가능하다. 서명 메시지·개인정보 탐지는 서버 핸들러의 것을 그대로 가져다 쓴다(드리프트 방지).
// ═════════════════════════════════════════════════
import { findPii, normBody, sha256Hex, saveMessage } from '../../worker/doc-form-handler.js';
import { REWARD_RULES, rateMessage, mineMessage } from '../../worker/doc-form-reward.js';

export const LOOKUP_RE = /\[FORM_LOOKUP:\s*([^\]]*)\]/;
export const PROPOSAL_RE = /\[FORM_SAVE_PROPOSAL:\s*([^\]]*)\]([\s\S]*?)\[\/FORM_SAVE_PROPOSAL\]/;

function parseAttrs(s) {
  const out = {};
  for (const part of String(s).split('|')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

export function parseLookup(text) {
  const m = String(text).match(LOOKUP_RE);
  if (!m) return null;
  const a = parseAttrs(m[1]);
  if (!a.agency || !a.name) return null;
  return { agency: a.agency, name: a.name, formNo: a.form_no || '' };
}

export function parseProposal(text) {
  const m = String(text).match(PROPOSAL_RE);
  if (!m) return null;
  const a = parseAttrs(m[1]);
  const body = normBody(m[2]);
  if (!a.agency || !a.name || !body) return null;
  return {
    agency: a.agency, name: a.name, formNo: a.form_no || '',
    formClass: a.class === 'B' ? 'B' : 'A',
    versionDate: a.version_date || '',
    source: a.source === 'ai_composed' ? 'ai_composed' : 'user_attached',
    body,
  };
}

// 화면·대화 이력에서 태그를 지운다. 제안 본문은 저장 카드에서 보여주므로 말풍선에서는 뺀다.
export function stripFormTags(text) {
  return String(text).replace(PROPOSAL_RE, '').replace(LOOKUP_RE, '').trim();
}

export async function findForm(worker, { agency, name, formNo = '' }, fetchImpl = fetch) {
  const q = `agency=${encodeURIComponent(agency)}&name=${encodeURIComponent(name)}&form_no=${encodeURIComponent(formNo)}`;
  const res = await fetchImpl(`${worker}/doc-form/find?${q}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.message || `서식 조회 실패 (HTTP ${res.status})`);
  return j.found ? j.form : null;
}

// 조회 결과를 대화에 되먹일 때 쓰는 문장. 상태 안내문(notice)을 반드시 포함한다(SP_DOC_FORM §4-2).
export function lookupResultText(form, req) {
  if (!form) return `[서식 DB 조회 결과] ${req.agency} / ${req.name}: 없음. SP_DOC_FORM §3-1 다음 순서(첨부 요청 → 임의 구성)로 진행하세요.`;
  return `[서식 DB 조회 결과] ${form.agency} / ${form.name}${form.formNo ? ' (' + form.formNo + ')' : ''} v${form.version}\n` +
    `상태: ${form.status} · 기준일: ${form.versionDate || '확인 필요'}\n안내(이용자에게 그대로 전할 것): ${form.notice}\n\n` +
    `--- 서식 본문 ---\n${form.body}`;
}

// 저장 전 점검 — 서버가 다시 막지만, 이용자에게 먼저 보여주려는 것.
export function precheckProposal(p) {
  const pii = findPii(p.body);
  return pii.length ? { ok: false, found: pii } : { ok: true, found: [] };
}

export async function saveForm(worker, wallet, guid, p, { persona = '', sourceNote = '', now = Date.now, fetchImpl = fetch } = {}) {
  const ts = now();
  const body = normBody(p.body);
  const sig = await wallet.signPayload(saveMessage(p.agency, p.name, p.formNo, ts, await sha256Hex(body)));
  const res = await fetchImpl(`${worker}/doc-form/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agency: p.agency, name: p.name, form_no: p.formNo, form_class: p.formClass, body,
      version_date: p.versionDate, source: p.source, source_note: sourceNote, persona,
      consent: true, guid, ts, sig,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) return { ok: false, code: j.code || 'HTTP_' + res.status, message: j.message || '저장하지 못했습니다.' };
  return { ok: true, duplicate: !!j.duplicate, form: j.form };
}

// ── 첨부 파일 처리 ─────────────────────────────────────
export const TEXT_EXT = /\.(txt|md|csv)$/i;
export const MAX_TEXT_CHARS = 20000;

// 첨부를 대화 메시지 내용으로 바꾼다. 읽지 못한 형식은 "읽지 못함"과 이유를 명시해 모델이 내용을 지어내지 않게 한다(SP_DOC_FORM §3-2).
export function attachmentToText(att) {
  if (att.text != null) {
    const t = att.text.length > MAX_TEXT_CHARS ? att.text.slice(0, MAX_TEXT_CHARS) + '\n…(이하 생략)' : att.text;
    return `[첨부 파일: ${att.name} — 본문${att.note ? ' · ' + att.note : ''}]\n${t}`;
  }
  const why = att.reason || `이 형식(${(att.name.split('.').pop() || '').toUpperCase()})은 아직 열 수 없습니다.`;
  return `[첨부 파일: ${att.name} — 내용을 읽지 못함. ${why} ` +
    `내용을 추측하지 말고, 이용자에게 사진 촬영(또는 텍스트 붙여넣기)을 요청하세요.]`;
}

// ── 공유·평가·보상 (2026-10-17 신설) ─────────────────────
// 저장 동의 카드와 저장 직후 안내에 쓰는 고지문. 보상 조건 숫자는 서버 규칙(REWARD_RULES)에서 가져와 어긋나지 않게 한다.
export const SHARE_NOTICE = (personaLabel) =>
  `저장하면 ${personaLabel ? '"' + personaLabel + '" ' : ''}전문가 페이지에 게시되어 다른 이용자가 이 서식을 활용할 수 있습니다. 개인정보와 사안 내용은 저장되지 않습니다.`;
export const REWARD_NOTICE = (source) => source === 'ai_composed'
  ? 'AI가 구성한 서식은 GDC 보상 대상이 아닙니다.'
  : `이 서식을 처음 올린 것이고, 다른 이용자 ${REWARD_RULES.MIN_RATERS}명 이상이 써 본 뒤 높이 평가하면 GDC 보상이 지급될 수 있습니다. 지급 여부와 금액은 운영 정책에 따르며 보장되지 않고, 이미 서식 DB에 있는 서식은 대상이 아닙니다.`;

// 서식을 써 본 이용자의 평가 — 지갑 서명(점수를 바꾸면 서명이 깨진다).
export async function rateForm(worker, wallet, guid, { keyHash, version, rating }, { now = Date.now, fetchImpl = fetch } = {}) {
  const ts = now();
  const sig = await wallet.signPayload(rateMessage(keyHash, version, rating, ts));
  const res = await fetchImpl(`${worker}/doc-form/rate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key_hash: keyHash, version, rating, used: true, guid, ts, sig }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) return { ok: false, code: j.code || 'HTTP_' + res.status, message: j.message || '평가를 저장하지 못했습니다.' };
  return { ok: true, counted: !!j.counted, stats: j.stats };
}

// 공개 집계 — pairs: [{keyHash, version}] (최대 20). 실패하면 빈 객체(부가 정보라 화면을 막지 않는다).
export async function fetchStats(worker, pairs, fetchImpl = fetch) {
  const keys = pairs.slice(0, 20).map(p => `${p.keyHash}:${p.version}`).join(',');
  if (!keys) return {};
  try {
    const res = await fetchImpl(`${worker}/doc-form/stats?keys=${encodeURIComponent(keys)}`);
    const j = await res.json();
    return res.ok && j.ok ? j.stats : {};
  } catch { return {}; }
}

// 내가 올린 서식의 집계와 보상 상태 — 본인 서명.
export async function fetchMine(worker, wallet, guid, { now = Date.now, fetchImpl = fetch } = {}) {
  const ts = now();
  const sig = await wallet.signPayload(mineMessage(guid, ts));
  const res = await fetchImpl(`${worker}/doc-form/mine`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guid, ts, sig }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) return { ok: false, message: j.message || '현황을 불러오지 못했습니다.' };
  return { ok: true, rewardsEnabled: !!j.rewardsEnabled, items: j.items || [] };
}

// 평가 카드·현황에 쓰는 한 줄 요약.
export function statsLine(s) {
  if (!s || !s.count) return '평가 모으는 중';
  return `★${s.avg} · ${s.count}명 평가`;
}
export const REWARD_STATUS_LABEL = { minting: '지급 처리 중', paid: '지급됨', failed: '지급 재시도 대기', unknown: '운영자 확인 중', void: '취소됨' };
