/* material-dialog.js — 공용 Material 대화상자 (2026-11-14)
   window.mpAlert(msg) / mpConfirm(msg,{ok,cancel}) / mpPrompt(msg,default,{ok,cancel}) → Promise
   window.alert 를 비차단 Material 대화상자로 대체한다(원래 함수는 window.nativeAlert).
   주의: 새 alert는 즉시 반환된다. 알림 직후 페이지를 이동·새로고침하는 곳은 nativeAlert 또는 await mpAlert 를 쓸 것. */
(function (w, d) {
  if (w.__mpDialog) return; w.__mpDialog = true;
  w.nativeAlert = w.alert.bind(w);
  var css = '#mp-dlg-back{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '#mp-dlg{width:min(400px,100%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;background:#fff;color:#212121;border-radius:4px;padding:24px 24px 8px;font:400 15px/1.6 Pretendard,system-ui,-apple-system,"Malgun Gothic",sans-serif;box-shadow:0 11px 15px -7px rgba(0,0,0,.2),0 24px 38px 3px rgba(0,0,0,.14),0 9px 46px 8px rgba(0,0,0,.12)}' +
    '#mp-dlg .mp-d-msg{white-space:pre-wrap;word-break:break-word;margin:0 0 12px}' +
    '#mp-dlg .mp-d-in{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid #9e9e9e;border-radius:0;padding:10px 2px;font:inherit;background:transparent;color:inherit;margin-bottom:12px}' +
    '#mp-dlg .mp-d-in:focus{outline:none;border-bottom:2px solid #00796B;padding-bottom:9px}' +
    '#mp-dlg .mp-d-act{display:flex;justify-content:flex-end;gap:8px;padding:8px 0}' +
    '#mp-dlg button{min-height:40px;padding:0 16px;border:0;border-radius:4px;background:transparent;color:#00796B;font-weight:600;font-size:14px;font-family:inherit;letter-spacing:.04em;cursor:pointer}' +
    '#mp-dlg button:hover{background:#e0f2f1}#mp-dlg button.mp-d-ok{background:#00796B;color:#fff}#mp-dlg button.mp-d-ok:hover{background:#00695c}' +
    '@media (prefers-color-scheme:dark){#mp-dlg{background:#1e293b;color:#f1f5f9}#mp-dlg button{color:#4db6ac}#mp-dlg button:hover{background:#1f3b38}#mp-dlg button.mp-d-ok{background:#00796B;color:#fff}}';
  var queue = [], busy = false;
  function ensureCss() { if (d.getElementById('mp-dlg-css')) return; var s = d.createElement('style'); s.id = 'mp-dlg-css'; s.textContent = css; (d.head || d.documentElement).appendChild(s); }
  function next() {
    if (busy || !queue.length) return; busy = true;
    var q = queue.shift(); ensureCss();
    var back = d.createElement('div'); back.id = 'mp-dlg-back';
    var box = d.createElement('div'); box.id = 'mp-dlg'; box.setAttribute('role', q.kind === 'alert' ? 'alertdialog' : 'dialog'); box.setAttribute('aria-modal', 'true');
    var m = d.createElement('p'); m.className = 'mp-d-msg'; m.textContent = q.msg; box.appendChild(m);
    var inp = null;
    if (q.kind === 'prompt') { inp = d.createElement('input'); inp.className = 'mp-d-in'; inp.type = 'text'; inp.value = q.def == null ? '' : String(q.def); box.appendChild(inp); }
    var act = d.createElement('div'); act.className = 'mp-d-act';
    var prev = d.activeElement;
    function done(v) { d.removeEventListener('keydown', key, true); back.remove(); busy = false; try { if (prev && prev.focus) prev.focus(); } catch (_) {} q.res(v); next(); }
    var ok = d.createElement('button'); ok.type = 'button'; ok.className = 'mp-d-ok'; ok.textContent = q.ok || '확인';
    ok.onclick = function () { done(q.kind === 'confirm' ? true : q.kind === 'prompt' ? inp.value : undefined); };
    if (q.kind !== 'alert') {
      var ca = d.createElement('button'); ca.type = 'button'; ca.textContent = q.cancel || '취소';
      ca.onclick = function () { done(q.kind === 'confirm' ? false : null); }; act.appendChild(ca);
    }
    act.appendChild(ok); box.appendChild(act); back.appendChild(box); d.body.appendChild(back);
    function key(e) {
      if (e.key === 'Escape') { e.stopPropagation(); (q.kind === 'alert' ? ok : act.firstChild).click(); }
      else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'BUTTON' && e.target !== ok)) { e.preventDefault(); ok.click(); }
    }
    d.addEventListener('keydown', key, true);
    (inp || ok).focus(); if (inp) inp.select();
  }
  function push(kind, msg, def, o) {
    return new Promise(function (res) {
      o = o || {}; queue.push({ kind: kind, msg: msg == null ? '' : String(msg), def: def, ok: o.ok, cancel: o.cancel, res: res });
      if (d.body) next(); else d.addEventListener('DOMContentLoaded', next, { once: true });
    });
  }
  w.mpAlert = function (m, o) { return push('alert', m, null, o); };
  w.mpConfirm = function (m, o) { return push('confirm', m, null, o); };
  w.mpPrompt = function (m, def, o) { return push('prompt', m, def, o); };
  w.alert = function (m) { w.mpAlert(m); };
})(window, document);
