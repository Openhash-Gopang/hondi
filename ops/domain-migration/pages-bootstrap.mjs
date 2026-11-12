// 2026-11-13 hondi.net 종료 대비 — 서비스별 Cloudflare Pages 프로젝트와
// <name>.naviweb.kr 도메인(CNAME 포함)을 일괄 생성한다. 멱등: 이미 있으면 건너뛴다.
// APPLY!=true 이면 쓰기 없이 점검만 한다(토큰 권한·대상 상태 보고).
const A = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const T = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
const APPLY = process.env.APPLY === 'true';
const OWNER = process.env.REPO_OWNER || 'Openhash-Gopang';
const ZONE = 'naviweb.kr';
const ALL = ['market','gdc','health','security','insurance','traffic','logistics','stock','public',
  'democracy','police','911','qna','plan','job','biz','search','watch','telecom','jit','city',
  'clean','estate','mail','users'];
// 건드리지 않는 주소: klaw·hondi(생성 완료), navi-pro 공유 코어가 서빙하는 9개, L1~L5(서버)
const SKIP = new Set(['klaw','hondi','appraiser','doctor','ip','jeju','law','pro','school','taxcpa','tax',
  'l1-hanlim','l1-ido1','l2-jeju-city','l3-jeju','l4-kr','l5-global']);
const only = (process.env.ONLY || '').split(/[\s,]+/).filter(Boolean);
const targets = (only.length ? only : ALL).filter(n => !SKIP.has(n));

const out = [];
const log = (s) => { console.log(s); out.push(s); };
let failed = 0;

async function cf(method, path, body) {
  const init = { method, headers: { Authorization: `Bearer ${T}` } };
  if (body instanceof FormData) init.body = body;
  else if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, init);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok && j.success !== false, j, err: (j.errors || []).map(e => `${e.code}:${e.message}`).join('; ') };
}
const need = (what) => `권한 부족(${what}) — 토큰에 해당 권한을 추가하세요`;

async function main() {
  if (!A || !T) { log('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 시크릿이 없습니다'); process.exit(1); }
  log(`## Pages 일괄 생성 (${APPLY ? '적용' : '점검 전용'})`);
  const v = await cf('GET', '/user/tokens/verify');
  log(`- 토큰 상태: ${v.ok ? v.j.result?.status : '확인 실패 ' + v.err}`);

  const pl = await cf('GET', `/accounts/${A}/pages/projects?per_page=100`);
  if (!pl.ok) {
    const ac = await cf('GET', '/accounts');
    log(`- 계정 ID 형식 ${/^[0-9a-f]{32}$/.test(A) ? '정상' : '비정상(길이 ' + A.length + ')'}, 토큰이 접근 가능한 계정 수: ${ac.ok ? ac.j.result.length : '조회 실패 ' + ac.err}`);
    if (ac.ok) log(`- 접근 가능 계정 ID 앞 8자리: ${ac.j.result.map(x => x.id.slice(0, 8) + '(' + A.slice(0, 8) + '와 ' + (x.id === A ? '일치' : '불일치') + ')').join(', ')}`); log(`- Pages 목록: 실패 (${pl.status}) ${pl.err} → ${need('Account · Cloudflare Pages · Edit')}`); process.exit(1); }
  const projects = new Map(pl.j.result.map(p => [p.name, p]));
  log(`- Pages 프로젝트 ${projects.size}개 확인`);

  const z = await cf('GET', `/zones?name=${ZONE}`);
  const zoneId = z.ok && z.j.result?.[0]?.id;
  if (!zoneId) { log(`- ${ZONE} 영역: 조회 실패 (${z.status}) ${z.err} → ${need('Zone · DNS · Edit, naviweb.kr')}`); process.exit(1); }
  const rl = await cf('GET', `/zones/${zoneId}/dns_records?per_page=500`);
  if (!rl.ok) { log(`- DNS 목록: 실패 ${rl.err} → ${need('Zone · DNS · Edit, naviweb.kr')}`); process.exit(1); }
  const recs = new Map(rl.j.result.map(r => [r.name, r]));
  log(`- ${ZONE} DNS 레코드 ${recs.size}개 확인\n\n| 이름 | 프로젝트 | 레코드 | 결과 |\n|---|---|---|---|`);

  for (const n of targets) {
    const host = `${n}.${ZONE}`;
    const notes = [];
    try {
      const rec = recs.get(host);
      if (rec && !(rec.type === 'CNAME' && rec.content === `${n}.pages.dev`) && !(rec.type === 'CNAME' && rec.content.endsWith('.pages.dev'))) {
        log(`| ${host} | - | ${rec.type} → ${rec.content} | 충돌: 기존 레코드가 있어 건너뜀 |`); failed++; continue;
      }
      let proj = projects.get(n);
      const state = [proj ? '프로젝트 있음' : '프로젝트 없음', rec ? '레코드 있음' : '레코드 없음'];
      if (!APPLY) { log(`| ${host} | ${n} | ${rec ? rec.content : '-'} | ${state.join(', ')} → 생성 예정 |`); continue; }

      if (!proj) {
        const gh = await fetch(`https://api.github.com/repos/${OWNER}/${n}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'pages-bootstrap' } });
        const branch = gh.ok ? (await gh.json()).default_branch : null;
        if (!branch) throw new Error(`저장소 ${OWNER}/${n} 를 읽지 못함(${gh.status})`);
        const c = await cf('POST', `/accounts/${A}/pages/projects`, {
          name: n, production_branch: branch,
          build_config: { build_command: '', destination_dir: '', root_dir: '' },
          source: { type: 'github', config: { owner: OWNER, repo_name: n, production_branch: branch,
            pr_comments_enabled: false, deployments_enabled: true, production_deployments_enabled: true, preview_deployment_setting: 'none' } },
        });
        if (!c.ok) throw new Error(`프로젝트 생성 실패 ${c.status} ${c.err}${c.status === 403 ? ' → ' + need('Account · Cloudflare Pages · Edit') : ''}`);
        proj = c.j.result; projects.set(n, proj); notes.push('프로젝트 생성');
        const fd = new FormData(); fd.append('branch', branch);
        const d = await cf('POST', `/accounts/${A}/pages/projects/${n}/deployments`, fd);
        notes.push(d.ok ? '배포 시작' : `배포 시작 실패(${d.err})`);
      }
      const dom = await cf('POST', `/accounts/${A}/pages/projects/${n}/domains`, { name: host });
      if (dom.ok) notes.push('도메인 추가');
      else if (/already|exist/i.test(dom.err)) notes.push('도메인 이미 있음');
      else throw new Error(`도메인 추가 실패 ${dom.status} ${dom.err}`);
      if (!rec) {
        const r = await cf('POST', `/zones/${zoneId}/dns_records`, { type: 'CNAME', name: n, content: `${proj.subdomain || n + '.pages.dev'}`, proxied: true, ttl: 1 });
        if (!r.ok) throw new Error(`CNAME 생성 실패 ${r.status} ${r.err}${r.status === 403 ? ' → ' + need('Zone · DNS · Edit') : ''}`);
        notes.push('CNAME 생성');
      }
      log(`| ${host} | ${n} | ${n}.pages.dev | ${notes.join(', ') || '변경 없음'} |`);
    } catch (e) { failed++; log(`| ${host} | ${n} | - | 실패: ${e.message.replace(/\|/g, '/')} |`); }
  }
  log(`\n대상 ${targets.length}개, 실패/충돌 ${failed}개`);
}
await main().catch(e => { log('오류: ' + e.message); failed++; });
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
process.exit(failed ? 1 : 0);
