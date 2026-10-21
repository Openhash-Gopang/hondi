// 2026-10-21 문서 등록 패치: admin.html 「사업 계획」 목록에 사업 계획 요약 v6 링크, desktop.html 🛠 개발자 문서 메뉴에 이 날의 세션 기록 등록.
// 앵커 기준 제자리 삽입(멱등). 사용: node scripts/apply-docs-register-patch.mjs  (저장소 루트에서)
import fs from 'node:fs';
function patch(file, marker, anchor, text) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes(marker)) { console.log(`${file}: 이미 적용됨`); return; }
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error(`${file}: 앵커가 ${n}번 나타남(1번이어야 함): ${anchor.slice(0, 80)}`); process.exit(1); }
  fs.writeFileSync(file, s.replace(anchor, () => text + anchor));
  console.log(`${file}: 적용 완료`);
}
patch('admin.html', 'consortium-business-plan-summary-v6.md',
  '              <li><strong>나비 컨소시엄 전체 문서 (요약·검토 요청서',
  '              <li><strong>나비 컨소시엄 사업 계획 요약 v6 (구독 부활·직역별 단계 개시·환불·개인정보 리스크 반영, 초안, 2026-10-21)</strong> — <a href="./docs/business-plan/consortium/consortium-business-plan-summary-v6.md" target="_blank" rel="noopener">MD ↗</a></li>\n');
patch('desktop.html', 'SESSION_SUMMARY_PRO_VERIFY_SUBSCRIPTION_REVIEW_20261021',
  '{"icon": "", "label": "세션 기록 — 전문가용 보조 AI SP 이분화·작성 문서 목록 개편',
  '{"icon": "", "label": "세션 기록 — 전문가 면허 인증·서버 게이트·구독·법무사/행정사 SP 분리·검수 패키지, 배포 순서·한계 (2026-10-21) ↗", "href": "./docs/SESSION_SUMMARY_PRO_VERIFY_SUBSCRIPTION_REVIEW_20261021_v1_0.md"}, ');
