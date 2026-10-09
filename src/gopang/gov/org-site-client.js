// 서버의 라이브 설정을 가져온다 (2026-10-09 신설). 실패·미설정이면 null → 호출부가 기존 ORG_SITES 기본값으로 계속한다.
import { sanitizeConfig } from './org-site-config.js';

export async function fetchLiveConfig(proxy, site, { timeoutMs = 4000, fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`${proxy}/org-site/config?site=${encodeURIComponent(site)}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok || !j.config) return null;
    const c = sanitizeConfig(j.config);
    return c.ok ? { version: j.version, config: c.config } : null;
  } catch { return null; }
}
