// 2026-10-28 — KMAIL_/KADDR_ 태그의 JSON 이 완전히 닫혔는데 그 뒤에 군더더기(설명 문장·코드펜스)가 붙은 응답을 정리한다.
const TAG_RE = /(?:KMAIL|KADDR)_[A-Z_]+\s*\{/;

// 문자열 내부의 중괄호를 무시하며 start(= '{' 위치)에서 균형이 맞는 끝 위치를 찾는다. 없으면 -1(잘린 응답).
export function findJsonEnd(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// 태그 JSON 뒤의 군더더기를 잘라낸다. 변화가 없으면 원문 그대로.
export function trimTrailingAfterTag(reply) {
  const s = String(reply || '');
  const m = TAG_RE.exec(s);
  if (!m) return s;
  const braceAt = m.index + m[0].length - 1;
  const end = findJsonEnd(s, braceAt);
  if (end < 0 || end === s.length - 1) return s;
  const rest = s.slice(end + 1).trim();
  if (!rest || /^[\]\)`\s]*$/.test(rest)) return s.slice(0, end + 1);
  return s.slice(0, end + 1);
}
