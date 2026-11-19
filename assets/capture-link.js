/* ═════════════════════════════════════════════════
   capture-link.js — 폰 카메라 → PC 증거 전달 (클라이언트, PC·폰 공용)
   2026-11-19. 설계: docs/design/PHONE_CAMERA_TO_PC_HELPER_v0_1.html · 서버: src/worker/capture-server.js
   · 같은 계정(phone_verify_token → guid) 의 PC 와 폰 사이에서만 동작한다.
   · 사진은 폰에서 PC 의 1회용 X25519 공개키로 봉인(AES-GCM) → 서버는 암호문만 본다.
     봉투 형식은 gopang-wallet.js sealForRecipient 와 같다(ephemeralPubKey/iv/ciphertext, base64url).
   · 폰 카메라는 폰에서 알림을 눌러야 열린다(PC 가 폰을 몰래 켤 수 없다).
   공개 API (window.NaviCapture):
     PC : await NaviCapture.start({ label, onPhoto(dataUrl, meta), onState(state) }) → { sid, stop() }
     폰 : await NaviCapture.phoneSession(sid) → { label, send(dataUrl) }
   ═════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var API = 'https://hondi-proxy.tensor-city.workers.dev';
  var enc = new TextEncoder(), dec = new TextDecoder();
  var cr = function () { return root.crypto; };

  function bufToB64u(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64uToBuf(str) { var b = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; var bin = atob(b), o = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o.buffer; }
  async function sha256Hex(str) { var d = await cr().subtle.digest('SHA-256', enc.encode(str)); return Array.prototype.map.call(new Uint8Array(d), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function newSid() { return bufToB64u(cr().getRandomValues(new Uint8Array(18))); }   // 24자

  // ── 봉인 / 개봉 (wallet 형식과 동일) ──
  async function generateKeyPair() {
    var kp = await cr().subtle.generateKey({ name: 'X25519' }, true, ['deriveKey']);
    return { privateKey: kp.privateKey, pub: bufToB64u(await cr().subtle.exportKey('raw', kp.publicKey)) };
  }
  async function seal(pubB64u, plaintext) {
    var rpub = await cr().subtle.importKey('raw', b64uToBuf(pubB64u), { name: 'X25519' }, false, []);
    var eph = await cr().subtle.generateKey({ name: 'X25519' }, true, ['deriveKey']);
    var key = await cr().subtle.deriveKey({ name: 'X25519', public: rpub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    var iv = cr().getRandomValues(new Uint8Array(12));
    var ct = await cr().subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintext));
    return { ephemeralPubKey: bufToB64u(await cr().subtle.exportKey('raw', eph.publicKey)), iv: bufToB64u(iv), ciphertext: bufToB64u(ct) };
  }
  async function open(privateKey, sealed) {
    var epub = await cr().subtle.importKey('raw', b64uToBuf(sealed.ephemeralPubKey), { name: 'X25519' }, false, []);
    var key = await cr().subtle.deriveKey({ name: 'X25519', public: epub }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var pt = await cr().subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64uToBuf(sealed.iv)) }, key, b64uToBuf(sealed.ciphertext));
    return dec.decode(pt);
  }

  // ── 서버 호출 (같은 계정 인증) ──
  function authBody() {
    var k = root.KAuth;
    var tok = k && typeof k.getToken === 'function' ? k.getToken() : null;
    if (!tok) throw new Error('LOGIN_REQUIRED');
    return { phone_verify_token: tok, ts: Date.now() };
  }
  async function call(op, extra) {
    var body = Object.assign(authBody(), extra);
    var r = await root.fetch(API + '/capture/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var j = await r.json().catch(function () { return {}; });
    return { status: r.status, json: j };
  }

  // ── PC: 촬영 세션 시작 → 폰에서 오는 사진을 받는다 ──
  async function start(opts) {
    opts = opts || {};
    var kp = await generateKeyPair(), sid = newSid(), stopped = false, got = {}, errs = 0;
    var r = await call('open', { s: sid, pc_pub: kp.pub, label: opts.label || '' });
    if (r.status !== 200) throw new Error(r.json.code || ('HTTP_' + r.status));
    if (opts.onState) opts.onState({ state: 'waiting', notified: r.json.notified !== false });
    async function tick() {
      if (stopped) return;
      try {
        var p = await call('pull', { s: sid });
        if (p.status === 404) { stopped = true; if (opts.onState) opts.onState({ state: 'expired' }); return; }
        if (p.status === 200) {
          errs = 0;
          var items = p.json.items || [];
          for (var i = 0; i < items.length; i++) {
            var it = items[i]; if (got[it.seq]) continue;
            try {
              var url = await open(kp.privateKey, it.sealed);
              if ((await sha256Hex(url)) !== it.sha256) { if (opts.onState) opts.onState({ state: 'bad-item', seq: it.seq }); continue; }
              got[it.seq] = 1;
              if (opts.onPhoto) opts.onPhoto(url, { seq: it.seq, sha256: it.sha256 });
            } catch (e) { if (opts.onState) opts.onState({ state: 'bad-item', seq: it.seq }); }
          }
        } else if (++errs >= 5 && opts.onState) opts.onState({ state: 'network' });
      } catch (e) { if (++errs >= 5 && opts.onState) opts.onState({ state: 'network' }); }
      if (!stopped) setTimeout(tick, 2500);
    }
    setTimeout(tick, 1500);
    return { sid: sid, stop: async function () { stopped = true; try { await call('close', { s: sid }); } catch (e) {} } };
  }

  // ── 폰: 세션에 붙어 사진 보내기 ──
  async function phoneSession(sid) {
    var g = await call('get', { s: sid });
    if (g.status !== 200) throw new Error(g.json.code || ('HTTP_' + g.status));
    var seq = 0;
    return {
      label: g.json.label || '',
      send: async function (dataUrl) {
        var n = seq++;
        var sealed = await seal(g.json.pc_pub, dataUrl);
        var r = await call('push', { s: sid, item: { seq: n, sha256: await sha256Hex(dataUrl), sealed: sealed } });
        if (r.status !== 200) { seq = n; throw new Error(r.json.code || ('HTTP_' + r.status)); }
        return n;
      }
    };
  }

  // 사진 줄이기(긴 변 1600px, JPEG 0.85) — 전송량·AI 읽기 품질의 균형
  async function downscale(file) {
    var url = await new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = no; r.readAsDataURL(file); });
    var img = await new Promise(function (ok, no) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = no; i.src = url; });
    var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  }

  // ── 증거(자료) 목록 — 순수 규칙 + 이 PC 의 보관(IndexedDB) ──
  // 소송 서류면 "갑 제N호증", 그 밖의 서류(의료·교육 등)는 "자료 N". 이름은 사용자가 고칠 수 있다.
  var LAWSUIT = /소장|준비서면|답변서|항소|상고|소송|지급명령|조정신청|가압류|가처분|법원/;
  function labelPrefix(ctx) { return LAWSUIT.test(String(ctx || '')) ? 'lawsuit' : 'plain'; }
  function defaultLabel(ctx, n) { return labelPrefix(ctx) === 'lawsuit' ? '갑 제' + n + '호증' : '자료 ' + n; }
  // 채택(on)된 항목만 AI 에 보낸다. 사진 순서 = 목록 순서. 출처 표기 규칙을 함께 알린다.
  function buildNote(items, ctx) {
    var on = (items || []).filter(function (x) { return x && x.on; });
    if (!on.length) return null;
    var cite = labelPrefix(ctx) === 'lawsuit' ? '(갑 제1호증 참조)' : '(자료 1 참조)';
    return {
      images: on.map(function (x) { return x.url; }),
      note: '채택한 자료 ' + on.length + '건(첨부 사진 순서): ' + on.map(function (x, i) { return (i + 1) + ') ' + (x.label || ('자료 ' + (i + 1))); }).join(', ') +
        '. 서류의 사실 주장에는 근거가 되는 자료를 ' + cite + '처럼 표기하고, 자료와 맞지 않는 문장은 고치지 말고 먼저 알려 주세요. 자료에 없는 사실은 새로 만들지 마세요.'
    };
  }
  var DB = 'navi_capture_evidence', STORE = 'ev';
  function idb() { return new Promise(function (ok, no) { var q = root.indexedDB.open(DB, 1); q.onupgradeneeded = function () { q.result.createObjectStore(STORE, { keyPath: 'id' }); }; q.onsuccess = function () { ok(q.result); }; q.onerror = function () { no(q.error); }; }); }
  async function evSave(rec) { try { var d = await idb(); await new Promise(function (ok, no) { var t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(rec); t.oncomplete = ok; t.onerror = no; }); } catch (e) {} }
  async function evDelete(id) { try { var d = await idb(); await new Promise(function (ok, no) { var t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(id); t.oncomplete = ok; t.onerror = no; }); } catch (e) {} }
  async function evList() { try { var d = await idb(); return await new Promise(function (ok, no) { var r = d.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = function () { ok(r.result || []); }; r.onerror = no; }); } catch (e) { return []; } }

  var api = { start: start, phoneSession: phoneSession, downscale: downscale, defaultLabel: defaultLabel, buildNote: buildNote, labelPrefix: labelPrefix, evSave: evSave, evDelete: evDelete, evList: evList, _t: { seal: seal, open: open, generateKeyPair: generateKeyPair, sha256Hex: sha256Hex, newSid: newSid } };
  root.NaviCapture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
