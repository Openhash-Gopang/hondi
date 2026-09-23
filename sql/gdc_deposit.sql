-- ============================================================
-- gdc_deposit.sql — GDC 입금·발행 + UTXO 하이브리드 RPC
-- 저장위치: gopang/sql/gdc_deposit.sql
-- 버전: v2.0 (UTXO 하이브리드 — 사고 실험 결론 반영)
-- 실행: Supabase SQL Editor
--
-- 설계 원칙:
--   Layer 1 (즉시): UTXO spent 원자 업데이트 → 이중지불 즉시 차단
--   Layer 2 (실시간): prev_settle_hash = 마지막 UTXO entryHash → 발행 순서
--   Layer 3 (주기): K-Tax fs_ledger 감사 → IASB 회계 정합성
--   Layer 4 (영속): OpenHash Merkle Anchor → 위변조 감사 증적
--
-- IASB 복식부기 (GDC 발행):
--   차변 bs-cash (자산↑)    = 발행 GDC
--   대변 pl-revenue (수익↑) = On-demand Issuance 수익
--
-- UTXO 적용 범위:
--   ₮1,000 이상 거래 → UTXO (보안 강화)
--   ₮1,000 미만     → fs-cash 집계 (효율 우선)
--   GDC 발행        → 항상 UTXO 생성 (추적 기반)
-- ============================================================

-- ── 1. gdc_utxo 테이블 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS gdc_utxo (
  -- 식별
  utxo_id       TEXT PRIMARY KEY,          -- SHA-256(tx_id ∥ output_index)
  tx_id         TEXT NOT NULL,             -- 생성 트랜잭션 ID
  output_index  INT  NOT NULL DEFAULT 0,   -- 동일 TX 내 출력 순번

  -- 소유권
  owner_guid    TEXT NOT NULL,             -- 소유자 IPv6 GUID
  amount        NUMERIC(20,6) NOT NULL,    -- GDC 금액
  sig           TEXT,                      -- Ed25519(owner.privKey, utxo_id) — 클라이언트 생성

  -- 상태
  spent         BOOLEAN NOT NULL DEFAULT FALSE,
  spent_tx_id   TEXT,                      -- 소비한 TX ID (spent=true 시)
  spent_at      TIMESTAMPTZ,

  -- OpenHash 연결
  entry_hash    TEXT,                      -- OpenHash anchor entryHash
  prev_hash     TEXT,                      -- 이전 체인 연결 (이중발행 방지)
  block_height  BIGINT,

  -- 메타
  utxo_type     TEXT DEFAULT 'transfer',   -- 'deposit'|'transfer'|'change'|'withdraw'
  memo          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_utxo_owner_unspent
  ON gdc_utxo (owner_guid, spent, created_at DESC)
  WHERE spent = FALSE;                     -- 미소비 UTXO 조회 최적화

CREATE INDEX IF NOT EXISTS idx_utxo_tx
  ON gdc_utxo (tx_id);

CREATE INDEX IF NOT EXISTS idx_utxo_spent_tx
  ON gdc_utxo (spent_tx_id)
  WHERE spent = TRUE;

-- ── 2. fs_ledger 테이블 (K-Tax 감사 경로) ────────────────────
CREATE TABLE IF NOT EXISTS fs_ledger (
  id              BIGSERIAL PRIMARY KEY,
  tx_id           TEXT UNIQUE NOT NULL,
  guid            TEXT NOT NULL,
  tx_type         TEXT NOT NULL,           -- 'gdc_deposit'|'gdc_withdraw'|'purchase'|...
  debit_account   TEXT,                    -- 차변 계정 (bs-cash 등)
  debit_amount    NUMERIC(20,6) DEFAULT 0,
  credit_account  TEXT,                    -- 대변 계정 (pl-revenue 등)
  credit_amount   NUMERIC(20,6) DEFAULT 0,
  krw_amount      NUMERIC(20,2) DEFAULT 0,
  gdc_amount      NUMERIC(20,6) DEFAULT 0,
  block_hash      TEXT,                    -- OpenHash entryHash
  prev_hash       TEXT,
  bank_ref        TEXT,                    -- 가상계좌 참조번호
  journal_entry   JSONB,                   -- IASB 분개 전문
  utxo_ids        TEXT[],                  -- 관련 UTXO ID 배열
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fs_ledger_guid
  ON fs_ledger (guid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fs_ledger_type
  ON fs_ledger (tx_type, created_at DESC);

-- ── 3. gdc_deposit RPC — 입금 → UTXO 생성 → 발행 ────────────
--
-- 호출: Worker /gdc/deposit
-- 원자성: BEGIN~COMMIT 내에서 UTXO 생성 + fs 갱신 동시 처리
-- 이중발행 방지: tx_id UNIQUE 제약 → 동일 TX 재실행 불가

DROP FUNCTION IF EXISTS gdc_deposit(TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION gdc_deposit(
  p_guid          TEXT,        -- 사용자 IPv6 GUID
  p_krw_amount    NUMERIC,     -- 입금 KRW 금액
  p_gdc_amount    NUMERIC,     -- 발행 GDC (= p_krw_amount / 1000)
  p_tx_id         TEXT,        -- SHA-256(guid ∥ krw ∥ timestamp ∥ nonce)
  p_entry_hash    TEXT,        -- OpenHash anchor entryHash
  p_prev_hash     TEXT,        -- 이전 UTXO entryHash (체인 연속성)
  p_bank_ref      TEXT,        -- 가상계좌 참조번호
  p_sig           TEXT         -- Ed25519(owner.privKey, tx_id) — 클라이언트 생성
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_utxo_id     TEXT;
  v_extra       JSONB;
  v_pub         JSONB;
  v_finance     JSONB;
  v_fs          JSONB;
  v_new_cash    NUMERIC;
  v_new_revenue NUMERIC;
  v_now         TIMESTAMPTZ := NOW();
  v_now_str     TEXT := to_char(v_now AT TIME ZONE 'Asia/Seoul',
                          'YYYY-MM-DD"T"HH24:MI:SS+09:00');
  v_block_h     BIGINT := EXTRACT(EPOCH FROM v_now)::BIGINT;
BEGIN
  -- ── A. 이중발행 방지 (TX 중복 확인) ─────────────────────────
  IF EXISTS (SELECT 1 FROM fs_ledger WHERE tx_id = p_tx_id) THEN
    RETURN jsonb_build_object(
      'ok', FALSE, 'error', 'DUPLICATE_TX',
      'detail', '이미 처리된 트랜잭션입니다.'
    );
  END IF;

  -- ── B. UTXO ID 생성 ─────────────────────────────────────────
  -- utxo_id = SHA-256(tx_id ∥ "0") — 발행은 단일 출력
  v_utxo_id := encode(
    sha256((p_tx_id || ':0')::BYTEA),
    'hex'
  );

  -- ── C. UTXO 원자 생성 ───────────────────────────────────────
  INSERT INTO gdc_utxo (
    utxo_id, tx_id, output_index,
    owner_guid, amount, sig,
    spent, utxo_type, memo,
    entry_hash, prev_hash, block_height,
    created_at
  ) VALUES (
    v_utxo_id, p_tx_id, 0,
    p_guid, p_gdc_amount, p_sig,
    FALSE, 'deposit',
    'GDC 발행 — KRW ' || p_krw_amount::TEXT || '원 입금',
    p_entry_hash, p_prev_hash, v_block_h,
    v_now
  );
  -- UNIQUE 제약 위반 시 자동 롤백 → 이중발행 원자 차단

  -- ── D. fs_ledger 기록 (IASB 복식부기) ──────────────────────
  INSERT INTO fs_ledger (
    tx_id, guid, tx_type,
    debit_account, debit_amount,
    credit_account, credit_amount,
    krw_amount, gdc_amount,
    block_hash, prev_hash, bank_ref,
    utxo_ids,
    journal_entry,
    created_at
  ) VALUES (
    p_tx_id, p_guid, 'gdc_deposit',
    -- 차변: bs-cash (자산 증가)
    'bs-cash', p_gdc_amount,
    -- 대변: pl-revenue (On-demand 발행 수익)
    'pl-revenue', p_gdc_amount,
    p_krw_amount, p_gdc_amount,
    p_entry_hash, p_prev_hash, p_bank_ref,
    ARRAY[v_utxo_id],
    jsonb_build_object(
      'standard',  'IASB IAS 38 / IFRS 9',
      'date',       v_now_str,
      'debit',  jsonb_build_array(jsonb_build_object(
        'account', 'bs-cash',
        'label',   '현금 및 현금성자산 (GDC)',
        'amount',   p_gdc_amount,
        'desc',     'GDC 입금 — On-demand Issuance'
      )),
      'credit', jsonb_build_array(jsonb_build_object(
        'account', 'pl-revenue',
        'label',   '영업외수익 — GDC 발행수익',
        'amount',   p_gdc_amount,
        'desc',     'KRW ' || p_krw_amount::TEXT || '원 입금에 의한 GDC 즉시 발행'
      )),
      'utxo',  jsonb_build_object(
        'utxo_id',    v_utxo_id,
        'amount',     p_gdc_amount,
        'entry_hash', p_entry_hash,
        'prev_hash',  p_prev_hash
      )
    ),
    v_now
  );

  -- ── E. user_profiles extra.fs 갱신 ──────────────────────────
  SELECT extra INTO v_extra
  FROM user_profiles WHERE guid = p_guid LIMIT 1;

  v_extra    := COALESCE(v_extra, '{}'::JSONB);
  v_pub      := COALESCE(v_extra->'public', '{}'::JSONB);
  v_finance  := COALESCE(v_pub->'finance', '{}'::JSONB);
  v_fs       := COALESCE(v_finance->'fs', '{}'::JSONB);

  -- IASB 잔액 갱신
  v_new_cash    := COALESCE((v_fs->>'bs-cash')::NUMERIC, 0) + p_gdc_amount;
  v_new_revenue := COALESCE((v_fs->>'pl-revenue')::NUMERIC, 0) + p_gdc_amount;

  v_fs := v_fs || jsonb_build_object(
    'bs-cash',         v_new_cash,
    'pl-revenue',      v_new_revenue,
    'last_tx_id',      p_tx_id,
    'last_block_hash', p_entry_hash,
    'last_prev_hash',  p_prev_hash,
    'last_updated_at', v_now_str,
    'last_tx_type',    'gdc_deposit',
    'last_tx_record',  jsonb_build_object(
      'tx_id',      p_tx_id,
      'type',       'gdc_deposit',
      'krw_amount', p_krw_amount,
      'gdc_amount', p_gdc_amount,
      'bank_ref',   p_bank_ref,
      'utxo_id',    v_utxo_id,
      'block_hash', p_entry_hash,
      'timestamp',  v_now_str
    )::TEXT
  );

  v_finance := v_finance || jsonb_build_object('fs', v_fs);
  v_pub     := v_pub     || jsonb_build_object('finance', v_finance);
  v_extra   := v_extra   || jsonb_build_object('public', v_pub);

  UPDATE user_profiles
  SET extra = v_extra
  WHERE guid = p_guid;

  -- ── F. 결과 반환 ─────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',            TRUE,
    'tx_id',         p_tx_id,
    'utxo_id',       v_utxo_id,
    'gdc_issued',    p_gdc_amount,
    'krw_deposited', p_krw_amount,
    'new_balance',   v_new_cash,
    'entry_hash',    p_entry_hash,
    'prev_hash',     p_prev_hash,
    'block_height',  v_block_h,
    'timestamp',     v_now_str
  );

EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object(
    'ok', FALSE, 'error', 'DUPLICATE_UTXO',
    'detail', '이중발행 시도가 차단되었습니다.'
  );
WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE, 'error', SQLERRM
  );
END;
$$;

-- ── 4. gdc_spend RPC — UTXO 소비 (결제·이체) ────────────────
--
-- SELECT FOR UPDATE NOWAIT → 동시 소비 원자 차단
-- Change UTXO 자동 생성 (잔액 반환)

DROP FUNCTION IF EXISTS gdc_spend(TEXT,TEXT[],JSONB,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION gdc_spend(
  p_spender_guid  TEXT,     -- 지불자 GUID
  p_input_utxos   TEXT[],   -- 소비할 UTXO ID 배열
  p_outputs       JSONB,    -- [{recipient_guid, amount, memo}]
  p_tx_id         TEXT,     -- 거래 TX ID
  p_entry_hash    TEXT,     -- OpenHash entryHash
  p_sig           TEXT      -- Ed25519(spender, tx_id)
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_utxo          RECORD;
  v_total_input   NUMERIC := 0;
  v_total_output  NUMERIC := 0;
  v_output        JSONB;
  v_change        NUMERIC;
  v_new_utxo_id   TEXT;
  v_out_idx       INT := 0;
  v_now           TIMESTAMPTZ := NOW();
  v_now_str       TEXT := to_char(v_now AT TIME ZONE 'Asia/Seoul',
                            'YYYY-MM-DD"T"HH24:MI:SS+09:00');
  v_created_utxos TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- ── A. 이중지불 방지: FOR UPDATE NOWAIT ──────────────────────
  FOR v_utxo IN
    SELECT utxo_id, amount, owner_guid, spent
    FROM gdc_utxo
    WHERE utxo_id = ANY(p_input_utxos)
    FOR UPDATE NOWAIT   -- 다른 TX가 락 보유 시 즉시 실패
  LOOP
    -- 소유권 확인
    IF v_utxo.owner_guid != p_spender_guid THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'NOT_OWNER',
        'utxo_id', v_utxo.utxo_id);
    END IF;
    -- 미소비 확인
    IF v_utxo.spent THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'ALREADY_SPENT',
        'utxo_id', v_utxo.utxo_id);
    END IF;
    v_total_input := v_total_input + v_utxo.amount;
  END LOOP;

  -- 입력 UTXO 개수 확인
  IF array_length(p_input_utxos, 1) IS NULL OR v_total_input = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NO_VALID_INPUTS');
  END IF;

  -- ── B. 출력 합계 계산 ────────────────────────────────────────
  SELECT SUM((value->>'amount')::NUMERIC)
  INTO v_total_output
  FROM jsonb_array_elements(p_outputs) AS value;

  -- BIVM: Σ입력 >= Σ출력
  IF v_total_output > v_total_input THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INSUFFICIENT_FUNDS',
      'input', v_total_input, 'output', v_total_output);
  END IF;

  -- ── C. 입력 UTXO 소비 (원자 처리) ───────────────────────────
  UPDATE gdc_utxo
  SET spent = TRUE, spent_tx_id = p_tx_id, spent_at = v_now
  WHERE utxo_id = ANY(p_input_utxos)
    AND spent = FALSE;

  -- ── D. 출력 UTXO 생성 ────────────────────────────────────────
  FOR v_output IN SELECT * FROM jsonb_array_elements(p_outputs)
  LOOP
    v_new_utxo_id := encode(
      sha256((p_tx_id || ':' || v_out_idx::TEXT)::BYTEA), 'hex'
    );
    INSERT INTO gdc_utxo (
      utxo_id, tx_id, output_index,
      owner_guid, amount,
      spent, utxo_type, memo,
      entry_hash, created_at
    ) VALUES (
      v_new_utxo_id, p_tx_id, v_out_idx,
      v_output->>'recipient_guid',
      (v_output->>'amount')::NUMERIC,
      FALSE, 'transfer',
      COALESCE(v_output->>'memo', ''),
      p_entry_hash, v_now
    );
    v_created_utxos := array_append(v_created_utxos, v_new_utxo_id);
    v_out_idx := v_out_idx + 1;
  END LOOP;

  -- ── E. Change UTXO 생성 (잔액 반환) ─────────────────────────
  v_change := v_total_input - v_total_output;
  IF v_change > 0 THEN
    v_new_utxo_id := encode(
      sha256((p_tx_id || ':change')::BYTEA), 'hex'
    );
    INSERT INTO gdc_utxo (
      utxo_id, tx_id, output_index,
      owner_guid, amount,
      spent, utxo_type, memo,
      entry_hash, created_at
    ) VALUES (
      v_new_utxo_id, p_tx_id, v_out_idx,
      p_spender_guid, v_change,
      FALSE, 'change', '잔액 반환',
      p_entry_hash, v_now
    );
    v_created_utxos := array_append(v_created_utxos, v_new_utxo_id);
  END IF;

  RETURN jsonb_build_object(
    'ok',            TRUE,
    'tx_id',         p_tx_id,
    'total_input',   v_total_input,
    'total_output',  v_total_output,
    'change',        v_change,
    'spent_utxos',   p_input_utxos,
    'created_utxos', v_created_utxos,
    'entry_hash',    p_entry_hash,
    'timestamp',     v_now_str
  );

EXCEPTION
  WHEN lock_not_available THEN
    -- FOR UPDATE NOWAIT 실패 → 이중지불 시도 원자 차단
    RETURN jsonb_build_object(
      'ok', FALSE, 'error', 'DOUBLE_SPEND_BLOCKED',
      'detail', '동시 소비 시도가 원자적으로 차단되었습니다.'
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', SQLERRM);
END;
$$;

-- ── 5. 잔액 조회 함수 (Σ UTXO) ───────────────────────────────
CREATE OR REPLACE FUNCTION gdc_balance(p_guid TEXT)
RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'guid',          p_guid,
    'balance',       COALESCE(SUM(amount), 0),
    'utxo_count',    COUNT(*),
    'largest_utxo',  MAX(amount),
    'smallest_utxo', MIN(amount)
  )
  FROM gdc_utxo
  WHERE owner_guid = p_guid AND spent = FALSE;
$$;

-- ── 6. UTXO Merkle Root 계산 (OpenHash 연동용) ───────────────
-- 미소비 UTXO 집합의 Merkle Root → OpenHash anchor 입력값
CREATE OR REPLACE FUNCTION gdc_utxo_merkle_root(p_guid TEXT)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  WITH ordered AS (
    SELECT utxo_id
    FROM gdc_utxo
    WHERE owner_guid = p_guid AND spent = FALSE
    ORDER BY created_at
  )
  SELECT encode(
    sha256(string_agg(utxo_id, '|' ORDER BY utxo_id)::BYTEA),
    'hex'
  )
  FROM ordered;
$$;

-- ── 7. 완료 확인 ─────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'gdc_utxo')             AS utxo_table_ok,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'fs_ledger')             AS fs_ledger_ok,
  (SELECT count(*) FROM pg_proc
   WHERE proname = 'gdc_deposit')              AS deposit_rpc_ok,
  (SELECT count(*) FROM pg_proc
   WHERE proname = 'gdc_spend')                AS spend_rpc_ok,
  (SELECT count(*) FROM pg_proc
   WHERE proname = 'gdc_balance')              AS balance_rpc_ok,
  (SELECT count(*) FROM pg_proc
   WHERE proname = 'gdc_utxo_merkle_root')     AS merkle_rpc_ok;
-- 모두 1이면 완료
