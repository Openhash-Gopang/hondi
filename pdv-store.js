/* ─────────────────────────────────────────────────────────────────────
   pdv-store.js — PDV 로컬 IndexedDB 미러 + 4분류(사람/사물/기관/공용AI) 파생

   위치: 이 파일은 webapp.html(부모)과 pdv.html(iframe) 양쪽에서 각각 로드된다.
   - webapp.html 쪽 인스턴스: 'gopang:pdv-recorded' 이벤트를 실제로 받아
     IndexedDB에 기록한다. 이 이벤트는 src/gopang/pdv/record.js의
     _recordPDV()가 기존 localStorage 기록 직후 발행한다(기존 로직은
     건드리지 않고 한 줄만 추가함 — 2026-07-01).
   - pdv.html 쪽 인스턴스: 이벤트 리스너는 그냥 놀고 있고(이 프레임에서는
     _recordPDV가 호출되지 않으므로), list()/listByCategory()로 같은
     오리진의 IndexedDB를 읽기만 한다. IndexedDB는 window가 아니라
     오리진 단위라 이게 가능하다.

   분류 근거 (2026-07-01 저장소 실사 결과 — SP-PDV보다 이 주석이 최신 진실):
   - 실제 _recordPDV() 호출부(expert-session.js, routing-engine.js,
     gwp/engine.js, klaw.js)를 전수 확인한 결과, 지금 기록되는 PDV는
     전부 "나비 자체 AI 서브시스템/에이전트와의 상호작용"이다.
     GWP_REGISTRY(gwp-registry.js)에 svc/serviceId가 존재하면 무조건
     공용 AI 전문가로 분류한다 — 신뢰도 높음, 실제 데이터 있음.
   - "기관"은 GWP_REGISTRY category가 MKT(K-Market 등 실거래)인 경우로
     근사한다 — 근사치다. 실제 판매자(seller_guid) 같은 진짜 상대방
     식별자가 레코드에 안 실려 있어서, 지금은 "상거래 유형이었다" 정도만
     알 수 있고 "어느 사업자였는지"는 모른다.
   - "사람"(1:1 대화 상대)과 "사물"(기기)은 지금 이 레포 어디에도
     _recordPDV() 호출부가 없다 — 즉 실제 데이터가 전혀 없다. 탭은
     만들어 두되, 채워지지 않는 게 정상이라는 걸 빈 상태 문구로 명시한다.
     (1:1 채팅에 _recordPDV 훅을 추가하는 건 이 파일의 책임 밖 — 별도 작업.)
   ───────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const DB_NAME = 'gopang_pdv_store';
  const DB_VERSION = 1;
  const STORE = 'records';
  const LS_LOG_KEY = 'gopang_pdv_log';
  const LS_MIGRATED_KEY = 'gopang_pdv_store_migrated_v1';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: '_id', autoIncrement: true });
          os.createIndex('serviceId', 'serviceId', { unique: false });
          os.createIndex('type', 'type', { unique: false });
          os.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putRecord(record) {
    if (!record) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(record); // add — autoIncrement라 중복 걱정 없음(레코드에 안정적 unique id가 없음)
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllRecords() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // 최초 1회: 기존 localStorage.gopang_pdv_log(최대 1000건)를 IndexedDB로 이전.
  // 이후로는 'gopang:pdv-recorded' 이벤트로만 채워진다.
  async function migrateFromLocalStorageOnce() {
    try {
      if (localStorage.getItem(LS_MIGRATED_KEY)) return;
      const raw = localStorage.getItem(LS_LOG_KEY);
      const log = raw ? JSON.parse(raw) : [];
      if (Array.isArray(log) && log.length) {
        for (const r of log) await putRecord(r);
        console.info('[pdv-store] localStorage → IndexedDB 이전 완료:', log.length, '건');
      }
      localStorage.setItem(LS_MIGRATED_KEY, '1');
    } catch (e) {
      console.warn('[pdv-store] localStorage 이전 실패:', e.message);
    }
  }

  // 실제 기록 이벤트 구독 (webapp.html 쪽 인스턴스에서만 의미 있음)
  global.addEventListener('gopang:pdv-recorded', (e) => {
    putRecord(e.detail).catch(err => console.warn('[pdv-store] 기록 실패:', err.message));
  });

  // ── 4분류 파생 ──────────────────────────────────────────────────
  // GWP_REGISTRY는 top window(webapp.html)에만 로드돼 있다. pdv.html(iframe)에서는
  // parent.GWP_REGISTRY로 접근해야 한다 — 두 경우 다 시도.
  function _registry() {
    return global.GWP_REGISTRY || (global.parent && global.parent !== global && global.parent.GWP_REGISTRY) || [];
  }

  const CATEGORY_LABEL = {
    person: '사람',
    thing: '사물',
    org: '기관',
    ai: '공용 AI 전문가',
    uncategorized: '미분류',
  };

  function classify(record) {
    const svcId = record.serviceId || record.svc || record.source || null;
    if (!svcId) return 'uncategorized';
    const entry = _registry().find(s => s.id === svcId);
    if (!entry) {
      // klaw_monitor 등 registry에 없어도 known service명이 있으면 AI로 간주
      if (svcId === 'klaw' || record.type === 'klaw_monitor') return 'ai';
      return 'uncategorized';
    }
    if (entry.category === 'MKT') return 'org'; // 근사치 — 위 파일 헤더 주석 참고
    return 'ai'; // GWP_REGISTRY 항목은 전부 나비 자체 AI 서브시스템
  }

  function normalizeSummary6w(record) {
    // worker.js 경유 레코드는 summary_6w가 JSON 문자열, record.js 직접 기록은
    // when/where/who/what/how/why가 레코드 최상위 필드로 흩어져 있다 — 둘 다 흡수.
    if (record.summary_6w) {
      if (typeof record.summary_6w === 'string') {
        try { return JSON.parse(record.summary_6w); } catch { /* fallthrough */ }
      } else if (typeof record.summary_6w === 'object') {
        return record.summary_6w;
      }
    }
    const { who, when, where, what, how, why } = record;
    return { who, when, where, what, how, why };
  }

  function toView(record) {
    const category = classify(record);
    return {
      ...record,
      category,
      category_label: CATEGORY_LABEL[category],
      summary_6w_view: normalizeSummary6w(record),
      risk_level: record.risk_level || record.data?.risk_level || null,
    };
  }

  async function list() {
    await migrateFromLocalStorageOnce();
    const all = await getAllRecords();
    return all.map(toView).sort((a, b) => {
      const ta = new Date(a.ts || a.when || 0).getTime();
      const tb = new Date(b.ts || b.when || 0).getTime();
      return tb - ta;
    });
  }

  async function listByCategory(category) {
    const all = await list();
    return category === 'all' ? all : all.filter(r => r.category === category);
  }

  // ── 하위 서비스용 요약 (2026-07-05 신설, 2026-07-06 화이트리스트 추가) ──
  // market 등 다른 origin에 원본 레코드를 넘기지 않고, 이 함수가 만든
  // 압축 텍스트만 auth/silent-pref.html을 통해 postMessage로 내보낸다.
  // record.js의 _buildPDVNote()(자기 자신의 AI 컨텍스트 주입용)와 같은
  // 원칙 — 정적으로 굽지 않고 호출 시점마다 새로 계산.
  //
  // ⚠️ 카테고리 화이트리스트 (2026-07-06, 사고실험 실사로 발견) ⚠️
  // classify()는 GWP_REGISTRY category==='MKT'(K-Market 하나뿐)만 'org'로
  // 분류하고, K-Health/K-Law/K-Finance/K-Insurance/K-Tax/K-Democracy/
  // K-Security/K-Police/K-Emergency 등 나머지 전부는 'ai'라는 하나의
  // 통 바구니에 뭉친다. 즉 category='ai'나 'all'을 외부에 허용하면
  // 건강·법률·금융 상담 기록까지 market 같은 상거래 서비스로 통째로
  // 새어나간다 — "취향 요약"이라는 이름과 전혀 다른 민감정보 유출
  // 경로가 된다. 그래서 이 함수는 외부 relay 용도로는 category를
  // 무조건 'org'로 강제한다('person'/'thing'은 현재 실제 데이터가
  // 없어 포함해도 무해하므로 같이 허용). 'ai'/'all'이 필요한 경우는
  // 이 함수(외부 relay)가 아니라 record.js의 _buildPDVNote()(자기 자신
  // 즉 hondi.net 본체의 AI 컨텍스트에만 주입, 외부로 안 나감)를 써야 한다.
  const _RELAY_ALLOWED_CATEGORIES = new Set(['org', 'person', 'thing']);
  const _PREF_MAX_ITEMS = 12;
  const _PREF_MAX_CHARS = 400;
  const _PREF_MAX_AGE_DAYS = 90; // 90일 지난 상호작용은 취향 신호로 안 씀

  function _textOf(record) {
    const s6 = normalizeSummary6w(record);
    return [record.summary, s6?.what, s6?.why].filter(Boolean).join(' ').toLowerCase();
  }

  // category: 화이트리스트(_RELAY_ALLOWED_CATEGORIES) 밖의 값('ai','all' 등)이
  // 들어오면 조용히 'org'로 강제 다운그레이드한다 — 호출측(market 등)이
  // 뭘 요청하든 이 함수가 최종 방어선이다.
  // keywords: 있으면 텍스트에 하나라도 매칭되는 레코드만 남김(예: ['중식','배달'])
  async function summarizeForRelay(category, keywords) {
    const safeCategory = _RELAY_ALLOWED_CATEGORIES.has(category) ? category : 'org';
    const all = await list(); // 내부에서 migrateFromLocalStorageOnce() 포함
    const cutoff = Date.now() - _PREF_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    let rows = all.filter(r => {
      const t = new Date(r.ts || r.when || 0).getTime();
      return t >= cutoff;
    });
    rows = rows.filter(r => r.category === safeCategory);
    if (Array.isArray(keywords) && keywords.length) {
      const kws = keywords.map(k => String(k).toLowerCase());
      rows = rows.filter(r => {
        const text = _textOf(r);
        return kws.some(k => text.includes(k));
      });
    }
    rows = rows.slice(0, _PREF_MAX_ITEMS);

    const lines = [];
    let used = 0;
    for (const r of rows) {
      const s6 = r.summary_6w_view || {};
      const bit = (s6.what || r.summary || '').toString().slice(0, 60);
      if (!bit) continue;
      const line = `· ${bit}`;
      if (used + line.length > _PREF_MAX_CHARS) break;
      lines.push(line);
      used += line.length;
    }
    return {
      count: rows.length,
      summary_text: lines.length ? lines.join('\n') : null,
      category: safeCategory, // 실제로 적용된 카테고리 — 호출측이 다운그레이드 여부를 알 수 있게
      // 원본 레코드/구체적 날짜/서비스ID는 절대 포함하지 않는다 — 텍스트 요약뿐.
    };
  }

  global.GopangPDV = {
    list,
    listByCategory,
    summarizeForRelay,
    CATEGORY_LABEL,
  };
})(window);
