import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeviceGeo, kakaoAddress, validKoreaCoord } from '../../src/worker/device-geo.js';

const kakaoOk = (r1, r2, r3, main = '', sub = '') => async (url, init) => {
  kakaoOk.calls.push({ url: String(url), auth: init?.headers?.Authorization });
  return new Response(JSON.stringify({ documents: [{ address: { region_1depth_name: r1, region_2depth_name: r2, region_3depth_name: r3, main_address_no: main, sub_address_no: sub } }] }), { status: 200 });
};
kakaoOk.calls = [];
const env = { KAKAO_REST_KEY: 'test-key' };
const req = (cf) => ({ cf });

test('좌표 검증: 국내 범위만 통과', () => {
  assert.ok(validKoreaCoord(33.4996, 126.5312));      // 제주
  assert.ok(validKoreaCoord(37.5665, 126.9780));      // 서울
  assert.ok(!validKoreaCoord(35.68, 139.69));         // 도쿄
  assert.ok(!validKoreaCoord(NaN, 127)); assert.ok(!validKoreaCoord('33', '126'));
});

test('GPS 좌표 → 카카오 주소(읍·면·동까지), 키는 KakaoAK 헤더, x=경도 y=위도', async () => {
  kakaoOk.calls.length = 0;
  const r = await resolveDeviceGeo(env, req({}), { geo: { lat: 33.4137, lng: 126.2650 } }, { fetchImpl: kakaoOk('제주특별자치도', '제주시', '한림읍', '1234', '5') });
  assert.deepEqual(r, { address: '제주특별자치도 제주시 한림읍', src: 'gps' });
  assert.equal(kakaoOk.calls[0].auth, 'KakaoAK test-key');
  assert.match(kakaoOk.calls[0].url, /x=126\.265&y=33\.4137/);
});

test('depth=4면 지번까지', async () => {
  const a = await kakaoAddress(env, 33.4137, 126.2650, { depth: 4, fetchImpl: kakaoOk('제주특별자치도', '제주시', '한림읍', '1234', '5') });
  assert.equal(a, '제주특별자치도 제주시 한림읍 1234-5');
});

test('좌표가 없으면 Cloudflare IP 좌표로 카카오 → src=ip', async () => {
  const r = await resolveDeviceGeo(env, req({ latitude: '33.4996', longitude: '126.5312', country: 'KR' }), {}, { fetchImpl: kakaoOk('제주특별자치도', '제주시', '이도이동') });
  assert.deepEqual(r, { address: '제주특별자치도 제주시 이도이동', src: 'ip' });
});

test('카카오 실패(HTTP 오류·타임아웃) → Cloudflare 지역명(한글)으로 대체', async () => {
  const fail = async () => new Response('x', { status: 401 });
  const r = await resolveDeviceGeo(env, req({ latitude: '33.4996', longitude: '126.5312', country: 'KR', region: 'Jeju', city: 'Jeju City' }), { geo: { lat: 33.5, lng: 126.5 } }, { fetchImpl: fail });
  assert.deepEqual(r, { address: '대한민국 제주특별자치도 제주시', src: 'ip' });
  const boom = async () => { throw new Error('timeout'); };
  assert.deepEqual((await resolveDeviceGeo(env, req({ country: 'KR', region: 'Seoul', city: 'Seoul' }), {}, { fetchImpl: boom })), { address: '대한민국 서울특별시 서울', src: 'ip' });
});

test('키가 없으면 카카오를 부르지 않고 지역명으로', async () => {
  kakaoOk.calls.length = 0;
  const r = await resolveDeviceGeo({}, req({ country: 'KR', region: 'Busan', city: 'Busan' }), { geo: { lat: 35.1, lng: 129.0 } }, { fetchImpl: kakaoOk('a', 'b', 'c') });
  assert.equal(kakaoOk.calls.length, 0); assert.equal(r.src, 'ip');
});

test('국외·엉터리 좌표는 무시하고 아무 정보도 없으면 null', async () => {
  kakaoOk.calls.length = 0;
  const r = await resolveDeviceGeo(env, req({}), { geo: { lat: 35.68, lng: 139.69 } }, { fetchImpl: kakaoOk('a', 'b', 'c') });
  assert.deepEqual(r, { address: null, src: null }); assert.equal(kakaoOk.calls.length, 0);
  assert.deepEqual(await resolveDeviceGeo(env, req({}), { geo: { lat: 'abc', lng: {} } }), { address: null, src: null });
  assert.deepEqual(await resolveDeviceGeo(env, undefined, undefined), { address: null, src: null });
});

test('결과에 좌표가 남지 않는다(주소 문자열과 출처만)', async () => {
  const r = await resolveDeviceGeo(env, req({}), { geo: { lat: 33.4137, lng: 126.2650 } }, { fetchImpl: kakaoOk('제주특별자치도', '제주시', '한림읍') });
  assert.deepEqual(Object.keys(r).sort(), ['address', 'src']);
  assert.ok(!JSON.stringify(r).includes('33.41'));
});
