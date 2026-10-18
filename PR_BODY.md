## Summary
- HANDOFF_2026-09-19_jeju-sp-quality-evaluation.md §4의 1단계(LLM 비평가 스크리닝) 구현
- content_quality_live_smoketest.py: 생성+비평 2회 호출, 4축 판정, PASS/NEEDS-REVIEW 2상태
- select_content_quality_sample.py: NEEDS-REVIEW 전수 + 카테고리별 무작위 표본 → 사람 검토용 체크리스트
- .github/workflows/live-smoketest-content-quality-govtree.yml: 기존 govtree 워크플로 재사용, 결과 브랜치 분리

## Test plan
- [ ] `workflow_dispatch`로 part1of5 먼저 돌려 API 호출/파싱 확인
- [ ] 성공하면 나머지 4개 파트 순차 실행(결과 브랜치 force-push라 배치별 `gh run download` 백업 권장)
- [ ] `human_review_sample.md`로 2단계 사람 표본 검토 진행

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019KnjxGYJDvibH9ELbCjxtg
