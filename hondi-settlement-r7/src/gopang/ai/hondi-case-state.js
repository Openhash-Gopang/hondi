/**
 * hondi-case-state.js — 매각 사건 상태기계: 바닥가 불변식과 미매각 종결 (2026-09-28 신설)
 *
 * 결정(주피터님, 2026-09-28): 허용한 최심 시점까지 매각되지 않으면 하향을 멈추고 미매각으로 종결한다.
 * 이 파일이 그 규칙을 코드로 강제한다 — 사건은 절대 바닥가 아래로 팔리지 않고, 마지막 창이 유찰되면
 * 반드시 종결된다(그 뒤로는 어떤 입찰도 받지 않는다).
 *
 * 왜 이것이 손실 방어책인가: 선지급률 상한(hondi-sale-ladder.js ladderAdvanceCapBps)은 "바닥가에 팔려도
 * 원금+자본비용+판매비용이 회수된다"는 계산 위에 서 있다. 그 계산은 이 상태기계가 바닥가 아래 매각을
 * 불가능하게 만들 때만 성립한다. 즉 둘은 한 쌍이다 — 상한은 계산이고, 이 파일은 그 계산의 전제를 지킨다.
 *
 * 상태: open → sold | terminated_unsold (둘 다 종착 상태, 이후 전이 없음)
 * 창(회차) 규칙: 창 r은 [ (r−1)·step, r·step ) 시간 동안 열리고 최저가가 고정된다. max_hours는 "마지막으로
 * 허용하는 창이 시작되는 시각"이며, 그 창이 끝나도 유효 입찰이 없으면 종결한다(수명 = terminal_round × step).
 */
import { PRESETS, minPriceAtRound, roundAt, requiredDeposit } from './hondi-sale-ladder.js';

function posInt(name, v, min = 0) {
  if (!Number.isSafeInteger(v) || v < min) throw new RangeError(`${name}: ${min} 이상의 정수여야 합니다 (받은 값: ${v})`);
  return v;
}

export function openCase({ case_id, start_price, max_hours, preset = PRESETS.hondi_daily }) {
  if (typeof case_id !== 'string' || !case_id) throw new RangeError('case_id: 비어 있지 않은 문자열이어야 합니다');
  posInt('start_price', start_price, 1); posInt('max_hours', max_hours, 0);
  const terminal_round = roundAt(max_hours, preset.step_hours);
  const floor_price = minPriceAtRound(start_price, terminal_round, preset);
  if (floor_price < 1) throw new RangeError('바닥가가 0원 이하가 됩니다 — max_hours를 줄이거나 하락률을 낮추세요');
  return Object.freeze({
    case_id, status: 'open', round: 1, start_price, preset, terminal_round, floor_price,
    lifetime_hours: terminal_round * preset.step_hours,
  });
}

/** 현재 열려 있는 창(입찰이 받는 최저가·보증금·시간 범위). 종결된 사건에는 창이 없다. */
export function currentWindow(state) {
  if (state.status !== 'open') throw new Error(`종결된 사건(${state.status})에는 열린 창이 없습니다`);
  const min_price = minPriceAtRound(state.start_price, state.round, state.preset);
  const step = state.preset.step_hours;
  return { round: state.round, min_price, required_deposit: requiredDeposit(min_price), start_hour: (state.round - 1) * step, end_hour: state.round * step, is_terminal: state.round === state.terminal_round };
}

/** resolveRound의 결과를 적용해 다음 상태를 만든다(불변 객체). 잘못된 순서·가격은 예외. */
export function applyRound(state, result) {
  if (state.status !== 'open') throw new Error(`종결된 사건(${state.status})에는 회차를 적용할 수 없습니다`);
  const w = currentWindow(state);
  if (result.round !== state.round) throw new RangeError(`회차 순서 오류: 현재 ${state.round}회차인데 ${result.round}회차 결과가 왔습니다`);
  if (result.min_price !== w.min_price) throw new RangeError('회차 결과의 최저가가 사건의 사다리와 다릅니다');
  if (result.outcome === 'sold') {
    if (!Number.isSafeInteger(result.price) || result.price < w.min_price) throw new RangeError('낙찰가가 그 회차의 최저가보다 낮습니다');
    return Object.freeze({ ...state, status: 'sold', sold_round: state.round, sale_price: result.price, winner: result.winner });
  }
  if (result.outcome !== 'failed') throw new RangeError(`알 수 없는 결과: ${result.outcome}`);
  if (state.round >= state.terminal_round) return Object.freeze({ ...state, status: 'terminated_unsold', terminated_round: state.round });
  return Object.freeze({ ...state, round: state.round + 1 });
}

/** 불변식 검사: 매각가는 바닥가 이상, 종결은 마지막 회차에서만, 회차는 마지막 회차를 넘지 않는다. */
export function assertInvariants(state) {
  if (state.round < 1 || state.round > state.terminal_round) throw new Error('회차가 허용 범위를 벗어났습니다');
  if (state.status === 'sold' && state.sale_price < state.floor_price) throw new Error('바닥가 아래로 매각되었습니다 — 불변식 위반');
  if (state.status === 'terminated_unsold' && state.terminated_round !== state.terminal_round) throw new Error('마지막 회차 전에 종결되었습니다');
  return true;
}
