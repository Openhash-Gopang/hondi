/**
 * pdv/usage-summary.js — 대시보드 일간/주간/월간 사용 내역 조회 (2026-09-07 신설)
 *
 * worker.js의 GET /pdv/my-records(from/to·카테고리 확장판, 2026-09-07)를
 * 서명해 호출하고, 대시보드가 바로 렌더링할 수 있는 형태로 반환한다.
 *
 * 주의(설계상 한계 — 사용자 확인 필요, 자세한 내용은 patch 안내 참고):
 * 2026-08-20 PDV 해시-전용 리팩터 이후 서버(pdv_records)는 각 기록의
 * "무엇을 했는지"에 대한 평문 요약을 전혀 갖고 있지 않다(콘텐츠 해시만
 * 저장). 그래서 이 모듈이 돌려주는 항목은 "언제 · 어느 서비스 종류 ·
 * (전문가 상담이면 어느 페르소나)"까지만 신뢰할 수 있고, "짜장면 1그릇
 * 주문"처럼 사람이 읽을 수 있는 상세 내용은 서버에서 재구성할 수 없다.
 * 그 수준의 상세 내용은 이 기록이 발생한 바로 그 기기의 localStorage
 * (gopang_pdv_log, 최대 1000건)에만 남아 있다.
 */
const WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';

function _isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/**
 * @param {Object} wallet   — window.GopangWallet.load()로 얻은 인스턴스
 * @param {Object} [opts]
 *   opts.granularity — 'day' | 'week' | 'month' (from/to 미지정 시 이 값으로 기간을 정함, 기본 'day')
 *   opts.from/opts.to — 직접 지정할 때(ISO 8601). 지정하면 granularity는 무시된다.
 *   opts.limit        — 서버 최대 반환 건수(기본 500, 최대 1000)
 * @returns {Promise<{items:Array, counts_by_category:Object, truncated:boolean, range:Object}>}
 */
export async function fetchUsageHistory(wallet, opts = {}) {
  if (!wallet?.guid || !wallet?.publicKeyB64u) {
    throw new Error('[usage-summary] wallet.guid/publicKeyB64u 없음 — 로그인 필요');
  }
  const granularity = opts.granularity || 'day';
  const days = granularity === 'month' ? 31 : granularity === 'week' ? 7 : 1;
  const from = opts.from || _isoDaysAgo(days);
  const to   = opts.to   || new Date().toISOString();
  const limit = opts.limit || 500;

  const ts = Date.now().toString();
  const sigMsg = `pdv-my-records:${wallet.guid}:${wallet.publicKeyB64u}:${ts}`;
  const signature = await wallet.signPayload(sigMsg);

  const qs = new URLSearchParams({
    guid: wallet.guid, pubkey: wallet.publicKeyB64u, signature, ts,
    from, to, limit: String(limit),
  });

  const res = await fetch(`${WORKER_URL}/pdv/my-records?${qs.toString()}`);
  if (!res.ok) throw new Error(`[usage-summary] 조회 실패: HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(`[usage-summary] ${data?.message || '알 수 없는 오류'}`);
  return data;
}

/**
 * items를 일(day) 단위 버킷으로 묶는다 — 주간/월간 뷰의 막대그래프·
 * 요일별 카드에 바로 사용할 수 있다.
 * @param {Array} items — fetchUsageHistory(...).items
 * @returns {Array<{day:string, total:number, by_category:Object}>} 날짜 오름차순
 */
export function bucketByDay(items) {
  const buckets = {};
  for (const it of items) {
    const day = (it.created_at || '').slice(0, 10); // YYYY-MM-DD
    if (!day) continue;
    if (!buckets[day]) buckets[day] = { day, total: 0, by_category: {} };
    buckets[day].total += 1;
    buckets[day].by_category[it.category_label] =
      (buckets[day].by_category[it.category_label] || 0) + 1;
  }
  return Object.values(buckets).sort((a, b) => a.day.localeCompare(b.day));
}

const LOCAL_LOG_KEY = 'gopang_pdv_log';

function _readLocalLog() {
  try {
    const log = JSON.parse(localStorage.getItem(LOCAL_LOG_KEY) || '[]');
    return Array.isArray(log) ? log : [];
  } catch { return []; }
}

/**
 * 서버 조회 결과(items)에 "이 기기에" 남아 있는 로컬 상세 요약을
 * 곁들인다(2026-09-07 신설, 하이브리드안).
 *
 * session_id로만 매칭한다 — 서버가 갖고 있지 않은 원문을 서버로 보내는
 * 과정은 전혀 없고, 전부 이 브라우저 안에서 완결된다. 매칭되는 로컬
 * 항목이 없으면 원래 항목을 그대로 둔다(과다표시보다 누락이 안전).
 *
 * 한계(정직하게 명시): 이 매칭은 gopang(hondi.net) 자신이 로컬에 기록을
 * 남긴 세션에만 걸린다. K-서비스가 자기 서브도메인에서 직접
 * window.recordPDV()를 호출한 경우(reporter_svc가 있는 경우)는 원문이
 * 그 서브도메인 자체 저장소에 남아 hondi.net 대시보드에서는 브라우저의
 * 오리진 격리 때문에 애초에 접근할 수 없다 — 이런 항목은 지금처럼
 * 서비스 종류·시각까지만 보인다. 또한 로컬 로그는 기기별(최대 1000건)
 * 이라 다른 기기에서 보거나 로그가 밀려나면 매칭되지 않는다.
 *
 * @param {Array} items — fetchUsageHistory(...).items
 * @returns {Array} 각 item에 매칭되면 local_detail(원문 요약) 필드가 추가된 새 배열
 */
export function enrichWithLocalDetail(items) {
  const localLog = _readLocalLog();
  if (!localLog.length) return items;

  const bySession = new Map();
  for (const r of localLog) {
    if (r?.session_id) bySession.set(r.session_id, r);
  }
  if (!bySession.size) return items;

  return items.map((it) => {
    const local = it.session_id && bySession.get(it.session_id);
    if (!local) return it;
    const detail = local.summary || local.what || local.why || null;
    return detail ? { ...it, local_detail: detail } : it;
  });
}
