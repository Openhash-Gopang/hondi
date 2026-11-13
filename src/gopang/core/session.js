/**
 * core/session.js — 세션 대화 저장 + OpenHash 앵커링 (앱 숨김 시 1회)
 *
 * 설계 원칙:
 *   - 세션 단위 = 앱 진입 ~ 앱 종료(visibilitychange / pagehide)
 *   - 세션 안의 모든 대화 + 거래를 하나의 데이터 뭉치로 묶어
 *     SHA-256 → hashChain.anchor() 1회 기록
 *   - 원문은 localStorage에 보존, OpenHash에는 해시만 기록
 */
import { history, L1_PDV_URL, L1_ANCHOR_URL } from './state.js';
import { USER_GUID } from './state.js';

const DOMAIN_PATTERNS = {
  ECO: /금융|투자|세금|결제|송금|보험|연금|대출|환율|주식|가계부/,
  MED: /병원|의사|약|진료|처방|응급|건강|수술|의료|코로나|백신/,
  EDU: /학교|강의|시험|특허|논문|학습|교육|수업|입학|졸업/,
  TRN: /배달|택배|교통|버스|지하철|택시|운전|물류|배송|주차/,
  MKT: /구매|쇼핑|거래|계약|부동산|임대|판매|상품|가격|주문/,
  GOV: /민원|등본|신고|행정|정부|공공|허가|면허|신청|공무원/,
  JUS: /법|소송|재판|경찰|변호사|판결|고소|계약서|법원|범죄/,
  IND: /제조|건설|농업|공장|생산|설비|작업|현장|제품|원자재/,
  ENV: /환경|에너지|재활용|기후|탄소|오염|태양광|전기|가스|수도/,
  CUL: /여행|관광|스포츠|영화|음악|게임|식당|카페|취미|문화/,
  SOC: /복지|고용|실업|육아|노인|장애|사회보험|지원금|봉사/,
  IOT: /냉장고|세탁기|에어컨|차량|스마트홈|IoT|사물|기기|센서/,
};

function _classifyDomain(text) {
  for (const [code, re] of Object.entries(DOMAIN_PATTERNS)) {
    if (re.test(text)) return code;
  }
  return 'ETC';
}

async function _saveSessionOnce() {
  if (history.length < 2) return;

  // ── 도메인 분류 ──────────────────────────────────────
  const domainCount = {};
  for (const msg of history) {
    const d = _classifyDomain(String(msg.content));
    domainCount[d] = (domainCount[d] || 0) + 1;
  }
  const primaryDomain = Object.entries(domainCount).sort((a,b)=>b[1]-a[1])[0][0];
  const now   = new Date().toISOString();
  const today = now.slice(0, 10);
  const key   = `gopang_history_${USER_GUID}_${today}`;

  // ── 세션 데이터 구성 ─────────────────────────────────
  // system 메시지 제외 — 사용자/AI 발화 + 거래만 포함
  const sessionMessages = history.filter(m => m.role !== 'system');
  const sessionId = `SES-${(USER_GUID || 'anon').replace(/:/g,'').slice(0,12)}-${Date.now()}`;

  const sessionData = {
    sessionId,
    guid:      USER_GUID || null,
    startedAt: history.find(m => m.role !== 'system')?.ts || now,
    endedAt:   now,
    domain:    primaryDomain,
    turns:     sessionMessages.length,
    messages:  sessionMessages,   // 대화 + 거래 전체 원문
  };



  // ── OpenHash 앵커링 ───────────────────────────────────
  // 설계 원칙:
  //   - 세션 원본 → vault.js IndexedDB (AES-256-GCM, 기기 내 보관)
  //   - contentHash = SHA-256(sessionRaw) → OpenHash에만 기록
  //   - userSig = gopangWallet.sign(contentHash) → 신원 증명
  //     "나는 이 세션 데이터가 정확함을 서명한다"
  //   - anchor(contentHash, [userSig], sessionId)
  //     entryHash = SHA-256(prevHash + contentHash + userSig + blockHeight)
  //   - prevHash: 이전 세션 체인 상태 (위변조 방지 핵심)
  try {
    const { anchor }       = await import('../../openhash/hashChain.js');
    const { storeMessage } = await import('../../pdv/vault.js');

    // 세션 원문 직렬화
    const sessionRaw = JSON.stringify(sessionData);

    // ② contentHash = SHA-256(sessionRaw)
    // ★ 2026-07-28 순서 변경 — 원래는 vault 저장(현재의 ①) 뒤에 계산되던
    // 걸 앞으로 옮겼다. vault.js의 _validateRecord()가 모든 레코드에
    // senderPubKeyB64·signature를 필수로 요구하는데(원래 P2P 서명 메시지
    // 스키마), 이 세션 로그 저장은 그 두 필드를 안 채워서 매번
    // "[Vault] 필수 필드 누락: senderPubKeyB64"로 실패하고 있었다(무시되는
    // catch라 조용히 실패). 서명 자체는 바로 아래(구 ③단계)에서 이미
    // 계산하고 있었으니, 그 계산만 앞으로 옮기고 실제로 vault 레코드에
    // 채워 넣는다.
    const buf         = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionRaw));
    const sessionHash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');

    // ③ Ed25519 서명 — gopangWallet.sign()이 없으면 guid로 fallback
    let userSig = USER_GUID || 'anon';
    try {
      if (window.gopangWallet?.sign) {
        userSig = await window.gopangWallet.sign(sessionHash);
      }
    } catch (e) {
      console.warn('[Session] Ed25519 서명 실패, guid로 대체:', e.message);
    }
    // gopang-wallet.js의 GopangWallet 인스턴스가 노출하는 공개키 필드명은
    // publicKeyB64u(Base64URL) — vault.js가 요구하는 레코드 필드명
    // senderPubKeyB64와는 이름이 다르지만 같은 값이다. 지갑이 아직 준비
    // 안 됐으면(초기 로드 중 등) USER_GUID로 최소한의 발신자 식별은 남긴다
    // — vault의 필수 필드 검증만 통과시키는 게 목적이지, 이 폴백 자체가
    // 암호학적 서명을 대체한다고 주장하지 않는다(§HONESTY와 동일 원칙).
    const senderPubKeyB64 = window.gopangWallet?.publicKeyB64u || USER_GUID || 'anon';

    // ① 원본 저장 — 이 기기의 로컬 vault(IndexedDB)에 남길지, 공용 PC
    //    세션이라 폰으로 릴레이만 하고 이 PC엔 아무것도 안 남길지 분기.
    //    (2026-07-23 신설, 5단계 — B안: 폰이 오프라인이면 유실 감수)
    if (sessionStorage.getItem('gopang_pc_session_mode') === 'shared' && USER_GUID) {
      try {
        await window.GopangWallet?.relayContentToPhone?.(USER_GUID, sessionRaw);
      } catch (e) {
        console.warn('[Session] 공용 PC 원문 릴레이 실패 (무시 — 이 PC엔 원문을 남기지 않음, B안):', e.message);
      }
    } else {
      //    원본 보관 주체 = 사용자 기기
      //    검증 시: vault에서 원본 꺼냄 → SHA-256 재계산 → entryHash 대조
      await storeMessage({
        msgId:     sessionId,
        senderId:  USER_GUID || 'anon',
        senderPubKeyB64,
        signature: userSig,
        role:      'session',
        content:   sessionRaw,
        timestamp: now,
        riskLevel: 'S0',
        sessionId,
      }).catch(e => console.warn('[Session] vault 저장 실패 (무시):', e.message));
    }

    // ④ anchor(contentHash, [userSig], sessionId)
    const result = await anchor(sessionHash, [userSig], sessionId);

    console.log(`[Session] OpenHash 앵커링 완료`,
      '| sessionId:', sessionId,
      '| domain:', primaryDomain,
      '| turns:', sessionMessages.length,
      '| sessionHash:', sessionHash.slice(0,16) + '...',
      '| entryHash:', result.entryHash.slice(0,16) + '...',
      '| layer:', result.layer);

    // ── localStorage 저장 (entryHash 포함 — 앵커링 완료 후)
    // Hash Chain 보기에서 AI 대화 세션도 조회 가능하도록 entryHash 포함
    try {
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.push({
        ts:        now,
        domain:    primaryDomain,
        turns:     sessionMessages.length,
        summary:   sessionMessages.slice(-4),
        sessionId,
        entryHash: result.entryHash,   // ← Hash Chain 보기용
        layer:     result.layer,
      });
      localStorage.setItem(key, JSON.stringify(existing));
      console.log(`[Session] localStorage 저장 완료 — 영역: ${primaryDomain}, entryHash: ${result.entryHash.slice(0,16)}...`);
    } catch(e) {
      console.warn('[Session] localStorage 저장 실패:', e.message);
    }

    // ── pdv_log 기록 (block_hash = entryHash → openhash_anchored: true)
    {
      const _report = {
        svc:          'gopang',
        type:         'session_end',
        reporter_svc: 'gopang-session',
        session_id:   sessionId,
        block_hash:   result.entryHash,
        who:   { ipv6: USER_GUID },
        when:  { period_start: sessionData.startedAt, period_end: now },
        where: { svc_url: 'https://app.naviweb.kr' },
        what:  { summary: `세션 종료 — ${primaryDomain} 영역, ${sessionMessages.length}턴` },
        how:   { method: '앱 종료(visibilitychange / pagehide)' },
        why:   { goal: '세션 데이터 PDV 기록' },
      };

      // T-C: L1 pdv_records 직접 기록 (Worker pdv 리포트 대체)
      fetch(L1_PDV_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guid:         USER_GUID,
          report_id:    `${sessionId}:gopang-session`,
          reporter_svc: _report.reporter_svc,
          svc:          _report.svc,
          type:         _report.type,
          summary:      _report.what.summary,
          summary_6w:   JSON.stringify(_report),
          block_hash:   _report.block_hash,
          risk_level:   'low',
          source:       _report.svc,
          openhash_anchored: !!_report.block_hash,
        }),
      }).catch(e => console.warn('[Session] L1 pdv_records 전송 실패 (무시):', e.message));

      fetch(L1_ANCHOR_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_hash:   result.entryHash,
          content_hash: sessionHash,
          msg_id:       sessionId,
          source:       'pdv_records',
        }),
      }).catch(e => console.warn('[Session] L1 anchor_records 전송 실패 (무시):', e.message));
    }

  } catch(e) {
    console.warn('[Session] OpenHash 앵커링 실패 (무시):', e.message);
  }
}

let _sessionSaved = false;
export function _saveOnce() {
  if (_sessionSaved) return;
  _sessionSaved = true;
  // async — fire-and-forget (visibilitychange/pagehide 핸들러가 await 불가)
  _saveSessionOnce().catch(e => console.warn('[Session] _saveOnce 오류:', e.message));
}
