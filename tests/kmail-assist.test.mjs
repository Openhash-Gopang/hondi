import test from 'node:test';
import assert from 'node:assert/strict';
import { routeFromReply, stripTags, quickRoute, siteForPersona, mailMode, finalizeRoute, assistNote, MAX_ASKS } from '../src/worker/kmail-assist.js';

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
test('quick: 메일 서류 혼동 없음(서류로 가지 않는다)', () => {
  const r = quickRoute('계약서를 메일로 보내줘');
  assert.notEqual(r.type, 'doc');
  assert.equal(quickRoute('계약서를 홍길동에게 메일로 보내줘').type, 'kmail');
});
test('quick: 모르면 null', () => { assert.equal(quickRoute('오늘 날씨 어때'), null); assert.equal(quickRoute(''), null); });

// ── 2026-10-31: 메일(편지/캠페인) · 서류 라우팅, 질의 2회 상한 ──
test('mailMode: 한 분 → 편지', () => { assert.equal(mailMode('김 교수님께 감사 인사 보내줘'), 'letter'); assert.equal(mailMode('편지 써줘'), 'letter'); });
test('mailMode: 여러 명·캠페인 → 캠페인', () => {
  assert.equal(mailMode('교수님들께 안내 메일 보내줘'), 'campaign');
  assert.equal(mailMode('주소록 전체에게 보내줘'), 'campaign');
  assert.equal(mailMode('정보공개 청구 메일 써줘'), 'campaign');
});
test('mailMode: 확인·조회는 K-Mail 일반 대화', () => assert.equal(mailMode('받은 편지함 확인해줘'), 'campaign'));
test('mailMode: 작성인데 단복수 불명 → null', () => assert.equal(mailMode('메일 작성해줘'), null));
test('quick: 메일에 mode 포함', () => {
  assert.equal(quickRoute('누구에게 메일을 보내줘.').mode, 'letter');
  assert.equal(quickRoute('홍길동에게 안부 전해줘').mode, 'letter');
  assert.equal(quickRoute('모든 회원에게 메일 보내줘').mode, 'campaign');
});
test('quick: 모호한 메일은 되묻기(선택지 3개, 그냥 대화 포함)', () => {
  const r = quickRoute('메일 작성해줘');
  assert.equal(r.type, 'ask'); assert.equal(r.kind, 'mail-kind');
  assert.deepEqual(r.options.map(o => o.route.mode || o.route.type), ['letter', 'campaign', 'assistant']);
  assert.equal(r.options[2].route.stay, true);
});
test('quick: 질의 상한 — asked>=2 이면 묻지 않고 편지 기본값', () => {
  const r = quickRoute('메일 작성해줘', { asked: MAX_ASKS });
  assert.equal(r.type, 'kmail'); assert.equal(r.mode, 'letter'); assert.equal(r.defaulted, true);
  assert.equal(quickRoute('메일 작성해줘', { asked: 1 }).type, 'ask');
});
test('quick: 서류 vs 편지 충돌은 되묻기, 상한 후엔 AC 에게', () => {
  const r = quickRoute('김 교수님께 보낼 계약서 써줘');
  assert.equal(r.type, 'ask'); assert.equal(r.kind, 'route'); assert.equal(r.options[0].route.type, 'doc');
  assert.equal(quickRoute('김 교수님께 보낼 계약서 써줘', { asked: 2 }), null);
});
test('quick: 서류만이면 그대로 doc', () => assert.equal(quickRoute('양도소득세 신고서 작성해줘').type, 'doc'));
test('GWP navi* → doc', () => {
  assert.deepEqual(routeFromReply('[GWP: navilaw]'), { type: 'doc', id: 'navilaw', site: 'law', label: '서류 작성' });
  assert.equal(routeFromReply('[GWP: navidoctor]').site, 'doctor');
  assert.equal(routeFromReply('[GWP: navidoc]').site, 'all');
  assert.equal(routeFromReply('[GWP: navipatent]').site, 'law');
  assert.equal(routeFromReply('[GWP: navischool]').site, 'all');
});
test('[ASK] 는 asking 표시, stripTags 가 제거', () => {
  assert.equal(routeFromReply('메일인가요, 서류인가요? [ASK]').asking, true);
  assert.equal(stripTags('메일인가요, 서류인가요? [ASK]'), '메일인가요, 서류인가요?');
});
test('finalize: AC 의 kmail 에 mode 부여 / 모호하면 되묻기 / 상한 후 편지', () => {
  assert.equal(finalizeRoute({ type: 'kmail', id: 'kmail' }, '김 교수님께 편지 써줘').mode, 'letter');
  assert.equal(finalizeRoute({ type: 'kmail', id: 'kmail' }, '메일 좀 도와줘 작성').type, 'ask');
  const d = finalizeRoute({ type: 'kmail', id: 'kmail' }, '메일 작성', { asked: 2 }); assert.equal(d.mode, 'letter'); assert.equal(d.defaulted, true);
});
test('finalize: 상한 초과 시 asking 무시', () => {
  assert.equal(finalizeRoute({ type: 'assistant', asking: true }, 'x', { asked: 2 }).asking, undefined);
  assert.equal(finalizeRoute({ type: 'assistant', asking: true }, 'x', { asked: 1 }).asking, true);
});
test('assistNote: 서류 id 안내 · 상한 전엔 [ASK] 허용, 후엔 금지', () => {
  assert.match(assistNote(0), /navilaw/); assert.match(assistNote(0), /\[ASK\]/);
  assert.doesNotMatch(assistNote(2), /\[ASK\]/); assert.match(assistNote(2), /더 묻지 말고/);
});
