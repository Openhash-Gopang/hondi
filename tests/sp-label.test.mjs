import test from 'node:test';
import assert from 'node:assert/strict';
import { spLabelText, setSPLabel, getSPLabel } from '../src/gopang/ui/sp-label.js';
test('SP 이름 표시 문구', () => {
  assert.equal(spLabelText('K-Intent'), 'K-Intent · 요청 파악');
  assert.equal(spLabelText('K-Plan'), 'K-Plan');
  assert.equal(spLabelText(''), ''); assert.equal(spLabelText(null), '');
});
test('저장소가 없어도(노드) 예외 없이 동작', () => { setSPLabel('K-Intent'); setSPLabel(''); assert.equal(getSPLabel(), ''); });
