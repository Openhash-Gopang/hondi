/// <reference path="../pb_data/types.d.ts" />
// 2026-09-25 v2 — 1794500001과 완전히 동일한 로직의 재시도.
// 1794500001은 첫 실행에서 PHONE_VERIFY_SECRET 미설정으로 중간에 실패했는데도(비밀값 로딩이 서버의
// systemd 환경과 마이그레이션 실행 환경이 분리돼 있던 배포 스크립트 결함 때문), PocketBase가 이 파일명을
// "이미 적용됨"으로 내부 기록(_migrations)에 남겨 이후 재실행(migrate up)이 조용히 건너뛰어졌다
// ("No new migrations to apply."). 내부 기록을 DB에서 직접 지우는 대신, 새 파일명으로 같은 작업을
// 다시 등록해 PocketBase가 "처음 보는 마이그레이션"으로 인식해 실제로 실행되게 한다.
// 배포 스크립트는 이미 고쳐졌다(PHONE_VERIFY_SECRET을 포함해 /opt/gopang/gopang.env를 source하도록
// 2026-09-25 서버에서 직접 수정 완료) — 그래서 이번엔 정상적으로 끝까지 실행될 것으로 예상한다.
//
// 2026-09-25 신설 — 주피터 실사로 발견: 오래된 계정(예: guid 2601:db80:c342:fd1b:bc4a:2dce:9ed8:04b6,
// x25519_registered_at 2026-09-06)의 e164(평문, 예: +8201096627170)가 지금 Worker가 정규화하는 형식과
// 완전히 똑같은데도 e164_hash가 서버가 지금 새로 계산한 값과 일치하지 않았다(혼디 숫자 코드 문자 인증
// 등록에서 재현 — PHONE_MISMATCH_HASH). 원인: e164_hash/e164_enc는 계산 당시(2026-09-07 신설 또는 그
// 이전 백필 시점)의 PHONE_VERIFY_SECRET/PHONE_ENC_KEY로 고정됐는데, 그 뒤 비밀값이 바뀌면 예전 해시는
// 영원히 지금 계산과 어긋난다 — 코드(정규화 형식) 문제가 전혀 아니었다.
//
// 이 마이그레이션은 pb_migrations/1793900200_backfill…(있으면 채우고 없으면 건너뜀)와 달리,
// e164가 있는 "모든" 레코드의 e164_hash/e164_enc/e164_last8을 **지금 이 서버에 설정된 현재
// 비밀값으로 무조건 다시 계산해 덮어쓴다** — 이미 값이 있어도 재계산한다(그래야 옛 비밀값으로 굳어
// 있던 레코드가 고쳐진다). e164_last8은 원문 자체는 그대로라 재계산해도 값이 같다(참고용으로만 다시 씀).
//
// 비밀값이 그사이 또 바뀌면 이 마이그레이션도 다시 실행해야 한다(재실행해도 안전 — 매번 "지금" 비밀값
// 기준으로 다시 맞춘다). 평문 e164는 여전히 건드리지 않는다(별도 정리 마이그레이션 대상).
migrate((db) => {
  const dao = new Dao(db);

  const secret = $os.getenv("PHONE_VERIFY_SECRET");
  const encKey = $os.getenv("PHONE_ENC_KEY");
  if (!secret) {
    throw new Error("PHONE_VERIFY_SECRET 미설정 — 재계산을 진행할 수 없습니다. 먼저 환경변수를 설정하세요.");
  }
  if (!encKey || encKey.length !== 32) {
    throw new Error("PHONE_ENC_KEY 미설정/형식 오류(정확히 32자여야 함) — 재계산을 진행할 수 없습니다.");
  }

  const BATCH_SIZE = 500;
  let offset = 0;
  let totalProcessed = 0;
  let totalUnchanged = 0;
  let totalFailed = 0;

  for (;;) {
    // 이전 백필과 달리 e164_hash 값 유무와 무관하게 전부 대상 — 그래서 offset을 실제로 늘려가며 페이지를 넘긴다
    // (이번엔 처리해도 조건에서 빠지지 않으므로, 0 고정 페이징을 쓰면 무한루프에 빠진다).
    const batch = dao.findRecordsByFilter(
      "profiles",
      "e164 != ''",
      "+id",
      BATCH_SIZE,
      offset
    );
    if (batch.length === 0) break;

    for (const record of batch) {
      const e164 = record.getString("e164");
      if (!e164) { continue; }

      try {
        const newHash = $security.hs256("e164-lookup:" + e164, secret);
        const newEnc = $security.encrypt(e164, encKey);
        const newLast8 = e164.slice(-8);

        const oldHash = record.getString("e164_hash");
        if (oldHash === newHash && record.getString("e164_last8") === newLast8) {
          totalUnchanged++;
        } else {
          console.log(`[E164-RESYNC-V2] guid=${record.getString("guid")} 해시 갱신: ${oldHash ? oldHash.substring(0, 8) + "…" : "(없음)"} → ${newHash.substring(0, 8)}…`);
        }

        record.set("e164_hash", newHash);
        record.set("e164_enc", newEnc);
        record.set("e164_last8", newLast8);

        dao.saveRecord(record);
        totalProcessed++;
      } catch (err) {
        totalFailed++;
        console.log(`[E164-RESYNC-V2] guid=${record.getString("guid")} 실패(건너뜀): ${err.message}`);
      }
    }

    offset += batch.length;
    if (offset > 2000000) {
      throw new Error("재계산이 예상보다 훨씬 많은 레코드를 처리하고 있습니다 — 안전을 위해 중단합니다. 수동 확인 필요.");
    }
  }

  console.log(`[E164-RESYNC-V2] 완료 — 처리 ${totalProcessed}건(값 변경 ${totalProcessed - totalUnchanged}건, 동일 ${totalUnchanged}건), 실패 ${totalFailed}건`);
}, (db) => {
  // 되돌리기 불가능 — 이 마이그레이션이 덮어쓰기 전의 예전 해시(어떤 비밀값으로 계산됐는지도 모르는 값)를
  // 복원할 방법이 없다. 값을 비우면 오히려 1793900200의 백필 완료 상태보다 후퇴하므로, 의도적으로 아무것도
  // 하지 않는다 — 되돌리려면 이전 비밀값을 알아내 수동으로 재계산해야 한다.
  console.log("[E164-RESYNC-V2] 되돌리기 없음 — 이 마이그레이션은 해시를 현재 비밀값 기준으로 갱신할 뿐이라 이전 상태를 복원할 수 없습니다.");
});
