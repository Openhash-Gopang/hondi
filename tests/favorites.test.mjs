import test from 'node:test';
import assert from 'node:assert/strict';
import { addFavorite, loadFavorites, removeFavorite, matchFavorite, MAX_FAVORITES } from '../src/gopang/ui/favorites.js';
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; };
const G = 'g1';
const LAW = { id: 'SP-LAW-01', name: '변호사', icon: '⚖️', url: 'https://hondi.net/pages/expert-chat.html?persona=SP-LAW-01' };
const MAIL = { id: 'kmail', name: 'K-Mail', url: 'https://mail.hondi.net/' };

test('호출한 상대를 저장하고 종류를 구분한다', () => {
  const s = mem();
  addFavorite(s, G, LAW, 1); addFavorite(s, G, MAIL, 2); addFavorite(s, G, LAW, 3);
  const l = loadFavorites(s, G);
  assert.equal(l.length, 2);
  const law = l.find(f => f.id === 'SP-LAW-01');
  assert.equal(law.kind, 'expert'); assert.equal(law.count, 2);
  assert.equal(l.find(f => f.id === 'kmail').kind, 'service');
  assert.equal(loadFavorites(s, 'other').length, 0);
});
test('이름만 말하거나 이름+연결 동사면 즉시 인출', () => {
  const l = [{ ...LAW, kind: 'expert' }, { ...MAIL, kind: 'service' }];
  for (const t of ['변호사', '변호사 불러줘', '변호사 연결해줘', '변호사님 연결', 'K-Mail 열어줘']) assert.ok(matchFavorite(t, l)?.fav, t);
  assert.equal(matchFavorite('변호사 불러줘', l).fav.id, 'SP-LAW-01');
});
test('질문·긴 글·이름 없는 문장은 가로채지 않는다', () => {
  const l = [{ ...LAW, kind: 'expert' }];
  for (const t of ['변호사 비용이 얼마야?', '오늘 날씨 어때', '변호사에게 물어볼 내용이 있는데 임대차 계약서 때문에 고민이에요 도와주세요 제발', '[INTERNAL: x]', '']) assert.equal(matchFavorite(t, l), null, t);
});
test('같은 이름이 둘이면 many, 삭제·상한', () => {
  const l = [{ id: 'a', name: '병원', kind: 'service' }, { id: 'b', name: '병원', kind: 'service' }];
  assert.equal(matchFavorite('병원 불러줘', l).many.length, 2);
  const s = mem(); addFavorite(s, G, LAW); assert.equal(removeFavorite(s, G, 'SP-LAW-01').length, 0);
  for (let i = 0; i < MAX_FAVORITES + 5; i++) addFavorite(s, G, { id: 'x' + i, name: 'n' + i, url: 'u' }, i);
  assert.equal(loadFavorites(s, G).length, MAX_FAVORITES);
});
