// src/worker/kmail-address.js — K-Mail 주소 규칙: 보내는 주소(From)와 들어오는 주소(To) 해석.
// 순수 함수만 담는다 — worker.js 밖에서 단위 시험이 가능하다.
//
// 2026-10-27 결정(주피터): 보내는 주소를 메일 아이디(<아이디>@hondi.kr)로 쓴다.
//   · 보낼 때: 메일 아이디가 있으면 그것을, 없으면 예전처럼 guid(콜론→하이픈)를 로컬파트로 쓴다.
//   · 받을 때(@hondi.kr 로 온 메일): 로컬파트가 ① kmail-<캠페인> 이면 캠페인 회신, ② guid 모양(4자리 16진수 8묶음, 39자)이면
//     예전 방식 그대로 guid, ③ 그 밖이면 메일 아이디로 보고 소유자를 찾는다. 메일 아이디는 최대 30자라 ②와 겹칠 수 없고,
//     예약어(kmail…)라 ①과도 겹치지 않는다.
//   ⚠ 아이디를 바꾸면 이전 아이디로 온 메일은 받지 못한다 — 상용 개시 전이라 옛 주소를 보관하지 않기로 한 결정 그대로다
//     (상용 개시 전에 옛 아이디 예약 기간을 다시 정할 것). 캠페인 회신(kmail-<id>@)은 아이디와 무관하게 계속 도착한다.
import { MAIL_ID_PATTERN } from './mail-id.js';

export const GUID_LOCAL_RE = /^[0-9a-f]{4}(?:-[0-9a-f]{4}){7}$/;
const CAMPAIGN_LOCAL_RE = /^kmail-([a-z0-9_-]+)$/i;

export const guidToLocalPart = (guid) => String(guid).replace(/:/g, '-');
export const localPartToGuid = (localPart) => String(localPart).replace(/-/g, ':');

// 이미 저장된 메일 아이디는 형식(3~30자)만 맞으면 쓴다. 숫자만·예약어 규칙은 "새로 정할 때" 적용되는 것이라,
// 예전에 자동 배정된 8자리 16진수(숫자만일 수 있음)도 보내는 주소로는 그대로 쓸 수 있어야 한다.
export function senderLocalPart(guid, mailId) {
  const id = String(mailId || '').trim().toLowerCase();
  return id && MAIL_ID_PATTERN.test(id) ? id : guidToLocalPart(guid);
}
// 2026-10-31 결정(주피터): 보내는 주소 도메인을 hondi.kr → naviweb.kr 로 옮긴다. 받을 때는 옛 hondi.kr 도 계속 K-Mail 로 처리한다(이미 나간 메일의 답장).
export const KMAIL_DOMAIN = 'naviweb.kr';
export const KMAIL_RECEIVE_DOMAINS = ['naviweb.kr', 'hondi.kr'];
export const isKmailAddress = (addr) => {
  const a = String(addr || '').trim().toLowerCase();
  return KMAIL_RECEIVE_DOMAINS.some((d) => a.endsWith('@' + d));
};
export const senderAddress = (guid, mailId) => `${senderLocalPart(guid, mailId)}@${KMAIL_DOMAIN}`;

// → { kind: 'campaign', campaignId } | { kind: 'guid', guid } | { kind: 'mail_id', mailId } | { kind: 'unknown' }
export function classifyInboundLocalPart(localPart) {
  const lp = String(localPart || '').trim().toLowerCase();
  const c = lp.match(CAMPAIGN_LOCAL_RE);
  if (c) return { kind: 'campaign', campaignId: c[1] };
  if (GUID_LOCAL_RE.test(lp)) return { kind: 'guid', guid: localPartToGuid(lp) };
  if (MAIL_ID_PATTERN.test(lp)) return { kind: 'mail_id', mailId: lp };
  return { kind: 'unknown' };
}
