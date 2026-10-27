// src/worker/mime-text.js — 들어온 메일(MIME)에서 제목·본문 텍스트를 올바르게 꺼낸다. 외부 라이브러리 없음(이 저장소는 npm 의존성이 없다).
//
// 고치는 문제(2026-10-28 실사): 받은메일함에 제목이 "=?UTF-8?B?UmU6IO2FjOyKpO2KuCDrqZTsnbw=?="로, 본문이 base64 글자 그대로 나왔다.
//   · 제목·이름 헤더의 RFC 2047 인코딩(=?charset?B/Q?…?=)을 풀지 않았다.
//   · 본문의 Content-Transfer-Encoding(base64·quoted-printable)과 문자 집합(UTF-8·EUC-KR 등)을 풀지 않았다.
//   · 중첩 multipart(mixed 안의 alternative), HTML 전용 메일, 첨부, 반송 통지(multipart/report)를 구분하지 못했다.
// 이미 저장된 깨진 글(제목·본문)은 repairStoredText로 읽을 때 고친다(멱등 — 정상 글은 그대로).
// 순수 함수만 담는다 — worker.js 밖에서 단위 시험이 가능하다.

const MAX_DEPTH = 8;
const MAX_TEXT = 200000;

// ── 바이트·문자열 도구 ────────────────────────────────────────────────────
function toBytes(input) {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(0);
}
function bytesToBin(bytes) {                       // 바이트를 1바이트=1글자(0~255)로 — 파싱 중에는 원본 바이트를 잃지 않는다
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return out;
}
function binToBytes(bin) {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xFF;
  return out;
}

const CHARSET_ALIAS = {
  'us-ascii': 'utf-8', ascii: 'utf-8', 'utf8': 'utf-8', 'utf-8': 'utf-8',
  'ks_c_5601-1987': 'euc-kr', 'ks_c_5601': 'euc-kr', ksc5601: 'euc-kr', 'ksc_5601': 'euc-kr', cp949: 'euc-kr', 'x-windows-949': 'euc-kr', 'euc-kr': 'euc-kr', euckr: 'euc-kr', 'uhc': 'euc-kr',
  'iso-8859-1': 'windows-1252', latin1: 'windows-1252', 'iso8859-1': 'windows-1252',
};
export function decodeBytes(bytes, charset) {
  const key = String(charset || 'utf-8').split('*')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  const label = CHARSET_ALIAS[key] || key || 'utf-8';
  try { return new TextDecoder(label).decode(bytes); }
  catch (e) { try { return new TextDecoder('utf-8').decode(bytes); } catch (e2) { return bytesToBin(bytes); } }
}

export function base64ToBytes(b64) {
  const clean = String(b64).replace(/[^A-Za-z0-9+/_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  let bin;
  try { bin = atob(padded); } catch (e) { return new Uint8Array(0); }
  return binToBytes(bin);
}
// quoted-printable → 바이트. header=true면 Q 인코딩(밑줄=공백)
export function qpToBytes(text, header = false) {
  const src = (header ? String(text).replace(/_/g, ' ') : String(text).replace(/=\r?\n/g, ''));
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(src.substr(i + 1, 2))) { out.push(parseInt(src.substr(i + 1, 2), 16)); i += 2; }
    else out.push(src.charCodeAt(i) & 0xFF);
  }
  return Uint8Array.from(out);
}

// ── RFC 2047 헤더 디코딩 ─────────────────────────────────────────────────
const ENC_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;
export function hasEncodedWord(s) { return /=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=/.test(String(s || '')); }
export function decodeMimeWords(input) {
  const text = String(input == null ? '' : input);
  if (!hasEncodedWord(text)) return text;
  // 인코딩된 단어 사이의 공백만 있는 틈은 버린다(RFC 2047 §6.2). 같은 문자 집합이 이어지면 바이트를 합쳐 한 번에 해석한다
  // (멀티바이트 글자를 단어 경계에서 쪼갠 잘못된 발신 서버 대응).
  const tokens = []; let last = 0, m;
  ENC_WORD.lastIndex = 0;
  while ((m = ENC_WORD.exec(text))) {
    if (m.index > last) tokens.push({ t: 'text', v: text.slice(last, m.index) });
    const bytes = m[2].toUpperCase() === 'B' ? base64ToBytes(m[3]) : qpToBytes(m[3], true);
    tokens.push({ t: 'enc', charset: m[1], bytes });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ t: 'text', v: text.slice(last) });
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'text') {
      const prevEnc = i > 0 && tokens[i - 1].t === 'enc', nextEnc = i + 1 < tokens.length && tokens[i + 1].t === 'enc';
      out += (prevEnc && nextEnc && /^\s*$/.test(tk.v)) ? '' : tk.v;
    } else {
      const cs = String(tk.charset).split('*')[0].toLowerCase(); let bytes = tk.bytes;
      while (i + 1 < tokens.length) {                                  // 같은 문자 집합의 이어지는 단어(사이에 공백뿐)를 합친다
        const a = tokens[i + 1], b = tokens[i + 2];
        if (a && a.t === 'text' && /^\s*$/.test(a.v) && b && b.t === 'enc' && String(b.charset).split('*')[0].toLowerCase() === cs) { bytes = concat(bytes, b.bytes); i += 2; }
        else if (a && a.t === 'enc' && String(a.charset).split('*')[0].toLowerCase() === cs) { bytes = concat(bytes, a.bytes); i += 1; }
        else break;
      }
      out += decodeBytes(bytes, cs);
    }
  }
  return out;
}
function concat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }

// ── 헤더 파싱 ──────────────────────────────────────────────────────────
function splitHeadBody(bin) {
  const m = /\r?\n\r?\n/.exec(bin);
  if (bin.startsWith('\r\n') || bin.startsWith('\n')) return { head: '', body: bin.replace(/^\r?\n/, '') };
  if (!m) return { head: bin, body: '' };
  return { head: bin.slice(0, m.index), body: bin.slice(m.index + m[0].length) };
}
function parseHeaders(headBin) {
  const unfolded = headBin.replace(/\r?\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':'); if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!(name in headers)) headers[name] = line.slice(i + 1).trim();    // 같은 헤더가 여러 번이면 첫 것
  }
  return headers;
}
// 헤더 값(1바이트=1글자)을 사람이 읽는 글로: 인코딩된 단어를 풀고, 인코딩 없이 들어온 8비트(UTF-8)는 UTF-8로 해석
export function headerToText(bin) {
  const v = String(bin || '');
  if (hasEncodedWord(v)) return decodeMimeWords(v).trim();
  if (/[\x80-\xFF]/.test(v)) { try { return new TextDecoder('utf-8', { fatal: true }).decode(binToBytes(v)).trim(); } catch (e) { return decodeBytes(binToBytes(v), 'euc-kr').trim(); } }
  return v.trim();
}
function parseParams(value) {                                            // 'text/plain; charset="UTF-8"; format=flowed' → { type, params }
  const parts = String(value || '').split(';');
  const type = (parts.shift() || '').trim().toLowerCase();
  const params = {};
  for (const p of parts) { const i = p.indexOf('='); if (i <= 0) continue; params[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"(.*)"$/, '$1'); }
  return { type, params };
}

// ── 본문 ──────────────────────────────────────────────────────────────
function decodeBody(bodyBin, cte, charset) {
  let bytes;
  switch (String(cte || '7bit').trim().toLowerCase()) {
    case 'base64': bytes = base64ToBytes(bodyBin); break;
    case 'quoted-printable': bytes = qpToBytes(bodyBin); break;
    default: bytes = binToBytes(bodyBin);                                // 7bit·8bit·binary — 원본 바이트 그대로
  }
  return decodeBytes(bytes, charset);
}
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', middot: '·', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', copy: '©' };
export function htmlToText(html) {
  let t = String(html || '');
  t = t.replace(/<!--[\s\S]*?-->/g, '').replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n').replace(/<(p|div|li|h[1-6]|blockquote)\b[^>]*>/gi, '\n').replace(/<\/t[dh]>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(code); } catch (x) { return ''; } }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
  return t.replace(/[ \t\u00A0]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function splitMultipart(bodyBin, boundary) {
  const esc = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\r?\\n)--${esc}(--)?[ \\t]*(?=\\r?\\n|$)`, 'g');
  const idx = []; let m;
  while ((m = re.exec(bodyBin))) idx.push({ start: m.index, end: m.index + m[0].length, last: !!m[1] });
  const parts = [];
  for (let i = 0; i < idx.length - 1; i++) {
    if (idx[i].last) break;
    parts.push(bodyBin.slice(idx[i].end, idx[i + 1].start).replace(/^\r?\n/, ''));
  }
  return parts;
}

function isAttachment(headers, params) {
  const disp = parseParams(headers['content-disposition'] || '');
  if (disp.type === 'attachment') return true;
  if (disp.type === 'inline' && (disp.params.filename || disp.params['filename*'])) return false;
  return false;
}

// 하나의 MIME 개체에서 사람이 읽을 본문 글을 뽑는다. 첨부·이미지·전달 메일·배송 상태 등은 건너뛴다.
function extractText(bin, depth) {
  if (depth > MAX_DEPTH) return '';
  const { head, body } = splitHeadBody(bin);
  const headers = parseHeaders(head);
  const ct = parseParams(headers['content-type'] || 'text/plain; charset=us-ascii');
  const type = ct.type || 'text/plain';
  if (isAttachment(headers, ct.params)) return '';

  if (type.startsWith('multipart/')) {
    const boundary = ct.params.boundary; if (!boundary) return '';
    const children = splitMultipart(body, boundary);
    if (type === 'multipart/alternative') {
      let plain = '', html = '', other = '';
      for (const c of children) {
        const ch = parseParams(parseHeaders(splitHeadBody(c).head)['content-type'] || 'text/plain');
        const txt = extractText(c, depth + 1);
        if (!txt) continue;
        if (ch.type === 'text/plain' && !plain) plain = txt; else if (ch.type === 'text/html' && !html) html = txt; else if (!other) other = txt;
      }
      return plain || html || other;
    }
    const texts = children.map(c => extractText(c, depth + 1)).filter(Boolean);
    return texts.join('\n\n');
  }
  if (type === 'text/plain') return decodeBody(body, headers['content-transfer-encoding'], ct.params.charset).replace(/\r\n/g, '\n').trim();
  if (type === 'text/html') return htmlToText(decodeBody(body, headers['content-transfer-encoding'], ct.params.charset));
  return '';                                                              // message/rfc822, message/delivery-status, image/*, application/* …
}

// 메일 전체(바이트 또는 문자열)에서 { subject, from, bodyText } — 못 뽑으면 빈 문자열
export function parseMessage(input) {
  const bin = bytesToBin(toBytes(input));
  const { head } = splitHeadBody(bin);
  const headers = parseHeaders(head);
  let bodyText = '';
  try { bodyText = extractText(bin, 0); } catch (e) { bodyText = ''; }
  if (bodyText.length > MAX_TEXT) bodyText = bodyText.slice(0, MAX_TEXT) + '\n…(이하 생략)';
  return { subject: headerToText(headers['subject'] || ''), from: headerToText(headers['from'] || ''), bodyText };
}

// ── 이미 저장된 깨진 글 고치기(읽을 때) ───────────────────────────────────
function printableRatio(s) {
  if (!s) return 0;
  let ok = 0; for (const ch of s) { const c = ch.codePointAt(0); if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 0x7F && c !== 0xFFFD && !(c >= 0x80 && c < 0xA0))) ok++; }
  return ok / Array.from(s).length;
}
function tryUtf8Strict(bytes) { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return null; } }
export function repairStoredBody(body) {
  const raw = String(body == null ? '' : body);
  const compact = raw.replace(/\s+/g, '');
  // ① 전체가 base64인 본문(옛 파서가 인코딩을 안 풀고 저장한 것)
  if (compact.length >= 16 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact) && !/^[A-Za-z]+$/.test(compact) ) {
    const bytes = base64ToBytes(compact); const txt = tryUtf8Strict(bytes);
    if (txt && printableRatio(txt) >= 0.95 && /[\s\uAC00-\uD7A3A-Za-z가-힣]/.test(txt)) return txt.replace(/\r\n/g, '\n').trim();
  }
  // ② quoted-printable(=EC=95=88 처럼 높은 비트 바이트가 3번 이상)
  const hi = raw.match(/=[89A-Fa-f][0-9A-Fa-f]/g);
  if (hi && hi.length >= 3) {
    const txt = tryUtf8Strict(qpToBytes(raw));
    if (txt && printableRatio(txt) >= 0.95) return txt.replace(/\r\n/g, '\n').trim();
  }
  return raw;
}
export function repairStoredText(subject, body) {
  const s = String(subject == null ? '' : subject);
  return { subject: hasEncodedWord(s) ? decodeMimeWords(s).trim() : s, body: repairStoredBody(body) };
}
