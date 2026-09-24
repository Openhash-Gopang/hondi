// ═════════════════════════════════════════════════
// 혼디 숫자 번호 — 서명된 청구 레코드 API (2026-09-24 신설)
//
// 엔드포인트
//   GET  /digit/status?serial=NNNN   번호 상태(available/claimed/revoked/reserved/blocked) + 정책 등급
//   GET  /digit/chain?serial=NNNN    레코드 체인 전체(공개) — 누구나 verifyChain()으로 서버 없이 검증
//   POST /digit/record               { record, grant?, guid }  청구·양도·폐기 레코드 제출
//
// 원칙
//   · 권한은 "번호를 안다"가 아니라 "그 번호의 현재 소유자 키로 서명했다"에서만 나온다.
//   · 청구 레코드의 owner 키는 제출한 guid 계정에 핀(pin)된 지갑 공개키와 같아야 한다.
//     (지갑 키는 가입 시 폰 알림 본인 인증으로 계정에 묶인다 → "폰 인증 = 소유권 확보"를 그대로 이어받음)
//   · 동시 청구는 (serial, seq) 유니크 인덱스가 정리한다 — 서버 로직에 락이 없다.
//   · 본인 확인은 두 요소다: ① 지갑 서명(핀된 키) ② 방금 문자(SMS)로 인증한 토큰(verifyPhoneToken 주입 시 필수, 2026-09-25).
//   · worker.js의 저수준 의존성(L1 admin 토큰, 핀된 키 조회)은 주입받는다 — k-service-auth.js와 같은 방식.
//
// worker.js 연결 예:
//   import { makeDigitClaimHandler } from './src/worker/digit-claim-handler.js';
//   const _digit = makeDigitClaimHandler({
//     l1: makePocketBaseDigitStore(env),          // 아래 인터페이스 참고
//     getPinnedPubKey: (env, guid) => ...,        // 기존 profiles 조회(ed25519_pubkey)
//     authorityPubKey: env.DIGIT_AUTHORITY_PUBKEY,// 예약 번호 grant 서명용 운영 공개키(공개키만 — 개인키는 Worker에 두지 않는다)
//     anchor: (rec) => ctx.waitUntil(openhashAnchor(rec)),
//   });
//   if (url.pathname.startsWith('/digit/')) return _digit.handle(request, url, env, corsHeaders);
//
// l1 인터페이스(PocketBase 어댑터가 구현):
//   listRecords(serial) → 레코드 배열(seq 오름차순)
//   appendRecord(rec)   → 저장. (serial,seq) 또는 hash 중복이면 반드시 Error('CONFLICT') 를 던진다.
// ═════════════════════════════════════════════════

import {
  applyRecord, verifyChain, classifySerial, checkClaimPolicy,
} from '../gopang/ai/hondi-digit-claim.js';
import { isValidSerial } from '../gopang/ai/hondi-digit-core.js';

function json(body, status, corsHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders } });
}
const err = (status, code, message, cors) => json({ ok: false, code, message }, status, cors);

export function makeDigitClaimHandler({ l1, getPinnedPubKey, authorityPubKey = null, premiumList = new Set(), anchor = null, now = () => Date.now(), verifyPhoneToken = null }) {
  if (!l1?.listRecords || !l1?.appendRecord) throw new Error('makeDigitClaimHandler: l1.listRecords/appendRecord 필요');
  if (typeof getPinnedPubKey !== 'function') throw new Error('makeDigitClaimHandler: getPinnedPubKey 필요');

  async function loadState(serial) {
    const recs = await l1.listRecords(serial);
    if (!recs.length) return { recs, state: null };
    const v = await verifyChain(recs);
    if (!v.ok) throw Object.assign(new Error(`체인 무결성 오류(${serial} #${v.index} ${v.code})`), { code: 'CHAIN_CORRUPT' });
    return { recs, state: v.state };
  }

  function publicState(serial, state, cfg) {
    const c = classifySerial(serial, cfg);
    if (state) return { serial, status: state.revoked ? 'revoked' : 'claimed', owner: state.revoked ? null : state.owner, seq: state.seq, head: state.hash, tier: c.tier };
    if (c.tier === 'public-safety') return { serial, status: 'blocked', tier: c.tier, reasons: c.reasons };
    if (c.tier !== 'open') return { serial, status: 'reserved', tier: c.tier, reasons: c.reasons };
    return { serial, status: 'available', tier: c.tier };
  }

  async function handle(request, url, env, cors = {}) {
    try {
      const path = url.pathname;
      if (request.method === 'GET' && (path === '/digit/status' || path === '/digit/chain')) {
        const serial = url.searchParams.get('serial') || '';
        if (!isValidSerial(serial)) return err(400, 'SERIAL', '번호는 1~10자리, 첫 자리 1~9여야 합니다.', cors);
        const { recs, state } = await loadState(serial);
        if (path === '/digit/chain') return json({ ok: true, serial, records: recs, state: publicState(serial, state, { premiumList }) }, 200, cors);
        return json({ ok: true, ...publicState(serial, state, { premiumList }) }, 200, cors);
      }

      if (request.method === 'POST' && path === '/digit/record') {
        let body; try { body = await request.json(); } catch { return err(400, 'JSON', '본문이 JSON이 아닙니다.', cors); }
        const { record, grant = null, guid } = body || {};
        if (!record || !guid) return err(400, 'MISSING', 'record, guid가 필요합니다.', cors);
        if (!isValidSerial(record.serial)) return err(400, 'SERIAL', '번호는 1~10자리, 첫 자리 1~9여야 합니다.', cors);

        // 1) 서명한 키가 이 계정에 핀된 지갑 키인가 (폰 인증으로 확립된 계정 ↔ 키 결합)
        const pinned = await getPinnedPubKey(env, guid);
        if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
        if (pinned !== record.owner) return err(403, 'KEY_MISMATCH', '서명 키가 이 계정의 지갑 키와 다릅니다.', cors);

        // 1.5) 문자(SMS) 인증: 서명과 별개의 두 번째 요소. verifyPhoneToken이 주입된 환경에서는 방금 문자로 인증한 토큰이 없으면 거절한다.
        if (verifyPhoneToken) {
          const tok = body.phone_verify_token;
          if (!tok) return err(401, 'PHONE_TOKEN_REQUIRED', '문자(SMS) 인증이 필요합니다.', cors);
          const pv = await verifyPhoneToken(env, tok, guid, { step_up_token: body.step_up_token });
          if (!pv || !pv.ok) return err((pv && pv.status) || 401, (pv && pv.code) || 'PHONE_TOKEN_INVALID', (pv && pv.message) || '문자 인증을 확인하지 못했습니다.', cors);
        }

        // 2) 상태 전이 검증(서명·해시·seq·prev·소유자·폐기 여부)
        const { state } = await loadState(record.serial);
        const applied = await applyRecord(state, record, { now: now() });
        if (!applied.ok) {
          const status = applied.code === 'ALREADY_CLAIMED' || applied.code === 'REVOKED' ? 409
            : (applied.code === 'NOT_OWNER' ? 403 : (applied.code === 'BAD_SIG' || applied.code === 'BAD_HASH' ? 401 : 400));
          return err(status, applied.code, applied.message, cors);
        }

        // 3) 청구 정책(예약·공공 번호) — 양도/폐기에는 적용하지 않는다(이미 정책을 통과한 번호)
        if (record.type === 'claim') {
          const pol = await checkClaimPolicy(record, { grant, authorityPubKey, premiumList });
          if (!pol.ok) return err(403, pol.code, pol.message, cors);
        }

        // 4) 저장 — 동시 제출은 (serial,seq) 유니크가 한 건만 통과시킨다
        try {
          await l1.appendRecord({ ...record, submitter_guid: guid });
        } catch (e) {
          if (e && e.message === 'CONFLICT') {
            const cur = await loadState(record.serial);
            return json({ ok: false, code: 'RACE_LOST', message: '같은 순간에 다른 요청이 먼저 저장되었습니다.', state: publicState(record.serial, cur.state, { premiumList }) }, 409, cors);
          }
          throw e;
        }
        if (anchor) { try { anchor(record); } catch { /* 앵커링 실패는 청구를 되돌리지 않는다 — 재시도 큐에서 처리 */ } }
        return json({ ok: true, record_hash: record.hash, state: publicState(record.serial, applied.state, { premiumList }) }, 200, cors);
      }

      return err(404, 'NOT_FOUND', '알 수 없는 경로입니다.', cors);
    } catch (e) {
      const code = e?.code || 'INTERNAL';
      return err(code === 'CHAIN_CORRUPT' ? 500 : 502, code, e?.message || '처리 중 오류', cors);
    }
  }
  return { handle, loadState };
}
