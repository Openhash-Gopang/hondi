-- ============================================================
-- 나비 Profile 2.0 Phase 0 마이그레이션
-- gopang_jeju_design_v1.3 기준
-- 실행 순서: Supabase SQL Editor에서 전체 붙여넣기 후 Run
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. user_profiles 위치 컬럼 추가
-- ─────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS lat             NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS lng             NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS geo_updated_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_profiles_geo
  ON user_profiles (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL AND is_public = true;

-- ─────────────────────────────────────────────
-- 2. location_log consent 컬럼 추가 (BUG-M4)
-- ─────────────────────────────────────────────
ALTER TABLE location_log
  ADD COLUMN IF NOT EXISTS consent BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────
-- 3. user_llm_keys
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_llm_keys (
  guid          TEXT PRIMARY KEY,
  provider      TEXT NOT NULL CHECK (provider IN
                  ('anthropic','openai','deepseek','custom')),
  api_key_enc   TEXT NOT NULL,
  model         TEXT,
  custom_prompt TEXT,
  ai_active     BOOLEAN DEFAULT true,
  native_lang   TEXT DEFAULT 'ko',
  escalate_to   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 4. ai_sessions
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_sessions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  caller_guid   TEXT NOT NULL,
  caller_lang   TEXT NOT NULL DEFAULT 'ko',
  target_guid   TEXT NOT NULL,
  target_lang   TEXT NOT NULL DEFAULT 'ko',
  mode          TEXT NOT NULL DEFAULT 'ai'
                  CHECK (mode IN ('ai','human','escalated')),
  session_type  TEXT CHECK (session_type IN
                  ('consult','reserve','order','general')),
  messages      JSONB DEFAULT '[]',
  is_active     BOOLEAN DEFAULT true,
  escalated_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_caller
  ON ai_sessions (caller_guid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_target
  ON ai_sessions (target_guid, is_active);

ALTER TABLE ai_sessions REPLICA IDENTITY FULL;

-- ─────────────────────────────────────────────
-- 5. messages
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id         UUID REFERENCES ai_sessions(id) ON DELETE CASCADE,
  sender_guid        TEXT NOT NULL,
  receiver_guid      TEXT NOT NULL,
  content_original   TEXT,
  content_translated TEXT,
  lang_from          TEXT,
  lang_to            TEXT,
  content_type       TEXT DEFAULT 'text'
                     CHECK (content_type IN
                       ('text','voice','image','order','reserve')),
  voice_url          TEXT,
  is_read            BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session
  ON messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_receiver
  ON messages (receiver_guid, is_read);

ALTER TABLE messages REPLICA IDENTITY FULL;

-- ─────────────────────────────────────────────
-- 6. profile_reviews (reviewer_lang 포함)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_reviews (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  target_guid     TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('org','institution')),
  reviewer_guid   TEXT NOT NULL,
  tx_id           TEXT NOT NULL,
  rating          INTEGER CHECK (rating BETWEEN 1 AND 5),
  body            TEXT,
  body_translated TEXT,
  body_lang       TEXT,
  reviewer_lang   TEXT DEFAULT 'ko',
  is_visible      BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (target_guid, reviewer_guid, tx_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_reviews_target
  ON profile_reviews (target_guid, reviewer_lang, created_at DESC);

-- 국적별 평점 집계 View
CREATE OR REPLACE VIEW profile_review_stats AS
SELECT
  target_guid,
  reviewer_lang,
  count(*)                              AS review_count,
  round(avg(rating)::numeric, 1)        AS avg_rating,
  count(*) FILTER (WHERE rating = 5)    AS five_star,
  count(*) FILTER (WHERE rating = 1)    AS one_star
FROM profile_reviews
WHERE is_visible = true
GROUP BY target_guid, reviewer_lang;

-- ─────────────────────────────────────────────
-- 7. community_posts
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_posts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  author_guid   TEXT NOT NULL,
  lang          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN (
                  'help','info','lost_found',
                  'companion','emergency','general')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  body_translated TEXT,
  lat           NUMERIC(10,7),
  lng           NUMERIC(10,7),
  location_name TEXT,
  is_resolved   BOOLEAN DEFAULT false,
  reply_count   INTEGER DEFAULT 0,
  is_visible    BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_lang_cat
  ON community_posts (lang, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_location
  ON community_posts (lat, lng)
  WHERE lat IS NOT NULL;

ALTER TABLE community_posts REPLICA IDENTITY FULL;

-- ─────────────────────────────────────────────
-- 8. community_replies
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_replies (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id         UUID REFERENCES community_posts(id) ON DELETE CASCADE,
  author_guid     TEXT NOT NULL,
  body            TEXT NOT NULL,
  body_translated TEXT,
  is_helpful      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_replies_post
  ON community_replies (post_id, created_at);

-- ─────────────────────────────────────────────
-- 9. heatmap_by_lang RPC
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION heatmap_by_lang(
  p_lang TEXT,
  p_days INTEGER DEFAULT 7
) RETURNS TABLE (
  grid_lat    NUMERIC,
  grid_lng    NUMERIC,
  visit_count BIGINT
) AS $$
SELECT
  round(l.lat::numeric, 2) AS grid_lat,
  round(l.lng::numeric, 2) AS grid_lng,
  count(*)                 AS visit_count
FROM location_log l
JOIN user_profiles u ON l.guid = u.guid
WHERE (p_lang = 'all' OR u.native_lang = p_lang)
  AND l.consent = true
  AND l.recorded_at > now() - make_interval(days => p_days)
GROUP BY 1, 2
HAVING count(*) >= 5
ORDER BY 3 DESC;
$$ LANGUAGE sql STABLE;

-- ─────────────────────────────────────────────
-- 완료 확인
-- ─────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name='user_profiles' AND column_name='lat')    AS up_lat_ok,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name='location_log' AND column_name='consent') AS ll_consent_ok,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name='user_llm_keys')                          AS llm_keys_ok,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name='ai_sessions')                            AS ai_sessions_ok,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name='messages')                               AS messages_ok,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name='profile_reviews')                        AS pr_ok,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name='community_posts')                        AS cp_ok,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name='community_replies')                      AS cr_ok;
-- 모든 컬럼이 1 이면 Phase 0 완료
