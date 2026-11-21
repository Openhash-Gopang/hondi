// src/worker/kmail-auto-sender.js — 부재중 자동응답을 보내면 안 되는 "자동 발송" 메일 판별 (2026-11-21)
//
// 배경: 자동응답이 noreply@… 같은 회신 불가·안내 메일 주소에까지 나가던 오류. 사람이 읽지 않는 주소로 답장을 보내면
// 반송·스팸 신호만 쌓이고, 상대가 자동응답 기능이면 메일이 서로 오가는 고리가 될 수 있다(RFC 3834 권고: 자동 생성 메일에는 자동 응답하지 않는다).
// 판단은 보수적으로 한다 — 헷갈리면 "자동 발송"으로 보고 안 보낸다(놓치는 쪽이 사람에게 잘못 보내는 쪽보다 낫다).

// 회신을 받을 사람이 없는 주소의 앞부분(로컬 파트) 패턴. 예: noreply, no-reply, do_not_reply, analyticsnoreply, mailer-daemon, bounce-123.
const AUTOMATED_LOCAL_RE = /(^|[^a-z])(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|dont[-_.]?reply|mailer[-_.]?daemon|postmaster|bounces?|notifications?|alerts?|auto[-_.]?(reply|mail|responder|generated))([^a-z]|$)|noreply|no-reply/i;
// 반송용 봉투 주소(cfbounce 등)의 도메인 일부
const AUTOMATED_DOMAIN_RE = /(^|\.)(cfbounce|bounce|bounces|mailer)\./i;

function _hdr(headers, name) {
  try { const v = headers && headers.get ? headers.get(name) : null; return v == null ? '' : String(v); } catch (e) { return ''; }
}

/** 이 메일에 자동응답을 보내면 안 되는가? fromEmail: 순수 주소, headers: Headers 비슷한 객체(없어도 됨). */
export function isAutomatedSender(fromEmail, headers) {
  const addr = String(fromEmail || '').trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at > 0) {
    const local = addr.slice(0, at), domain = addr.slice(at + 1);
    if (AUTOMATED_LOCAL_RE.test(local)) return true;
    if (AUTOMATED_DOMAIN_RE.test(domain)) return true;
  }
  const autoSubmitted = _hdr(headers, 'auto-submitted').toLowerCase().trim();
  if (autoSubmitted && autoSubmitted !== 'no') return true;                       // RFC 3834
  if (/^(bulk|list|junk|auto_reply)\b/i.test(_hdr(headers, 'precedence').trim())) return true;
  if (_hdr(headers, 'list-id') || _hdr(headers, 'list-unsubscribe')) return true; // 메일링·뉴스레터
  if (_hdr(headers, 'x-auto-response-suppress').trim()) return true;               // Exchange 계열
  if (_hdr(headers, 'x-autoreply') || _hdr(headers, 'x-autorespond')) return true;
  return false;
}
