-- =========================================
-- K-Law Supabase Schema v1.0
-- klaw_simulations table
-- =========================================

create table if not exists public.klaw_simulations (
  id            text primary key,          -- SIM-2026-XXXX
  created_at    timestamptz not null default now(),
  
  -- 사건 기본 정보
  case_type     text not null,             -- 민사 | 형사 | 가사 | 행정 | 헌법 | 국제 | 노동 | 지재 | 세무 | 기타
  case_subtype  text,                      -- 계약분쟁 | 손해배상 | 이혼 | 행정처분 취소 ...
  case_summary  text not null,             -- 사건 요약 (사용자 입력)
  
  -- 요청 메타
  reporter      text,                      -- gopang user token
  source        text default 'webapp',     -- webapp | gopang | api
  
  -- K-Law 판결 시뮬레이션 결과
  verdict       text,                      -- 원고승 | 피고승 | 일부인용 | 기각 | 각하 | 화해권고
  verdict_prob  numeric(5,2),             -- 승소 확률 0~100
  damages       bigint,                   -- 인용 금액 (원)
  sentence      text,                     -- 형사: 징역 X년, 벌금 Y만원 등
  
  -- 법적 분석
  key_issues    jsonb,                    -- ["쟁점1", "쟁점2", ...]
  applicable_laws jsonb,                  -- [{"law":"민법 제750조","desc":"불법행위"}, ...]
  precedents    jsonb,                    -- [{"case":"대법원 2020다12345","summary":"..."}, ...]
  reasoning     text,                     -- 판결 이유 전문
  
  -- 위험도 / 신뢰도
  risk_level    text,                     -- LOW | MED | HIGH | CRITICAL
  confidence    numeric(5,2),            -- K-Law 신뢰도 0~100
  
  -- 처리 상태
  status        text default '완료',      -- 처리중 | 완료 | 오류
  
  -- 전체 분석 JSON (DeepSeek raw output)
  analysis      jsonb
);

-- 인덱스
create index if not exists klaw_sim_case_type on public.klaw_simulations(case_type);
create index if not exists klaw_sim_created_at on public.klaw_simulations(created_at desc);
create index if not exists klaw_sim_verdict on public.klaw_simulations(verdict);
create index if not exists klaw_sim_risk on public.klaw_simulations(risk_level);

-- RLS: 읽기 공개, 쓰기는 서버(anon key + API 경유)
alter table public.klaw_simulations enable row level security;

create policy "read_all" on public.klaw_simulations
  for select using (true);

create policy "insert_anon" on public.klaw_simulations
  for insert with check (true);
