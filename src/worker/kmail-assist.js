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

const TAG_RE = /\[\s*(GWP|EXPERT|CALL_[A-Z_]+)\s*:\s*([^\]]*)\]/g;

// AC 응답에서 라우팅 태그를 찾아 첫 번째 것을 경로로 바꾼다. 없으면 { type:'assistant' }.
export function routeFromReply(text) {
  const s = String(text || '');
  let m; TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(s))) {
    const kind = m[1].toUpperCase(); const arg = m[2].trim();
    const id = arg.split(/[,\s]/)[0].trim().toLowerCase();
    if (kind === 'GWP') {
      if (id === 'kmail' || id === 'kaddress') return { type: 'kmail', id, label: 'K-Mail' };
      if (GWP_TO_EXPERT[id]) return { type: 'expert', id, ...GWP_TO_EXPERT[id] };
      return { type: 'assistant', id, service: id };          // 다른 K-서비스: 화면에서는 AC 답변으로 안내
    }
    if (kind === 'EXPERT') return { type: 'expert', id, persona: id, label: id, site: siteForPersona(id) };
    // CALL_* 은 시스템 전환형 — 이 화면에서는 AC가 직접 답한 본문만 쓴다
  }
  return { type: 'assistant' };
}

export function stripTags(text) {
  return String(text || '').replace(TAG_RE, '').replace(/\[\s*(NEXT_STEP|INTERNAL)\s*:[^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// LLM 호출 전의 빠른 규칙(명확한 발화만). 모르면 null → AC가 판단한다.
const MAIL_RE = /(메일|이메일|e-?mail|편지|캠페인|주소록|수신자|받은\s*편지함|보낸\s*편지함)/i;
const MAIL_ACT_RE = /(보내|보낼|발송|쓰|써|작성|확인|읽|조회|찾|정리|답장|회신|등록|추가)/;
const SEND_TO_RE = /(누구|[가-힣A-Za-z0-9._-]+)\s*(에게|한테|께)\s*.{0,30}(보내|전달|전해|연락)/;
const SYMPTOM_RE = /(아파|아프|아픕|통증|쑤시|결리|저리|열이\s*나|열나|기침|가래|콧물|두통|어지러|메스꺼|구토|설사|복통|발진|가려|붓|피가\s*나|숨이\s*차|허리|무릎|어깨\s*(가|를)?\s*(아|뻐))/;
const DOC_NOUN_RE = /(신청서|답변서|소장|고소장|고발장|진정서|탄원서|내용증명|계약서|진술서|청구서|신고서|합의서|위임장|확약서|이의신청서|소명서|진단서|소견서|의뢰서|서류|서식)/;
const DOC_ACT_RE = /(작성|써\s*줘|써줘|만들어|초안|작성해)/;
export function quickRoute(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (DOC_NOUN_RE.test(s) && DOC_ACT_RE.test(s) && !MAIL_RE.test(s)) {
    const site = /세금|세무|부가세|양도|상속|증여|회계|소득/.test(s) ? 'tax' : /진단서|소견서|병원|의원|환자/.test(s) ? 'doctor' : /소장|고소|고발|진정|탄원|내용증명|계약|답변서|등기|법원|합의/.test(s) ? 'law' : 'all';
    return { type: 'doc', site, label: '서류 작성' };
  }
  if ((MAIL_RE.test(s) && MAIL_ACT_RE.test(s)) || SEND_TO_RE.test(s)) return { type: 'kmail', id: 'kmail', label: 'K-Mail' };
  if (SYMPTOM_RE.test(s)) return { type: 'expert', id: 'khealth', persona: 'physician', label: '의사', site: 'doctor' };
  return null;
}
