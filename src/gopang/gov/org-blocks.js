// 혼디 AI 웹사이트 — 화면 블록 (2026-10-09 신설)
// AI 답변의 [[BLOCK:…]] 태그가 열어 주는 작은 UI. 모든 텍스트는 textContent로만 넣는다(XSS 방지).
// 제출은 사람이 "승인"해야만 되고, 시연 설정(config.demoNotice)이면 실제로 어디에도 전송되지 않는다.
//
// renderBlock(block, config, ctx) → HTMLElement
//   ctx.onAsk(text)        : 블록 안 버튼이 AI에게 보낼 말(예: "이 사업 신청서 초안을 만들어줘")
//   ctx.onSubmit(payload)  : 승인된 제출 — 시연이면 호출하지 않고 시연 접수번호만 보여 준다. Promise<{ok, receipt?}> 반환 가능.
const CSS = `
.hb{border:1px solid #cfe0f4;background:#f7fbff;border-radius:14px;padding:12px;margin:8px 0;font-size:14px;color:#14213a}
.hb h4{margin:0 0 8px;font-size:14px}
.hb .card{background:#fff;border:1px solid #dbe7f5;border-radius:10px;padding:10px;margin:6px 0}
.hb .card b{display:block;margin-bottom:2px}
.hb .meta{font-size:12px;color:#51607a;line-height:1.5}
.hb label{display:block;font-size:12px;color:#51607a;margin:8px 0 2px}
.hb input,.hb textarea,.hb select{width:100%;box-sizing:border-box;border:1px solid #c5d5ea;border-radius:8px;padding:8px;font:inherit;background:#fff;color:inherit}
.hb textarea{min-height:64px;resize:vertical}
.hb button{margin-top:8px;margin-right:6px;border:0;border-radius:8px;padding:8px 12px;font:inherit;font-weight:600;background:#1f5fbf;color:#fff;cursor:pointer}
.hb button.sub{background:#e6eefa;color:#1f5fbf}
.hb .tag{display:inline-block;font-size:11px;background:#fff3cd;color:#7a5b00;border-radius:6px;padding:1px 6px;margin-left:6px}
.hb .ok{color:#17663a;font-weight:700}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); cssDone = true;
}
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'onclick') e.onclick = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  for (const c of kids) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
const demoTag = on => (on ? el('span', { class: 'tag', text: '가상 예시' }) : null);
const field = (label, node) => el('div', {}, el('label', { text: label }), node);

function confirmView(title, rows, config, ctx) {
  const demo = !!config.demoNotice;
  const box = el('div', { class: 'hb' }, el('h4', { text: title }));
  for (const [k, v] of rows) box.appendChild(el('div', { class: 'meta', text: `${k}: ${v || '(비어 있음)'}` }));
  if (demo) box.appendChild(el('div', { class: 'meta', text: `※ ${config.demoNotice} — 승인해도 실제로 접수되지 않습니다.` }));
  const out = el('div');
  const ok = el('button', { text: '승인하고 접수', onclick: async () => {
    ok.disabled = true;
    let res = { ok: true };
    if (!demo && ctx.onSubmit) { try { res = await ctx.onSubmit({ title, rows: Object.fromEntries(rows) }); } catch { res = { ok: false }; } }
    out.textContent = '';
    if (res.ok) out.appendChild(el('div', { class: 'ok', text: (demo ? '시연 접수번호 ' : '접수번호 ') + (res.receipt || 'DEMO-' + Math.random().toString(36).slice(2, 8).toUpperCase()) }));
    else { out.appendChild(el('div', { class: 'meta', text: '접수하지 못했습니다. 잠시 후 다시 시도해 주세요.' })); ok.disabled = false; }
  } });
  box.append(ok, el('button', { class: 'sub', text: '취소', onclick: () => box.remove() }), out);
  return box;
}

const R = {
  programs(args, config, ctx) {
    const ids = (args.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    const list = (ids.length ? ids.map(i => config.programs.find(p => p.id === i)).filter(Boolean) : config.programs).slice(0, 3);
    const box = el('div', { class: 'hb' }, el('h4', { text: '맞는 지원사업 후보' }));
    if (!list.length) box.appendChild(el('div', { class: 'meta', text: '조건에 맞는 사업을 찾지 못했습니다.' }));
    for (const p of list) {
      const c = el('div', { class: 'card' }, el('b', { text: p.title }, demoTag(p.demo)),
        el('div', { class: 'meta', text: `접수 ${p.period || '미정'} · 대상 ${p.target || '-'} · 지원 ${p.support || '-'}` }),
        p.summary ? el('div', { class: 'meta', text: p.summary }) : null);
      if (config.blocks.includes('apply-draft')) c.appendChild(el('button', { text: '신청서 초안 만들기', onclick: () => ctx.onAsk && ctx.onAsk(`"${p.title}" 신청서 초안을 만들어 주세요.`) }));
      if (p.url) { const a = el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: '공고 원문' }); a.style.cssText = 'margin-left:6px;font-size:12px'; c.appendChild(a); }
      box.appendChild(c);
    }
    return box;
  },
  'apply-draft'(args, config, ctx) {
    const p = config.programs.find(x => x.id === args.program);
    const box = el('div', { class: 'hb' }, el('h4', { text: `신청서 초안${p ? ' — ' + p.title : ''}` }));
    const company = el('input', { value: args.company || '' });
    const summary = el('textarea', { text: args.summary || '' }); summary.value = args.summary || '';
    const amount = el('input', { placeholder: '예: 신청 금액·내용' });
    box.append(field('기업명', company), field('사업 개요', summary), field('희망 지원 내용', amount),
      el('div', { class: 'meta', text: '초안입니다. 내용을 고친 뒤 확인 화면으로 넘어가세요.' }),
      el('button', { text: '확인 화면으로', onclick: () => {
        box.replaceWith(confirmView('신청서 접수 확인', [['지원사업', p ? p.title : args.program], ['기업명', company.value], ['사업 개요', summary.value], ['희망 지원', amount.value]], config, ctx));
      } }));
    return box;
  },
  'facility-booking'(args, config, ctx) {
    const box = el('div', { class: 'hb' }, el('h4', { text: '장비·시설 예약 요청' }));
    const sel = el('select');
    for (const f of config.facilities) { const o = el('option', { value: f.id, text: f.name }); if (f.id === args.facility) o.selected = true; sel.appendChild(o); }
    const when = el('input', { type: 'datetime-local' });
    const purpose = el('textarea'); purpose.value = args.purpose || '';
    box.append(field('장비·시설', sel), field('희망 일시', when), field('사용 목적', purpose),
      el('button', { text: '확인 화면으로', onclick: () => {
        const f = config.facilities.find(x => x.id === sel.value);
        box.replaceWith(confirmView('예약 요청 확인', [['장비·시설', f ? f.name : sel.value], ['위치', f && f.location], ['희망 일시', when.value], ['사용 목적', purpose.value]], config, ctx));
      } }));
    return box;
  },
  inquiry(args, config, ctx) {
    const box = el('div', { class: 'hb' }, el('h4', { text: '담당자에게 문의 전달' }));
    const sel = el('select');
    for (const t of config.contacts) { const o = el('option', { value: t.id, text: `${t.dept} ${t.role}`.trim() }); if (t.id === args.dept) o.selected = true; sel.appendChild(o); }
    const subject = el('input', { value: args.subject || '' });
    const body = el('textarea'); body.value = args.body || '';
    box.append(field('받는 부서', sel), field('제목', subject), field('내용', body),
      el('button', { text: '확인 화면으로', onclick: () => {
        const t = config.contacts.find(x => x.id === sel.value);
        box.replaceWith(confirmView('문의 전달 확인', [['받는 부서', t ? t.dept : sel.value], ['제목', subject.value], ['내용', body.value]], config, ctx));
      } }));
    return box;
  },
};

export function renderBlock(block, config, ctx = {}) {
  ensureCss();
  const fn = R[block.type];
  if (!fn || !config.blocks.includes(block.type)) return null;
  return fn(block.args || {}, config, ctx);
}
