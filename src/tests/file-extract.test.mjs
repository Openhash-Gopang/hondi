import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFile, htmlToFormText, hwpxXmlToText } from '../gopang/ai/file-extract.js';
import { attachmentToText } from '../gopang/ai/doc-form-client.js';

describe('파일 형식 분류', () => {
  it('확장자·MIME', () => {
    assert.equal(classifyFile('a.PDF', ''), 'pdf');
    assert.equal(classifyFile('a.docx', ''), 'docx');
    assert.equal(classifyFile('a.hwpx', ''), 'hwpx');
    assert.equal(classifyFile('a.hwp', ''), 'hwp');
    assert.equal(classifyFile('a.doc', ''), 'doc');
    assert.equal(classifyFile('a.txt', ''), 'text');
    assert.equal(classifyFile('x', 'image/jpeg'), 'image');
    assert.equal(classifyFile('a.zip', ''), 'other');
  });
});

describe('DOCX(mammoth HTML) → 글', () => {
  it('문단·표 칸·행', () => {
    const html = '<h1>소장</h1><p>원고: ____</p><table><tr><td>성명</td><td>____</td></tr><tr><td>주소</td><td>____ &amp; 기타</td></tr></table><p>끝</p>';
    assert.equal(htmlToFormText(html), '소장\n원고: ____\n성명 | ____\n주소 | ____ & 기타\n끝');
  });
});

describe('DOCX 실물 모양(mammoth는 칸 안을 <p>로 감싼다)', () => {
  it('칸은 한 줄에 남는다', () => {
    const html = '<h1>신청서</h1><table><tr><td><p>상호</p></td><td><p>____</p><p>(법인명)</p></td></tr><tr><td><p>소재지</p></td><td><p>____</p></td></tr></table><p>끝</p>';
    assert.equal(htmlToFormText(html), '신청서\n상호 | ____ (법인명)\n소재지 | ____\n끝');
  });
});

describe('HWPX section XML → 글', () => {
  it('문단·표·엔티티', () => {
    const xml = '<hs:sec><hp:p><hp:run><hp:t>사업자등록 신청서</hp:t></hp:run></hp:p>' +
      '<hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>상호</hp:t></hp:run></hp:p></hp:subList></hp:tc>' +
      '<hp:tc><hp:subList><hp:p><hp:run><hp:t>____ &lt;법인&gt;</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hs:sec>';
    assert.equal(hwpxXmlToText(xml), '사업자등록 신청서\n상호 | ____ <법인>');
  });
});

describe('첨부 → 대화 텍스트(이유·비고)', () => {
  it('읽지 못함: 이유 포함', () => {
    const t = attachmentToText({ name: 'a.hwp', text: null, reason: '예전 한글(.hwp) 형식은 열 수 없습니다.' });
    assert.match(t, /내용을 읽지 못함/); assert.match(t, /\.hwp\) 형식은 열 수 없습니다/); assert.match(t, /추측하지 말고/);
  });
  it('본문: 비고 표시', () => {
    assert.match(attachmentToText({ name: 'a.pdf', text: '내용', note: 'PDF 40쪽 중 앞 30쪽만 읽음' }), /본문 · PDF 40쪽 중 앞 30쪽만 읽음\]\n내용/);
  });
});
