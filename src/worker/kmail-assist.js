// src/worker/kmail-assist.js — 나비 메인 화면(naviweb.kr / mail.hondi.net)의 SP 라우팅 순수 함수.
//
// 기본 SP는 "혼디 나만의 AI 비서"(AC-PRO-CORE)다. AC가 내는 [GWP: id] / [EXPERT: personaId] 태그를 읽어
// 화면이 어디로 보낼지(K-Mail · 전문가 · 서류 작성 · 그대로 답변)를 정한다. 네트워크 없음 — 단위 시험 가능.

// 전문가 id → 서류 작성 사이트(law/tax/doctor). 해당 없으면 '' (전문가 대화만 연다).
const SITE_RULES = [
  ['law', /lawyer|attorney|scrivener|judicial|patent|notary|labor-|labour|법|변호|변리|법무|노무/i],
  ['tax', /accountant|tax|appraiser|세무|회계|감정/i],
  ['doctor', /physician|doctor|hospital|clinic|dentist|oriental|nurse|pharmac|medical|의사|병원|의원|한의|치과|약사/i],
];
export function siteForPersona(id) {
  const s = String(id || '');
  for (const [site, re] of SITE_RULES) if (re.test(s)) return site;
  return '';
}

// GWP id → 전문가 대화로 연결할 페르소나(서류 작성까지 이어지는 직역)
const GWP_TO_EXPERT = {
  klaw: { persona: 'lawyer', label: '변호사', site: 'law' },
  ktax: { persona: 'tax-accounting', label: '세무사', site: 'tax' },
  khealth: { persona: 'physician', label: '의사', site: 'doctor' },
  kdoctor: { persona: 'physician', label: '의사', site: 'doctor' },
};

// 서류 작성 서비스 GWP id → 서류 작성 사이트(2026-10-31). AC-PRO-CORE 본문은 이 id 들을 모르므로 _ASSIST_NOTE(assistNote)가 알려 준다.
// navidoc 은 분야를 정하지 않은 일반 서류(pro.hondi.net) — 레지스트리 미등록 id 이므로 이 화면에서만 쓴다.
const GWP_TO_DOC = { navilaw: 'law', navipatent: 'law', navischool: 'all', navidoctor: 'doctor', navidoc: 'all' };

const TAG_RE = /\[\s*(GWP|EXPERT|CALL_[A-Z_]+)\s*:\s*([^\]]*)\]/g;
const ASK_RE = /\[\s*ASK\s*\]/i;

// AC 응답에서 라우팅 태그를 찾아 첫 번째 것을 경로로 바꾼다. 없으면 { type:'assistant' }.
// [ASK] 는 "되묻는 중" 표시 — 클라이언트가 질의 횟수를 세는 데만 쓴다(asking:true).
export function routeFromReply(text) {
  const s = String(text || '');
  const asking = ASK_RE.test(s);
  let m; TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(s))) {
    const kind = m[1].toUpperCase(); const arg = m[2].trim();
    const id = arg.split(/[,\s]/)[0].trim().toLowerCase();
    if (kind === 'GWP') {
      if (id === 'kmail' || id === 'kaddress') return { type: 'kmail', id, label: 'K-Mail' };
      if (GWP_TO_EXPERT[id]) return { type: 'expert', id, ...GWP_TO_EXPERT[id] };
      if (GWP_TO_DOC[id]) return { type: 'doc', id, site: GWP_TO_DOC[id], label: '서류 작성' };
      return { type: 'assistant', id, service: id };          // 다른 K-서비스: 화면에서는 AC 답변으로 안내
    }
    if (kind === 'EXPERT') return { type: 'expert', id, persona: id, label: id, site: siteForPersona(id) };
    // CALL_* 은 시스템 전환형 — 이 화면에서는 AC가 직접 답한 본문만 쓴다
  }
  return asking ? { type: 'assistant', asking: true } : { type: 'assistant' };
}

export function stripTags(text) {
  return String(text || '').replace(TAG_RE, '').replace(/\[\s*ASK\s*\]/gi, '').replace(/\[\s*(NEXT_STEP|INTERNAL)\s*:[^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ── 질의 정책 ─────────────────────────────────────────────
// 모호할 때만 묻고, 한 요청에서 최대 MAX_ASKS(=2)회. 2회가 지나면 묻지 않고 기본값으로 진행한다
// (메일 → 편지, 경로 불명 → AI 비서가 그대로 답변). asked 는 클라이언트가 세어 보내며 서버가 상한을 강제한다.
export const MAX_ASKS = 2;
const STAY = { label: '그냥 대화로 계속', route: { type: 'assistant', stay: true } };

// LLM 호출 전의 빠른 규칙(명확한 발화만). 모르면 null → AC가 판단한다.
const MAIL_RE = /(메일|이메일|e-?mail|편지|캠페인|주소록|수신자|받은\s*편지함|보낸\s*편지함)/i;
const MAIL_ACT_RE = /(보내|보낼|발송|쓰|써|작성|확인|읽|조회|찾|정리|답장|회신|등록|추가)/;
const SEND_TO_RE = /(누구|[가-힣A-Za-z0-9._-]+)\s*(에게|한테|께)\s*.{0,30}(보내|전달|전해|연락)/;
const SYMPTOM_RE = /(아파|아프|아픕|통증|쑤시|결리|저리|열이\s*나|열나|기침|가래|콧물|두통|어지러|메스꺼|구토|설사|복통|발진|가려|붓|피가\s*나|숨이\s*차|허리|무릎|어깨\s*(가|를)?\s*(아|뻐))/;
const DOC_NOUN_RE = /(신청서|답변서|소장|고소장|고발장|진정서|탄원서|내용증명|계약서|진술서|청구서|신고서|합의서|위임장|확약서|이의신청서|소명서|진단서|소견서|의뢰서|서류|서식)/;
const DOC_ACT_RE = /(작성|써\s*줘|써줘|만들어|초안|작성해)/;

// 메일 모드 판별 — 'letter'(한 분께 편지) | 'campaign'(여러 명·캠페인·조회 등 K-Mail 일반 대화) | null(작성 의도인데 단/복수 불명)
const MAIL_COMPOSE_RE = /(보내|보낼|발송|쓰|써|작성|전해|전달|연락)/;
const MAIL_CAMPAIGN_RE = /(캠페인|정보\s*공개|공개\s*청구|뉴스레터|구독자|대량)/;
const MAIL_GROUP_RE = /(들께|들에게|들한테|모두|모든|전체|전원|일괄|단체|여러\s*(분|명|곳)|\d+\s*(명|곳)|주소록|그룹|동시에)/;
const MAIL_SINGLE_RE = /(에게|께|한테|편지)/;
export function mailMode(text) {
  const s = String(text || '');
  if (MAIL_CAMPAIGN_RE.test(s)) return 'campaign';
  if (!(MAIL_COMPOSE_RE.test(s) || SEND_TO_RE.test(s))) return 'campaign';   // 확인·조회·주소록 등은 K-Mail 일반 대화
  if (MAIL_GROUP_RE.test(s)) return 'campaign';
  if (MAIL_SINGLE_RE.test(s)) return 'letter';
  return null;
}
function docSite(s) {
  return /세금|세무|부가세|양도|상속|증여|회계|소득/.test(s) ? 'tax' : /진단서|소견서|병원|의원|환자/.test(s) ? 'doctor' : /소장|고소|고발|진정|탄원|내용증명|계약|답변서|등기|법원|합의/.test(s) ? 'law' : 'all';
}
const kmailRoute = (mode) => ({ type: 'kmail', id: 'kmail', label: 'K-Mail', mode });

export function quickRoute(text, opts = {}) {
  const s = String(text || '').trim();
  const asked = Number(opts.asked) || 0;
  if (!s) return null;
  const isDoc = DOC_NOUN_RE.test(s) && DOC_ACT_RE.test(s);
  if (isDoc && !MAIL_RE.test(s)) {
    // "○○님께 보낼 계약서 써줘" — 서류 작성인지 편지인지 모호
    if (/(에게|께|한테)/.test(s) && /(보내|보낼|전달)/.test(s)) {
      if (asked >= MAX_ASKS) return null;
      return { type: 'ask', kind: 'route', question: '서류를 작성할까요, 아니면 편지로 보낼까요?',
        options: [{ label: '서류 작성', route: { type: 'doc', site: docSite(s), label: '서류 작성' } }, { label: '편지로 보내기', route: kmailRoute('letter') }, STAY] };
    }
    return { type: 'doc', site: docSite(s), label: '서류 작성' };
  }
  if ((MAIL_RE.test(s) && MAIL_ACT_RE.test(s)) || SEND_TO_RE.test(s)) {
    const mode = mailMode(s);
    if (mode) return kmailRoute(mode);
    if (asked >= MAX_ASKS) return { ...kmailRoute('letter'), defaulted: true };
    return { type: 'ask', kind: 'mail-kind', question: '어떤 메일인가요?',
      options: [{ label: '한 분께 편지', route: kmailRoute('letter') }, { label: '여러 명에게 캠페인', route: kmailRoute('campaign') }, STAY] };
  }
  if (SYMPTOM_RE.test(s)) return { type: 'expert', id: 'khealth', persona: 'physician', label: '의사', site: 'doctor' };
  return null;
}

// AC 가 낸 경로를 마무리 — 메일이면 편지/캠페인을 정하고, 모호하면 (상한 안에서) 묻는다.
export function finalizeRoute(route, userText, opts = {}) {
  const asked = Number(opts.asked) || 0;
  let r = route || { type: 'assistant' };
  if (r.type === 'assistant' && r.asking && asked >= MAX_ASKS) { const { asking, ...rest } = r; r = rest; }   // 상한 초과 — 되묻기 표시 무시
  if (r.type === 'kmail' && !r.mode) {
    const mode = mailMode(userText);
    if (mode) return { ...r, mode };
    if (asked >= MAX_ASKS) return { ...r, mode: 'letter', defaulted: true };
    return { type: 'ask', kind: 'mail-kind', question: '어떤 메일인가요?',
      options: [{ label: '한 분께 편지', route: kmailRoute('letter') }, { label: '여러 명에게 캠페인', route: kmailRoute('campaign') }, STAY] };
  }
  return r;
}

// AC 에 덧붙이는 런타임 안내문(나비웹 /kmail/assist 전용 — 메인 앱·AC-PRO-CORE 본문에는 영향 없음)
export function assistNote(asked = 0) {
  const base = '[나비 메인 화면] 사용자는 naviweb.kr 의 첫 화면 입력창에 쓰고 있습니다. '
    + '메일 보내기·확인·주소록·캠페인은 [GWP: kmail]. '
    + '특정 서류(신청서·소장·계약서·진단서 등)의 작성을 요청하면 분야에 맞는 서류 작성 서비스로 연결하세요 — 법률·등기·소송·계약 [GWP: navilaw], 특허·상표 [GWP: navipatent], 학교·교육 [GWP: navischool], 병원·의료 [GWP: navidoctor], 분야를 정하기 어렵거나 세무·회계 서류 [GWP: navidoc]. '
    + '서류 작성이 아니라 상담·질문이면 기존대로 [EXPERT: personaId] 또는 [GWP: id] 로 연결하세요. '
    + '연결할 때는 한 문장 안내와 태그 하나만 내고, 그 밖의 일반 대화는 간결하게 직접 답하세요. ';
  const ask = (Number(asked) || 0) >= MAX_ASKS
    ? '이미 충분히 되물었습니다. 더 묻지 말고 가장 가능성 높은 경로로 연결하거나 직접 답하세요.'
    : '메일·서류·그냥 대화 중 무엇인지 정말 알 수 없을 때에만 짧은 확인 질문 한 문장을 쓰고 끝에 [ASK] 를 붙이세요(태그는 이것 하나만). 대화 맥락으로 판단되면 묻지 마세요.';
  return base + ask;
}
