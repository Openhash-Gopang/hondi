import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLookup, parseProposal, stripFormTags, findForm, lookupResultText, precheckProposal, saveForm, attachmentToText } from '../gopang/ai/doc-form-client.js';
import { makeDocFormHandler } from '../worker/doc-form-handler.js';

const b64u = b => Buffer.from(b).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), signPayload: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
}
// 클라이언트 fetch → 실제 서버 핸들러(메모리 저장소)로 연결: 서명 메시지가 양쪽에서 일치하는지까지 검증한다.
async function rig() {
  const w = await wallet(); const rows = [];
  const store = {
    async latest(k) { return rows.filter(r => r.key_hash === k).sort((a, b) => b.version - a.version)[0] || null; },
    async get(k, v) { return rows.find(r => r.key_hash === k && r.version === v) || null; },
    async search() { return rows; }, async append(r) { rows.push({ ...r }); }, async setStatus() { return true; }, async countSince() { return 0; },
  };
  const h = makeDocFormHandler({ store, getPinnedPubKey: async (e, g) => (g === 'g1' ? w.pub : null) });
  const fetchImpl = async (url, init = {}) => h.handle(new Request(url, init), new URL(url), {});
  return { w, rows, fetchImpl };
}
const W = 'https://w.test';

describe('태그 파싱', () => {
  it('FORM_LOOKUP', () => {
    assert.deepEqual(parseLookup('확인할게요.\n[FORM_LOOKUP: agency=대법원 | name=소장(이혼) | form_no=]'), { agency: '대법원', name: '소장(이혼)', formNo: '' });
    assert.equal(parseLookup('[FORM_LOOKUP: agency=대법원]'), null);
    assert.equal(parseLookup('태그 없음'), null);
  });
  it('FORM_SAVE_PROPOSAL', () => {
    const t = '저장할까요?\n[FORM_SAVE_PROPOSAL: agency=세무서 | name=사업자등록 신청서 | form_no=별지 제4호 | class=A | version_date=2026-01 | source=user_attached]\n# 신청서\n성명: ____\n[/FORM_SAVE_PROPOSAL]';
    const p = parseProposal(t);
    assert.equal(p.agency, '세무서'); assert.equal(p.formNo, '별지 제4호'); assert.equal(p.formClass, 'A'); assert.equal(p.source, 'user_attached');
    assert.equal(p.body, '# 신청서\n성명: ____');
    assert.equal(parseProposal('[FORM_SAVE_PROPOSAL: agency=a | name=b]\n[/FORM_SAVE_PROPOSAL]'), null);   // 빈 본문
  });
  it('stripFormTags: 태그·제안 본문 제거', () => {
    const t = '저장할까요?\n[FORM_SAVE_PROPOSAL: agency=a | name=b]\n본문\n[/FORM_SAVE_PROPOSAL]';
    assert.equal(stripFormTags(t), '저장할까요?');
    assert.equal(stripFormTags('찾아볼게요 [FORM_LOOKUP: agency=a | name=b]'), '찾아볼게요');
  });
});

describe('서버와 연결(저장→조회)', () => {
  it('저장 후 다른 이용자가 같은 서식을 조회하면 본문과 안내문을 받는다', async () => {
    const { w, fetchImpl } = await rig();
    const p = { agency: '대법원', name: '소장(이혼)', formNo: '', formClass: 'A', versionDate: '2026-01', source: 'user_attached', body: '# 소장\n원고: ____\n피고: ____' };
    const r = await saveForm(W, w, 'g1', p, { persona: 'lawyer', fetchImpl });
    assert.equal(r.ok, true); assert.equal(r.form.status, 'user_provided');
    const f = await findForm(W, { agency: '대법원', name: '소장 (이혼)' }, fetchImpl);   // 표기 차이 허용
    assert.match(f.body, /원고/);
    assert.match(lookupResultText(f, p), /공식 확인 전/);
    assert.equal((await saveForm(W, w, 'g1', p, { fetchImpl })).duplicate, true);
  });
  it('개인정보가 있으면 사전 점검과 서버 모두 거절', async () => {
    const { w, fetchImpl } = await rig();
    const p = { agency: 'a', name: 'b', formNo: '', formClass: 'B', versionDate: '', source: 'user_attached', body: '성명: 홍길동 연락처 010-1234-5678' };
    assert.equal(precheckProposal(p).ok, false);
    const r = await saveForm(W, w, 'g1', p, { fetchImpl });
    assert.equal(r.ok, false); assert.equal(r.code, 'PII');
  });
  it('조회: 없으면 안내 문구', async () => {
    const { fetchImpl } = await rig();
    const req = { agency: '대법원', name: '없는서식', formNo: '' };
    assert.match(lookupResultText(await findForm(W, req, fetchImpl), req), /없음/);
  });
});

describe('첨부 → 대화 텍스트', () => {
  it('텍스트 파일은 본문 포함, 읽지 못한 형식은 명시', () => {
    assert.match(attachmentToText({ name: 'a.txt', text: '안녕' }), /본문\]\n안녕/);
    const u = attachmentToText({ name: 'b.pdf', text: null });
    assert.match(u, /내용을 읽지 못함/); assert.match(u, /추측하지 말고/);
  });
  it('긴 텍스트는 잘라서 표시', () => {
    assert.match(attachmentToText({ name: 'c.txt', text: 'x'.repeat(30000) }), /이하 생략/);
  });
});
