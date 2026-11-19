// 나비 AI 웹사이트·프로필의 방문자 언어 처리 (2026-11-19 신설)
//
// 방문자의 폰 언어(navigator.language)로 (1) 고정 인사말을 보여 주고 (2) AI가 그 언어로 답하게 한다.
// 인사말은 AI에게 번역시키지 않고 아래 고정 표에서만 읽는다(오역·사칭 방지 — 기관 설정은 URL이 아니라 표에서만 읽는다는 기존 규칙과 같다).
// 표에 없는 언어는 영어 인사말을 보여 주고, 답변은 AI가 방문자 언어로 한다.

/** 번역 대상으로 지원하는 언어(프로필 본문 번역·인사말 표 공통). 한국어는 원문이라 제외. */
export const SUPPORTED_VISITOR_LANGS = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'vi', 'th', 'id', 'ru', 'pt', 'ar', 'hi'];

export const LANG_NAMES = {
  ko: '한국어', en: 'English', zh: '简体中文', ja: '日本語', es: 'Español', fr: 'Français', de: 'Deutsch',
  vi: 'Tiếng Việt', th: 'ไทย', id: 'Bahasa Indonesia', ru: 'Русский', pt: 'Português', ar: 'العربية', hi: 'हिन्दी',
};

/** 'en-US' → 'en', 'zh-Hant-TW' → 'zh', 비어 있으면 'ko'(기본). */
export function normalizeLang(raw) {
  const t = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
  if (!t) return 'ko';
  const base = t.split('-')[0];
  return /^[a-z]{2,3}$/.test(base) ? base : 'ko';
}

const GREETING = {
  ko: '안녕하세요. {n} AI 비서입니다. 무엇을 도와드릴까요?',
  en: "Hello. I'm the AI assistant of {n}. How can I help you?",
  zh: '您好，我是{n}的AI助手。请问有什么可以帮您？',
  ja: 'こんにちは。{n}のAIアシスタントです。ご用件をお聞かせください。',
  es: 'Hola, soy el asistente de IA de {n}. ¿En qué puedo ayudarle?',
  fr: "Bonjour, je suis l'assistant IA de {n}. Comment puis-je vous aider ?",
  de: 'Guten Tag, ich bin der KI-Assistent von {n}. Wie kann ich Ihnen helfen?',
  vi: 'Xin chào, tôi là trợ lý AI của {n}. Tôi có thể giúp gì cho bạn?',
  th: 'สวัสดี ฉันคือผู้ช่วย AI ของ {n} มีอะไรให้ช่วยไหม',
  id: 'Halo, saya asisten AI {n}. Ada yang bisa saya bantu?',
  ru: 'Здравствуйте! Я ИИ-ассистент {n}. Чем могу помочь?',
  pt: 'Olá, sou o assistente de IA de {n}. Como posso ajudar?',
  ar: 'مرحباً، أنا مساعد الذكاء الاصطناعي لـ{n}. كيف يمكنني مساعدتك؟',
  hi: 'नमस्ते, मैं {n} का AI सहायक हूँ। मैं आपकी क्या सहायता कर सकता हूँ?',
};
const DEMO = {
  ko: '(시연용 — 공식 서비스가 아닙니다.)',
  en: '(Demo only — not the official service.)',
  zh: '（演示用，并非官方服务。）',
  ja: '（デモ用です。公式サービスではありません。）',
};

/** 방문자 언어의 고정 인사말. demo=true면 "시연용" 고지를 붙인다(고지는 표에 없는 언어면 영어). */
export function localizedGreeting(name, lang, { demo = false } = {}) {
  const l = GREETING[normalizeLang(lang)] ? normalizeLang(lang) : 'en';
  const n = String(name || '').trim() || 'AI';
  const g = GREETING[l].replace('{n}', n);
  return demo ? g + ' ' + (DEMO[l] || DEMO.en) : g;
}

/** AI 시스템 지시문에 덧붙일 문장. 한국어 폰이면 빈 문자열. */
export function languageInstruction(lang) {
  const l = normalizeLang(lang);
  if (l === 'ko') return '';
  const nm = LANG_NAMES[l] || l;
  return '\n\n[방문자 언어] 방문자 폰의 언어는 ' + nm + '(' + l + ')이다. 방문자가 다른 언어로 말하지 않는 한 반드시 그 언어로 답한다. ' +
    '가격·상품명·주소 같은 고유한 값은 한국어 원문과 숫자를 그대로 함께 적고, 번역이 불확실한 용어는 지어내지 않는다.';
}
