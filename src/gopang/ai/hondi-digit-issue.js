// 혼디 숫자 코드 자동 발급 — 가입 순번 번호를 배정받아(GET /digit/next) 지갑으로 서명하고 등록(POST /digit/record)한다.
// 가입 직후(auth.js _initGdcWalletAndFs)와 숫자 코드 페이지(번호가 없는 기존 계정)가 같이 쓴다.
// 본인 인증은 가입 때 폰 인증으로 끝났다 — 서버는 서명한 키가 그 계정에 핀된 지갑 키인지만 확인한다.
import { canonical, recordHash, verifySig, CLAIM_VERSION, CLAIM_NS, GENESIS_PREV } from './hondi-digit-claim.js';
import { isValidSerial } from './hondi-digit-core.js';

/**
 * @param {{guid:string, wallet:{signPayload:Function, publicKeyB64u?:string}, worker:string, owner?:string, onStatus?:(m:string)=>void, maxTries?:number}} o
 * @returns {Promise<{ok:true, serial:string, order:number|null}|{ok:false, code:string, message:string}>}
 */
export async function issueDigitCode({ guid, wallet, worker, owner, onStatus = () => {}, maxTries = 4 }) {
  const fail = (code, message) => ({ ok: false, code, message });
  const own = owner || wallet?.publicKeyB64u;
  if (!guid || !own || typeof wallet?.signPayload !== 'function') return fail('NO_WALLET', '지갑을 열 수 없습니다.');
  for (let attempt = 0; attempt < maxTries; attempt++) {
    onStatus('번호를 배정받는 중…');
    let nx;
    try {
      const r = await fetch(worker + '/digit/next', { signal: AbortSignal.timeout(8000) });
      nx = await r.json().catch(() => null);
      if (!r.ok || !nx || !nx.ok || !isValidSerial(nx.serial)) return fail('NEXT_FAILED', (nx && nx.message) || '번호를 배정받지 못했습니다.');
    } catch (e) { return fail('NEXT_FAILED', '번호를 배정받지 못했습니다(' + (e.message || e.name) + ').'); }

    const rec = { v: CLAIM_VERSION, ns: CLAIM_NS, type: 'claim', serial: nx.serial, seq: 0, prev: GENESIS_PREV, owner: own, to: null, ts: Date.now() };
    let sig = await wallet.signPayload(canonical(rec));
    if (sig && typeof sig === 'object' && sig.signature) sig = sig.signature;
    rec.sig = sig; rec.hash = await recordHash(rec);
    if (!(await verifySig(rec.owner, canonical(rec), rec.sig))) return fail('BAD_SIG', '서명이 요청 내용과 맞지 않습니다. 이 기기의 지갑이 계정의 키와 다를 수 있습니다.');

    let j = null, status = 0;
    try {
      const r = await fetch(worker + '/digit/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record: rec, guid }), signal: AbortSignal.timeout(10000) });
      status = r.status; j = await r.json().catch(() => null);
    } catch (e) { return fail('NETWORK', '서버에 연결하지 못했습니다(' + (e.message || e.name) + ').'); }
    if (j && j.ok) return { ok: true, serial: nx.serial, order: nx.order || null };
    if (j && (j.code === 'ALREADY_CLAIMED' || j.code === 'RACE_LOST')) continue;   // 동시에 다른 가입자가 먼저 받음 → 다음 번호로
    return fail((j && j.code) || ('HTTP_' + status), (j && j.message) || ('서버가 등록을 거절했습니다 (HTTP ' + status + ').'));
  }
  return fail('BUSY', '지금 가입자가 많아 번호를 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
}
