// 3단계 가치평가 실행 예시 — 웹 검색으로 얻은 증거(가상 데이터)가 국가 → 지역 → 개별 단계를 거쳐 두 트랙 산출물이 되는 과정
// ★ 아래 물건·수치·URL은 전부 설명용 가상 데이터다(실제 물건·지수가 아니다). 실행: node example-staged.mjs
import { buildTracksFromStaged } from '../../src/gopang/ai/hondi-staged-valuation.js';

const ev = (name, url, basis) => ({ source_name: name, source_url: url, retrieved_at: '2026-09-28', basis_date: basis });
const staged = {
  as_of: '2026-09-28',
  base: { evidence: ev('국토교통부 실거래가 공개시스템(가상)', 'https://example.go.kr/rt', '2026-09-20'),
          comps: [{ price: 96_000_000, date: '2026-07-10' }, { price: 100_000_000, date: '2026-07-20' }, { price: 104_000_000, date: '2026-08-05' }] },
  liquidity: { ...ev('국토교통부 실거래가 공개시스템(가상)', 'https://example.go.kr/rt', '2026-09-20'), txn_12m: 18, counted_from_listing: true },
  national: { index: { ...ev('한국부동산원 R-ONE(가상)', 'https://example.or.kr/r-one', '2026-08-31'), region_label: '가상시 단독주택 매매가격지수', value_at_comps: 100, value_now: 97.5 }, regime: 'falling' },
  regional: {
    population: { ...ev('행정안전부 주민등록 인구통계(가상)', 'https://example.go.kr/jumin', '2026-08-31'), yoy_change: -0.021, depopulation_designated: false },
    redevelopment: { ...ev('가상시 정비구역 고시(가상)', 'https://example.go.kr/notice', '2026-06-30'), status: 'designated' },
    infrastructure: [{ ...ev('가상 교육청 공고(가상)', 'https://example.go.kr/edu', '2026-07-15'), type: 'school', change: 'planned_closing' }],
  },
  individual: { rights: { origin: 'registry_document', viewed_at: '2026-09-25',
    mortgages: [{ max_claim: 50_000_000, is_third_party: true }], tenant_deposits_assumed: 0, other_assumed_burden: 0, seizure_count: 0 } },
};

const t = buildTracksFromStaged(staged, { annual_rate_bps: 800, ladder: { max_round: 61, round_interval_days: 1, reduction_ppm: 5_570 } });
const won = n => n.toLocaleString('ko-KR') + '원', pct = x => (x * 100).toFixed(2) + '%';
const { national: n, regional: r, individual: i } = t.staged.stages;
console.log('══ 3단계 가치평가 (가상 예시) ══');
console.log(`IDENTIFY  비교사례 ${t.staged.comps.n}건, 중앙값 ${won(t.staged.comps.median)}, 변동계수 ${pct(t.staged.comps.cv)}, 평균 경과 ${t.staged.comps.months_stale.toFixed(1)}개월, 최근 12개월 거래 ${t.staged.txn_12m}건`);
console.log(`NATIONAL  시점수정 ${n.time_adjust_factor.toFixed(4)} (${n.status}, 국면 ${n.regime}) — σ 가산 ${n.sigma_extra}, 연변동성 ${pct(n.annual_vol)}(${n.annual_vol_source})`);
console.log(`REGIONAL  지역요인 ${r.regional_factor.toFixed(4)} (정성 위험은 계수를 만들지 않음) — σ_지역 ${r.sigma_regional.toFixed(4)}: ${r.components.map(c => c.item).join(', ')}`);
console.log(`INDIVIDUAL 인수 부담 ${won(i.assumed_burden)} · 제3자 근저당(대출 담보 차감) ${won(i.third_party_liens)} — σ_개별 ${i.sigma_individual.toFixed(4)}, 거부 조건 ${JSON.stringify(i.veto_flags)}`);
console.log(`\n중앙 추정(부담 차감 전) ${won(t.staged.central_before_burden)} → 공정가치 ${won(t.staged.fair_value)}   총 σ ${t.staged.sigma.toFixed(4)}  (자료 상태 ${t.staged.data_quality})`);
console.log(`\n[중재 트랙]  공정가치 ${won(t.mediation.fair_value)}  80% 구간 ${won(t.mediation.low_p10)} ~ ${won(t.mediation.high_p90)}`);
console.log(`[대출 트랙]  담보가치 ${won(t.lending.collateral_value)} → 제3자 권리 차감 후 순가치 ${won(t.lending.collateral_net)} → 선지급 ${won(t.lending.advance)} (${t.lending.advance_bps / 100}%, 제약: ${t.lending.binding})`);
console.log(`            거래 확신도 ${t.lending.confidence.score10}/10 (제약 요인 ${t.lending.confidence.limiting}) — ${t.lending.gate.passed ? '차단 통과' : '선지급 차단'}`);
console.log('\n사유:'); for (const x of t.lending.reasons) console.log('  - ' + x);
if (t.staged.flags.length) console.log('\n플래그:', t.staged.flags.join(', '));
