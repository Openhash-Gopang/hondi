/// <reference path="../pb_data/types.d.ts" />
// 2026-09-07 신설 — 1793900100_add_e164_hash_enc_last8_to_profiles.js가
// 새 필드 3개를 추가했지만, 그건 "앞으로 생성되는 레코드"부터만 채워진다
// (onRecordBeforeCreateRequest 훅이 그 시점에만 계산하므로). 이 배포
// *이전에* 이미 가입해 평문 e164로 저장된 기존 레코드들은 새 필드가
// 전부 빈 값인 채로 남는다.
//
// 이 상태로 재클레임 중복탐지·최초 키 바인딩 재인증 로직(둘 다
// e164_hash 기준으로 바뀜)을 배포하면, 기존 가입자 전원에 대해 그
// 방어들이 조용히 무력화된다(빈 e164_hash는 아무 것도 매칭 안 되므로) —
// 원래 있던 평문 e164 기준 방어보다 오히려 후퇴하는 셈이다. 그래서
// 이 백필을 pb_hooks 로직 배포보다 반드시 먼저 끝내야 한다.
//
// 안전을 위해 이 마이그레이션은 평문 e164는 지우지 않는다(그건 별도
// 후속 정리 마이그레이션에서, 이 백필 결과를 충분히 확인한 뒤에 한다 —
// 계산이 잘못됐을 때 원본에서 다시 계산할 수 있는 여지를 남겨둔다).
// 이미 e164_hash가 채워진 레코드(이 마이그레이션이 이미 처리했거나,
// 배포 이후 새로 가입한 사람)는 건너뛴다 — 재실행해도 안전(idempotent).
migrate((db) => {
  const dao = new Dao(db);

  const secret = $os.getenv("PHONE_VERIFY_SECRET");
  const encKey = $os.getenv("PHONE_ENC_KEY");
  if (!secret) {
    throw new Error("PHONE_VERIFY_SECRET 미설정 — 백필을 진행할 수 없습니다. 먼저 환경변수를 설정하세요.");
  }
  if (!encKey || encKey.length !== 32) {
    throw new Error("PHONE_ENC_KEY 미설정/형식 오류(정확히 32자여야 함) — 백필을 진행할 수 없습니다.");
  }

  const BATCH_SIZE = 500;
  let offset = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (;;) {
    // e164가 있고 아직 e164_hash가 비어있는 레코드만 — 이미 처리된
    // 레코드는 매 페이지에서 자연히 빠지므로 offset을 0으로 고정해도
    // 안전하다(처리할수록 조건에 안 맞게 되어 다음 배치로 밀려남).
    const batch = dao.findRecordsByFilter(
      "profiles",
      "e164 != '' && e164_hash = ''",
      "",
      BATCH_SIZE,
      0
    );
    if (batch.length === 0) break;

    for (const record of batch) {
      const e164 = record.getString("e164");
      if (!e164) { totalSkipped++; continue; }

      try {
        // onRecordBeforeCreateRequest(main.pb.js)와 완전히 동일한
        // 알고리즘/도메인 접두어 — 다르면 새 가입자와 기존 가입자의
        // 해시가 어긋나 서로 못 찾는다.
        const e164Hash  = $security.hs256("e164-lookup:" + e164, secret);
        const e164Enc   = $security.encrypt(e164, encKey);
        const e164Last8 = e164.slice(-8);

        record.set("e164_hash", e164Hash);
        record.set("e164_enc", e164Enc);
        record.set("e164_last8", e164Last8);
        // 평문 e164는 의도적으로 유지 — 별도 정리 마이그레이션에서 처리.

        dao.saveRecord(record);
        totalProcessed++;
      } catch (err) {
        totalFailed++;
        console.log(`[E164-BACKFILL] guid=${record.getString("guid")} 실패(건너뜀): ${err.message}`);
      }
    }

    offset += BATCH_SIZE; // 안전망 — 위 filter 특성상 실제로는 안 늘어도 무방하지만 무한루프 방지
    if (offset > 2000000) {
      throw new Error("백필이 예상보다 훨씬 많은 레코드를 처리하고 있습니다 — 안전을 위해 중단합니다. 수동 확인 필요.");
    }
  }

  console.log(`[E164-BACKFILL] 완료 — 처리 ${totalProcessed}건, 스킵 ${totalSkipped}건, 실패 ${totalFailed}건`);
}, (db) => {
  // 되돌리기 — 평문 e164는 애초에 안 건드렸으니 그대로 두고, 이
  // 마이그레이션이 채운 세 필드만 비운다(정보 손실 없음 — e164가
  // 그대로 있으니 언제든 다시 계산 가능).
  const dao = new Dao(db);
  const BATCH_SIZE = 500;
  for (;;) {
    const batch = dao.findRecordsByFilter(
      "profiles",
      "e164 != '' && e164_hash != ''",
      "",
      BATCH_SIZE,
      0
    );
    if (batch.length === 0) break;
    for (const record of batch) {
      record.set("e164_hash", "");
      record.set("e164_enc", "");
      record.set("e164_last8", "");
      dao.saveRecord(record);
    }
  }
});
