-- ============================================================
-- search_index.sql — 나비 프로필 검색 엔진
-- 저장위치: gopang/sql/search_index.sql
-- 실행: Supabase SQL Editor
-- ============================================================

-- ── 1. 컬럼 추가 ────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS search_text   TEXT,
  ADD COLUMN IF NOT EXISTS search_tags   TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;  -- 자동 갱신 (트리거)

-- ── 2. tsvector 인덱스 (GIN — 전문검색 최적화) ──────────────
CREATE INDEX IF NOT EXISTS idx_user_profiles_search_vector
  ON user_profiles USING GIN (search_vector);

-- 태그 배열 인덱스 (GIN)
CREATE INDEX IF NOT EXISTS idx_user_profiles_search_tags
  ON user_profiles USING GIN (search_tags);

-- entity_type + is_public 복합 인덱스 (필터 검색용)
CREATE INDEX IF NOT EXISTS idx_user_profiles_type_public
  ON user_profiles (entity_type, is_public)
  WHERE is_public = TRUE;

-- ── 3. search_vector 자동 갱신 트리거 ───────────────────────
-- search_text가 갱신될 때마다 tsvector 자동 재계산
-- 가중치:
--   'A' (최고) : name, handle
--   'B' (높음) : search_tags
--   'C' (보통) : description / purpose
--   'D' (낮음) : address, entity_type

CREATE OR REPLACE FUNCTION fn_update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    -- name/handle: 가중치 A (가장 중요)
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.handle, '')), 'A') ||

    -- tags: 가중치 B
    setweight(
      to_tsvector('simple',
        coalesce(array_to_string(NEW.search_tags, ' '), '')),
    'B') ||

    -- search_text 전체 (소개, 상품, 커스텀필드 등): 가중치 C
    setweight(to_tsvector('simple', coalesce(NEW.search_text, '')), 'C') ||

    -- 주소, 유형: 가중치 D
    setweight(to_tsvector('simple', coalesce(NEW.address, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(NEW.entity_type, '')), 'D');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 기존 트리거 제거 후 재생성
DROP TRIGGER IF EXISTS trg_update_search_vector ON user_profiles;

CREATE TRIGGER trg_update_search_vector
  BEFORE INSERT OR UPDATE OF
    name, handle, search_text, search_tags, address, entity_type
  ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_search_vector();

-- ── 4. 기존 데이터 search_vector 일괄 갱신 ──────────────────
UPDATE user_profiles SET search_text = search_text;  -- 트리거 발동

-- ── 5. 검색 RPC (search_entities) ───────────────────────────
-- POST /search → Worker → Supabase RPC 호출
-- 파라미터:
--   q         TEXT    — 검색어
--   etype     TEXT    — entity_type 필터 (NULL=전체)
--   lat       FLOAT8  — 위치 기반 정렬용 (선택)
--   lng       FLOAT8  — 위치 기반 정렬용 (선택)
--   lim       INT     — 결과 수 (기본 20)
--   ofst      INT     — 페이징 오프셋 (기본 0)

CREATE OR REPLACE FUNCTION search_entities(
  q      TEXT    DEFAULT '',
  etype  TEXT    DEFAULT NULL,
  lat    FLOAT8  DEFAULT NULL,
  lng    FLOAT8  DEFAULT NULL,
  lim    INT     DEFAULT 20,
  ofst   INT     DEFAULT 0
)
RETURNS TABLE (
  guid        TEXT,
  name        TEXT,
  handle      TEXT,
  entity_type TEXT,
  address     TEXT,
  search_tags TEXT[],
  phone       TEXT,
  website     TEXT,
  extra       JSONB,
  rank        REAL,
  distance_km FLOAT8
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tsq TSQUERY;
BEGIN
  -- 빈 검색어 처리: 전체 공개 프로필 반환
  IF q IS NULL OR trim(q) = '' THEN
    RETURN QUERY
      SELECT
        p.guid, p.name, p.handle, p.entity_type,
        p.address, p.search_tags, p.phone, p.website, p.extra,
        1.0::REAL AS rank,
        CASE
          WHEN lat IS NOT NULL AND lng IS NOT NULL AND p.lat IS NOT NULL AND p.lng IS NOT NULL
          THEN (point(lng, lat) <@> point(p.lng, p.lat)) * 1.60934
          ELSE NULL
        END AS distance_km
      FROM user_profiles p
      WHERE p.is_public = TRUE
        AND (etype IS NULL OR p.entity_type = etype OR (etype IN ('institution','org','platform') AND p.extra #>> '{public,identity,entity_subtype}' = etype))
      ORDER BY p.updated_at DESC
      LIMIT lim OFFSET ofst;
    RETURN;
  END IF;

  -- 검색어 → tsquery 변환 (한국어 + 영어 모두 simple 사전)
  -- 복수 단어: 각 단어 OR 검색 후 순위로 정렬
  tsq := websearch_to_tsquery('simple', q);

  RETURN QUERY
    SELECT
      p.guid, p.name, p.handle, p.entity_type,
      p.address, p.search_tags, p.phone, p.website, p.extra,
      -- 관련도 점수 (가중치 A>B>C>D 반영)
      ts_rank_cd(p.search_vector, tsq, 32)::REAL AS rank,
      -- 거리 (km) — lat/lng 있을 때만 계산
      CASE
        WHEN lat IS NOT NULL AND lng IS NOT NULL AND p.lat IS NOT NULL AND p.lng IS NOT NULL
        THEN (point(lng, lat) <@> point(p.lng, p.lat)) * 1.60934
        ELSE NULL
      END AS distance_km
    FROM user_profiles p
    WHERE p.is_public = TRUE
      AND p.search_vector @@ tsq
      AND (etype IS NULL OR p.entity_type = etype OR (etype IN ('institution','org','platform') AND p.extra #>> '{public,identity,entity_subtype}' = etype))
    ORDER BY
      rank DESC,
      distance_km ASC NULLS LAST
    LIMIT lim OFFSET ofst;
END;
$$;

-- ── 6. 태그 전용 검색 RPC ────────────────────────────────────
-- 정확한 태그 매칭 (검색 태그 인덱스 활용)
CREATE OR REPLACE FUNCTION search_by_tags(
  tags   TEXT[],
  etype  TEXT   DEFAULT NULL,
  lim    INT    DEFAULT 20,
  ofst   INT    DEFAULT 0
)
RETURNS TABLE (
  guid        TEXT,
  name        TEXT,
  handle      TEXT,
  entity_type TEXT,
  search_tags TEXT[],
  address     TEXT,
  extra       JSONB
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.guid, p.name, p.handle, p.entity_type,
    p.search_tags, p.address, p.extra
  FROM user_profiles p
  WHERE p.is_public = TRUE
    AND p.search_tags && tags          -- 배열 교집합 (하나라도 일치)
    AND (etype IS NULL OR p.entity_type = etype OR (etype IN ('institution','org','platform') AND p.extra #>> '{public,identity,entity_subtype}' = etype))
  ORDER BY p.updated_at DESC
  LIMIT lim OFFSET ofst;
$$;

-- ── 7. 완료 확인 ─────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'user_profiles'
   AND column_name = 'search_text')          AS search_text_ok,

  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'user_profiles'
   AND column_name = 'search_tags')          AS search_tags_ok,

  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'user_profiles'
   AND column_name = 'search_vector')        AS search_vector_ok,

  (SELECT count(*) FROM pg_indexes
   WHERE tablename = 'user_profiles'
   AND indexname = 'idx_user_profiles_search_vector') AS gin_idx_ok,

  (SELECT count(*) FROM pg_proc
   WHERE proname = 'search_entities')        AS rpc_ok;

-- 모두 1 이면 완료
