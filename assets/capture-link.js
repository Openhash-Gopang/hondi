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

  var api = { start: start, phoneSession: phoneSession, downscale: downscale, _t: { seal: seal, open: open, generateKeyPair: generateKeyPair, sha256Hex: sha256Hex, newSid: newSid } };
  root.NaviCapture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
