# 적극적 보조 원칙(§14/C35/P10) 사고실험 보고서 v4
> v3 이후 변경점: 사용자 지시에 따라 `K-Public_common_v1_0→v1_1` 개정
> (P10 파이프라인: 접수·명확화 → 위치파악 → PDV 중개 개인정보확보 → 업무수행
> → 사용자/기관 인간 보고·승인 → 최종실행·결과보고). 재사고실험 수행.

> **2026-07-04 추가 업데이트**: `wrangler deploy` 실제 실행 완료 확인
> (Version ID `5b6927cc-8b25-481f-8a83-f1019e7979c5`, `hondi-proxy.tensor-city.workers.dev`).
> 이 과정에서 실제 운영 중이던 Cloudflare Worker를 대조한 결과, 리포의
> `worker.js`에만 있던 `/gov/relay`·`/klaw/relay`·`ALLOWED_ORIGINS`의
> `jeju.hondi.net` 항목이 **운영본에는 배포된 적이 없었다는 것**이 확인됐다
> — 즉 아래 45건은 이번 배포 전까지 코드는 존재하되 실제로는 전부 FAIL
> 상태였다. 이제 45건을 **PASS(배포 완료)**로 갱신한다. 상세는
> `scenarios_300_v5.json` 참조. (K-Law 및 배선 불명 5개 서비스는 이번
> 배포와 무관하게 여전히 FAIL — §1 참고)

---

## 0. 요약

| 트랙 | 시나리오 | PASS | PASS(조건부/배포대기) | PARTIAL | FAIL |
|---|---|---|---|---|---|
| 전문직 페르소나 (26개) | 78 | **78** | 0 | 0 | 0 |
| 제주 정부·국가기관 (51개) | 137 | 3 | 18 | **116** | 0 |
| K-서비스 (16개) | 85 | 0 | **45** | 0 | **40** |
| **합계** | **300** | 81 | 63 | 116 | **40** |

v3 대비 K-서비스 트랙 FAIL 85건 중 **45건이 PASS(배포 대기)로 전환**됐다. `K-Public_common_v1_1.md`에 P10 파이프라인을 추가하고, `worker.js`의 `K_PUBLIC_COMMON_URL`을 v1.1로 갱신했다. 이 URL은 `/gov/relay`가 GitHub raw에서 직접 fetch하는 실제 런타임 경로임을 소스에서 확인했다(캐시 TTL 10분).

## 1. 새로 밝혀진 사실 — GOV_AGENCIES 허용 목록

`worker.js`를 더 파고들자 `/gov/relay`가 아무 K-서비스나 다 받아주는 게 아니라 **명시적 허용 목록**(`GOV_AGENCIES`)이 있었다:

```js
const GOV_AGENCIES = new Set([
  'public', 'tax', 'health', 'police', '911', 'democracy', 'insurance',
  'traffic', 'logistics',
]);
```

16개 K-서비스 중 이 9개(K-Public·K-Tax·K-Health·K-Police·K119·K-Democracy·K-Insurance·K-Traffic·K-Logistics)만 실제로 K-Public_common을 상속한다. 나머지는:

| SP | 상태 |
|---|---|
| K-Law (SP-01) | `/klaw/relay`로 별도 처리 — 코드 주석에 "다음 개정 때 이 경로로 통합 예정"이라 명시. **미상속.** |
| K-School, K-GDC, K-Stock, K-Market, K-Clean | `GOV_AGENCIES`에 없음 — 이번 세션에서 이 5개가 시스템 프롬프트를 어떻게 조립하는지 이 저장소 안에서 찾지 못함. 별도 워커이거나 미완성 상태로 추정되나 **확인 불가.** |

즉 "K-Public_common 한 곳만 고치면 16개 전체에 전파된다"는 v3 보고서의 암묵적 전제는 **틀렸다** — 실제로는 9개에만 전파되고, K-Law는 알려진 대로 별도, 나머지 5개는 배선 자체가 불투명하다. 이 정정은 이번 라운드의 가장 중요한 발견이다.

## 2. 트랙별 갱신 결과

### 2-1. 페르소나 — 변동 없음 (78/78 PASS)

### 2-2. 정부(Jejudo) — 변동 없음 (PARTIAL 116건 그대로)

이번 라운드는 K-Public_common만 건드렸으므로 JEJU-GOV-COMMON 쪽 상태는 v3와 동일하다. `jeju` 저장소 미확인 문제도 그대로 남아있다.

### 2-3. K-서비스 — 45건 PASS(배포 대기)로 전환, 40건 FAIL 유지

**PASS(배포 대기)** 라고 부르고 "PASS"라고 부르지 않은 이유: 소스 코드(`K-Public_common_v1_1.md`, `worker.js`)는 저장소에 커밋·푸시됐지만, 이 저장소가 실제 Cloudflare Worker(hondi-proxy)의 배포 소스인지, 그리고 `wrangler deploy` 같은 배포 절차가 별도로 필요한지는 **이번 세션에서 확인·실행하지 못했다** — 컨테이너 네트워크 허용 목록에 Cloudflare API 도메인이 없다. 코드는 고쳤지만 "실제로 서비스 중인 워커에 반영됐는지"는 다른 문제라는 걸 이 보고서가 스스로 정직하게 구분해야 한다(P3/§10 원칙을 이 보고서 자체에도 적용).

**FAIL 유지 40건** = K-Law(15건) + 배선 불명 5개 서비스(25건). K-Law는 `/klaw/relay`가 별도 로직이라 이번 개정과 무관하다.

## 3. 갱신된 권고 (우선순위 순)

1. **(배포 확인)** `hondi-proxy` Cloudflare Worker에 이번 `worker.js` 변경사항이 실제로 배포됐는지 확인한다 — `wrangler tail` 또는 실제 요청 테스트로.
2. **(배선 확인)** K-School·K-GDC·K-Stock·K-Market·K-Clean 5개 서비스가 시스템 프롬프트를 어디서/어떻게 조립하는지 찾는다. `GOV_AGENCIES`에 추가할 수 있는 것들인지, 아니면 원래 다른 상속 구조를 쓰는지부터 확인이 먼저다.
3. **(K-Law 통합)** `SP_hierarchy_inheritance_v1_0.md`에 이미 "다음 개정 때 편입 예정"이라고 적혀있던 작업 — K-Law를 `/gov/relay` + `K-Public_common`으로 통합할지, 아니면 판결방법론(v15.1)의 특수성 때문에 계속 별도로 둘지 결정이 필요하다.
4. 정부(Jejudo) 트랙의 `jeju` 저장소 미확인 문제는 v3 권고 그대로 유효하다.

---

*원자료: `scenarios_300_v4.json` (300건, verdict/reason 갱신본).*
