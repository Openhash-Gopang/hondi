/* ═════════════════════════════════════════════════
   case-mailbox.js — M3 봉인 우편함 계약(순수 검증·정책). 서버 구현은 별도 PR(worker.js 최소 변경).
   목적: 공급자↔소비자 전달 중 상대가 오프라인일 때 암호문을 잠시 맡아 둔다.
   기존 /pdv/relay 는 TTL 10분·20건이라 장기 대기에 부적합 → 같은 봉인 방식을 쓰되 보관 정책만 다르게.
   정책: 암호문만(서버는 내용을 읽지 못함) · 수신 확인(ack) 즉시 삭제 · 최대 30일 · 건당 64KB
        (큰 파일은 종단 암호화 후 R2, 우편함엔 파일 해시·키 봉투만).
   ⚠ 서버 엔드포인트(push/pull/ack)와 실제 X25519 봉인은 이 파일에 없다(기존 wallet/x25519 코드 재사용 예정).
   ═════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var POLICY = { TTL_DAYS: 30, MAX_BYTES: 64 * 1024, MAX_PENDING_PER_RECIPIENT: 500, DELETE_ON_ACK: true };
  var KINDS = ['invite_notice', 'agreement', 'history_entry', 'chat', 'request', 'file_ref', 'close'];
  var HEX64 = /^[0-9a-f]{64}$/;

  // envelope: { to, from, kind, nonce, ciphertext(base64), content_hash, case_id_hash, created_at }
  function validateEnvelope(e, nowIso) {
    var errs = [];
    e = e || {};
    if (!e.to) errs.push('to 필수');
    if (!e.from) errs.push('from 필수');
    if (KINDS.indexOf(e.kind) < 0) errs.push('kind 오류');
    if (!e.nonce) errs.push('nonce 필수');
    if (!HEX64.test(e.content_hash || '')) errs.push('content_hash(sha256 hex) 필수');
    if (!HEX64.test(e.case_id_hash || '')) errs.push('case_id_hash(sha256 hex) 필수');
    if (typeof e.ciphertext !== 'string' || !e.ciphertext) errs.push('ciphertext 필수');
    else if (!/^[A-Za-z0-9+/_-]+=*$/.test(e.ciphertext)) errs.push('ciphertext 는 base64');
    else if (e.ciphertext.length * 0.75 > POLICY.MAX_BYTES) errs.push('봉투 크기 초과');
    // 평문이 섞여 들어오는 실수를 막는다 — 허용 필드 외 키 금지
    var allow = ['to', 'from', 'kind', 'nonce', 'ciphertext', 'content_hash', 'case_id_hash', 'created_at'];
    Object.keys(e).forEach(function (k) { if (allow.indexOf(k) < 0) errs.push('허용되지 않은 필드: ' + k); });
    return errs.length ? { ok: false, errors: errs } : { ok: true, expires_at: new Date(Date.parse(e.created_at || nowIso || new Date().toISOString()) + POLICY.TTL_DAYS * 864e5).toISOString() };
  }
  function isExpired(expiresAt, nowIso) { return Date.parse(nowIso || new Date().toISOString()) >= Date.parse(expiresAt); }

  root.CaseMailbox = { POLICY: POLICY, KINDS: KINDS, validateEnvelope: validateEnvelope, isExpired: isExpired };
})(typeof window !== 'undefined' ? window : globalThis);
