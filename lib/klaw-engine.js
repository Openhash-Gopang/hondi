/*!
 * klaw-engine.js — K-Law 판결 시뮬레이션 공유 엔진 (v1.0)
 *
 * klaw.hondi.net/verdict-generate.html 안에 묶여 있던 판결문 생성 파이프라인
 * (사건 분석 → 추가질문 → STEP 0·A·B·C → 확신도 파싱 → 이력 저장)을 DOM 없이 분리한 모듈.
 * klaw 페이지와 naviweb.kr 가 이 파일 하나를 함께 쓰면, 방법론이 Agon 1.0 등으로 바뀌어도
 * 파이프라인은 한 곳에서만 고치면 된다. UI 는 이 모듈의 이벤트만 구독한다.
 *
 * 서버 계약(변경 없음): hondi-proxy Worker 의
 *   POST /klaw/relay      DeepSeek 공유 계정 중계 (phone_verify_token 필수, GDC 차감)
 *   POST /klaw/sessions   이력 저장
 *
 * 사용 예
 *   const engine = KLawEngine.create({ auth: KAuth });
 *   engine.on('step:chunk', e => render(e.id, e.text));
 *   await engine.loadMethod();
 *   const a = await engine.analyze(caseText);        // { caseData, needsMoreInfo, question }
 *   // needsMoreInfo 이면 engine.reply(text) 를 ready 가 될 때까지 반복 (또는 engine.skipQuestions())
 *   const r = await engine.runVerdict();             // { ok, text, meta, ... }
 *   if (!r.ok) await engine.runVerdict({ resume: true }); // 실패한 STEP 부터 이어서
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KLawEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ══ 상수 ═══════════════════════════════════════════════════
  const DEFAULTS = {
    proxyBase:   'https://hondi-proxy.tensor-city.workers.dev',
    repoApi:     'https://api.github.com/repos/Openhash-Gopang/klaw/contents/',
    rawBase:     'https://raw.githubusercontent.com/Openhash-Gopang/klaw/main/',
    formatFile:  '가상판결_출력형식_v13_3.txt',
    fallbackMethodFile: 'klaw_v16_2.md',
    cacheKey:    'klaw_method_cache_v2',
    cacheTtlMs:  24 * 60 * 60 * 1000,
    deepseekEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  };
  const TIER_INTERVIEW = 'klaw-flash'; // 분석·확인 등 경량 호출
  const TIER_VERDICT   = 'klaw-pro';   // STEP 0~C 판결문 생성(추론)
  const MIN_CASE_CHARS = 20;

  // 예산 근거는 verdict-generate.html 주석 참고(2026-09-25 재상향분 그대로).
  // max_tokens 는 상한일 뿐 실제 생성분만 과금된다.
  const STEP_DEFS = [
    { id: 'step0', tag: 'STEP 0', title: 'STEP 0 — 사건 기본 분석 · 명제 설정', maxTokens: 27000,
      prompt: ctx => `${ctx}\n\nK-Law 판결 방법론의 STEP 0만 작성하세요.\n[0-α 직관] [0-β 격리] [명제] [STEP-0-COMPLETE] 포함.` },
    { id: 'stepA', tag: 'STEP A', title: 'STEP A — 판례 법리·법률관계 분석', maxTokens: 42000,
      prompt: ctx => `${ctx}\n\nSTEP 0이 완료되었습니다. STEP A만 작성하세요.\nA-0~A-5 소항목과 각 완료 태그 포함. 허위 판례 번호 인용 금지.` },
    { id: 'stepB', tag: 'STEP B', title: 'STEP B — 법률관계 확정 · 최종 판결문', maxTokens: 48000,
      prompt: ctx => `${ctx}\n\nSTEP A가 완료되었습니다. STEP B만 작성하세요.\nB-1~B-7 소항목, 주문+이유 완성, [STEP-B-COMPLETE] 포함.` },
    { id: 'stepC', tag: 'STEP C', title: 'STEP C — 완결 게이트웨이 · 확신도 · 자기 검증', maxTokens: 27000,
      prompt: ctx => `${ctx}\n\nSTEP B가 완료되었습니다. STEP C를 작성하고 아래 형식으로 마무리하세요.\n[법리 확신도: X/10] [사실 확신도: Y/10] [종합 확신도: Z/10]\n[사건 복잡도: X/10]\n[결론 유형: 확정적/조건부/판단유보]\n판결 요약: [핵심 2~3문장]\n[STEP-C-COMPLETE]` },
  ];

  const ANALYZE_PROMPT = `당신은 K-Law AI 판결 분석 시스템입니다.
사용자가 제출한 사건의 개요를 분석하여 아래 형식으로 정확히 응답하세요.

【심급】1심 / 2심 / 3심 / 헌법재판 중 하나
【사건분류】민사(본안) / 형사 / 행정 / 가사 / 소액사건 / 노동 중 하나
【사건종류_상세】사건의 구체적 유형
【사건명】실제 법원 사건명처럼 핵심 청구를 담은 짧은 한 문구 (예: "건축인허가 처분 취소 청구", "OO시청과 건설사 간 계약 이행 분쟁"). 날짜·당사자 상세 정보 없이 15자 내외로.
【사건의 개요】입력된 내용을 바탕으로 명확하게 정리
【원고의 주장】원고(신청인) 측 주장 정리 (없으면 "정보 부족"으로 표기)
【피고의 주장】피고(상대방) 측 주장 정리 (없으면 "정보 부족"으로 표기)
【다툼이 없는 사실】양측이 동의하는 사실관계 (없으면 "추가 확인 필요"로 표기)
【다툼의 요지】핵심 법적 쟁점 2~3가지
【추가질문】판결 시뮬레이션에 필요한 정보가 부족한 경우 구체적인 질문 1~3개. 충분하면 "없음".

응답은 반드시 위 형식만 사용하세요.`;

  // ══ 순수 유틸 (DOM·네트워크 없음) ═══════════════════════════
  function stripMatchTag(t) {
    return String(t || '')
      .replace(/\[K-Law 대법원 판결 일치도 예상[^\]]*(\]|$)/g, '')
      .replace(/^.*일치도 예상 수치는.*추정치입니다.*$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  function appendTruncationNotice(content, finishReason) {
    if (finishReason !== 'length') return content;
    return content + '\n\n⚠️ [응답이 토큰 한도에 도달해 중간에 잘렸습니다 — 사건이 복잡하거나 입력이 길 때 발생할 수 있습니다. "재생성"을 시도하거나 사건 개요를 간결히 줄여 다시 입력해 보세요.]';
  }

  function isRecoverableAuthError(message) {
    return /로그인이 필요합니다|인증 토큰이 만료|토큰 서명이 유효하지 않습니다/.test(message || '');
  }

  function caseIsComplex(caseInput) {
    if (!caseInput) return false;
    const partyMarkers = (caseInput.match(/원고|피고|당사자|법인|회사|공사(?!법)/g) || []).length;
    return caseInput.length > 900 || partyMarkers > 12;
  }

  function parseAnalysis(text) {
    const get = tag => {
      const m = String(text || '').match(new RegExp('【' + tag + '】\\s*([\\s\\S]*?)(?=【|$)'));
      return m ? m[1].trim() : '';
    };
    return {
      level: get('심급'), type: get('사건분류'), typeDetail: get('사건종류_상세'), caseName: get('사건명'),
      overview: get('사건의 개요'), plaintiff: get('원고의 주장'), defendant: get('피고의 주장'),
      agreed: get('다툼이 없는 사실'), dispute: get('다툼의 요지'), extraQ: get('추가질문'),
    };
  }

  function analysisIsEmpty(d) {
    return !d.overview?.trim() && !d.plaintiff?.trim() && !d.defendant?.trim();
  }

  function hasExtraQuestion(d) {
    const q = d && d.extraQ;
    return !!(q && q !== '없음' && q.trim().length > 2);
  }

  function parseVerdictMeta(fullText) {
    const num = re => { const m = fullText.match(re); return m ? parseFloat(m[1]) : null; };
    const typeM  = fullText.match(/\[결론 유형:\s*([^\]]+)\]/);
    const summM  = fullText.match(/판결 요약:\s*([\s\S]{1,200}?)(?:\n\n|\[━|$)/);
    const orderM = fullText.match(/主\s*문\s*[:：]?\s*([^\n]{1,80})/) || fullText.match(/주\s*문\s*[:：]?\s*([^\n]{1,80})/);
    return {
      lawConfidence:   num(/\[법리 확신도:\s*([\d.]+)\/10\]/),
      factConfidence:  num(/\[사실 확신도:\s*([\d.]+)\/10\]/),
      totalConfidence: num(/\[종합 확신도:[^\]]*?([\d.]+)\/10\]/),
      complexity:      num(/\[사건 복잡도:\s*([\d.]+)\/10\]/),
      conclusionType:  typeM ? typeM[1].trim() : null,
      summary:         summM ? summM[1].trim() : '',
      order:           orderM ? orderM[1].trim().slice(0, 80) : null,
    };
  }

  function deriveTitle(caseType, caseSummary, caseName) {
    if (caseName && caseName.trim()) return caseName.trim().slice(0, 100);
    const head = caseType ? `[${caseType}] ` : '';
    const body = (caseSummary || '').trim().slice(0, 40);
    return (head + (body || '제목 없음')).slice(0, 100);
  }

  async function pumpSSE(response, handleJson) {
    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try { const b = await response.json(); errMsg = b.error?.message || b.message || errMsg; } catch (e) { /* 본문 없음 */ }
      throw new Error(errMsg);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        let json;
        try { json = JSON.parse(payload); } catch (e) { continue; }
        handleJson(json);
      }
    }
  }

  // ══ 제공사 어댑터 (본인 API Key 사용 시 브라우저에서 직접 호출) ═══
  // 각 어댑터: build(messages, maxTokens, stream, model, key) → {url, headers, body}
  //            text(json) → 비스트리밍 본문 / delta(json) → 스트리밍 조각 / err(json) → 오류 메시지|null
  const sys  = m => m.find(x => x.role === 'system')?.content || '';
  const nsys = m => m.filter(x => x.role !== 'system');
  const openaiLike = (url, defModel) => ({
    build: (m, max, stream, model, key) => ({
      url, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: { model: model || defModel, messages: m, max_tokens: max, temperature: 0.2, ...(stream ? { stream: true } : {}) },
    }),
    text:  j => j.choices?.[0]?.message?.content || '',
    delta: j => j.choices?.[0]?.delta?.content || '',
    finish: j => j.choices?.[0]?.finish_reason || null,
    err:   j => j.error ? (j.error.message || JSON.stringify(j.error)) : null,
  });
  const PROVIDERS = {
    claude: {
      build: (m, max, stream, model, key) => ({
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: { model: model || 'claude-sonnet-4-20250514', max_tokens: max, messages: nsys(m), system: sys(m), ...(stream ? { stream: true } : {}) },
      }),
      text:  j => j.content?.[0]?.text || '',
      delta: j => (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') ? j.delta.text : '',
      finish: () => null,
      err:   j => j.type === 'error' ? (j.error?.message || 'Claude 스트리밍 오류') : (j.error ? j.error.message : null),
    },
    gemini: {
      build: (m, max, stream, model, key) => ({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-pro'}:${stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'}key=${key}`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          system_instruction: sys(m) ? { parts: [{ text: sys(m) }] } : undefined,
          contents: nsys(m).map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] })),
          generationConfig: { maxOutputTokens: max },
        },
      }),
      text:  j => j.candidates?.[0]?.content?.parts?.[0]?.text || '',
      delta: j => j.candidates?.[0]?.content?.parts?.[0]?.text || '',
      finish: () => null,
      err:   j => j.error ? (j.error.message || 'Gemini 오류') : null,
    },
    groq:     openaiLike('https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile'),
    deepseek: openaiLike(DEFAULTS.deepseekEndpoint, 'deepseek-v4-pro'),
  };

  // ══ 엔진 ═══════════════════════════════════════════════════
  /**
   * @param {object} opts
   *   auth      {ensureLogin, getToken, logout?, hasValidLogin?, getGuid?}  — KAuth 호환 객체 (relay 사용 시 필수)
   *   provider  'deepseek'(기본) | 'claude' | 'gemini' | 'groq'
   *   apiKey    본인 키(BYOK). 비어 있고 provider 가 deepseek 면 relay + GDC 차감
   *   model     제공사 모델명(선택)
   *   fetch     테스트/SSR 용 fetch 주입
   *   storage   sessionStorage 호환 객체(방법론 캐시). 기본: 전역 sessionStorage
   *   saveSession  true(기본) — 판결 완료 시 /klaw/sessions 에 이력 저장(로그인 상태일 때만)
   *   proxyBase, repoApi, rawBase, formatFile, manifestUrl  — 기본값은 DEFAULTS
   */
  function create(opts = {}) {
    const cfg = Object.assign({}, DEFAULTS, opts);
    const doFetch = (opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null));
    const auth = opts.auth || null;
    let provider = opts.provider || 'deepseek';
    let apiKey = opts.apiKey || '';
    let model = opts.model || '';
    let storage = opts.storage;
    if (storage === undefined) { try { storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch (e) { storage = null; } }

    const listeners = {};
    let controller = null;
    let simCount = 0;

    const st = {
      phase: 'idle',            // idle | analyzing | chatting | ready | generating | done | error
      messages: [],             // 분석·추가질문 대화
      caseText: '',
      caseData: null,
      method: { version: '', text: '', format: '', loaded: false },
      run: null,                // 진행 중/직전 판결 실행 { caseNo, level, parts, nextIndex }
    };

    // ── 이벤트 ──
    function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return () => off(name, fn); }
    function off(name, fn) { listeners[name] = (listeners[name] || []).filter(f => f !== fn); }
    function emit(name, payload) {
      (listeners[name] || []).concat(listeners['*'] || []).forEach(fn => {
        try { fn(payload, name); } catch (e) { if (typeof console !== 'undefined') console.error('[KLawEngine] 핸들러 오류', name, e); }
      });
    }
    function setPhase(p) { st.phase = p; emit('phase', { phase: p }); }

    function newSignal() { controller = (typeof AbortController !== 'undefined') ? new AbortController() : null; return controller ? controller.signal : undefined; }
    function abort() { if (controller) controller.abort(); }

    // ── 설정 변경 ──
    function configure(next = {}) {
      if (next.provider !== undefined) provider = next.provider || 'deepseek';
      if (next.apiKey !== undefined) apiKey = next.apiKey || '';
      if (next.model !== undefined) model = next.model || '';
    }
    const usesRelay = () => provider === 'deepseek' && !apiKey;

    // ── 방법론 원문 로드 ──
    async function loadMethod() {
      try {
        const c = JSON.parse((storage && storage.getItem(cfg.cacheKey)) || 'null');
        if (c && c.version && c.text && c.format && c.ts && (Date.now() - c.ts) < cfg.cacheTtlMs) {
          st.method = { version: c.version, text: c.text, format: c.format, loaded: true };
          return { ok: true, version: c.version, cached: true };
        }
      } catch (e) { /* 캐시 무시 */ }

      try {
        let methodFile = null, formatFile = cfg.formatFile, version = null;
        if (cfg.manifestUrl) {
          try {
            const mr = await doFetch(cfg.manifestUrl, { cache: 'no-cache' });
            if (mr.ok) { const mj = await mr.json(); methodFile = mj.methodFile || null; formatFile = mj.formatFile || formatFile; version = mj.version || null; }
          } catch (e) { emit('warning', { code: 'MANIFEST_FAILED', message: '방법론 매니페스트를 읽지 못해 저장소 목록으로 대체합니다.' }); }
        }
        if (!methodFile) {
          let files = [];
          try { const r = await doFetch(cfg.repoApi, { cache: 'no-cache' }); const j = await r.json(); files = Array.isArray(j) ? j : []; } catch (e) { /* 아래 기본 파일 사용 */ }
          const ver = n => { const m = n.match(/klaw_v(\d+)_?(\d*)\.md/i); return m ? parseFloat(m[1] + '.' + (m[2] || '0')) : 0; };
          const vFiles = files.map(f => f.name).filter(n => /^klaw_v[\d_]+\.md$/i.test(n)).sort((a, b) => ver(b) - ver(a));
          methodFile = vFiles[0] || cfg.fallbackMethodFile;
          if (!vFiles[0]) emit('warning', { code: 'METHOD_LIST_UNAVAILABLE', message: `방법론 파일 목록을 받지 못해 기본 파일(${cfg.fallbackMethodFile})을 사용합니다. 새 버전이 나왔다면 반영되지 않을 수 있습니다.` });
        }
        if (!version) { const vm = methodFile.match(/klaw_v(\d+_?\d*)\.md/i); version = vm ? 'v' + vm[1].replace('_', '.') : 'v16.2'; }

        const [rm, rf] = await Promise.all([
          doFetch(cfg.rawBase + methodFile, { cache: 'no-cache' }),
          doFetch(cfg.rawBase + encodeURIComponent(formatFile), { cache: 'no-cache' }),
        ]);
        const text = rm.ok ? await rm.text() : '';
        const format = rf.ok ? await rf.text() : '';
        if (!text) throw new Error('방법론 원문을 받지 못했습니다 (HTTP ' + rm.status + ')');
        if (!format) emit('warning', { code: 'FORMAT_MISSING', message: '가상판결 출력형식 원문을 받지 못했습니다 (HTTP ' + rf.status + ').' });
        st.method = { version, text, format, loaded: true };
        try { storage && storage.setItem(cfg.cacheKey, JSON.stringify({ version, text, format, ts: Date.now() })); } catch (e) { /* 용량 초과 등 */ }
        return { ok: true, version, cached: false };
      } catch (e) {
        st.method = { version: '', text: '', format: '', loaded: false };
        emit('warning', { code: 'METHOD_LOAD_FAILED', message: e.message });
        return { ok: false, error: e.message };
      }
    }

    // 사건번호·심급 등 호출마다 달라지는 값은 넣지 않는다 — DeepSeek 프롬프트 캐시가
    // 방법론+출력형식(약 4만자) prefix 전체를 STEP 0→C, 다음 사건까지 재사용하도록.
    function buildSystemPrompt() {
      const v = st.method.version || '(버전 미상)';
      const methodBody = st.method.text ? '[K-Law 방법론 원문]\n' + st.method.text + '\n\n---\n\n' : '[⚠️ K-Law 방법론 원문 로드 실패]\n\n';
      const formatBody = st.method.format ? '[가상판결 출력형식 v13.3]\n' + st.method.format + '\n\n---\n\n' : '[⚠️ 가상판결 출력형식 v13.3 로드 실패]\n\n';
      return `당신은 K-Law 판결 방법론 ${v}을 적용하는 대한민국 법원 판결 AI입니다.
${methodBody}${formatBody}위 가상판결 출력형식 v13.3을 반드시 준수하여 판결문을 작성하세요.
사건번호·심급 등 이번 사건의 구체적인 정보는 이어지는 사용자 메시지에서 확인하세요.

[이 시뮬레이터의 예외 지시 — 위 출력형식보다 우선]
사건별 "대법원 판결 일치도 예상" 수치는 검증되지 않은 값이므로 출력하지 않습니다. 위 출력형식에 있는
"[K-Law 대법원 판결 일치도 예상: …]" 태그, 일치도 산출 공식·표, 판결 요약에 일치도 예상을 포함하라는 지시,
"통계적 추정치입니다" 각주는 모두 생략하세요. 그 밖의 형식과 완료 태그는 그대로 준수합니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
본 시뮬레이션은 법률 정보 제공 목적이며 법률 자문이 아닙니다.
가상판결 출력형식 v13.3 | K-Law ${v} 적용
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    }

    // ── relay 호출 (DeepSeek 공유 계정 · 로그인 필수 · GDC 차감) ──
    async function relayCall(tier, messages, o, signal) {
      if (!auth) throw new Error('AUTH_REQUIRED: relay 를 쓰려면 auth(KAuth) 를 주입해야 합니다.');
      const { maxTokens = 1200, stream = false, onChunk = null, stepCycle = false } = o;
      // 요청 전에 로그인을 먼저 확정한다 — 공유 계정 relay 가 "누구인지 모르는 상태"로 불리는 경로를 차단.
      await auth.ensureLogin();
      emit('auth', { loggedIn: true });

      const doRequest = async useTier => {
        const resp = await doFetch(cfg.proxyBase + '/klaw/relay', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({
            guid: (auth.getGuid && auth.getGuid()) || 'anonymous', tier: useTier, messages, max_tokens: maxTokens, stream,
            step_cycle: stepCycle, phone_verify_token: auth.getToken(), case_id: null, claim_amount_krw: null,
          }),
        });
        if (stream) {
          let full = '', fin = null;
          await pumpSSE(resp, j => {
            const d = j.choices?.[0]?.delta?.content || '';
            if (j.choices?.[0]?.finish_reason) fin = j.choices[0].finish_reason;
            if (d) { full += d; onChunk && onChunk(d, full); }
          });
          return { text: full, finishReason: fin };
        }
        let data;
        try { data = await resp.json(); } catch (e) { throw new Error('HTTP ' + resp.status); }
        if (!resp.ok || data.error) throw new Error(data.message || data.error || 'HTTP ' + resp.status);
        return { text: data.choices?.[0]?.message?.content || '', finishReason: data.choices?.[0]?.finish_reason };
      };

      const attempt = async useTier => {
        try { return await doRequest(useTier); }
        catch (e) {
          if (isRecoverableAuthError(e.message)) {          // 토큰 만료 → 재로그인 후 한 번 재시도
            auth.logout && auth.logout();
            await auth.ensureLogin();
            return await doRequest(useTier);
          }
          throw e;
        }
      };

      let { text, finishReason } = await attempt(tier);
      // flash 가 토큰 한도로 잘리면 pro 로 딱 한 번 자동 전환 (무한 재시도 방지)
      if (finishReason === 'length' && tier === TIER_INTERVIEW) {
        ({ text, finishReason } = await attempt(TIER_VERDICT));
      }
      return appendTruncationNotice(text, finishReason);
    }

    // ── 통합 LLM 호출 ──
    // o: { stream, onChunk, stepCycle, forceProTier }
    async function llm(messages, maxTokens, o = {}) {
      const signal = o.signal;
      if (usesRelay()) {
        const tier = (o.stepCycle || o.forceProTier) ? TIER_VERDICT : TIER_INTERVIEW;
        return relayCall(tier, messages, { maxTokens, stream: !!o.stream, onChunk: o.onChunk, stepCycle: !!o.stepCycle }, signal);
      }
      const p = PROVIDERS[provider];
      if (!p) throw new Error('지원하지 않는 제공사: ' + provider);
      if (!apiKey) throw new Error('API_KEY_REQUIRED: ' + provider + ' 는 본인 API Key 가 필요합니다.');
      const req = p.build(messages, maxTokens, !!o.stream, model, apiKey);
      const resp = await doFetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
      if (o.stream) {
        let full = '', fin = null;
        await pumpSSE(resp, j => {
          const e = p.err(j); if (e) throw new Error(e);
          const f = p.finish(j); if (f) fin = f;
          const d = p.delta(j);
          if (d) { full += d; o.onChunk && o.onChunk(d, full); }
        });
        return provider === 'deepseek' ? appendTruncationNotice(full, fin) : full;
      }
      const data = await resp.json();
      const e = p.err(data); if (e) throw new Error(e);
      const text = p.text(data);
      return provider === 'deepseek' ? appendTruncationNotice(text, p.finish(data)) : text;
    }

    // ══ 1단계: 사건 분석 ══════════════════════════════════════
    async function analyze(caseText) {
      const input = String(caseText || '').trim();
      if (input.length < MIN_CASE_CHARS) { const e = new Error(`사건 개요를 ${MIN_CASE_CHARS}자 이상 입력해 주세요.`); e.code = 'CASE_TOO_SHORT'; throw e; }
      st.caseText = input;
      st.run = null;
      st.messages = [{ role: 'system', content: ANALYZE_PROMPT }, { role: 'user', content: '사건의 개요:\n' + input }];
      setPhase('analyzing');
      const signal = newSignal();
      try {
        // 복잡한 사건은 분석 단계도 pro tier 로 (flash 가 중간에 끊긴 사례 대응). 예산은 원본과 동일.
        const complex = caseIsComplex(input);
        const attemptAnalysis = async (maxTokens, forceProTier) => {
          const r = await llm(st.messages, maxTokens, { stream: true, forceProTier, signal, onChunk: (d, full) => emit('analyze:chunk', { delta: d, text: full }) });
          return { result: r, caseData: parseAnalysis(r) };
        };
        let { result, caseData } = await attemptAnalysis(complex ? 30000 : 7200, complex);
        if (analysisIsEmpty(caseData)) {                      // thinking 모드가 예산을 추론에 다 쓴 경우 1회 자동 재시도
          emit('analyze:retry', { reason: 'EMPTY' });
          ({ result, caseData } = await attemptAnalysis(42000, true));
        }
        if (analysisIsEmpty(caseData)) {
          const e = new Error('두 번 시도했지만 사건 개요를 추출하지 못했습니다(응답이 비어 있음). 사건이 매우 복잡하거나 입력이 지나치게 길 때 발생할 수 있습니다. 개요를 간결하게 줄여 다시 시도해 보세요.');
          e.code = 'ANALYSIS_EMPTY'; throw e;
        }
        st.messages.push({ role: 'assistant', content: result });
        st.caseData = caseData;
        const needsMoreInfo = hasExtraQuestion(caseData);
        setPhase(needsMoreInfo ? 'chatting' : 'ready');
        emit('analyze:done', { caseData, needsMoreInfo });
        return { caseData, needsMoreInfo, question: needsMoreInfo ? caseData.extraQ : '' };
      } catch (e) {
        setPhase('error'); emit('error', { stage: 'analyze', code: e.code || null, message: e.message });
        throw e;
      }
    }

    // ── 추가질문 응답 ──
    async function reply(text) {
      const t = String(text || '').trim();
      if (!t) throw new Error('답변을 입력해 주세요.');
      st.messages.push({ role: 'user', content: t });
      const check = st.messages.concat([{ role: 'user', content: '위 추가 답변을 반영하여, 판결 시뮬레이션에 충분한 정보가 갖춰졌는지 판단하세요. 추가 질문이 필요하면 【추가질문】 형식으로, 충분하면 "시뮬레이션_진행"이라고만 답하세요.' }]);
      const resp = await llm(check, 500, { signal: newSignal() });
      if (/시뮬레이션[_ ]진행/.test(resp)) { setPhase('ready'); return { ready: true, question: '' }; }
      const qM = resp.match(/【추가질문】\s*([\s\S]*?)(?=【|$)/);
      st.messages.push({ role: 'assistant', content: resp });
      return { ready: false, question: (qM ? qM[1].trim() : resp.trim()) };
    }

    function skipQuestions() {
      st.messages.push({ role: 'user', content: '(추가 정보 없이 진행)' });
      setPhase('ready');
    }

    // ══ 2단계: 판결문 생성 (STEP 0 → A → B → C) ═══════════════
    function baseContext() {
      return st.messages.filter(m => m.role !== 'system').map(m => (m.role === 'user' ? '사용자: ' : 'K-Law: ') + m.content).join('\n\n');
    }

    async function runStep(def, index, run, signal) {
      emit('step:start', { id: def.id, tag: def.tag, title: def.title, index, total: STEP_DEFS.length });
      const prevParts = STEP_DEFS.slice(0, index).map(d => run.parts[d.id]).filter(Boolean).join('\n\n');
      const base = baseContext();
      const ctx = `[사건번호: ${run.caseNo} | 심급: ${run.level}]\n\n` +
        (prevParts ? `[이전 STEP 출력]\n${prevParts}\n\n[사건 정보]\n${base}` : `[사건 정보]\n${base}`);
      const msgs = [{ role: 'system', content: buildSystemPrompt() }, { role: 'user', content: def.prompt(ctx) }];
      const onChunk = (d, full) => emit('step:chunk', { id: def.id, text: stripMatchTag(full) });

      let result = await llm(msgs, def.maxTokens, { stream: true, stepCycle: true, signal, onChunk });
      if (!result.trim()) {                                    // 추론이 예산을 다 먹어 본문이 비면 1.5배로 1회 재시도
        emit('step:retry', { id: def.id, reason: 'EMPTY' });
        result = await llm(msgs, Math.round(def.maxTokens * 1.5), { stream: true, stepCycle: true, signal, onChunk });
      }
      if (!result.trim()) { const e = new Error(`${def.tag}에서 두 번 시도했지만 응답을 받지 못했습니다(빈 응답). 사건이 매우 복잡할 때 발생할 수 있습니다.`); e.code = 'STEP_EMPTY'; throw e; }
      result = stripMatchTag(result);
      run.parts[def.id] = result;
      const completeTags = result.match(/\[STEP-[A-Z0-9-]+-COMPLETE[^\]]*\]/g) || [];
      emit('step:done', { id: def.id, tag: def.tag, index, text: result, completeTags });
    }

    /**
     * @param {{resume?: boolean}} o  resume:true 면 직전 실행이 실패한 STEP 부터 이어서 실행(이미 끝난 STEP 은 재호출·재과금 없음)
     * @returns {Promise<{ok:boolean, caseNo, level, parts, text?, meta?, failedStep?, error?}>}
     */
    async function runVerdict(o = {}) {
      if (!st.caseData) throw new Error('먼저 analyze() 로 사건을 분석해야 합니다.');
      if (usesRelay() === false && !apiKey) throw new Error('API_KEY_REQUIRED');
      if (!st.method.loaded || !st.method.text) {
        // 방법론 없이 판결문을 만들면 품질이 깨진 결과에 비용만 나간다 — 먼저 막는다.
        const r = await loadMethod();
        if (!r.ok) { const e = new Error('방법론 원문을 불러오지 못해 판결문 생성을 중단했습니다: ' + r.error); e.code = 'METHOD_NOT_LOADED'; setPhase('error'); emit('error', { stage: 'verdict', code: e.code, message: e.message }); throw e; }
      }
      let run = st.run;
      if (!(o.resume && run && run.nextIndex < STEP_DEFS.length)) {
        run = st.run = { caseNo: 'SIM-' + new Date().getFullYear() + '-' + String(++simCount).padStart(4, '0'), level: st.caseData.level || '3심', parts: {}, nextIndex: 0 };
      }
      setPhase('generating');
      emit('verdict:start', { caseNo: run.caseNo, level: run.level, version: st.method.version, resumeFrom: run.nextIndex });
      const signal = newSignal();

      for (let i = run.nextIndex; i < STEP_DEFS.length; i++) {
        const def = STEP_DEFS[i];
        try {
          await runStep(def, i, run, signal);
          run.nextIndex = i + 1;
        } catch (e) {
          // 원본은 한 STEP 이 실패해도 다음 STEP 으로 진행했지만, 그러면 STEP A 없이 "최종 판결문"이 만들어진다.
          // 여기서는 멈추고, 호출 측이 runVerdict({resume:true}) 로 실패 지점부터 이어가게 한다.
          setPhase('error');
          emit('step:error', { id: def.id, tag: def.tag, index: i, code: e.code || null, message: e.message, aborted: e.name === 'AbortError' });
          return { ok: false, caseNo: run.caseNo, level: run.level, parts: Object.assign({}, run.parts), failedStep: def.id, error: e.message };
        }
      }

      const text = STEP_DEFS.map(d => run.parts[d.id]).filter(Boolean).join('\n\n');
      const meta = parseVerdictMeta(text);
      const result = { ok: true, caseNo: run.caseNo, level: run.level, version: st.method.version, parts: Object.assign({}, run.parts), text, meta };
      setPhase('done');
      emit('verdict:done', result);
      if (opts.saveSession !== false) result.saved = await saveSession(result);
      return result;
    }

    // ── 이력 저장 (/klaw/sessions) — 로그인 상태일 때만. 실패해도 판결 결과에는 영향 없음 ──
    async function saveSession(result) {
      if (!auth || !doFetch) return false;
      if (auth.hasValidLogin && !auth.hasValidLogin()) return false;
      const token = auth.getToken && auth.getToken();
      if (!token) return false;
      const cd = st.caseData || {};
      try {
        const res = await doFetch(cfg.proxyBase + '/klaw/sessions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone_verify_token: token,
            klaw_version: st.method.version,
            llm_model: usesRelay() ? 'deepseek' : provider,
            case_type: cd.type || null,
            case_level: cd.level || result.level || null,
            case_summary: result.meta.summary ? result.meta.summary.slice(0, 150) : null,
            verdict: result.meta.order,
            confidence: result.meta.totalConfidence != null ? result.meta.totalConfidence + '/10' : null,
            match_rate: null,   // 사건별 일치도 예상은 검증 전 수치라 저장하지 않는다
            case_input: (st.caseText || '').slice(0, 200),
            verdict_full: result.text,
            title: deriveTitle(cd.type, result.meta.summary, cd.caseName),
            is_public: false,   // 기본 비공개. 공개 전환은 이력 페이지에서 사용자가 직접
          }),
        });
        const json = await res.json();
        if (!json.ok) { emit('warning', { code: 'SESSION_SAVE_FAILED', message: '이력 저장에 실패했습니다.' }); return false; }
        emit('session:saved', { id: json.id || null });
        return true;
      } catch (e) {
        emit('warning', { code: 'SESSION_SAVE_FAILED', message: '이력 저장에 실패했습니다: ' + e.message });
        return false;
      }
    }

    function reset() { abort(); st.phase = 'idle'; st.messages = []; st.caseText = ''; st.caseData = null; st.run = null; emit('phase', { phase: 'idle' }); }

    return {
      on, off, configure, loadMethod, analyze, reply, skipQuestions, runVerdict, saveSession, abort, reset,
      get state() { return { phase: st.phase, caseData: st.caseData, methodVersion: st.method.version, usesRelay: usesRelay() }; },
      get steps() { return STEP_DEFS.map(d => ({ id: d.id, tag: d.tag, title: d.title })); },
    };
  }

  return {
    create, STEP_DEFS, ANALYZE_PROMPT, PROVIDERS,
    // 테스트·UI 보조용 순수 함수
    util: { stripMatchTag, parseAnalysis, parseVerdictMeta, caseIsComplex, analysisIsEmpty, hasExtraQuestion, deriveTitle, appendTruncationNotice, isRecoverableAuthError },
  };
});
