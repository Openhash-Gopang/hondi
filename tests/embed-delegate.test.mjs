import test from 'node:test';
import assert from 'node:assert/strict';
await import('../embed-delegate.js');
const E = globalThis.EmbedDelegate;
const PARENT = {}; const OTHER = {};
const mk = (opts = {}) => { const sent = []; const d = E.create({ parent: PARENT, post: (m, o) => sent.push([m, o]), ...opts }); return { d, sent }; };
const ev = (data, origin = 'https://mail.hondi.net', source = PARENT) => ({ data, origin, source });

test('위임을 알리기 전에는 보내지 않는다(undefined → 호출자가 기존 처리)', () => {
  const { d, sent } = mk(); assert.equal(d.active(), false); assert.equal(d.send('안녕'), undefined); assert.equal(sent.length, 0);
});
test('호스트가 위임을 알리면 보내고, 응답이 오면 문장을 돌려준다', async () => {
  const { d, sent } = mk(); d.onMessage(ev({ type: 'hondi-embed-host', v: 1, ai: 'delegate' }));
  assert.equal(d.active(), true);
  const p = d.send('신청 사유를 고쳐 줘');
  assert.equal(sent[0][0].type, 'hondi-embed-ai'); assert.equal(sent[0][1], 'https://mail.hondi.net');
  d.onMessage(ev({ type: 'hondi-embed-ai-reply', id: sent[0][0].id, text: '고쳤습니다' }));
  assert.equal(await p, '고쳤습니다');
});
test('부모가 아니거나 허용 출처가 아니면 무시한다', () => {
  const { d } = mk();
  assert.equal(d.onMessage(ev({ type: 'hondi-embed-host', ai: 'delegate' }, 'https://evil.example')), false);
  assert.equal(d.onMessage(ev({ type: 'hondi-embed-host', ai: 'delegate' }, 'https://mail.hondi.net', OTHER)), false);
  assert.equal(d.active(), false);
  d.onMessage(ev({ type: 'hondi-embed-host', ai: 'delegate' }, 'https://naviweb.kr')); assert.equal(d.active(), true);
});
test('위임 해제, 엉뚱한 id 응답 무시, 시간 초과는 null, 길이 제한', async () => {
  const { d, sent } = mk({ waitMs: 20 }); d.onMessage(ev({ type: 'hondi-embed-host', ai: 'delegate' }));
  const p = d.send('x'.repeat(5000)); assert.equal(sent[0][0].text.length, 2000);
  d.onMessage(ev({ type: 'hondi-embed-ai-reply', id: 'zzz', text: 'no' }));
  assert.equal(await p, null);
  assert.equal(d.send('   '), undefined);
  d.onMessage(ev({ type: 'hondi-embed-host', ai: '' })); assert.equal(d.active(), false);
});
test('note 는 콜백으로 전달된다', () => {
  const { d } = mk(); let got = ''; d.onNote(t => { got = t; });
  d.onMessage(ev({ type: 'hondi-embed-ai-note', text: '되돌렸습니다' })); assert.equal(got, '되돌렸습니다');
});

test('webapp.html: 나비웹의 "각종 기관" 선택 — hondi-embed-sp 로 패널 SP 전환, hondi-embed-sp-ask 로 입력창 말을 그 SP 로 답한다', async () => {
  const { readFileSync } = await import('node:fs');
  const s = readFileSync(new URL('../webapp.html', import.meta.url), 'utf8');
  for (const k of ["d.type === 'hondi-embed-sp'", "d.type === 'hondi-embed-sp-ask'", "type: 'hondi-embed-sp-ready'", "type: 'hondi-embed-sp-reply'", "window.__hondiEmbedSp && window.__hondiEmbedSp.text", "/prompts/sp-catalog.json", 'window.EmbedDelegate.HOSTS.indexOf(e.origin) >= 0']) assert.ok(s.includes(k), k);
});

test('hondi-embed-sp: 답은 짧게·마크다운, 면책 문구 제외 규칙을 붙이고 마크다운 원문을 돌려준다', async () => {
  const { readFileSync } = await import('node:fs');
  const h = readFileSync(new URL('../webapp.html', import.meta.url), 'utf8');
  assert.match(h, /\[화면 표시 규칙 — 나비웹 대화창\]/);
  assert.match(h, /_lastA/);
});

test('hondi-embed-sp: role=expert 이면 사용자를 해당 분야 인간 전문가로 상정하는 규칙을 붙인다', async () => {
  const { readFileSync } = await import('node:fs');
  const h = readFileSync(new URL('../webapp.html', import.meta.url), 'utf8');
  assert.match(h, /expert: d\.role === 'expert'/);
  assert.match(h, /\[대화 상대 — 나비웹 전문가 AI\]/);
});

test('지역별 정부 기관: gov-tree 경로 SP 전환(검증)·지역 컨텍스트 주입, 브릿지 region 응답', async () => {
  const { readFileSync } = await import('node:fs');
  const h = readFileSync(new URL('../webapp.html', import.meta.url), 'utf8');
  assert.match(h, /prompts\\\/gov-tree\\\/\[A-Za-z0-9_\\-\\\/\.\]\+\\\.md/);
  assert.match(h, /\[사용자 지역 정보 — 나비웹\]/);
  const b = readFileSync(new URL('../pdv-draft-bridge.html', import.meta.url), 'utf8');
  assert.match(b, /region: function \(\)/);
});

test('hondi-embed-sp: inline: 키 + spText 로 호스트가 직접 준 안내용 SP 를 쓴다', async () => {
  const { readFileSync } = await import('node:fs');
  const h = readFileSync(new URL('../webapp.html', import.meta.url), 'utf8');
  assert.match(h, /key\.indexOf\('inline:'\) === 0 && typeof d\.spText === 'string'/);
});

test('hondi-embed-sp: autoAsk 로 첫 요청을 사용자 말풍선 없이 SP 에 넣는다', async () => {
  const { readFileSync } = await import('node:fs');
  const h = readFileSync(new URL('../webapp.html', import.meta.url), 'utf8');
  assert.match(h, /typeof d\.autoAsk === 'string'/);
});

test('hondi-embed-say: 호스트가 대화창에 AI 말풍선을 보여 준다', async () => {
  const { readFileSync } = await import('node:fs');
  const h = readFileSync(new URL('../webapp.html', import.meta.url), 'utf8');
  assert.match(h, /d\.type === 'hondi-embed-say'/);
});

test('첨부 파일을 호스트로 함께 넘긴다(텍스트·사진/PDF 원본, 개수·크기 상한)', async () => {
  const { d, sent } = mk(); d.onMessage(ev({ type: 'hondi-embed-host', ai: 'delegate' }));
  const big = 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024);
  const files = [
    { name: '계약서.pdf', mimeType: 'application/pdf', extractedText: '본문'.repeat(20000), dataUrl: 'data:application/pdf;base64,AAAA' },
    { name: '사진.png', isImage: true, mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
    { name: '큰사진.png', isImage: true, mimeType: 'image/png', dataUrl: big },
    { name: 'a.txt', mimeType: 'text/plain', extractedText: '글' }, { name: 'b.txt', extractedText: '글' }, { name: 'c.txt', extractedText: '글' },
  ];
  const p = d.send('', files); assert.ok(p);
  const m = sent[0][0]; assert.equal(m.files.length, 4); assert.equal(m.files[0].text.length, 20000); assert.equal(m.files[1].dataUrl.startsWith('data:image'), true);
  assert.equal(m.files.some(f => f.name === '큰사진.png'), false);
  assert.equal(d.send('', []), undefined);
});

// ── 서류 작성 도우미 인계(2026-11-04): 서류 SP 의 [AGENT_TASK]·[DOC_HANDBACK] 태그 ──────────────────────────────
test('parseDocTags: [AGENT_TASK] 를 slot/goal 로 뽑고 본문에서 지운다', () => {
  const r = E.parseDocTags('도우미에 맡겼습니다.\n[AGENT_TASK: slot=집행권원 사본 1부; goal=대법원 전자소송에서 판결문 정본을 발급 신청 화면까지 열어 주세요]');
  assert.deepEqual(r.tasks, [{ slot: '집행권원 사본 1부', goal: '대법원 전자소송에서 판결문 정본을 발급 신청 화면까지 열어 주세요' }]);
  assert.equal(r.handback, null);
  assert.equal(r.clean, '도우미에 맡겼습니다.');
});
test('parseDocTags: 한 답변 2건까지, 3번째부터는 버린다(태그는 모두 지운다)', () => {
  const t = (n) => `[AGENT_TASK: slot=서류${n}; goal=일${n}]`;
  const r = E.parseDocTags(`맡깁니다 ${t(1)} ${t(2)} ${t(3)}`);
  assert.equal(r.tasks.length, 2); assert.deepEqual(r.tasks.map(x => x.slot), ['서류1', '서류2']);
  assert.equal(r.clean.includes('AGENT_TASK'), false);
});
test('parseDocTags: 형식이 틀린 태그(slot·goal 누락)는 실행하지 않고 화면에서만 지운다', () => {
  for (const bad of ['[AGENT_TASK: slot=서류]', '[AGENT_TASK: goal=일만]', '[AGENT_TASK: ]', '[AGENT_TASK: slot=; goal=일]', '[AGENT_TASK: slot=서류; goal=]']) {
    const r = E.parseDocTags('앞 ' + bad + ' 뒤'); assert.equal(r.tasks.length, 0, bad); assert.equal(r.clean.replace(/\s+/g, ' '), '앞 뒤', bad); assert.equal(r.clean.includes('AGENT_TASK'), false, bad);
  }
});
test('parseDocTags: 길이 상한(slot 80·goal 300)과 제어문자·줄바꿈 제거', () => {
  const r = E.parseDocTags(`[AGENT_TASK: slot=${'가'.repeat(200)}; goal=첫 줄\n둘째\u0007줄 ${'나'.repeat(500)}]`);
  assert.equal(r.tasks[0].slot.length, 80); assert.equal(r.tasks[0].goal.length, 300);
  assert.equal(/[\u0000-\u001f]/.test(r.tasks[0].goal), false);
  assert.ok(r.tasks[0].goal.startsWith('첫 줄 둘째 줄'));
});
test('parseDocTags: [DOC_HANDBACK] 는 cancel·complete 만 인정하고 마지막 것을 쓴다', () => {
  assert.equal(E.parseDocTags('끝 [DOC_HANDBACK: reason=complete]').handback, 'complete');
  assert.equal(E.parseDocTags('[DOC_HANDBACK: reason=cancel] x [DOC_HANDBACK: reason=complete]').handback, 'complete');
  assert.equal(E.parseDocTags('[DOC_HANDBACK: reason=offtopic]').handback, null);
  assert.equal(E.parseDocTags('[DOC_HANDBACK: reason=offtopic]').clean, '');
  assert.equal(E.parseDocTags('[DOC_HANDBACK: complete]').handback, null);
});
test('parseDocTags: 태그가 없으면 본문 그대로, 비문자열도 안전', () => {
  assert.deepEqual(E.parseDocTags('안녕하세요'), { tasks: [], handback: null, clean: '안녕하세요' });
  assert.deepEqual(E.parseDocTags(null), { tasks: [], handback: null, clean: '' });
});
test('webapp.html: 서류 SP(inline:doc:)일 때만 태그를 호스트로 올리고, 표시 전에 지운다', async () => {
  const { readFileSync } = await import('node:fs');
  const h = readFileSync(new URL('../webapp.html', import.meta.url), 'utf8');
  assert.match(h, /function _embedDocTags\(full\)/);
  assert.match(h, /if \(!_isScreenSp\(\) \|\| window\.parent === window \|\| !ho/);
  assert.match(h, /type: 'hondi-embed-agent-task', slot: t\.slot, goal: t\.goal/);
  assert.match(h, /type: 'hondi-embed-doc-handback', reason: r\.handback/);
  assert.match(h, /const _clean = _stripInternalTags\(_embedDocTags\(full\)\)/);
  const c = readFileSync(new URL('../src/gopang/ai/call-ai.js', import.meta.url), 'utf8');
  assert.match(c, /\\\[AGENT_TASK:\[\^\\\]\]\*\\\]/); assert.match(c, /\\\[DOC_HANDBACK:\[\^\\\]\]\*\\\]/);
});
