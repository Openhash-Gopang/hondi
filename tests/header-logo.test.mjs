import { readFileSync } from 'node:fs';
import assert from 'node:assert';
const h = readFileSync('webapp.html', 'utf8');
assert.match(h, /<button id="ai-panel-logo"[^>]*onclick="_returnToNavi\(\)"/);
assert.match(h, /#ai-panel-name,#ai-panel-name-input,#ai-panel-name-edit-icon\{display:none !important\}/);
assert.match(h, /window\._returnToNavi = async function/);
assert.match(h, /id="ai-panel-name-tagline">최신 버전</);
assert.ok(!/id="ai-panel-name-wrap" onclick/.test(h));
console.log('ok');
