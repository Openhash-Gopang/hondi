// ═════════════════════════════════════════════════
// digit-claim-handler.js 의 l1 저장소 어댑터 — L1 PocketBase `digit_claim_records` 컬렉션 (2026-09-24 신설)
//
//   listRecords(serial) → 레코드 배열(seq 오름차순). 컬렉션에 없는 필드 v·ns 는 상수로 복원한다
//                         (서명 대상 정규화 문자열에 들어가므로 반드시 원래 값이어야 한다).
//   appendRecord(rec)   → 저장. (serial,seq) 또는 hash 유니크 위반이면 Error('CONFLICT').
//
// 의존성은 주입한다(worker.js 저수준 함수를 직접 import 하지 않음 → 단위 테스트 가능):
//   makePocketBaseDigitStore({ base: L1_DEFAULT, getToken: () => _l1AdminToken(env) })
// ═════════════════════════════════════════════════
import { CLAIM_VERSION, CLAIM_NS } from '../gopang/ai/hondi-digit-claim.js';

const COLLECTION = 'digit_claim_records';
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function toRecord(row) {
  return {
    v: CLAIM_VERSION, ns: CLAIM_NS, type: row.type, serial: row.serial, seq: row.seq, prev: row.prev,
    owner: row.owner, to: row.to ? row.to : null, ts: row.ts, sig: row.sig, hash: row.hash,
  };
}

export function makePocketBaseDigitStore({ base, getToken, fetchImpl = fetch }) {
  if (!base || typeof getToken !== 'function') throw new Error('makePocketBaseDigitStore: base, getToken 필요');
  const url = path => `${base}/api/collections/${COLLECTION}/records${path}`;
  const auth = async () => ({ 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' });

  async function listRecords(serial) {
    const filter = encodeURIComponent(`serial='${q(serial)}'`);
    const res = await fetchImpl(url(`?filter=${filter}&sort=seq&perPage=200`), { headers: await auth() });
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    return (data.items || []).map(toRecord);
  }

  async function appendRecord(rec) {
    const body = {
      serial: rec.serial, seq: rec.seq, type: rec.type, prev: rec.prev, owner: rec.owner,
      to: rec.to || '', ts: rec.ts, sig: rec.sig, hash: rec.hash, submitter_guid: rec.submitter_guid || '',
    };
    const res = await fetchImpl(url(''), { method: 'POST', headers: await auth(), body: JSON.stringify(body) });
    if (res.ok) return;
    // PocketBase는 유니크 위반을 400으로 돌려주며 원인 구분이 모호하다 → 실제로 같은 (serial,seq)/hash가 이미 있는지 확인해 판정한다
    if (res.status === 400) {
      const now = await listRecords(rec.serial);
      if (now.some(r => r.seq === rec.seq || r.hash === rec.hash)) throw new Error('CONFLICT');
    }
    const text = await res.text().catch(() => '');
    throw new Error(`L1 저장 실패 (HTTP ${res.status}) ${text.slice(0, 200)}`);
  }

  return { listRecords, appendRecord };
}
