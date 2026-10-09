// ═════════════════════════════════════════════════
// 혼디 AI 웹사이트 라이브 설정 API (2026-10-09 신설)
//
//   GET  /org-site/config?site=ID            현재 설정(공개). 저장된 게 없으면 {version:0, config:null}
//   GET  /org-site/history?site=ID           버전 목록(최신순, 설정 본문 제외)
//   GET  /org-site/version?site=ID&version=N 특정 버전 설정(롤백 준비용)
//   POST /org-site/save                      { site, config, baseVersion, note?, guid, ts, sig }
//
// 저장 권한: guid 계정에 핀된 지갑 키로 서명 + 그 계정이 관리자 목록(env.ORG_SITE_ADMINS, 쉼표 구분 — guid 또는 공개키)에 있어야 한다.
// 서명 대상: "hondi-org-site\n{site}\n{baseVersion}\n{ts}\n{sha256(stableStringify(config))}"
// 동시 수정: baseVersion이 현재 최신과 다르면 409 STALE. 롤백은 옛 설정을 새 버전으로 다시 저장하는 것(특별 경로 없음).
// ═════════════════════════════════════════════════
import { sanitizeConfig, stableStringify, SITE_ID_RE } from '../gopang/gov/org-site-config.js';
import { verifySig } from '../gopang/ai/hondi-digit-claim.js';

const json = (body, status, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
const err = (status, code, message, cors, extra = {}) => json({ ok: false, code, message, ...extra }, status, cors);

export async function sha256Hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const signedMessage = (site, baseVersion, ts, configHash) => `hondi-org-site\n${site}\n${baseVersion}\n${ts}\n${configHash}`;

export function makeOrgSiteHandler({ store, getPinnedPubKey, now = () => Date.now(), maxSkewMs = 10 * 60 * 1000 }) {
  if (!store?.latest || !store?.append) throw new Error('makeOrgSiteHandler: store 필요');
  if (typeof getPinnedPubKey !== 'function') throw new Error('makeOrgSiteHandler: getPinnedPubKey 필요');

  const siteOf = (url, cors) => {
    const s = url.searchParams.get('site') || '';
    return SITE_ID_RE.test(s) ? s : null;
  };

  async function handle(request, url, env, cors = {}) {
    try {
      const path = url.pathname;
      if (request.method === 'GET' && ['/org-site/config', '/org-site/history', '/org-site/version'].includes(path)) {
        const site = siteOf(url);
        if (!site) return err(400, 'SITE', 'site 형식이 올바르지 않습니다.', cors);
        const nocache = { 'Cache-Control': 'no-store', ...cors };   // 라이브 수정이 바로 보여야 한다
        if (path === '/org-site/config') {
          const cur = await store.latest(site);
          return json(cur ? { ok: true, version: cur.version, ts: cur.ts, config: cur.config } : { ok: true, version: 0, config: null }, 200, nocache);
        }
        if (path === '/org-site/history') return json({ ok: true, versions: await store.list(site, 50) }, 200, nocache);
        const v = Number(url.searchParams.get('version'));
        if (!Number.isInteger(v) || v < 1) return err(400, 'VERSION', 'version이 올바르지 않습니다.', cors);
        const rec = await store.get(site, v);
        return rec ? json({ ok: true, version: rec.version, config: rec.config, note: rec.note }, 200, nocache) : err(404, 'NO_VERSION', '그 버전이 없습니다.', cors);
      }

      if (request.method === 'POST' && path === '/org-site/save') {
        const admins = String(env?.ORG_SITE_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!admins.length) return err(503, 'NO_ADMIN', '관리자가 설정되지 않았습니다(ORG_SITE_ADMINS).', cors);
        const body = await request.json().catch(() => null);
        const { site, config, baseVersion, note = '', guid, ts, sig } = body || {};
        if (!SITE_ID_RE.test(site || '') || !guid || !sig || !Number.isInteger(baseVersion) || baseVersion < 0 || !Number.isInteger(ts)) return err(400, 'MISSING', '요청 형식이 올바르지 않습니다.', cors);
        if (Math.abs(now() - ts) > maxSkewMs) return err(400, 'STALE_TS', '시각 차이가 너무 큽니다. 기기 시계를 확인해 주세요.', cors);
        const pinned = await getPinnedPubKey(env, guid);
        if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
        if (!admins.includes(guid) && !admins.includes(pinned)) return err(403, 'NOT_ADMIN', '이 사이트를 수정할 권한이 없습니다.', cors);
        const clean = sanitizeConfig(config);
        if (!clean.ok) return err(422, 'BAD_CONFIG', clean.errors.join(' / '), cors, { errors: clean.errors });
        const hash = await sha256Hex(stableStringify(clean.config));
        if (!(await verifySig(pinned, signedMessage(site, baseVersion, ts, hash), sig))) return err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors);
        const cur = await store.latest(site);
        const curVer = cur ? cur.version : 0;
        if (curVer !== baseVersion) return err(409, 'STALE', `다른 곳에서 먼저 수정되었습니다(현재 v${curVer}). 새로고침 후 다시 저장하세요.`, cors, { version: curVer });
        const rec = { site, version: curVer + 1, config: clean.config, note: String(note).slice(0, 200), author: pinned, ts, sig, hash };
        try { await store.append(rec); }
        catch (e) { if (e.message === 'CONFLICT') return err(409, 'STALE', '동시에 다른 수정이 저장되었습니다. 새로고침 후 다시 저장하세요.', cors); throw e; }
        return json({ ok: true, version: rec.version, config: rec.config }, 200, cors);
      }
      return err(404, 'NOT_FOUND', '알 수 없는 경로입니다.', cors);
    } catch (e) {
      console.error('[OrgSiteHandler]', e.message);
      return err(500, 'INTERNAL', '서버 오류가 발생했습니다.', cors);
    }
  }
  return { handle };
}
