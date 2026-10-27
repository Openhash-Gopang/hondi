/**
 * tests/mime-text.test.mjs — 받은 메일의 제목·본문 해석(RFC 2047, base64/quoted-printable, 문자 집합, 중첩 multipart, HTML 전용)과
 * 이미 저장된 깨진 글 복구. 네트워크 없음.
 * 실행: node --test tests/mime-text.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { decodeMimeWords, hasEncodedWord, parseMessage, htmlToText, repairStoredText, repairStoredBody, qpToBytes } from '../src/worker/mime-text.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const b64wrap = (s) => b64(s).replace(/(.{76})/g, '$1\r\n');
const EUCKR_ANNYEONG = Uint8Array.from([0xBE, 0xC8, 0xB3, 0xE7, 0xC7, 0xCF, 0xBC, 0xBC, 0xBF, 0xE4]);     // "안녕하세요"
const qpUtf8 = (s) => [...Buffer.from(s, 'utf8')].map(b => (b < 128 && b !== 0x3D) ? String.fromCharCode(b) : '=' + b.toString(16).toUpperCase().padStart(2, '0')).join('');

test('EUC-KR 바이트 상수가 실제로 "안녕하세요"인지(시험 자료 점검)', () => {
  assert.equal(new TextDecoder('euc-kr').decode(EUCKR_ANNYEONG), '안녕하세요');
});

test('RFC 2047 제목: 화면에 깨져 보이던 실제 사례("Re: 테스트 메일")', () => {
  assert.equal(decodeMimeWords('=?UTF-8?B?UmU6IO2FjOyKpO2KuCDrqZTsnbw=?='), 'Re: 테스트 메일');
});
test('RFC 2047: B·Q 인코딩, 언더스코어 공백, 일반 글과 섞임, 언어 표시, 여러 단어', () => {
  assert.equal(decodeMimeWords(`=?UTF-8?B?${b64('스모크')}?=`), '스모크');
  assert.equal(decodeMimeWords(`=?UTF-8?Q?${qpUtf8('안녕 하세요').replace(/ /g, '_')}?=`), '안녕 하세요');
  assert.equal(decodeMimeWords(`Re: =?UTF-8?B?${b64('테스트')}?= 6f940975ee`), 'Re: 테스트 6f940975ee');
  assert.equal(decodeMimeWords(`=?utf-8*ko?B?${b64('언어표시')}?=`), '언어표시');
  assert.equal(decodeMimeWords(`=?UTF-8?B?${b64('가')}?=   =?UTF-8?B?${b64('나')}?=`), '가나', '인코딩된 단어 사이의 공백은 버린다');
  assert.equal(decodeMimeWords('그냥 글자'), '그냥 글자'); assert.equal(decodeMimeWords(null), '');
  assert.equal(hasEncodedWord('=?UTF-8?B?QQ==?='), true); assert.equal(hasEncodedWord('a=b?c'), false);
});
test('RFC 2047: 한 글자를 두 단어로 쪼갠 잘못된 발신 서버도 합쳐서 해석', () => {
  const bytes = Buffer.from('한', 'utf8');                       // 3바이트를 1+2로 쪼갬
  const w = (b) => `=?UTF-8?B?${b.toString('base64')}?=`;
  assert.equal(decodeMimeWords(w(bytes.subarray(0, 1)) + ' ' + w(bytes.subarray(1))), '한');
});
test('RFC 2047: EUC-KR 문자 집합, 잘못된 입력은 죽지 않음', () => {
  assert.equal(decodeMimeWords(`=?EUC-KR?B?${Buffer.from(EUCKR_ANNYEONG).toString('base64')}?=`), '안녕하세요');
  assert.equal(decodeMimeWords(`=?ks_c_5601-1987?B?${Buffer.from(EUCKR_ANNYEONG).toString('base64')}?=`), '안녕하세요');
  assert.doesNotThrow(() => decodeMimeWords('=?UTF-8?B?!!!?=')); assert.doesNotThrow(() => decodeMimeWords('=?nope-charset?B?QQ==?='));
});

const raw = (head, body) => head.join('\r\n') + '\r\n\r\n' + body;

test('본문: UTF-8 7bit 그대로', () => {
  const r = parseMessage(raw(['Subject: hi', 'Content-Type: text/plain; charset=UTF-8'], 'Hello\r\nWorld'));
  assert.equal(r.subject, 'hi'); assert.equal(r.bodyText, 'Hello\nWorld');
});
test('본문: base64(Gmail 회신 모양) — 보고된 증상의 직접 원인', () => {
  const text = '답장\r\n\r\nOn Tue, Oct 27, 2026 at 7:19 PM 스모크발신자 <ceo@hondi.kr> wrote:\r\n> 안녕하세요, K-Mail 테스트 발송입니다.';
  const msg = raw(['From: =?UTF-8?B?' + b64('테스트 사용자') + '?= <tensor.city@gmail.com>', 'Subject: =?UTF-8?B?UmU6IO2FjOyKpO2KuCDrqZTsnbw=?=', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64'], b64wrap(text));
  const r = parseMessage(msg);
  assert.equal(r.subject, 'Re: 테스트 메일'); assert.equal(r.from, '테스트 사용자 <tensor.city@gmail.com>');
  assert.ok(r.bodyText.startsWith('답장\n\nOn Tue') && r.bodyText.includes('> 안녕하세요, K-Mail 테스트 발송입니다.')); assert.ok(!/^[A-Za-z0-9+/=\s]+$/.test(r.bodyText));
});
test('본문: quoted-printable + 소프트 줄바꿈', () => {
  const body = qpUtf8('안녕하세요, 테스트 메일입니다.') + '=\r\n' + qpUtf8(' 이어지는 줄') + '\r\n둘째 줄';
  const r = parseMessage(raw(['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'], body));
  assert.equal(r.bodyText, '안녕하세요, 테스트 메일입니다. 이어지는 줄\n둘째 줄');
});
test('본문: EUC-KR — base64와 8비트 원본 바이트 모두(바이트를 잃지 않음)', () => {
  const h = ['Content-Type: text/plain; charset=euc-kr'];
  assert.equal(parseMessage(raw([...h, 'Content-Transfer-Encoding: base64'], Buffer.from(EUCKR_ANNYEONG).toString('base64'))).bodyText, '안녕하세요');
  const bin = Buffer.concat([Buffer.from(h.join('\r\n') + '\r\nContent-Transfer-Encoding: 8bit\r\n\r\n'), Buffer.from(EUCKR_ANNYEONG)]);
  assert.equal(parseMessage(new Uint8Array(bin)).bodyText, '안녕하세요');
  assert.equal(parseMessage(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)).bodyText, '안녕하세요', 'ArrayBuffer로 받아도 같다');
});
test('본문: 문자열(이미 UTF-8로 풀린 원문)과 바이트 입력이 같은 결과', () => {
  const msg = raw(['Subject: x', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit'], '한글 본문입니다');
  assert.equal(parseMessage(msg).bodyText, '한글 본문입니다'); assert.equal(parseMessage(new Uint8Array(Buffer.from(msg))).bodyText, '한글 본문입니다');
});
test('본문: multipart/alternative는 text/plain을 우선, 없으면 HTML을 글로', () => {
  const alt = (parts) => raw(['Content-Type: multipart/alternative; boundary="b1"'], parts.map(p => `--b1\r\n${p}\r\n`).join('') + '--b1--\r\n');
  const plain = `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('평문 본문')}`;
  const html = `Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('<div>HTML <b>본문</b></div>')}`;
  assert.equal(parseMessage(alt([plain, html])).bodyText, '평문 본문'); assert.equal(parseMessage(alt([html, plain])).bodyText, '평문 본문', '순서와 무관');
  assert.equal(parseMessage(alt([html])).bodyText, 'HTML 본문');
});
test('본문: 중첩(mixed 안의 alternative) + 첨부는 건너뜀', () => {
  const inner = `Content-Type: multipart/alternative; boundary="alt"\r\n\r\n--alt\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('본문입니다')}\r\n--alt\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>본문입니다</p>\r\n--alt--\r\n`;
  const att = `Content-Type: application/pdf; name="a.pdf"\r\nContent-Disposition: attachment; filename="a.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK`;
  const txtAtt = `Content-Type: text/plain; name="메모.txt"\r\nContent-Disposition: attachment; filename="메모.txt"\r\n\r\n첨부 텍스트 파일 내용`;
  const msg = raw(['Subject: s', 'Content-Type: multipart/mixed; boundary="mix"'], `preamble\r\n--mix\r\n${inner}\r\n--mix\r\n${att}\r\n--mix\r\n${txtAtt}\r\n--mix--\r\nepilogue`);
  assert.equal(parseMessage(msg).bodyText, '본문입니다');
});
test('본문: HTML 전용 — 태그·스타일·주석 제거, 줄바꿈·엔티티 처리', () => {
  const h = '<html><head><style>p{color:red}</style></head><body><!-- c --><p>안녕&nbsp;하세요 &amp; 반갑습니다</p><div>둘째<br>줄 &#54620;&#xAE00;</div><script>alert(1)</script></body></html>';
  assert.equal(htmlToText(h), '안녕 하세요 & 반갑습니다\n\n둘째\n줄 한글');
  const r = parseMessage(raw(['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64'], b64(h)));
  assert.ok(r.bodyText.includes('안녕 하세요 & 반갑습니다') && r.bodyText.includes('둘째') && r.bodyText.includes('한글') && !r.bodyText.includes('alert') && !r.bodyText.includes('color:red'));
});
test('본문: 반송 통지(multipart/report)는 사람이 읽는 설명만', () => {
  const msg = raw(['Subject: =?utf-8?b?' + b64('[발송 실패] 전달 불가') + '?=', 'Content-Type: multipart/report; report-type=delivery-status; boundary="rep"'],
    `--rep\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('수신자 주소를 찾을 수 없습니다.')}\r\n--rep\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; x\r\n\r\n--rep\r\nContent-Type: message/rfc822\r\n\r\nFrom: a@b.c\r\nSubject: 원본\r\n\r\n원본 본문\r\n--rep--`);
  const r = parseMessage(msg);
  assert.equal(r.subject, '[발송 실패] 전달 불가'); assert.equal(r.bodyText, '수신자 주소를 찾을 수 없습니다.');
});
test('헤더: 줄이 접힌 제목, 8비트 UTF-8 제목, 대소문자 헤더 이름', () => {
  const folded = raw(['SUBJECT: =?UTF-8?B?' + b64('긴 제목의 앞부분') + '?=', ' =?UTF-8?B?' + b64(' 이어지는 뒷부분') + '?=', 'content-type: text/plain'], 'x');
  assert.equal(parseMessage(folded).subject, '긴 제목의 앞부분 이어지는 뒷부분');
  assert.equal(parseMessage(new Uint8Array(Buffer.from('Subject: 그냥 UTF-8 제목\r\n\r\nx'))).subject, '그냥 UTF-8 제목');
});
test('안전: 이상한 입력에도 죽지 않고 빈 값을 돌려준다', () => {
  for (const bad of ['', 'not a mail', '\r\n\r\n', 'Content-Type: multipart/mixed\r\n\r\nx', 'Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\n', 'Content-Type: text/plain; charset=nope\r\n\r\nabc', new Uint8Array(0), null, undefined, 12345]) assert.doesNotThrow(() => parseMessage(bad), String(bad).slice(0, 20));
  assert.equal(parseMessage('Content-Type: text/plain; charset=nope\r\n\r\nabc').bodyText, 'abc');
  assert.equal(parseMessage('Content-Type: image/png\r\n\r\nXXXX').bodyText, '');
});
test('안전: 아주 긴 본문은 잘라서 돌려준다', () => {
  const r = parseMessage(raw(['Content-Type: text/plain'], 'a '.repeat(200000)));
  assert.ok(r.bodyText.length < 205000 && r.bodyText.endsWith('…(이하 생략)'));
});

// ── 이미 저장된 깨진 글 복구 ──────────────────────────────────────────────
test('복구: 화면에 보이던 깨진 제목·본문(이미 DB에 들어간 것)', () => {
  const r = repairStoredText('=?UTF-8?B?UmU6IO2FjOyKpO2KuCDrqZTsnbw=?=', b64wrap('답장\r\n\r\nOn Tue, Oct 27, 2026 at 7:19 PM 스모크발신자 <ceo@hondi.kr> wrote:\r\n> \r\n> 스모크서명-84ba267c\r\n'));
  assert.equal(r.subject, 'Re: 테스트 메일'); assert.ok(r.body.startsWith('답장') && r.body.includes('> 스모크서명-84ba267c'));
  assert.equal(repairStoredText(`=?utf-8?b?${b64('[발송 실패]')}?= =?utf-8?b?${b64(' 전달 불가')}?= 6f940975ee`, '').subject, '[발송 실패] 전달 불가 6f940975ee');
});
test('복구: quoted-printable로 저장된 본문', () => {
  assert.equal(repairStoredBody(qpUtf8('안녕하세요, 반갑습니다.') + '=\r\n' + qpUtf8(' 둘째')), '안녕하세요, 반갑습니다. 둘째');
});
test('복구: 정상 글은 건드리지 않는다(오탐 방지)', () => {
  for (const ok of ['안녕하세요. 회의는 내일 3시입니다.', 'Hello world, this is a plain message.', 'AAAAAAAAAAAAAAAAAAAAAAAA', '회의 URL: https://x.com/a?b=3D&c=4', '=?',
    crypto.createHash('sha256').update('x').digest('hex'), crypto.randomBytes(30).toString('base64'), '토큰: ' + crypto.randomBytes(24).toString('base64'), '']) assert.equal(repairStoredBody(ok), ok, ok.slice(0, 30));
  assert.equal(repairStoredText('일반 제목', '본문').subject, '일반 제목');
});
test('복구는 멱등이다 — 두 번 적용해도 같다', () => {
  const broken = b64wrap('한글 본문 내용입니다. 여러 줄\r\n둘째 줄');
  const once = repairStoredBody(broken); assert.equal(repairStoredBody(once), once);
  const s1 = repairStoredText('=?UTF-8?B?7ZWc6riA?=', broken); assert.deepEqual(repairStoredText(s1.subject, s1.body), s1);
});

test('worker.js: 수신 경로 두 곳과 읽기 경로가 모두 새 해석기를 쓴다', () => {
  const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(w, /from '\.\/src\/worker\/mime-text\.js'/);
  assert.equal((w.match(/_kmailParseMime\(/g) || []).length >= 3, true, '수신 두 곳 + _extractPlainTextBody');
  assert.ok(!/const subject = message\.headers\?\.get\?\.\('subject'\) \|\| '\(제목 없음\)';/.test(w), '날것의 제목 헤더를 그대로 쓰던 코드가 사라졌다');
  assert.ok(/_kmailRepairStoredText\(/.test(w), '이미 저장된 글을 읽을 때 고치는 경로');
});
