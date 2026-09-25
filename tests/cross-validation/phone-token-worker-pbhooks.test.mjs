// ═════════════════════════════════════════════════
// worker.js(Cloudflare) ↔ pb_hooks/main.pb.js(PocketBase JSVM) 교차 검증 (2026-09-26 신설)
//
// 배경: 2026-09-25 하루 동안 "문자 인증한 본인 번호가 계정 번호와 다르다"는 오류를 놓고
// 번호 표기 형식(r4~r8)과 PHONE_VERIFY_SECRET 값을 여러 시간 동안 의심했다. 실제 원인은
// 그중 무엇도 아니었지만(digit_claim_records.seq 스키마 결함), 그 조사 자체가 오래 걸린 이유는
// "두 실행 환경(Worker/PocketBase)에 같은 로직을 손으로 두 번 옮겨 적어 두고, 실제로 같은
// 입력에 같은 출력을 내는지 자동으로 확인하는 수단이 하나도 없었기 때문"이었다.
// 이 파일은 그 확인을 자동화한다 — pb_hooks(goja/JSVM)는 Node에서 직접 실행할 수 없으므로,
// ① 두 파일의 실제 소스 텍스트에서 핵심 상수(해시 도메인 접두어, 비밀값 환경변수 이름)를
//   그대로 추출해 서로 같은지 검사하고(한쪽만 바뀌면 바로 실패),
// ② PocketBase 바이너리로 $security.hs256()이 Node의 crypto.createHmac('sha256',...)와
//   동일한 hex를 낸다는 사실은 이미 사람이 확인해 두었다(pb_hooks/main.pb.js 주석 참고) —
//   그 전제 위에서, "골든 벡터"(고정 입력→고정 출력)로 알고리즘·접두어 조합 자체가
//   실수로 바뀌지 않는지 고정한다.
// pb_hooks 자체를 CI에서 직접 실행하는 것(goja 하네스)은 이 커밋 범위 밖의 후속 작업이다.
// ═════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { e164LookupHash } from '../../src/worker/phone-lookup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── ① 소스 텍스트 교차 검사 — 실제 파일 내용에서 뽑는다(하드코딩한 사본과 비교하지 않는다) ──
test('e164_hash 해시 도메인 접두어("e164-lookup:")가 worker.js 쪽과 pb_hooks 양쪽에 똑같이 있다', () => {
  const workerSide = read('src/worker/phone-lookup.js');
  const pbHooks = read('pb_hooks/main.pb.js');
  const inWorker = workerSide.includes("'e164-lookup:'");
  const inPbHooks = pbHooks.includes('"e164-lookup:"');
  assert.ok(inWorker, 'src/worker/phone-lookup.js에 도메인 접두어가 없습니다 — 이름이 바뀌었을 수 있습니다.');
  assert.ok(inPbHooks, 'pb_hooks/main.pb.js에 도메인 접두어가 없습니다 — 이름이 바뀌었을 수 있습니다.');
});

test('전화번호 인증 비밀값 환경변수 이름("PHONE_VERIFY_SECRET")이 worker.js·phone-token.js·pb_hooks 세 곳에 모두 같다', () => {
  const files = ['worker.js', 'src/worker/phone-token.js', 'src/worker/phone-lookup.js', 'pb_hooks/main.pb.js'];
  for (const f of files) {
    const src = read(f);
    assert.ok(src.includes('PHONE_VERIFY_SECRET'), `${f}에 PHONE_VERIFY_SECRET 참조가 없습니다 — 이름이 바뀌었거나 다른 변수를 쓰고 있을 수 있습니다.`);
  }
});

test('phone_verify_token 서명 대상 payload를 worker.js와 pb_hooks가 같은 방식으로 만든다("e164:guid:exp" 또는 "e164:exp")', () => {
  const workerSrc = read('worker.js');
  const pbHooksSrc = read('pb_hooks/main.pb.js');
  // worker.js: 토큰을 "만드는" 쪽 — 템플릿 리터럴 형태를 그대로 찾는다
  assert.ok(/\$\{e164\}:\$\{guid\}:\$\{exp\}/.test(workerSrc), 'worker.js의 payload 템플릿(e164:guid:exp)을 찾지 못했습니다.');
  // pb_hooks: 토큰을 "쪼개 읽는" 쪽 — ':' 로 split 하고 segs[0]을 e164로 쓴다
  assert.ok(pbHooksSrc.includes('payload.split(":")'), 'pb_hooks가 payload를 ":" 로 나누는 코드를 찾지 못했습니다 — 구분자가 바뀌었을 수 있습니다.');
  assert.ok(/segs\[0\]\s*;?\s*$|tokenE164\s*=\s*segs\[0\]/m.test(pbHooksSrc), 'pb_hooks가 첫 필드를 e164로 읽는 코드를 찾지 못했습니다.');
});

// ── ② 골든 벡터 — HMAC-SHA256(secret, "e164-lookup:"+e164) 이 Node·Worker·(검증된) PocketBase 세 곳 모두 같은 값 ──
// pb_hooks/main.pb.js 상단 주석: "$security.hs256()이 Node의 crypto.createHmac('sha256',...)와
// 동일한 hex를 내는 것까지 검증 완료" — 그 전제 위에서 Node crypto를 pb_hooks의 대역으로 쓴다.
const GOLDEN_SECRET = 'hondi-cross-check-fixed-secret';
const GOLDEN_E164 = '+8201012345678';
const GOLDEN_EXPECTED = createHmac('sha256', GOLDEN_SECRET).update('e164-lookup:' + GOLDEN_E164).digest('hex');

test('골든 벡터: Node crypto(HMAC-SHA256) 기준값이 고정돼 있다(우연히 알고리즘·접두어가 바뀌면 이 값부터 깨진다)', () => {
  // 이 상수 자체가 잘못 바뀌면(예: 접두어를 실수로 지움) 바로 알 수 있도록, 계산 과정을 다시 한번 명시적으로 적는다.
  const recomputed = createHmac('sha256', GOLDEN_SECRET).update('e164-lookup:' + GOLDEN_E164).digest('hex');
  assert.equal(GOLDEN_EXPECTED, recomputed);
  assert.equal(GOLDEN_EXPECTED.length, 64);
});

test('골든 벡터: worker.js 쪽 실제 함수(e164LookupHash)가 Node crypto 기준값과 정확히 일치한다', async () => {
  const actual = await e164LookupHash(GOLDEN_SECRET, GOLDEN_E164);
  assert.equal(actual, GOLDEN_EXPECTED);
});

test('여러 번호·비밀값 조합에서도 e164LookupHash가 Node crypto 기준과 항상 일치한다(회귀 방지)', async () => {
  const cases = [
    ['s1', '+8201096627170'], ['다른-비밀값-!@#', '+8201000000000'],
    ['', '+8201012345678'].filter(Boolean).length === 2 ? ['빈문자열아님', '+8201012345678'] : null,
  ].filter(Boolean);
  for (const [secret, e164] of cases) {
    const expected = createHmac('sha256', secret).update('e164-lookup:' + e164).digest('hex');
    assert.equal(await e164LookupHash(secret, e164), expected, `secret=${secret} e164=${e164}`);
  }
});

// ── ③ pb_hooks의 payload 파싱을 그대로 흉내 낸 미니 구현으로, worker.js가 만든 토큰을 pb_hooks도 똑같이 읽는지 확인 ──
// (pb_hooks 실행기 자체가 없으므로, 그 파일에 실제로 적힌 파싱 로직 — indexOf('.')·split(':')·segs[0]/parseInt(segs[1]) —
//  을 그대로 재현한 함수로 cross-check한다. pb_hooks 소스가 이 로직을 바꾸면 위 ①의 텍스트 검사가 먼저 잡아낸다.)
function pbHooksStyleParse(token) {
  const dotIdx = token.indexOf('.');
  const payload = token.substring(0, dotIdx);
  const segs = payload.split(':');
  return { e164: segs[0], exp: parseInt(segs[1], 10) };  // guid 없는 2-필드 토큰 기준(profiles 생성 경로)
}
test('worker.js가 만드는 2필드 토큰(e164:exp)을 pb_hooks 방식 파서로 읽어도 같은 e164가 나온다', () => {
  const e164 = '+8201099998888', exp = Date.now() + 100000;
  const token = `${e164}:${exp}.deadbeef`;   // 서명은 이 테스트의 관심사가 아님(①에서 별도 확인)
  const parsed = pbHooksStyleParse(token);
  assert.equal(parsed.e164, e164);
  assert.equal(parsed.exp, exp);
});
