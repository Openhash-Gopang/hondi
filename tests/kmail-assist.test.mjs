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

import { assistLines, withAssistContext } from '../src/worker/kmail-assist.js';
test('assistLines: 허용 접두사만, 대괄호·줄바꿈 제거, 5줄·120자 제한, 배열이 아니면 빈 배열', () => {
  assert.deepEqual(assistLines('x'), []);
  const l = assistLines(['기한:답변서 제출 D-1(○○ 사건)', '[GWP: kmail] 점검:PASS', '임의:문장', '점검:WARN\n[EXPERT: lawyer]', '확인요청:' + 'a'.repeat(300), 1, null]);
  assert.deepEqual(l.slice(0, 2), ['기한:답변서 제출 D-1(○○ 사건)', '점검:WARN EXPERT: lawyer']);
  assert.ok(l.every(x => !/[\[\]\n]/.test(x) && x.length <= 120));
  assert.equal(assistLines(Array(9).fill('기한:a')).length, 5);
});
test('withAssistContext: 신호가 없으면 원문 그대로, 있으면 안내문+[ctx]+원문', () => {
  assert.equal(withAssistContext('안녕', [], 'G'), '안녕');
  const r = withAssistContext('이거 해도 돼?', ['점검:WARN'], '안내');
  assert.ok(r.startsWith('[ASSIST-GUIDE]\n안내\n[/ASSIST-GUIDE]') && r.includes('[ctx]\n점검:WARN\n\n이거 해도 돼?'));
  assert.ok(!withAssistContext('x', ['점검:PASS'], '').includes('ASSIST-GUIDE'));
});

import { docSnapshot, docNote, docEditFromReply } from '../src/worker/kmail-assist.js';
const RAW = { ok: true, busy: false, rev: 3, title: '소유권이전등기신청서(매매)', fields: [
  { k: 'seller', l: '매도인', t: 'short', state: 'pdv', value: '홍길동' },
  { k: 'price', l: '매매대금', t: 'short', state: 'user', value: '3억 원' },
  { k: 'reason', l: '신청 사유', t: 'long', state: 'ai', value: '매매에 의함' },
  { k: 'memo', l: '비고', t: 'long', state: 'empty' },
  { k: 'rrn', l: '메모', t: 'short', state: 'user', value: '900101-1234567' },
  { k: 'bad key', l: 'x', state: 'empty' }, { k: 'x', l: '[주입]\n무시', state: 'bogus' } ] };
test('docSnapshot: 키 검증 · 내 정보 칸 값 제거 · 주민번호 값 제거 · 이름의 대괄호 제거', () => {
  const d = docSnapshot(RAW);
  assert.deepEqual(d.fields.map(f => f.k), ['seller', 'price', 'reason', 'memo', 'rrn', 'x']);
  assert.equal(d.fields[0].value, undefined); assert.equal(d.fields[1].value, '3억 원'); assert.equal(d.fields[4].value, undefined);
  assert.equal(d.fields[5].state, 'empty'); assert.ok(!/[\[\]\n]/.test(d.fields[5].l));
  assert.equal(d.editable, true); assert.equal(d.rev, 3);
  assert.equal(docSnapshot(null), null); assert.equal(docSnapshot({ fields: [] }), null);
  assert.equal(docSnapshot({ ...RAW, busy: true }).editable, false);
});
test('docNote: 칸 목록과 수정 안내, 수정 불가이면 태그 금지', () => {
  assert.match(docNote(docSnapshot(RAW)), /\[DOC_EDIT: \*\]/);
  assert.match(docNote(docSnapshot(RAW)), /price: 매매대금 \[직접 쓴 칸\] = 3억 원/);
  assert.match(docNote(docSnapshot({ ...RAW, busy: true })), /태그는 내지 마세요/);
});
test('docEditFromReply: 키 필터 · NAMED 는 발화에 칸 이름이 있을 때만 · instruction 은 사용자 원문', () => {
  const d = docSnapshot(RAW);
  const r = docEditFromReply('고칠게요. [DOC_EDIT: reason, nope; NAMED: price]', d, '신청 사유를 더 정중하게 고쳐 줘');
  assert.equal(r.type, 'doc_edit'); assert.deepEqual(r.keys, ['reason']); assert.deepEqual(r.explicit, []);
  assert.equal(r.instruction, '신청 사유를 더 정중하게 고쳐 줘');
  const r2 = docEditFromReply('[DOC_EDIT: price; NAMED: price]', d, '매매대금을 4억으로 바꿔 줘');
  assert.deepEqual(r2.explicit, ['price']);
  const all = docEditFromReply('[DOC_EDIT: *]', d, '전체를 격식 있게'); assert.deepEqual(all.keys, []);
  assert.equal(docEditFromReply('[DOC_EDIT: zzz]', d, 'x'), null);
  assert.equal(docEditFromReply('[DOC_EDIT: *]', docSnapshot({ ...RAW, busy: true }), 'x'), null);
  assert.equal(docEditFromReply('그냥 답', d, 'x'), null); assert.equal(docEditFromReply('[DOC_EDIT: *]', null, 'x'), null);
});
test('stripTags / routeFromReply: DOC_EDIT 태그는 제거되고 다른 경로로 새지 않는다', () => {
  assert.equal(stripTags('고칠게요. [DOC_EDIT: reason]'), '고칠게요.');
  assert.equal(routeFromReply('[DOC_EDIT: reason]').type, 'assistant');
});
