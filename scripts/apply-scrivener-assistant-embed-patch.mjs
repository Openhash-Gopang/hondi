#!/usr/bin/env node
// 법무사·행정사 「서류 작성하기」(expert-chat 임베드)가 전문가용(-assistant) SP 를 쓰고 인증 세션(pro_session)을 보내게 한다. (2026-10-21)
// 앵커 삽입 방식 — 이미 적용돼 있으면 건너뜀. 사용: node scripts/apply-scrivener-assistant-embed-patch.mjs
import fs from 'node:fs';
const p = new URL('../pages/expert-chat.html', import.meta.url);
let t = fs.readFileSync(p, 'utf8');
if (t.includes('__PRO_ASSISTANT_SP')) { console.log('이미 적용됨'); process.exit(0); }
function rep(a, b) { if (t.split(a).length !== 2) throw new Error('앵커가 정확히 1개가 아님: ' + a.slice(0, 60)); t = t.replace(a, () => b); }

rep(`  parts.push(await _loadSpRawByKey(def.key, def.label)
    .catch(e => { throw new Error(\`\${def.label} SP 로드 실패: \` + e.message); }));

  return parts.join('\\n\\n---\\n\\n');`,
`  // 2026-10-21: 법무사·행정사 서류 작성하기(임베드)는 전문가용(-assistant) SP 를 쓴다 — 서류 작성 도구(STEP C·W)는 거기에만 있다.
  const _spKey = (_embedOn() && _PRO_WRITE_PERSONAS.has(PERSONA)) ? def.key + '-assistant' : def.key;
  window.__PRO_ASSISTANT_SP = _spKey !== def.key;
  parts.push(await _loadSpRawByKey(_spKey, def.label)
    .catch(e => { throw new Error(\`\${def.label} SP 로드 실패: \` + e.message); }));

  return parts.join('\\n\\n---\\n\\n');`);

rep(`async function callExpertAI(messages, onChunk) {
  const candidates = _buildCandidates();`,
`const _PRO_WRITE_PERSONAS = new Set(['judicial-scrivener', 'administrative-scrivener']);
let _proClientP = null;
function _loadProClient() {
  if (window.HondiPro) return Promise.resolve();
  if (!_proClientP) _proClientP = new Promise((resolve) => { const s = document.createElement('script'); s.src = '/assets/pro-verify.js'; s.onload = resolve; s.onerror = resolve; document.head.appendChild(s); });
  return _proClientP;
}

async function callExpertAI(messages, onChunk) {
  const candidates = _buildCandidates();
  let proSession = null;
  if (window.__PRO_ASSISTANT_SP) {
    try { await _loadProClient(); if (window.HondiPro) proSession = await window.HondiPro.getSession(); } catch (eP) { console.warn('[Expert] 전문가 세션', eP); }
  }`);

rep(`            body: JSON.stringify({ ...reqBody, guid: user?.ipv6 || null }),`,
    `            body: JSON.stringify({ ...reqBody, guid: user?.ipv6 || null, pro_session: proSession || undefined }),`);
rep(`            body: JSON.stringify({ provider: c.provider, baseUrl: c.baseUrl, apiKey: c.apiKey, ...reqBody }),
          });
`,
`            body: JSON.stringify({ provider: c.provider, baseUrl: c.baseUrl, apiKey: c.apiKey, ...reqBody, pro_session: proSession || undefined }),
          });
      if (window.__PRO_ASSISTANT_SP && c.provider !== 'legacy' && window.HondiPro && await window.HondiPro.isBlocked(resp.clone())) {
        try { window.HondiPro.openPanel(); } catch (eO) {}
        throw new Error('전문가용 AI는 면허 인증이 승인된 전문가만 쓸 수 있습니다. 열린 창에서 인증을 신청해 주세요.');
      }
`);
fs.writeFileSync(p, t);
console.log('적용 완료');
