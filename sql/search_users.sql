-- ============================================================
-- search_users.sql — 나비 사용자/프로필 통합 검색 RPC
-- 저장위치: gopang/sql/search_users.sql
-- 실행: Supabase SQL Editor (search_index.sql 실행 후)
-- ============================================================

-- ── search_users RPC ─────────────────────────────────────────
DROP FUNCTION IF EXISTS search_users(text, integer);

CREATE OR REPLACE FUNCTION search_users(
  q        TEXT    DEFAULT '',
  limit_n  INT     DEFAULT 20
)
RETURNS TABLE (
  guid        TEXT,
  handle      TEXT,
  name        TEXT,
  entity_type TEXT,
  address     TEXT,
  search_tags TEXT[],
  extra       JSONB,
  match_type  TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tsq TSQUERY;
BEGIN
  IF q IS NULL OR trim(q) = '' THEN RETURN; END IF;

  -- 1) handle 정확 매칭
  RETURN QUERY
    SELECT p.guid, p.handle, p.name, p.entity_type,
           p.address, p.search_tags, p.extra,
           'handle_exact'::TEXT
    FROM user_profiles p
    WHERE p.is_public = TRUE
      AND (p.handle = q OR p.handle = '@' || q)
    LIMIT limit_n;

  -- 2) 이름 prefix 매칭
  RETURN QUERY
    SELECT p.guid, p.handle, p.name, p.entity_type,
           p.address, p.search_tags, p.extra,
           'name_prefix'::TEXT
    FROM user_profiles p
    WHERE p.is_public = TRUE
      AND p.name ILIKE q || '%'
      AND NOT (p.handle = q OR p.handle = '@' || q)
    ORDER BY p.name
    LIMIT limit_n;

  -- 3) FTS 전문검색
  BEGIN
    tsq := websearch_to_tsquery('simple', q);
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  RETURN QUERY
    SELECT p.guid, p.handle, p.name, p.entity_type,
           p.address, p.search_tags, p.extra,
           'fts'::TEXT
    FROM user_profiles p
    WHERE p.is_public = TRUE
      AND p.search_vector @@ tsq
      AND NOT (p.handle = q OR p.handle = '@' || q)
      AND NOT p.name ILIKE q || '%'
    ORDER BY ts_rank_cd(p.search_vector, tsq, 32) DESC
    LIMIT limit_n;
END;
$$;

-- ── search_nearby RPC (Haversine 공식 — 확장 불필요) ─────────
DROP FUNCTION IF EXISTS search_nearby(float8, float8, float8, text, integer);

CREATE OR REPLACE FUNCTION search_nearby(
  user_lat   FLOAT8,
  user_lng   FLOAT8,
  radius_km  FLOAT8  DEFAULT 5.0,
  etype      TEXT    DEFAULT NULL,
  lim        INT     DEFAULT 20
)
RETURNS TABLE (
  guid        TEXT,
  handle      TEXT,
  name        TEXT,
  entity_type TEXT,
  address     TEXT,
  search_tags TEXT[],
  phone       TEXT,
  extra       JSONB,
  distance_km FLOAT8
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.guid, p.handle, p.name, p.entity_type,
    p.address, p.search_tags, p.phone, p.extra,
    -- Haversine 공식 (km)
    6371.0 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(p.lat - user_lat) / 2), 2) +
      COS(RADIANS(user_lat)) * COS(RADIANS(p.lat)) *
      POWER(SIN(RADIANS(p.lng - user_lng) / 2), 2)
    )) AS distance_km
  FROM user_profiles p
  WHERE p.is_public = TRUE
    AND p.lat IS NOT NULL
    AND p.lng IS NOT NULL
    AND (etype IS NULL OR p.entity_type = etype)
    -- 반경 필터 (Haversine 재계산)
    AND 6371.0 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(p.lat - user_lat) / 2), 2) +
      COS(RADIANS(user_lat)) * COS(RADIANS(p.lat)) *
      POWER(SIN(RADIANS(p.lng - user_lng) / 2), 2)
    )) <= radius_km
  ORDER BY distance_km ASC
  LIMIT lim;
$$;

-- ── 완료 확인 ─────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_users')    AS search_users_ok,
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_nearby')   AS search_nearby_ok,
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_entities') AS search_entities_ok;
