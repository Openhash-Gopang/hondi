const assert = require('assert');
// 저장소가 "type":"module" 이라 require() 대신 소스를 직접 평가한다(브라우저에서는 일반 <script> 로 로드됨).
const fs = require('fs'), path = require('path');
const _m = { exports: {} };
new Function('module', 'exports', fs.readFileSync(path.join(__dirname, 'klaw-engine.js'), 'utf8'))(_m, _m.exports);
const KLawEngine = _m.exports;
// 실행: node lib/klaw-engine.test.cjs

function sse(chunks, finish='stop') {
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) {
    for (const t of chunks) c.enqueue(enc.encode('data: ' + JSON.stringify({choices:[{delta:{content:t}}]}) + '\n\n'));
    c.enqueue(enc.encode('data: ' + JSON.stringify({choices:[{delta:{},finish_reason:finish}]}) + '\n\n'));
    c.enqueue(enc.encode('data: [DONE]\n\n')); c.close();
  }});
  return new Response(body, { status: 200, headers: {'Content-Type':'text/event-stream'} });
}
const json = (o, status=200) => new Response(JSON.stringify(o), { status, headers: {'Content-Type':'application/json'} });

const ANALYSIS = (extra) => `【심급】3심\n【사건분류】민사(본안)\n【사건종류_상세】대여금\n【사건명】대여금 반환 청구\n【사건의 개요】갑은 을에게 1천만 원을 빌려주었다.\n【원고의 주장】반환하라\n【피고의 주장】이미 갚았다\n【다툼이 없는 사실】대여 사실\n【다툼의 요지】변제 여부\n【추가질문】${extra}`;

function makeWorld(over = {}) {
  const w = { calls: [], relayTiers: [], logout: 0, logins: 0, saved: [], failStepOnce: null, expire401Once: false, analysisReplies: [], stepCalls: {} };
  w.auth = { ensureLogin: async () => { w.logins++; return 'tok'; }, getToken: () => 'tok', hasValidLogin: () => true, logout: () => { w.logout++; } };
  w.fetch = async (url, init = {}) => {
    w.calls.push(url);
    if (url.startsWith('https://api.github.com/')) return json([{name:'klaw_v15_1.md'},{name:'klaw_v16_2.md'},{name:'x.txt'}]);
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      if (over.rawFail) return new Response('nf', {status:404});
      return new Response(url.includes('klaw_v') ? '# 방법론 본문' : '# 출력형식 본문', {status:200});
    }
    if (url.endsWith('/klaw/sessions')) { w.saved.push(JSON.parse(init.body)); return json({ok:true,id:'sess1'}); }
    if (url.endsWith('/klaw/relay')) {
      const b = JSON.parse(init.body); w.relayTiers.push(b.tier);
      if (w.expire401Once) { w.expire401Once = false; return json({error:'TOKEN_EXPIRED', message:'인증 토큰이 만료됐습니다'}, 401); }
      if (b.step_cycle) {
        const user = b.messages.find(m => m.role==='user').content;
        const id = user.includes('STEP C를') ? 'stepC' : user.includes('STEP B만') ? 'stepB' : user.includes('STEP A만') ? 'stepA' : 'step0';
        w.stepCalls[id] = (w.stepCalls[id]||0)+1;
        if (w.failStepOnce === id) { w.failStepOnce = null; return json({error:'X', message:'서버 오류'}, 500); }
        const tail = id === 'stepC' ? '\n[법리 확신도: 7/10] [사실 확신도: 8/10] [종합 확신도: 7.5/10]\n[사건 복잡도: 3/10]\n[결론 유형: 확정적]\n판결 요약: 피고는 원고에게 1천만 원을 지급하라.\n\n[STEP-C-COMPLETE]'
                    : id === 'stepB' ? '\n주문: 피고는 원고에게 10,000,000원을 지급하라.\n[STEP-B-COMPLETE]' : `\n[STEP-${id.replace('step','')}-COMPLETE]`;
        return sse([id+' 본문 ', '[K-Law 대법원 판결 일치도 예상: 80%]', tail]);
      }
      // 분석/확인 호출
      const last = b.messages[b.messages.length-1].content;
      if (last.includes('시뮬레이션_진행')) return json({choices:[{message:{content: w.readyOnReply ? '시뮬레이션_진행' : '【추가질문】변제 증거가 있나요?'}}]});
      const r = w.analysisReplies.shift();
      if (r && r.finish === 'length') return sse(['【심급】3심'], 'length');
      if (r && r.empty) return sse(['']);
      return sse([r ? r.text : ANALYSIS('없음')]);
    }
    throw new Error('unexpected url ' + url);
  };
  return w;
}
const mk = (w, o={}) => KLawEngine.create({ auth: w.auth, fetch: w.fetch, storage: null, ...o });
const LONG = '갑은 을에게 2023년 1월 1천만 원을 빌려주었으나 을은 변제하지 않았다. 을은 이미 갚았다고 주장한다.';
let n = 0; const ok = (m) => console.log('  ✓', m, ++n);

(async () => {
  console.log('1) 정상 경로 + 추가질문 + 이력 저장');
  { const w = makeWorld(); w.analysisReplies = [{text: ANALYSIS('변제 시점이 언제인가요?')}]; w.readyOnReply = true;
    const e = mk(w); const ev = [];
    e.on('*', (p, name) => ev.push(name));
    assert.strictEqual((await e.loadMethod()).version, 'v16.2'); ok('방법론 최신 버전 선택(v16.2)');
    const a = await e.analyze(LONG); assert(a.needsMoreInfo && a.question.includes('변제')); ok('추가질문 감지');
    const r1 = await e.reply('2023년 3월입니다'); assert.strictEqual(r1.ready, true); ok('reply → ready');
    const v = await e.runVerdict();
    assert(v.ok && v.meta.totalConfidence === 7.5 && v.meta.complexity === 3 && v.meta.conclusionType === '확정적'); ok('확신도·복잡도·결론유형 파싱');
    assert(v.meta.order && v.meta.order.includes('10,000,000')); ok('주문 파싱');
    assert(!v.text.includes('일치도 예상')); ok('일치도 예상 태그 제거');
    assert(ev.filter(x=>x==='step:done').length === 4 && ev.includes('verdict:done') && ev.includes('session:saved')); ok('이벤트 순서/저장');
    assert.strictEqual(w.saved[0].is_public, false); assert.strictEqual(w.saved[0].match_rate, null); assert.strictEqual(w.saved[0].phone_verify_token, 'tok'); ok('이력: 비공개·일치도 null·토큰 포함');
    assert(w.relayTiers.filter(t=>t==='klaw-pro').length >= 4); ok('STEP 은 klaw-pro 사용');
  }

  console.log('2) STEP A 실패 → 중단 → resume (STEP 0 재호출 없음)');
  { const w = makeWorld(); const e = mk(w); await e.loadMethod(); await e.analyze(LONG);
    w.failStepOnce = 'stepA';
    const r = await e.runVerdict(); assert(!r.ok && r.failedStep === 'stepA'); ok('실패 시 ok:false, failedStep=stepA');
    assert(!w.stepCalls.stepB && !w.stepCalls.stepC); ok('실패 후 STEP B/C 진행 안 함');
    const r2 = await e.runVerdict({ resume: true });
    assert(r2.ok && w.stepCalls.step0 === 1 && w.stepCalls.stepA === 2 && r2.caseNo === r.caseNo); ok('resume: STEP 0 재과금 없음, 같은 사건번호');
  }

  console.log('3) 토큰 만료 → 재로그인 후 재시도');
  { const w = makeWorld(); const e = mk(w); w.expire401Once = true;
    const a = await e.analyze(LONG); assert(a.caseData.overview && w.logout === 1 && w.logins >= 2); ok('logout+재로그인+재시도 성공');
  }

  console.log('4) flash 가 length 로 잘리면 pro 로 1회 전환');
  { const w = makeWorld(); w.analysisReplies = [{finish:'length'}]; const e = mk(w);
    const a = await e.analyze(LONG);
    assert.deepStrictEqual(w.relayTiers.slice(0,2), ['klaw-flash','klaw-pro']); assert(a.caseData.overview); ok('flash→pro 전환');
  }

  console.log('5) 분석 응답이 비면 재시도, 두 번 비면 ANALYSIS_EMPTY');
  { const w = makeWorld(); w.analysisReplies = [{empty:1},{empty:1}]; const e = mk(w); let err;
    try { await e.analyze(LONG); } catch (x) { err = x; }
    assert(err && err.code === 'ANALYSIS_EMPTY'); ok('ANALYSIS_EMPTY');
    assert.strictEqual(e.state.phase, 'error'); ok('phase=error');
  }

  console.log('6) 입력 검증 / 방법론 로드 실패 시 과금 호출 차단');
  { const w = makeWorld(); const e = mk(w); let err; try { await e.analyze('짧음'); } catch (x) { err = x; }
    assert(err && err.code === 'CASE_TOO_SHORT'); ok('CASE_TOO_SHORT');
    const w2 = makeWorld({ rawFail: true }); const e2 = mk(w2); await e2.analyze(LONG); w2.relayTiers.length = 0;
    let err2; try { await e2.runVerdict(); } catch (x) { err2 = x; }
    assert(err2 && err2.code === 'METHOD_NOT_LOADED' && w2.relayTiers.length === 0); ok('방법론 없으면 relay 호출 0회로 중단');
  }

  console.log('7) BYOK(claude) 스트리밍 경로');
  { const w = makeWorld(); const enc = new TextEncoder();
    const claudeFetch = async (url, init) => {
      if (url === 'https://api.anthropic.com/v1/messages') {
        const b = JSON.parse(init.body); assert(b.stream === true && typeof b.system === 'string' && b.messages.every(m=>m.role!=='system'));
        assert.strictEqual(init.headers['x-api-key'], 'sk-test');
        const body = new ReadableStream({ start(c) { c.enqueue(enc.encode('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:ANALYSIS('없음')}})+'\n\n')); c.close(); } });
        return new Response(body, {status:200});
      }
      return w.fetch(url, init);
    };
    const e = KLawEngine.create({ auth: null, provider: 'claude', apiKey: 'sk-test', fetch: claudeFetch, storage: null });
    const a = await e.analyze(LONG); assert(a.caseData.type === '민사(본안)' && !a.needsMoreInfo && e.state.usesRelay === false); ok('claude 스트리밍 분석 + relay 미사용');
    const e2 = KLawEngine.create({ auth: null, provider: 'claude', fetch: claudeFetch, storage: null }); let er;
    try { await e2.analyze(LONG); } catch (x) { er = x; } assert(er && /API_KEY_REQUIRED/.test(er.message)); ok('키 없는 BYOK 는 API_KEY_REQUIRED');
  }
  console.log('\n전체 통과:', n, '개 검증');
})().catch(e => { console.error('✗ 실패:', e.stack || e); process.exit(1); });
