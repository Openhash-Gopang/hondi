// src/worker/test-migrate.js — 테스트 계정 데이터를 정식 계정으로 옮긴다(L1 레코드의 소유 guid만 바꾼다).
//
// 원칙
//   · 화이트리스트(MIGRATION_TARGETS)에 있는 "사용자가 만든 콘텐츠"만 옮긴다.
//     옮기지 않는 것: 잔액·충전·원장·구독(blocks, charge_requests, ledger_entries, virtual_accounts …),
//     지갑 키·개인 금고(gdc_keys, pdv_records), 사용자 LLM 키(user_llm_keys), 사용 기록(ai_usage_log),
//     메일 발송 기록(kmail_send_log — 일일 한도 계산에 쓰이므로), 프로필 자체.
//   · 이미 옮긴 레코드는 조건(소유자=테스트 guid)에서 빠지므로 다시 실행해도 안전하다(이어하기).
//   · 레코드 하나가 실패(중복 제약 등)해도 나머지는 계속한다. 실패 건수는 그대로 보고한다.
//   · 한 번의 호출이 쓰는 하위 요청 수를 maxRequests로 제한한다(무료 플랜 워커는 요청 1건당 하위 요청이 50개까지).
//     넘으면 done=false와 next_index(다음에 이어갈 대상 번호)를 돌려주고, 호출자가 그 값을 startIndex로 다시 보낸다.
//     이미 끝낸 대상은 다시 조회하지 않으므로, 예산이 대상 수(26)보다 작아도 반드시 끝난다.
//
// l1(path, init) → Response : 호출자가 L1 주소·관리자 토큰을 씌워 주는 함수(worker.js에서 주입).

export const MIGRATION_TARGETS = [
  // K-Mail
  { c: 'kmail_contacts',          f: 'owner_user_guid', label: 'K-Mail 연락처' },
  { c: 'kmail_campaigns',         f: 'owner_user_guid', label: 'K-Mail 캠페인' },
  { c: 'kmail_campaign_messages', f: 'owner_user_guid', label: 'K-Mail 캠페인 대화' },
  { c: 'kmail_drafts',            f: 'owner_user_guid', label: 'K-Mail 초안' },
  { c: 'kmail_rules',             f: 'owner_user_guid', label: 'K-Mail 규칙' },
  { c: 'kmail_blocklist',         f: 'owner_user_guid', label: 'K-Mail 차단 목록' },
  { c: 'kmail_attachments',       f: 'owner_user_guid', label: 'K-Mail 첨부' },
  { c: 'kmail_message_state',     f: 'owner_user_guid', label: 'K-Mail 메일 상태' },
  { c: 'kmail_thread_state',      f: 'owner_user_guid', label: 'K-Mail 스레드 상태' },
  { c: 'org_units',               f: 'owner_user_guid', label: '주소록 소속 기관 트리' },
  // K-Plan · 정보 공개 청구
  { c: 'kplan_plans',             f: 'guid',            label: 'K-Plan 계획' },
  { c: 'kplan_tasks',             f: 'guid',            label: 'K-Plan 작업' },
  { c: 'kplan_plan_state',        f: 'owner_user_guid', label: 'K-Plan 진행 상태' },
  { c: 'foi_campaigns',           f: 'owner_guid',      label: '정보 공개 청구 건' },
  // 그 밖의 사용자 작성 콘텐츠
  { c: 'citizen_reports',         f: 'user_guid',       label: '시민 제보' },
  { c: 'citizen_schedule',        f: 'user_guid',       label: '일정' },
  { c: 'school_student_profiles', f: 'user_guid',       label: 'K-School 학생 프로필' },
  { c: 'school_subjects',         f: 'user_guid',       label: 'K-School 과목' },
  { c: 'school_learning_schedules', f: 'user_guid',     label: 'K-School 학습 일정' },
  { c: 'school_sessions',         f: 'user_guid',       label: 'K-School 학습 세션' },
  { c: 'school_progress',         f: 'user_guid',       label: 'K-School 진도' },
  { c: 'school_assessments',      f: 'user_guid',       label: 'K-School 평가' },
  { c: 'school_reports',          f: 'user_guid',       label: 'K-School 보고서' },
  { c: 'kcleaner_reports',        f: 'user_guid',       label: 'K-Cleaner 보고서' },
  { c: 'ins_claims',              f: 'user_guid',       label: '보험 청구' },
  { c: 'insurance_calc_results',  f: 'user_guid',       label: '보험 계산 결과' },
];

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const PER_PAGE = 200;

export async function migrateTestData({ l1, fromGuid, toGuid, dryRun = false, maxRequests = 800, startIndex = 0, targets = MIGRATION_TARGETS }) {
  if (!fromGuid || !toGuid || fromGuid === toGuid) throw new Error('migrateTestData: 출발·도착 guid가 올바르지 않습니다');
  let used = 0;
  let nextIndex = targets.length;           // 끝까지 처리했으면 targets.length
  const call = async (path, init) => { used += 1; return l1(path, init); };
  const results = [];
  const from = Math.max(0, Math.min(targets.length, Number(startIndex) || 0));

  for (let idx = from; idx < targets.length; idx++) {
    const t = targets[idx];
    if (used >= maxRequests) { nextIndex = idx; break; }            // 이 대상은 다음 호출에서 처음부터
    const r = { collection: t.c, label: t.label, found: 0, moved: 0, failed: 0 };
    results.push(r);
    const filter = encodeURIComponent(`${t.f}='${esc(fromGuid)}'`);

    // 한 컬렉션 처리 — 옮긴 레코드는 조회 조건(소유자=테스트 guid)에서 빠지므로 항상 "첫 페이지"만 읽으면 된다.
    // 레코드가 아주 많아도 목록 읽기에 예산을 다 쓰지 않고, 옮기고 → 다시 첫 페이지를 읽는 식으로 진행한다.
    // 옮기지 못한 레코드(중복 제약 등)는 조건에서 제외해 다시 만나지 않게 한다.
    if (dryRun) {
      let res;
      try { res = await call(`/api/collections/${t.c}/records?filter=${filter}&perPage=1&page=1&fields=id`); }
      catch (e) { r.error = '조회 실패: ' + e.message; continue; }
      if (res.status === 404) { r.skipped = 'collection-missing'; continue; }
      if (!res.ok) { r.error = `조회 실패 (HTTP ${res.status})`; continue; }
      const data = await res.json().catch(() => ({ totalItems: 0 }));
      r.found = Number(data.totalItems) || 0;
      continue;
    }
    const failedIds = [];
    let consecutiveFail = 0, stop = false;
    while (!stop) {
      if (used >= maxRequests) { r.incomplete = true; break; }
      const excl = failedIds.length ? ' && ' + failedIds.map(x => `id!='${esc(x)}'`).join(' && ') : '';
      const q = encodeURIComponent(`${t.f}='${esc(fromGuid)}'${excl}`);
      let res;
      try { res = await call(`/api/collections/${t.c}/records?filter=${q}&perPage=${PER_PAGE}&page=1&fields=id`); }
      catch (e) { r.error = '조회 실패: ' + e.message; break; }
      if (res.status === 404) { r.skipped = 'collection-missing'; break; }
      if (!res.ok) { r.error = `조회 실패 (HTTP ${res.status})`; break; }
      const data = await res.json().catch(() => ({ items: [] }));
      const items = data.items || [];
      if (!items.length) break;                       // 이 컬렉션은 끝
      r.found += items.length;
      for (const it of items) {
        if (used >= maxRequests) { r.incomplete = true; stop = true; break; }
        let pr;
        try { pr = await call(`/api/collections/${t.c}/records/${it.id}`, { method: 'PATCH', body: JSON.stringify({ [t.f]: toGuid }) }); }
        catch (e) { r.failed += 1; failedIds.push(it.id); r.error = r.error || ('이동 실패: ' + e.message); if (++consecutiveFail >= 5) { stop = true; break; } continue; }
        if (pr.ok) { r.moved += 1; consecutiveFail = 0; }
        else {
          r.failed += 1; failedIds.push(it.id);
          if (!r.error) r.error = `이동 실패 (HTTP ${pr.status}) — 중복 등으로 옮길 수 없는 항목이 있습니다`;
          if (++consecutiveFail >= 5) { stop = true; break; }      // 같은 원인으로 계속 실패하면 이 컬렉션은 그만 시도
        }
      }
      if (items.length < PER_PAGE && !stop) break;    // 마지막 페이지였다 — 다시 읽을 필요 없음
    }
    if (r.incomplete) { nextIndex = idx; break; }     // 옮기던 중 예산이 끝났다 — 남은 것은 다음 호출에서 이어서(옮긴 것은 조건에서 빠진다)
  }

  const totals = results.reduce((a, r) => ({ found: a.found + r.found, moved: a.moved + r.moved, failed: a.failed + r.failed }), { found: 0, moved: 0, failed: 0 });
  const done = nextIndex >= targets.length;
  return {
    dry_run: !!dryRun, done, next_index: nextIndex, total_targets: targets.length,
    clean: totals.failed === 0 && !results.some(r => r.error),
    totals, results, requests_used: used,
  };
}

// K-Mail 설정(서명·보내는 이름·자동 답장)은 정식 계정의 행이 이미 있으므로 "행 이동" 대신 값만 합친다.
// 메일 ID(mail_id)는 계정마다 하나뿐이라 옮기지 않는다. 정식 쪽 값이 비어 있거나 기본값일 때만 채운다.
export const SETTINGS_FIELDS = ['signature_text', 'sender_display_name', 'auto_reply_text', 'auto_reply_until'];
const DEFAULT_SENDER = '나비 K-Mail';

export async function mergeKmailSettings({ l1, fromGuid, toGuid }) {
  const get = async (g) => {
    const res = await l1(`/api/collections/kmail_user_settings/records?filter=${encodeURIComponent(`owner_user_guid='${esc(g)}'`)}&perPage=1`);
    if (!res.ok) return null;
    const d = await res.json().catch(() => ({ items: [] }));
    return (d.items && d.items[0]) || null;
  };
  const from = await get(fromGuid);
  if (!from) return { merged: false, reason: 'no-source' };
  const to = await get(toGuid);
  if (!to) return { merged: false, reason: 'no-target' };      // 정식 계정의 설정 행은 가입 시 만들어진다. 없으면 건드리지 않는다.
  const patch = {};
  for (const k of SETTINGS_FIELDS) {
    const tv = to[k], fv = from[k];
    const empty = tv === undefined || tv === null || tv === '' || (k === 'sender_display_name' && tv === DEFAULT_SENDER);
    const has = fv !== undefined && fv !== null && fv !== '' && !(k === 'sender_display_name' && fv === DEFAULT_SENDER);
    if (empty && has) patch[k] = fv;
  }
  if (!Object.keys(patch).length) return { merged: false, reason: 'nothing-to-merge' };
  const res = await l1(`/api/collections/kmail_user_settings/records/${to.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return { merged: res.ok, fields: Object.keys(patch) };
}
