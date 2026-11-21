// src/worker/deposit-name.js — 입금 알림 문구에서 입금자 이름을 찾고, 가입자 이름과 맞추는 순수 함수 (2026-11-21, 주피터 지시)
//
// 전화번호 뒤 8자리 매칭키를 폐기하고, 입금자 이름으로 가입자를 찾아 GDC를 자동 충전한다.
//   · 은행 문자 예: "[Web발신]\n2026/11/21 21:34\n입금 1,000원\n잔액 384,000원\n도영민\n315***02804011\n기업"
//   · 이름은 은행마다 위치가 달라서 문구에서 한글 낱말을 후보로 뽑고, 은행·거래 용어는 걸러 낸다.
//   · 후보가 가입자 이름과 공백·기호를 무시하고 같을 때만 쓴다. 같은 이름의 가입자가 둘 이상이면 자동 처리하지 않는다.
import { normName } from './plan-pay.js';

// 이름이 아닌 흔한 낱말(은행·거래 용어). 가입자 이름과 우연히 겹쳐 엉뚱한 사람을 충전하지 않도록 거른다.
const STOP = new Set(['입금', '출금', '이체', '송금', '잔액', '잔고', '거래', '승인', '결제', '취소', '발신', '수신', '안내', '알림', '통지',
  '계좌', '은행', '기업', '국민', '신한', '우리', '하나', '농협', '수협', '새마을', '신협', '우체국', '카카오', '카카오뱅크', '토스', '토스뱅크', '케이뱅크',
  '씨티', '제일', '부산', '대구', '경남', '광주', '전북', '제주', '산업', '기업은행', '국민은행', '신한은행', '우리은행', '하나은행', '농협은행',
  '체크', '카드', '일시불', '할부', '누적', '가능', '한도', '이자', '원금', '수수료', '급여', '월급', '자동이체', '전자금융', '모바일', '인터넷',
  '고객', '고객님', '님께', '감사', '합니다', '입니다', '되었습니다', '완료', '확인', '문의', '센터', '고객센터', '대표', '번호', '날짜', '시간', '오전', '오후',
  '입금액', '출금액', '입금확인', '보낸분', '받는분', '받은분', '보내는분', '받으신분', '기타', '타행', '당행', '펌뱅킹', '무통장', '현금', '지급', '정상', '처리']);

const isStop = (t) => STOP.has(t) || STOP.has(t.replace(/(은행|뱅크)$/, ''));

// 알림 문구(와 앱이 따로 보낸 입금자명)에서 이름 후보를 우선순위 순으로 돌려준다(최대 5개).
//   1) 앱이 보낸 입금자명  2) 한 줄이 한글 낱말뿐인 줄  3) 그 밖의 한글 낱말
//   · "홍 길동"처럼 공백으로 떨어진 이름은 이어 붙여 "홍길동"으로 만든다(은행·거래 용어가 사이에 끼면 끊는다).
//   · 이어 붙인 이름이 있으면 그 안의 짧은 낱말("길동")은 따로 후보로 쓰지 않는다 — 다른 사람 이름으로 오인하지 않도록.
export function depositorNameCandidates(text, hint = '') {
  const out = [], seen = new Set();
  const add = (raw) => { const n = normName(raw); if (n.length >= 2 && n.length <= 6 && !seen.has(n) && !isStop(n)) { seen.add(n); out.push(n); } };
  if (hint) add(hint);
  const s = String(text == null ? '' : text).replace(/[\d,.]+\s*원/g, ' | ');   // 금액("5,000원")의 "원"이 이름에 붙지 않게 끊는다
  const runs = [];                                   // { text, wholeLine }
  let cur = null;
  const flush = () => { if (cur) { runs.push(cur); cur = null; } };
  const words = [...s.matchAll(/[가-힣]+/g)];
  for (const m of words) {
    const w = m[0];
    if (w.length > 5 || isStop(w)) { flush(); continue; }
    const gap = cur ? s.slice(cur.end, m.index) : null;
    if (cur && /^[ \t]{1,2}$/.test(gap)) { cur.words.push(w); cur.end = m.index + w.length; }
    else { flush(); cur = { words: [w], start: m.index, end: m.index + w.length }; }
  }
  flush();
  const lineOf = (r) => { const ls = s.lastIndexOf('\n', r.start - 1) + 1; let le = s.indexOf('\n', r.end); if (le < 0) le = s.length; return s.slice(ls, le).trim() === s.slice(r.start, r.end).trim(); };
  const items = [];
  for (const r of runs) {
    const merged = r.words.join('');
    const list = (r.words.length > 1 && merged.length <= 6) ? [merged] : r.words;
    for (const t of list) items.push({ t, whole: lineOf(r) });
  }
  for (const it of items.filter(x => x.whole)) add(it.t);
  for (const it of items.filter(x => !x.whole)) add(it.t);
  return out.slice(0, 5);
}

// PocketBase 필터: 이름이 공백을 포함해 저장돼 있어도 후보로 걸리도록, 이름의 글자를 모두 포함하는 프로필을 넓게 찾는다.
// 결과는 pickGuidsByName으로 다시 걸러야 한다. 이름은 한글·영문·숫자만 허용한다(필터 문자열에 따옴표가 들어가지 않게).
export function nameFilter(n) {
  const chars = [...new Set(String(n).replace(/[^0-9A-Za-z가-힣]/g, '').split(''))].slice(0, 6);
  if (!chars.length) return null;
  const all = (f) => '(' + chars.map(c => `${f}~'${c}'`).join(' && ') + ')';
  return `${all('name')} || ${all('real_name')}`;
}

// 조회 결과에서 이름이 공백·기호를 무시하고 정확히 같은 가입자만 골라 guid 목록으로 돌려준다.
export function pickGuidsByName(profiles, n) {
  const want = normName(n), out = [];
  for (const p of profiles || []) {
    if (!p || !p.guid) continue;
    const names = [p.real_name, p.name, p.extra && p.extra.core && p.extra.core.name];
    if (names.some(x => x && normName(x) === want) && !out.includes(p.guid)) out.push(p.guid);
  }
  return out;
}
