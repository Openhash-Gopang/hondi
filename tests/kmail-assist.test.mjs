import test from 'node:test';
import assert from 'node:assert/strict';
import { routeFromReply, stripTags, quickRoute, siteForPersona } from '../src/worker/kmail-assist.js';

test('GWP kmail', () => assert.equal(routeFromReply('메일을 도와드릴게요. [GWP: kmail]').type, 'kmail'));
test('GWP klaw → 변호사', () => { const r = routeFromReply('[GWP: klaw]'); assert.equal(r.type, 'expert'); assert.equal(r.persona, 'lawyer'); assert.equal(r.site, 'law'); });
test('EXPERT physician', () => { const r = routeFromReply('[EXPERT: physician]'); assert.equal(r.persona, 'physician'); assert.equal(r.site, 'doctor'); });
test('EXPERT 기타', () => { const r = routeFromReply('[EXPERT: chef]'); assert.equal(r.type, 'expert'); assert.equal(r.site, ''); });
test('태그 없음', () => assert.equal(routeFromReply('안녕하세요').type, 'assistant'));
test('다른 서비스는 assistant', () => assert.equal(routeFromReply('[GWP: kjob]').type, 'assistant'));
test('stripTags', () => assert.equal(stripTags('안내합니다.\n[GWP: kmail]'), '안내합니다.'));
test('siteForPersona', () => { assert.equal(siteForPersona('accountant'), 'tax'); assert.equal(siteForPersona('dentist'), 'doctor'); assert.equal(siteForPersona('patent-attorney'), 'law'); });
test('quick: 메일', () => { assert.equal(quickRoute('누구에게 메일을 보내줘.').type, 'kmail'); assert.equal(quickRoute('홍길동에게 안부 전해줘').type, 'kmail'); });
test('quick: 증상', () => { const r = quickRoute('허리가 아파'); assert.equal(r.type, 'expert'); assert.equal(r.site, 'doctor'); });
test('quick: 서류', () => { assert.deepEqual(quickRoute('소유권이전등기 신청서 작성해줘'), { type: 'doc', site: 'law', label: '서류 작성' }); assert.equal(quickRoute('양도소득세 신고서 작성해줘').site, 'tax'); });
test('quick: 메일 서류 혼동 없음', () => assert.equal(quickRoute('계약서를 메일로 보내줘').type, 'kmail'));
test('quick: 모르면 null', () => { assert.equal(quickRoute('오늘 날씨 어때'), null); assert.equal(quickRoute(''), null); });
