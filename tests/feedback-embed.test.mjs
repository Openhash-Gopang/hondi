import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const h = readFileSync(new URL('../feedback.html', import.meta.url), 'utf8');
test('feedback.html: 나비웹 화면 안(embed=mail)에서는 자체 상단 바를 숨기고, 날짜는 PocketBase created 를 쓴다', () => {
  assert.match(h, /body\.embed \.header \{ display: none; \}/);
  assert.match(h, /<body>\n<script>if \(\/\[\?&\]embed=mail\//);
  assert.match(h, /item\.created \|\| item\.created_at/);
});
