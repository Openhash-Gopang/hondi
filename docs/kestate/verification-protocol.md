# K-Estate 3단계 가치평가 — 검증 규약 (초안, 2026-09-28)

K-Law(klaw.hondi.net)의 표본 밖 검증·"표본 오염 방지" 개념을 참고해,
국가·지역·개별 3단계 가치평가(`src/gopang/ai/hondi-staged-valuation.js`)를
실제 사건에 배포하기 전과 배포 후 정기적으로 검증하는 규약이다.

## 왜 필요한가

이 모듈의 상수(연변동성 기본값 6%, 지역 위험 요인별 σ 가산치, 개별 하자
σ 가산치 등)는 전부 가정이며 백테스트로 보정되지 않았다
(`hondi-staged-valuation.js` 파일 머리 주석 참조). SP-24a 자체도 아직
sp-catalog.json에 등록되지 않은 초안이다. 실제 사건에 쓰기 전에, 그리고
쓴 뒤에도, "추정이 실제와 얼마나 가까운가"를 표본 밖(out-of-sample)에서
계속 재봐야 한다.

## 표본 오염 방지 원칙

- **시간 분리(splitByTime)**: 상수를 보정하는 데 쓴 과거 사건(훈련 기간)과
  검증에 쓰는 사건(검증 기간)은 시간으로 나눈다 — 무작위 분리가 아니다.
  부동산 시세는 시계열 상관이 커서, 무작위 분리는 미래 정보가 과거 보정에
  새어 들어가는 것(look-ahead bias)을 못 막는다.
- **오염 없음 확인(assertNoContamination)**: 검증 기간의 어떤 사건도
  `hondi-staged-valuation.js`의 상수를 고르는 데 쓰이지 않았음을, 상수를
  바꿀 때마다 사람이 확인하고 기록한다. 이 저장소에는 아직 이 확인을
  자동화하는 코드가 없다 — 사람이 PR 설명에 "어떤 사건으로 어떤 상수를
  바꿨고, 검증에는 어떤 사건을 썼는지"를 적는 것으로 대신한다(자동화는
  향후 과제).

## 채점 기준

`hondi-valuation-metrics.js`의 `evaluate`/`evaluateByTag`를 그대로 쓴다.
3단계 가치평가가 추가한 것은 입력(fair_value·sigma)이 어떻게 만들어지는가
뿐이므로, 채점 자체는 기존 중재/대출 두 트랙의 채점(`evaluateMediationTrack`,
`evaluateLendingTrack`, `hondi-valuation-tracks.js`)을 그대로 재사용한다.

추가로 단계별 원인 분석을 위해 `cause_tags`에 다음을 포함할 수 있다:
`national_index_missing`(시점수정 자료 없이 진행됨), `regional_ratio_missing`
(지역 가격 수준비 없이 진행됨), `registry_unconfirmed_rejected`(등기부
미확인으로 거부됨).

## 채택 기준값 — 비워 둠

아래 값은 실제 검증 표본이 모일 때까지 **사람이 사전등록**해야 하며,
지금은 비워 둔다(가정값으로 임의 채우지 않는다):

- 시점수정(국가) 지수비의 표본 밖 허용 오차
- 지역 가격 수준비 관측값의 신뢰 최소 표본 수
- 정비구역 단계별 σ 가산치가 실제 낙찰가 분산과 맞는지의 판정 기준
- 검증 표본 최소 건수(`hondi-valuation-metrics.js`의 `LOW_SAMPLE_N=30`을
  잠정 차용하되, 3단계 평가 전용 기준은 별도로 정해야 한다)

## 한계

- SP-24a가 아직 배선되지 않아, 지금은 코드 계산 로직만 유닛 테스트로
  검증된 상태다(`tests/settlement/staged-valuation.test.mjs`). 이 규약은
  SP-24a가 실제 운영에 배선된 이후에나 실행할 수 있다.
- 조직의 다른 저장소·운영 중 배포된 프롬프트 버전은 이 문서 작성 시
  확인하지 못했다.
