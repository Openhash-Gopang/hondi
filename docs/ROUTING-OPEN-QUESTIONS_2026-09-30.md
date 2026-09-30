# 라우팅 경계 미해결 항목 (2026-09-30)

`scenarios_regression_R1_20260801.json` 39건 실측 재검증(PR #481·#482,
그리고 klaw/lawyer 경계 정리) 과정에서, 테스트 데이터 문제도 라우팅
설계 문제도 아니라 **제품 판단이 필요해서 이번에 손대지 않고 남겨둔
4건**을 기록한다. 해당 4건은 R1 시나리오 파일에서 `static_verdict:
"PASS"`로 남아 있어 계속 strict 채점 대상이며, 다음 CI 실행에서도
FAIL로 잡힐 것이다 — 의도적으로 그대로 뒀다(아래 각 항목 참고).

## #4 — ksecurity vs kpolice (보이스피싱)

- 발화: "은행이라는 사람한테 전화 와서 계좌번호랑 비밀번호를 다
  불러줬는데 사기인 거 같아요"
- 기대(R1): `GWP ksecurity`
- 실측: `[GWP: kpolice]`
- 문제: `ksecurity.triggers`(gwp-registry.js)에 '보이스피싱'이 리터럴로
  있고 설명도 "사이버 보안·개인정보 침해 대응"이라 ksecurity가 유력해
  보이는데, `kpolice.triggers`에도 '범죄'·'사기' 계열 일반어가 있어
  경쟁한다. AC-PRO-CORE에 이 두 서비스의 경계를 구분하는 명시적 규칙이
  없다(예: "피해 발생 직후 신고·긴급 조치"는 kpolice, "예방·재발방지·
  사이버 범죄 수사 협조"는 ksecurity 식의 구분이 없음).
- 필요한 결정: 보이스피싱처럼 "사이버 범죄 + 즉시 신고 필요"가 겹치는
  전형적 사례에서 어느 서비스가 기본값이어야 하는지, 혹은 항상 되물어야
  하는지.

## #9 — kfinance vs ktax (연금저축 절세)

- 발화: "연금저축 계좌 세금 좀 아끼는 방법 없을까요"
- 기대(R1): `GWP kfinance`
- 실측: `[GWP: ktax]`
- 문제: AC-PRO-CORE §CORE 2단계 자체가 "kfinance vs ktax"를 **이미
  분야 칸만으로 명확히 안 갈리는 대표 예시**로 들고 있다(되물어야 할
  신호 목록에 명시). 그런데 실측에서 모델은 되묻지 않고 ktax를 바로
  선택했다 — 이건 라우팅이 "틀렸다"기보다, 정작 되물어야 할 상황에서
  안 되물은 §CORE 준수 이슈에 더 가깝다.
- 필요한 결정: (a) 연금저축·IRP·ISA처럼 투자 계좌의 세금 최적화는
  kfinance가 기본값이라고 명문화할지, (b) 이 유형은 항상 되묻게
  강제할지, (c) 현재처럼 애매한 채로 두고 이후 실사로 더 관찰할지.

## #14 — klogistics vs kbusiness (재고 파악)

- 발화: "창고에 재고가 얼마나 남았는지 파악이 안 돼서 곤란해요"
- 기대(R1): `GWP klogistics`
- 실측: `[GWP: kbusiness]`
- 문제: `klogistics.triggers`에 '재고'가 리터럴로 명시돼 있어 표면적으론
  klogistics가 명백해 보이는데도 모델이 kbusiness(사업체 재무·경영
  분석)로 라우팅했다. klogistics(priority 8)가 kbusiness(priority 9)
  보다 우선순위가 높게 등록돼 있는데도 이 결과가 나온 것으로 보아,
  단순 trigger 표 매칭이 아니라 "재고 파악이 안 된다"는 표현을
  "경영난·매출 분석" 쪽 의미로 폭넓게 해석했을 가능성.
- 필요한 결정: klogistics 설명에 "재고 현황 파악·관리" 자체가 배송·물류
  운영의 일부임을 더 명시적으로 강조할지, 아니면 kbusiness 쪽 설명에서
  "재고·매출 분석"이 겹치는 부분을 정리해 경계를 좁힐지.

## #25 — paramedic(EXPERT) vs kemergency(GWP) (응급처치 사전 학습)

- 발화: "아이가 갑자기 쓰러졌을 때 어떻게 응급처치를 해야 하는지 미리
  배워두고 싶어요"
- 기대(R1): `EXPERT paramedic`
- 실측: `[GWP: kemergency]` — 다만 raw_response 자체는 "이건 예방·교육
  목적이지 실제 응급 상황은 아니다"라고 명확히 인지한 뒤 kemergency의
  교육 콘텐츠 경로로 안내함.
- 문제: §SAFETY(응급 신호 감지 시 즉시 kemergency)와 paramedic EXPERT의
  "의료 상담·자문" 역할이 "응급처치를 사전에 배우고 싶다"는 예방적
  교육 요청에서 서로 겹친다. 모델의 판단(실제 응급이 아니므로 교육
  콘텐츠로 안내) 자체는 합리적으로 보이지만, 그 경로가 kemergency
  GWP인지 paramedic EXPERT(1:1 상담)인지는 §CATALOG에 명확한 기준이
  없다.
- 필요한 결정: "응급처치를 미리 배우고 싶다"류 예방·교육형 요청을
  전담할 경로를 kemergency의 하위 기능으로 둘지, paramedic EXPERT로
  분리할지.

## 공통 메모

4건 모두 "라우팅이 명백히 틀렸다"라기보다 **두 서비스의 역할 경계가
아직 명문화되지 않은 지점**이다. klaw/lawyer 건(2026-09-30, 이 커밋과
같은 PR)처럼 실제 담당 서비스가 확정되면, 그 경계를 §CATALOG/
§CATALOG-EXPERT 설명에 명문화하고 R1 시나리오의 expected 값도 함께
갱신하는 패턴을 따르면 된다.
