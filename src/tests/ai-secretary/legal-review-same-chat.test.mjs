import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../../../assets/start-field.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../../assets/pro-doc-page.css', import.meta.url), 'utf8');

test('legal-review tab toggles body.lr-mode', () => {
  assert.match(js, /document\.body\.classList\.toggle\('lr-mode', next === 'review'\)/);
});
test('lr-mode hides drafting-only UI but keeps start area and footer', () => {
  assert.match(css, /body\.lr-mode \.ug-doc > :not\(\.doc-intro\):not\(\.ug-footer\)\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /body\.lr-mode \.doc-intro > \.svc-callout\s*\{\s*display:\s*none/);
});

test('legal-review tab swaps the hero text and restores it', () => {
  assert.match(js, /function heroApply\(\)/);
  assert.match(js, /h1\.innerHTML = on \? LR_H1 : heroOrig\.h1/);
  assert.match(js, /\n\s+heroApply\(\);\n/);
});
