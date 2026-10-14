// 서식 촬영 사진을 다른 페이지(전문가 채팅)로 넘기는 브라우저 전용 도우미 (2026-10-14 신설).
// 사진은 서버로 보내지 않는다. 같은 기기의 IndexedDB에 잠깐 두었다가 받는 쪽이 읽는 즉시 지운다(30분 지나면 무효).
// sessionStorage는 5MB 한도라 사진 몇 장이면 넘치므로 IndexedDB를 쓴다.
export const HANDOFF_PARAM = 'formshots';
export const HANDOFF_TTL_MS = 30 * 60 * 1000;
const DB = 'hondi_handoff', STORE = 'kv', KEY = 'formshots';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode); let out;
    t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    out = fn(t.objectStore(STORE));
  });
}

// 이미지를 긴 변 maxSide px JPEG data URL로 줄인다(서식 사진은 글자가 읽혀야 하므로 1600px).
export function downscaleImage(file, maxSide = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const r = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없습니다.')); };
    img.src = url;
  });
}

// 이미 data URL인 사진(메인 채팅 첨부)을 같은 방식으로 줄인다.
export function downscaleDataUrl(dataUrl, maxSide = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const r = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('이미지를 열 수 없습니다.'));
    img.src = dataUrl;
  });
}

export async function putShots(dataUrls, now = Date.now) {
  const db = await open();
  try { await tx(db, 'readwrite', s => s.put({ ts: now(), images: dataUrls }, KEY)); } finally { db.close(); }
}

// 읽으면서 지운다. 없거나 오래됐으면 [].
export async function takeShots(now = Date.now) {
  const db = await open();
  try {
    const rec = await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite'); const s = t.objectStore(STORE);
      const g = s.get(KEY); g.onsuccess = () => { s.delete(KEY); resolve(g.result); }; g.onerror = () => reject(g.error);
    });
    if (!rec || !Array.isArray(rec.images) || now() - rec.ts > HANDOFF_TTL_MS) return [];
    return rec.images.filter(u => typeof u === 'string' && u.startsWith('data:image/'));
  } finally { db.close(); }
}

// 받는 쪽이 대화 메시지로 쓸 첨부 객체.
export function shotsToAttachment(images) {
  return { name: `서식 사진 ${images.length}장`, isImage: true, dataUrl: images[0], images };
}
