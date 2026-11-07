/**
 * pdv/phone-fetch.js — PDV 방식 P: 원본은 폰에 두고, PC 는 폰의 승인을 받아 불러온다.
 *
 * 흐름(기존 device-link 세션 재사용, purpose='pdv_fetch'):
 *   PC   init(e164, 1회용 X25519 공개키) → 폰에 웹푸시
 *   폰   승인(step-up) → 레코드를 JSON → 조각(chunk) → 조각마다 PC 공개키로 봉투 암호화 → /deliver-part → /deliver{partCount}
 *   PC   poll → delivered → /part 로 조각을 받아(받으면 서버에서 삭제) 복호화·합침
 * 서버는 암호화된 조각만 중계하고 평문을 보지 못한다. 조각은 KV 에 짧게(2분) 머문다.
 * 암복호·네트워크 함수는 주입식이라 Node 테스트가 가능하다.
 */

export const PART_CHARS = 90000;          // 조각당 평문 글자 수(세션 저장소 한계 128KB 아래, 봉투 base64 확장 감안)
export const MAX_PARTS = 200;             // 서버 한도와 같다(≈18MB)

/** 문자열 → 조각 배열 */
export function splitText(text, size = PART_CHARS) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

/**
 * 폰 쪽: 레코드를 조각내 봉투 암호화로 올리고 마지막에 deliver 한다.
 * @param {object} o
 * @param {Array} o.records PDV 원본 레코드
 * @param {(plain:string)=>Promise<object>} o.seal PC 공개키로 봉투 암호화(sealForRecipient 래핑)
 * @param {(i:number,total:number,sealed:object)=>Promise<void>} o.postPart
 * @param {(info:{partCount:number,count:number})=>Promise<void>} o.deliver
 */
export async function phoneRespond({ records, seal, postPart, deliver, partChars = PART_CHARS }) {
  const text = JSON.stringify({ v: 1, ts: Date.now(), records });
  const parts = splitText(text, partChars);
  if (parts.length > MAX_PARTS) throw new Error('PDV 가 너무 커서 한 번에 옮길 수 없습니다(' + parts.length + '조각). 항목을 나눠 불러 주세요.');
  for (let i = 0; i < parts.length; i++) await postPart(i, parts.length, await seal(parts[i]));
  await deliver({ partCount: parts.length, count: records.length });
  return { partCount: parts.length, count: records.length };
}

/**
 * PC 쪽: 폰이 보낸 조각을 받아 합친다.
 * @param {number} o.partCount
 * @param {(i:number)=>Promise<object>} o.getPart  봉투 조각 1개
 * @param {(sealed:object)=>Promise<string>} o.open 1회용 개인키로 복호화
 */
export async function pcCollect({ partCount, getPart, open }) {
  if (!Number.isInteger(partCount) || partCount < 1 || partCount > MAX_PARTS) throw new Error('조각 수가 올바르지 않습니다.');
  let text = '';
  for (let i = 0; i < partCount; i++) text += await open(await getPart(i));
  const data = JSON.parse(text);
  if (!data || data.v !== 1 || !Array.isArray(data.records)) throw new Error('폰이 보낸 PDV 형식이 올바르지 않습니다.');
  return data;
}

/**
 * PC 쪽 전체 흐름. 폰이 승인할 때까지 기다린 뒤 레코드를 돌려준다.
 * @param {object} o
 * @param {string} o.worker  Worker 주소
 * @param {string} o.e164
 * @param {{publicKeyB64u:string, privateKey:any}} o.keyPair  GopangWallet.generateX25519KeyPair() 결과(1회용)
 * @param {(sealed:object, privateKey:any)=>Promise<string>} o.openWithKey GopangWallet.openSealedWithKey
 * @param {(state:string)=>void} [o.onState] 'pushed' | 'waiting' | 'receiving'
 */
export async function requestFromPhone({ worker, e164, keyPair, openWithKey, pcLabel = 'PC', fetchImpl = globalThis.fetch, onState = () => {}, pollMs = 1500, timeoutMs = 120000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const j = async (res) => { const d = await res.json().catch(() => ({})); if (!res.ok || d.ok === false) throw new Error(d.detail || d.error || ('요청 실패 ' + res.status)); return d; };
  const init = await j(await fetchImpl(`${worker}/auth/device-link/init`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ e164, purpose: 'pdv_fetch', pcPubKeyB64u: keyPair.publicKeyB64u, pcLabel }),
  }));
  const sessionId = init.sessionId;
  onState(init.pushSentToMobile === false ? 'no-push' : 'pushed');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const p = await j(await fetchImpl(`${worker}/auth/device-link/poll?sessionId=${encodeURIComponent(sessionId)}`));
    if (p.state === 'delivered') {
      onState('receiving');
      const getPart = async (i) => (await j(await fetchImpl(`${worker}/auth/device-link/part?sessionId=${encodeURIComponent(sessionId)}&i=${i}`))).sealed;
      return pcCollect({ partCount: p.partCount, getPart, open: (s) => openWithKey(s, keyPair.privateKey) });
    }
    if (p.state === 'expired') throw new Error('요청이 만료됐습니다. 다시 시도해 주세요.');
    onState('waiting');
    await sleep(pollMs);
  }
  throw new Error('폰에서 승인하지 않아 시간이 지났습니다.');
}
