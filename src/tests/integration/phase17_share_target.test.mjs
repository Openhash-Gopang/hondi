/**
 * phase17_share_target.test.mjs
 *
 * "정부24 앱과 나비를 앱 대 앱으로 연동" 구현 검증. Web Share Target
 * API로 정부24가 공유한 문서를 받는 sw.js 로직(_parseShareTargetForm,
 * _handleShareTarget)과, 그걸 클라이언트에서 읽어오는 src/gopang/pdv/
 * share-inbox.js를 함께 검증한다.
 *
 * sw.js는 classic(비-모듈) service worker라 import를 못 쓴다 —
 * phase11/13와 동일한 "실제 소스에서 함수만 추출해 격리 실행" 방식을
 * 쓴다. Cache Storage API(caches)는 Node 전역에 없어서 최소 in-memory
 * mock을 만들어 주입한다.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  parseSharedIdFromQuery, getSharedDocument, clearSharedDocument,
  formatShareConfirmation, buildGov24LaunchInfo,
} from '../../gopang/pdv/share-inbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// ── 최소 in-memory Cache Storage mock ──────────────────────────
function makeMockCacheStore() {
  const stores = new Map(); // cacheName -> Map(url -> Response)
  return {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(url, response) { store.set(String(url), response); },
        async match(url) { return store.get(String(url)) || undefined; },
        async delete(url) { return store.delete(String(url)); },
      };
    },
    _stores: stores, // 테스트 검증용 직접 접근
  };
}

// sw.js에서 _parseShareTargetForm/_handleShareTarget을 추출해 실행
function loadSwShareTargetFns(mockCacheStore) {
  const raw = readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf-8').replace(/\r\n/g, '\n');

  const fnStart = raw.indexOf('function _parseShareTargetForm(formData) {');
  assert.ok(fnStart !== -1, '_parseShareTargetForm을 sw.js에서 찾지 못함');
  const handlerStart = raw.indexOf('async function _handleShareTarget(request) {', fnStart);
  assert.ok(handlerStart !== -1, '_handleShareTarget을 sw.js에서 찾지 못함');
  const handlerEnd = raw.indexOf('\n}\n', handlerStart) + '\n}\n'.length;

  const block = raw.slice(fnStart, handlerEnd);
  const body = `
    const caches = __caches__;
    ${block}
    return { _parseShareTargetForm, _handleShareTarget };
  `;
  // eslint-disable-next-line no-new-func
  const factory = new Function('__caches__', body);
  return factory(mockCacheStore);
}

describe('N-45: _parseShareTargetForm — FormData에서 파일/메타데이터 추출', () => {
  const { _parseShareTargetForm } = loadSwShareTargetFns(makeMockCacheStore());

  it('govdoc 파일이 있으면 file/title/text를 정확히 추출', () => {
    const fd = new FormData();
    const file = new File(['dummy pdf bytes'], '가족관계증명서.pdf', { type: 'application/pdf' });
    fd.set('govdoc', file);
    fd.set('title', '정부24 공유');
    fd.set('text', '가족관계증명서');

    const result = _parseShareTargetForm(fd);
    assert.equal(result.file.name, '가족관계증명서.pdf');
    assert.equal(result.title, '정부24 공유');
    assert.equal(result.text, '가족관계증명서');
  });

  it('govdoc 파일이 없으면 null(텍스트만 공유된 경우)', () => {
    const fd = new FormData();
    fd.set('title', '텍스트만');
    const result = _parseShareTargetForm(fd);
    assert.equal(result, null);
  });

  it('title/text가 없어도 빈 문자열로 안전 처리', () => {
    const fd = new FormData();
    fd.set('govdoc', new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
    const result = _parseShareTargetForm(fd);
    assert.equal(result.title, '');
    assert.equal(result.text, '');
  });
});

describe('N-46: _handleShareTarget — 전체 흐름(캐시 저장 + 리다이렉트)', () => {
  it('파일이 있으면 hondi-share-inbox 캐시에 저장하고 ?shared=id로 리다이렉트', async () => {
    const mockStore = makeMockCacheStore();
    const { _handleShareTarget } = loadSwShareTargetFns(mockStore);

    const fd = new FormData();
    fd.set('govdoc', new File(['pdf-content'], '등본.pdf', { type: 'application/pdf' }));
    fd.set('title', '등본');
    const request = new Request('https://hondi.net/share-receive.html', { method: 'POST', body: fd });

    const res = await _handleShareTarget(request);
    assert.equal(res.status, 303);
    const location = res.headers.get('Location');
    assert.match(location, /\/webapp\.html\?shared=share-/);

    const id = new URL(location).searchParams.get('shared');
    const store = mockStore._stores.get('hondi-share-inbox');
    assert.ok(store, 'hondi-share-inbox 캐시가 생성돼야 함');
    assert.ok(store.has(`/_share-inbox/${id}`), '해당 id로 저장돼야 함');
  });

  it('서버로는 절대 전송하지 않는다 — fetch()가 한 번도 호출 안 됨(구조 검사)', () => {
    const raw = readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf-8').replace(/\r\n/g, '\n');
    const fnStart = raw.indexOf('async function _handleShareTarget(request) {');
    const fnEnd = raw.indexOf('\n}\n', fnStart) + '\n}\n'.length;
    const body = raw.slice(fnStart, fnEnd);
    assert.ok(!/\bfetch\(/.test(body), '_handleShareTarget이 fetch()를 호출하면 원본이 서버로 나갈 위험 — PDV 원칙 위반');
  });

  it('파일 없이 텍스트만 공유되면 인박스에 저장 안 하고 그냥 webapp.html로 리다이렉트', async () => {
    const mockStore = makeMockCacheStore();
    const { _handleShareTarget } = loadSwShareTargetFns(mockStore);
    const fd = new FormData();
    fd.set('title', '텍스트만 공유됨');
    const request = new Request('https://hondi.net/share-receive.html', { method: 'POST', body: fd });
    const res = await _handleShareTarget(request);
    assert.equal(res.headers.get('Location'), 'https://hondi.net/webapp.html');
    assert.ok(!mockStore._stores.has('hondi-share-inbox'), '파일 없으면 캐시 자체를 열 필요 없음');
  });
});

describe('N-47: activate 핸들러가 hondi-share-inbox를 삭제 대상에서 제외하는지(정적 검사)', () => {
  it('KEEP_CACHES에 hondi-share-inbox가 포함돼야 함', () => {
    const raw = readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf-8').replace(/\r\n/g, '\n');
    const activateStart = raw.indexOf("addEventListener('activate'");
    assert.ok(activateStart !== -1);
    const activateBlock = raw.slice(activateStart, activateStart + 800);
    assert.match(activateBlock, /KEEP_CACHES/, 'SW 업데이트 시 캐시 정리 로직이 원래 CACHE_NAME 외 전부를 지우는 구조였음 — hondi-share-inbox도 같이 날아가면 안 됨');
    assert.match(activateBlock, /'hondi-share-inbox'/);
  });
});

describe('N-48: share-inbox.js — parseSharedIdFromQuery', () => {
  it('?shared=xxx 형태에서 id를 정확히 추출', () => {
    assert.equal(parseSharedIdFromQuery('?shared=share-123-abc'), 'share-123-abc');
  });
  it('shared 파라미터 없으면 null', () => {
    assert.equal(parseSharedIdFromQuery('?other=1'), null);
  });
  it('빈 문자열/undefined면 null', () => {
    assert.equal(parseSharedIdFromQuery(''), null);
    assert.equal(parseSharedIdFromQuery(undefined), null);
  });
});

describe('N-49: share-inbox.js — getSharedDocument/clearSharedDocument (mock 캐시 주입)', () => {
  it('저장된 문서를 정확히 읽어옴(blob, 메타데이터 전부)', async () => {
    const mockStore = makeMockCacheStore();
    const cache = await mockStore.open('hondi-share-inbox');
    const file = new File(['pdf-bytes'], '가족관계증명서.pdf', { type: 'application/pdf' });
    await cache.put('/_share-inbox/abc123', new Response(file, {
      headers: {
        'Content-Type': 'application/pdf',
        'X-Share-Filename': encodeURIComponent('가족관계증명서.pdf'),
        'X-Share-Title': encodeURIComponent('정부24'),
        'X-Share-Text': encodeURIComponent(''),
        'X-Share-Ts': '1720000000000',
      },
    }));

    const doc = await getSharedDocument('abc123', { cacheStore: mockStore });
    assert.ok(doc);
    assert.equal(doc.filename, '가족관계증명서.pdf');
    assert.equal(doc.title, '정부24');
    assert.equal(doc.mimeType, 'application/pdf');
    assert.equal(doc.ts, 1720000000000);
  });

  it('없는 id면 null', async () => {
    const mockStore = makeMockCacheStore();
    const doc = await getSharedDocument('no-such-id', { cacheStore: mockStore });
    assert.equal(doc, null);
  });

  it('id가 falsy면 캐시 열지도 않고 즉시 null', async () => {
    let opened = false;
    const mockStore = { open: async () => { opened = true; } };
    const doc = await getSharedDocument('', { cacheStore: mockStore });
    assert.equal(doc, null);
    assert.equal(opened, false);
  });

  it('clearSharedDocument로 지운 뒤에는 다시 못 읽음', async () => {
    const mockStore = makeMockCacheStore();
    const cache = await mockStore.open('hondi-share-inbox');
    await cache.put('/_share-inbox/xyz', new Response(new File(['x'], 'a.pdf'), {
      headers: { 'Content-Type': 'application/pdf' },
    }));
    const cleared = await clearSharedDocument('xyz', { cacheStore: mockStore });
    assert.equal(cleared, true);
    const doc = await getSharedDocument('xyz', { cacheStore: mockStore });
    assert.equal(doc, null);
  });
});

describe('N-50: share-inbox.js — formatShareConfirmation (용도 확인 강제)', () => {
  it('후보 절차가 없으면 직접 물어보는 문구', () => {
    const msg = formatShareConfirmation({ filename: '등본.pdf' }, []);
    assert.match(msg, /등본\.pdf/);
    assert.match(msg, /알려주세요/);
  });

  it('후보 절차가 있으면 선택지로 제시(AI가 임의로 단정하지 않음)', () => {
    const msg = formatShareConfirmation({ filename: '가족관계증명서.pdf' }, ['개인파산 신청', '전입신고']);
    assert.match(msg, /1\) 개인파산 신청/);
    assert.match(msg, /2\) 전입신고/);
  });
});

describe('N-51: share-inbox.js — buildGov24LaunchInfo (실사 확인된 값 사용)', () => {
  it('android는 실제 확인된 패키지명(kr.go.minwon.m) 사용', () => {
    const info = buildGov24LaunchInfo('android', '가족관계증명서');
    assert.match(info.launchUrl, /kr\.go\.minwon\.m/);
    assert.match(info.fallbackUrl, /play\.google\.com.*kr\.go\.minwon\.m/);
    assert.match(info.guidance, /가족관계증명서/);
    assert.match(info.guidance, /공유하기/, '특정화면 진입을 보장 못하니 안내 문구로 유도해야 함');
  });

  it('ios는 실제 확인된 App Store ID(586454505) 사용', () => {
    const info = buildGov24LaunchInfo('ios', '주민등록등본');
    assert.match(info.launchUrl, /586454505/);
  });

  it('플랫폼 불명이면 gov.kr 공식 페이지로 안전하게 폴백', () => {
    const info = buildGov24LaunchInfo('unknown', null);
    assert.match(info.launchUrl, /gov\.kr/);
  });

  it('문서명 없어도 일반 안내 문구는 제공', () => {
    const info = buildGov24LaunchInfo('android', null);
    assert.match(info.guidance, /필요한 서류/);
  });
});
