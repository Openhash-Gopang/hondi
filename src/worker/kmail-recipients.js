// 2026-10-28 — 메일 > 편지쓰기의 받는 사람(복수)·참조(CC)·숨은참조(BCC) 처리.
export const MAIL_RECIPIENTS_MAX = 50;
const EMAIL_RE = /^[^\s<>,;"'@]+@[^\s<>,;"'@]+\.[^\s<>,;"'@]+$/;

// 문자열("a@x.com, 홍길동 <b@y.com>; c@z.com") 또는 배열(문자열/{email})을 소문자 주소 배열로. 잘못된 항목은 bad 로 따로 모은다.
export function parseAddressList(value) {
  const out = [], bad = [];
  const items = Array.isArray(value) ? value : (value == null ? [] : [value]);
  for (const it of items) {
    const raw = typeof it === 'object' && it ? (it.email || '') : String(it);
    for (const part of raw.split(/[,;\n]+/)) {
      const s = part.trim();
      if (!s) continue;
      const m = s.match(/<([^<>]+)>\s*$/);
      const addr = (m ? m[1] : s).trim().toLowerCase();
      if (EMAIL_RE.test(addr)) out.push(addr); else bad.push(s);
    }
  }
  return { emails: out, bad };
}

export function validateMailRecipients({ to, cc, bcc }) {
  const t = parseAddressList(to), c = parseAddressList(cc), b = parseAddressList(bcc);
  const bad = [...t.bad, ...c.bad, ...b.bad];
  if (bad.length) return { ok: false, message: '올바르지 않은 이메일 주소가 있습니다: ' + bad.slice(0, 3).join(', ') };
  const seen = new Set();
  const uniq = list => list.filter(e => (seen.has(e) ? false : (seen.add(e), true)));
  const toL = uniq(t.emails), ccL = uniq(c.emails), bccL = uniq(b.emails);
  if (!toL.length) return { ok: false, message: '받는 사람이 없습니다.' };
  const total = toL.length + ccL.length + bccL.length;
  if (total > MAIL_RECIPIENTS_MAX) return { ok: false, message: `받는 사람·참조·숨은참조를 합쳐 ${MAIL_RECIPIENTS_MAX}명까지 보낼 수 있습니다(현재 ${total}명).` };
  return { ok: true, to: toL, cc: ccL, bcc: bccL, total };
}
