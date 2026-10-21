/**
 * expert-counsel.test.mjs — 교육·복지 상담형 10개 직역 「단계별 상담」(STEP K) 정적 검사 (2026-10-21)
 * 확인하는 것: SP 에 STEP K(K-0~K-7)와 상태 줄이 있고 STEP D 뒤·다음 절 앞에 위치 · STEP K/머리 주석/끝 줄을 걷어내면 원래 SP 와 바이트 단위로 같음(위기 대응·한계 불변) ·
 * 상담 화면이 10개 직역을 알고 상태 줄 형식이 SP 와 일치 · expert-chat 의 진입 링크가 있고 상담형은 전문가 인증 목록에 없음. (실제 대화·로그인은 브라우저가 필요해 범위 밖)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const catalog = JSON.parse(read('prompts/sp-catalog.json'));
// [id, 상태 줄 이름, 파일(제자리 수정 — 파일명·버전 불변), STEP K 추가 전 본문(끝 줄바꿈 제외)의 sha256]
const JOBS = [
  ['teacher', '교사 AI', 'SP_teacher_v3_3.md', '280c082019d40e259323719177760798a04710275e77325d77e472355f17166a'],
  ['school-counselor', '전문상담교사 AI', 'SP_school-counselor_v3_3.md', '75cc6dd8950011adeffd792ef6a81d89ecabbda8a4477a8b978c8391f1fa0e2a'],
  ['clinical-psychologist', '임상심리사 AI', 'SP_clinical-psychologist_v3_4.md', '82dbd53520334b6ab17dea54d2ab6039d9b3cf04c92bc0bb76daabb8a3328b13'],
  ['mental-health-professional', '정신건강전문요원 AI', 'SP_mental-health-professional_v3_3.md', '4bed044a94d78d25831a6bde636ce1bfc6a58bb398702bfe0866b1ae2bf81246'],
  ['social-worker', '사회복지사 AI', 'SP_social-worker_v2_1.md', '39ca5824b7f4648776791e2da50abc0c8733a335f0811fd1a0cdebb3735a8173'],
  ['curator', '학예사 AI', 'SP_curator_v3_3.md', '526edb881e5a75ae5c2fd6ffce668b928e6a9bcd59bac95312b2eba4db42b4d8'],
  ['librarian', '사서 AI', 'SP_librarian_v3_3.md', 'bbfc0f59883dab8e2fe9aa2887d43a88ec4d93373a10e17b65c4e0d80509909f'],
  ['youth-counselor', '청소년상담사 AI', 'SP_youth-counselor_v1_8.md', '86b6b321152746457c7a1fe6d66ee7904fd88683ea8eb57dd5f411c0c02c9414'],
  ['childcare-teacher', '보육교사 AI', 'SP_childcare-teacher_v1_8.md', '5267ea55f6ef4c5b7128d646edd404b85aeb9502309bf90a1742b65fff665c2d'],
  ['lifelong-educator', '평생교육사 AI', 'SP_lifelong-educator_v1_8.md', 'e0a4906eaa9347f41fb5d7e0cb9bb95697ad8c515db8590a19d7312577f6dbd0'],
];
const js = read('assets/expert-counsel.js');
const html = read('pages/expert-counsel.html');
const chat = read('pages/expert-chat.html');

function stripK(sp) {
  const lines = sp.split('\n');
  assert.ok(lines[1].startsWith('> 2026-10-21 상담 진행 트랙(STEP K) 추가'), '머리 주석');
  lines.splice(1, 1);
  const a = lines.findIndex((l) => l.startsWith('## STEP K — 상담 진행 트랙'));
  assert.ok(a > 0);
  let b = a + 1;
  while (!lines[b].startsWith('## ')) b++;
  lines.splice(a, b - a);
  let s = lines.join('\n').replace(/\n+\*STEP K 상담 진행 트랙 추가 \(2026-10-21[^\n]*\*\n*$/, '');
  return s.replace(/\n+$/, '');
}

for (const [pid, label, file, sha] of JOBS) {
  describe(`${label} 단계별 상담 (${pid})`, () => {
    const sp = read('prompts/' + file);
    it('카탈로그가 이 SP 파일을 가리키고 STEP K 가 한 번만 있다', () => {
      assert.equal(catalog[`SP_${pid}`], file);
      assert.equal((sp.match(/^## STEP K — 상담 진행 트랙/gm) || []).length, 1);
    });
    it('K-0~K-7 절과 상태 줄 형식이 있고 STEP D 뒤에 위치한다', () => {
      for (let n = 0; n <= 7; n++) assert.ok(new RegExp(`^### K-${n}\\. `, 'm').test(sp), `K-${n} 절`);
      assert.ok(sp.includes(`[${label} | 상담 진행 트랙 | 현재: K-n |`));
      const at = (re) => sp.search(re);
      assert.ok(at(/^## STEP D /m) < at(/^## STEP K — /m));
      assert.ok(at(/^## STEP K — /m) < at(/^## (도메인 특유 환각 위험 및 )?Tier 테이블/m));
    });
    it('위기 신호 시 멈춘다는 규칙과 조회·미확인 규칙이 있다', () => {
      const k = sp.slice(sp.search(/^## STEP K — /m));
      assert.ok(/### K-1\. 안전 확인[\s\S]*트랙을 멈추고 안전 안내만 한다/.test(k));
      assert.ok(k.includes('[WEB_SEARCH: query=') && k.includes('[미확인]'));
      assert.ok(k.includes('결정·신청·신고를 하지 않는다'));
    });
    it('STEP K 를 걷어내면 원래 SP 와 같다(위기 대응·한계 규정 불변)', () => {
      assert.equal(createHash('sha256').update(stripK(sp), 'utf8').digest('hex'), sha);
    });
    it('상담 화면이 이 직역을 알고 선택 목록에 있다', () => {
      assert.ok(js.includes(`'${pid}': {`) && js.includes(`tool: '${label}'`));
      assert.ok(html.includes(`expert-counsel.html?persona=${pid}"`));
      assert.ok(chat.includes(`'${pid}'`));
    });
  });
}

describe('상담 화면·진입 링크', () => {
  it('상태 줄 읽기 정규식이 SP 의 형식과 맞는다', () => {
    assert.ok(js.includes('상담 진행 트랙\\s*\\|\\s*현재:\\s*K-([1-7])'));
  });
  it('상담형은 전문가 인증(_PRO_WRITE_PERSONAS) 목록에 없고 진입 링크 집합에는 10개 모두 있다', () => {
    const pro = /const _PRO_WRITE_PERSONAS = new Set\(\[([\s\S]*?)\]\);/.exec(chat);
    const cs = /const _COUNSEL_PERSONAS = new Set\(\[([\s\S]*?)\]\);/.exec(chat);
    assert.ok(pro && cs);
    for (const [pid] of JOBS) {
      assert.ok(!pro[1].includes(`'${pid}'`), `${pid} 가 전문가 인증 목록에 있음`);
      assert.ok(cs[1].includes(`'${pid}'`));
    }
  });
  it('직역 지정이 없으면 선택 화면을 보인다', () => {
    assert.ok(html.includes('id="chooser"') && js.includes("$('chooser').hidden = false"));
  });
});
