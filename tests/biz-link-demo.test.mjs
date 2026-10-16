// assets/biz-link-demo.js 핵심 로직 검증 (2026-10-16) — 「사업자·세무사 연동 시연」의 장부·재무제표·세금 계산·자동납부 조건.
// 외부 의존성 없이 `node tests/biz-link-demo.test.mjs`로 실행한다. 화면(DOM) 흐름은 이 파일이 다루지 않는다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const m = { exports: {} };
// 브라우저용 IIFE 스크립트이므로 CommonJS module 객체를 주입해 core를 꺼낸다(package.json이 type:module이라 require 불가).
new Function('module', 'exports', readFileSync(join(here, '..', 'assets', 'biz-link-demo.js'), 'utf8'))(m, m.exports);
const c = m.exports;

const mk = (ids, status, over) => ids.map((id,i)=>{ const t=JSON.parse(JSON.stringify(c.SAMPLES.find(x=>x.id===id))); t.uid='e'+i; t.status=status; Object.assign(t, over&&over[id]||{}); return t; });
const all = ['s1','s2','s3','s4','s5','s6','s7'];

// 1) 잠정: 승인 대기 중 🔴(s6)는 미반영
let ev = mk(all,'pending');
let tb = c.trialBalance(ev,[],'provisional'); let st = c.statements(tb);
assert.strictEqual(st.pl['pl-revenue'],13000000);
assert.strictEqual(st.pl['pl-cogs'],5000000);
assert.strictEqual(st.pl['pl-opex'],1000000+330000+2500000);          // s6 제외
assert.strictEqual(st.pl['pl-net-income'],13000000-5000000-3830000);
assert.ok(st.balanced,'잠정 대차 불일치');
// 2) 확정 기준은 승인분만 — 승인 전에는 매출도 0
let tb0 = c.trialBalance(ev,[],'confirmed'); assert.strictEqual(c.statements(tb0).pl['pl-revenue'],0);
assert.strictEqual(tb0.cash,c.OPENING_CASH);
// 3) 전부 승인 → 확정
ev = mk(all,'approved'); tb = c.trialBalance(ev,[],'confirmed'); st = c.statements(tb);
assert.strictEqual(st.pl['pl-net-income'],4120000); assert.ok(st.balanced);
let tax = c.taxCalc(tb,ev,'confirmed',9);
assert.strictEqual(tax.vatOut,1300000); assert.strictEqual(tax.vatIn,600000); assert.strictEqual(tax.vatPayable,700000);
assert.strictEqual(tax.corp,Math.floor(4120000*0.09)); assert.strictEqual(tax.penalty,1000); assert.strictEqual(tax.penaltyBase,50000);
// 4) 접대비 매입세액 불공제: s5는 vat 0 → 대급금에 안 들어감
assert.ok(!c.buildEntries(ev.find(e=>e.id==='s5')).some(x=>x.a==='vatIn'));
// 5) 반려 건은 어디에도 없음
ev = mk(all,'approved',{s3:{status:'rejected'}}); tb=c.trialBalance(ev,[],'confirmed');
assert.strictEqual(c.taxCalc(tb,ev,'confirmed',9).vatIn,100000);
// 6) 납부 분개 후에도 대차 균형, 부가세 계정 0, 현금 감소
ev = mk(all,'approved'); tb = c.trialBalance(ev,[],'confirmed'); tax=c.taxCalc(tb,ev,'confirmed',9);
const j=[{label:'납부',entries:[{a:'vatOut',dr:tax.vatOut,cr:0},{a:'vatIn',dr:0,cr:tax.vatIn},{a:'cash',dr:0,cr:tax.vatPayable}]}];
const tb2=c.trialBalance(ev,j,'confirmed'); assert.strictEqual(tb2.vatOut,0); assert.strictEqual(tb2.vatIn,0);
assert.strictEqual(tb2.cash,tb.cash-700000); assert.ok(c.statements(tb2).balanced);
// 7) 자동납부 차단 사유
const base={gate:{ok:true},confirmed:true,filed:true,consent:true,consentLimit:700000};
assert.deepStrictEqual(c.payBlockers(base,{vatPayable:700000}),[]);
assert.ok(c.payBlockers({...base,gate:{ok:false}},{vatPayable:700000}).length===1);
assert.ok(c.payBlockers({...base,confirmed:false},{vatPayable:700000}).length>=1);
assert.ok(c.payBlockers({...base,filed:false},{vatPayable:700000}).some(m=>m.includes('전자신고')));
assert.ok(c.payBlockers({...base,consent:false},{vatPayable:700000}).some(m=>m.includes('동의')));
assert.ok(c.payBlockers(base,{vatPayable:800000}).some(m=>m.includes('한도')));
assert.ok(c.payBlockers(base,{vatPayable:0}).some(m=>m.includes('납부할')));
// 8) 세율 입력 경계
assert.strictEqual(c.taxCalc(tb,ev,'confirmed',999).rate,0.4); assert.strictEqual(c.taxCalc(tb,ev,'confirmed',-5).corp,0);
// 9) 회계사 모드: 세무대리업무 미등록 회계사는 신고·납부 불가(세무사법 제20조의2), 등록 시 통과
const cpa = { ...base, requireReg: true, reg: false };
assert.ok(c.payBlockers(cpa, { vatPayable: 700000 }).some(m => m.includes('세무대리업무에 등록')));
assert.deepStrictEqual(c.payBlockers({ ...cpa, reg: true }, { vatPayable: 700000 }), []);
// 세무사 모드(requireReg 없음)는 영향 없음
assert.deepStrictEqual(c.payBlockers(base, { vatPayable: 700000 }), []);
console.log('biz-link-demo core tests passed');
