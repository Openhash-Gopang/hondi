#!/usr/bin/env node
// 법무사·행정사 SP 분리 후 페이지의 SP 참조를 새 파일·전문가용 키로 바꾼다. (2026-10-21) 이미 적용돼 있으면 변경 없음.
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
function edit(f, pairs) {
  const p = new URL(f, root); let t = fs.readFileSync(p, 'utf8'), n = 0;
  for (const [a, b] of pairs) { if (t.includes(a)) { t = t.split(a).join(b); n++; } }
  fs.writeFileSync(p, t); console.log(f, n ? '수정' : '변경 없음');
}
const files = [['SP_judicial-scrivener_v3_3.md', 'SP_judicial-scrivener_v4_0.md'], ['SP_administrative-scrivener_v1_3.md', 'SP_administrative-scrivener_v2_0.md']];
edit('pages/expert-personas.html', files);
edit('pages/professional-ai.html', files);
edit('pages/judicial-scrivener.html', [['sp: "SP_judicial-scrivener",', 'sp: "SP_judicial-scrivener-assistant",']]);
edit('pages/administrative-scrivener.html', [['sp: "SP_administrative-scrivener",', 'sp: "SP_administrative-scrivener-assistant",']]);
