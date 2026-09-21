// K-FOI — 「제주 AI 행정」 SP 요약본(다이제스트) 조회. 2026-09-21 신설.
//
// prompts/gov-tree/kfoi-digest/gov-digest.json(tools/build_kfoi_digest.mjs가 만든다)을 청구 비서의 KFOI_DIGEST 도구가
// 기관 유형별로 잘라서 읽게 해 준다. 한 번의 응답은 LLM 문맥을 지키기 위해 maxChars 이내로 자르고, 이어 보려면 offset을 쓴다.
//
// 이 요약은 우리 저장소의 SP에서 기계적으로 뽑은 것이라 "외부 데이터"가 아니라 참고 자료다. 그래도 요약에 섞인 KFOI_ 태그
// 문법은 무력화해서 넘긴다(호출 측에서 neutralizeTags).

const DEFAULT_MAX_CHARS = 5500;
const TIER_KEYS_HINT = 'do, jeju-si, seogwipo, agency, org, emd';

function textOf(e) {
  return [e.name, e.parent, e.handles, e.outputs, ...(e.does || []), ...(e.can || [])].join(' ').toLowerCase();
}

// SP 하나를 LLM에 보여 줄 짧은 형태로 줄인다(비어 있는 필드는 뺀다).
export function compactEntry(e, brief = false) {
  const o = { name: e.name };
  if (brief) {   // 국(기관) 단위 조직 대조용 — 이름·상태·현행 조직 대조 결과만
    o.state = e.state;
    if (e.org) { o.org = { status: e.org.status }; if (e.org.current_name) o.org.current_name = e.org.current_name; if (e.org.confidence) o.org.confidence = e.org.confidence; if (e.org.note) o.org.note = e.org.note.length > 80 ? e.org.note.slice(0, 79) + '…' : e.org.note; }
    if (e.handles) o.handles = e.handles.length > 60 ? e.handles.slice(0, 59) + '…' : e.handles;
    return o;
  }
  if (e.parent) o.parent = e.parent;
  o.state = e.state;
  if (e.handles) o.handles = e.handles;
  if (e.outputs) o.outputs = e.outputs;
  if (e.does && e.does.length) o.does = e.does.slice(0, 2).map(x => (x.length > 90 ? x.slice(0, 89) + '…' : x));
  if (e.cannot && e.cannot.length) o.cannot = e.cannot.slice(0, 3);
  if (e.unverified && e.unverified.length) o.unverified = e.unverified.slice(0, 2).map(x => (x.length > 90 ? x.slice(0, 89) + '…' : x));
  if (e.data_gaps && e.data_gaps.length) o.data_gaps = e.data_gaps.slice(0, 4);
  if (e.teams && e.teams.length) o.teams = e.teams;
  if (e.org) {
    o.org = { status: e.org.status };
    if (e.org.current_name) o.org.current_name = e.org.current_name;
    if (e.org.confidence) o.org.confidence = e.org.confidence;
    if (e.org.note) o.org.note = e.org.note.length > 90 ? e.org.note.slice(0, 89) + '…' : e.org.note;
  }
  return o;
}

// args: { tier, q, offset }
//   tier 없음/summary → 유형별 규모·상태 요약만
//   tier 있음        → 그 유형의 SP를 (q로 거른 뒤) offset부터 maxChars가 찰 때까지
export function digestQuery(digest, args = {}, maxChars = DEFAULT_MAX_CHARS) {
  const tiers = (digest && digest.tiers) || {};
  const key = String(args.tier || 'summary');

  if (key === 'summary') {
    return {
      tiers: Object.fromEntries(Object.entries(tiers).map(([k, t]) => [k, {
        label: t.label, stats: t.stats,
        ...(t.baseline ? { org_baseline: { as_of: t.baseline.as_of, org_counts: t.baseline.org_counts, missing_in_inventory: t.baseline.missing_in_inventory.map(m => m.name) } } : {}),
        ...(t.baseline_note ? { baseline_note: t.baseline_note } : {}),
      }])),
      how_to_read: 'state: draft=v1.0 초안(내용이 얇을 수 있음) · revised=갱신됨 · gapped=데이터 공백 표 있음 · template=템플릿 렌더링(개별 내용 없음). org_baseline(도청): 현행 조직(2026-08-25 개편)과 SP 목록을 대조한 결과 — org.status는 match·renamed·name_differs·not_in_official_menu·unverified. 이어서 {"tier":"do","kind":"bureau"} 처럼 유형을 조회하세요(kind: bureau·division·institution·emd — 국 단위만 볼 때는 bureau).',
    };
  }
  const tier = Object.prototype.hasOwnProperty.call(tiers, key) ? tiers[key] : null;
  if (!tier) return { error: 'UNKNOWN_TIER', message: `tier는 ${TIER_KEYS_HINT} 중 하나입니다.` };

  const q = String(args.q || '').trim().toLowerCase();
  const kind = String(args.kind || '').trim();
  let all = kind ? tier.entries.filter(e => e.kind === kind) : tier.entries;
  if (q) all = all.filter(e => textOf(e).includes(q));
  const start = Math.max(0, Number.parseInt(args.offset, 10) || 0);
  const brief = kind === 'bureau' || kind === 'institution';
  const out = [];
  let size = 0;
  for (let i = start; i < all.length; i++) {
    const c = compactEntry(all[i], brief);
    const len = JSON.stringify(c).length + 1;
    if (out.length && size + len > maxChars) break;
    out.push(c); size += len;
  }
  const next = start + out.length < all.length ? start + out.length : null;
  return {
    tier: key, label: tier.label, stats: tier.stats,
    ...(start === 0 && tier.baseline ? { baseline: tier.baseline } : {}),
    ...(start === 0 && tier.baseline_note ? { baseline_note: tier.baseline_note } : {}),
    matched: all.length, offset: start, returned: out.length, next_offset: next,
    entries: out,
  };
}
