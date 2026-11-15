import assert from 'node:assert';
import { withBrevityNote, BREVITY_NOTE } from '../src/gopang/ai/brevity-note.js';
const r = withBrevityNote('안녕');
assert.ok(r.startsWith('안녕') && r.endsWith(BREVITY_NOTE));
assert.strictEqual(withBrevityNote(r), r);
assert.deepStrictEqual(withBrevityNote([{ type: 'text' }]), [{ type: 'text' }]);
assert.strictEqual(withBrevityNote(''), '');
console.log('ok');
