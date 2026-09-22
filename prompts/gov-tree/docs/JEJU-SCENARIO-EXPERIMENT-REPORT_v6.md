# 적극적 보조 원칙 사고실험 보고서 v6 — jeju 배선 확인 + K-School/Market/Stock/GDC 신규 발견
> v5 이후 두 미확인 항목을 순차 확인.

## 1. 정부(Jejudo) 트랙 — jeju 저장소 확인 결과: 정상

`jeju` 저장소(`Openhash-Gopang/jeju`)의 `jeju-router.js`:

```js
const _RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/Jejudo/';
if (!_govCommon) _govCommon = await _fetchText('00-common/JEJU-GOV-COMMON_v1_5.md');
```

`gopang` main 브랜치에서 **매 요청 실시간 fetch**하는 구조라, worker.js와 달리 별도 배포 절차 없이 v1.5 push 시점에 즉시 반영됨. `webapp.html`의 AI 호출도 `hondi-proxy.tensor-city.workers.dev`를 정확히 사용. **정부 트랙 137개 시나리오 중 PARTIAL로 남아있던 116건의 근거였던 "jeju 리포 미확인" 문제는 해소.** (단, 도메인별 실행 예시 부족 문제는 v3 권고대로 여전히 유효.)

## 2. K-School·K-Market·K-Stock·K-GDC — 새로 발견된 별개 문제

`GOV_AGENCIES` 목록에 없어 "배선 불명"이라고 남겨뒀던 4개 서비스를 직접 클론해서 확인.

**(a) K-Public_common 미상속 — 애초에 편입 대상이 아니었음**
각 서비스가 자기 `prompts/` 폴더의 단일 파일만 fetch (`system_prompt.txt`, `SP-KMARKET-v2_4.txt`, `SP-GDC_v2_0.txt` 등). 공통 규칙을 앞에 붙이는 조립 로직 자체가 없다 — GOV_AGENCIES 추가로 해결될 문제가 아니라, 애초에 K-Public 생태계 밖에서 독립적으로 만들어진 서비스들.

**(b) 더 심각한 문제 — 폐기된 프록시 엔드포인트 사용**
4개 저장소 전부 `js/config.js`, `webapp.html`, `gopang-wallet.js` 등에서 AI 호출(`/deepseek`)과 PDV 리포트(`/pdv/report`)를 다음으로 하드코딩:
```
https://gopang-proxy.tensor-city.workers.dev
```
`hondi-proxy`가 아니다. gopang 리포에는 "저장소 전체 gopang-proxy 잔재 정리 — hondi-proxy로 통일"이라는 커밋이 이미 있었는데, 그 정리가 이 4개의 **별도 저장소**까지는 미치지 못한 것으로 보인다. 공통 원인은 각 저장소에 복붙된 `gopang-wallet.js`(4개 저장소 모두 동일 내용)가 구버전 URL을 그대로 갖고 있는 것.

**리스크**: `gopang-proxy.tensor-city.workers.dev`가 지금도 살아있는 워커인지 이번 세션에서 확인 못 했다(컨테이너 네트워크 정책상 `*.workers.dev` 접근 불가). 만약 이미 폐기됐다면 이 4개 서비스는 **AI 채팅과 PDV 기록이 현재 전부 실패 중**일 수 있다 — 조속한 확인 필요.

**K-Clean**: `kcleaner`/`fiil`/`fiil-kcleaner` 이름으로 GitHub 조직 내 저장소를 찾지 못함. 다른 이름이거나 별도 호스팅으로 추정, 미확인 상태로 남김.

## 3. 갱신된 종합 표

| 트랙 | 상태 |
|---|---|
| 전문직 페르소나 (26) | PASS 확정 |
| 정부 Jejudo (51) | 상속 배선 확인됨(v6). 실행예시 보강은 과제로 남음 |
| K-Public 산하 9개 (public/tax/health/police/911/democracy/insurance/traffic/logistics) | PASS, 배포 확인됨(v5) |
| K-Law | 별도 `/klaw/relay` 유지, 미상속 |
| K-School/Market/Stock/GDC | **K-Public 생태계 밖, 별개 문제(구버전 프록시 엔드포인트) 발견 — 원 목적(§14 상속)과 무관하게 우선 점검 필요** |
| K-Clean | 저장소 미발견, 미확인 |

## 4. 권고 (갱신)

1. **(긴급, 신규)** `gopang-proxy.tensor-city.workers.dev` 생존 여부 확인. 죽어있다면 K-School/Market/Stock/GDC의 `gopang-wallet.js` 및 각 webapp.html의 엔드포인트를 `hondi-proxy`로 즉시 교체.
2. 이 4개 서비스를 K-Public 생태계에 편입할지(별도 설계 결정 필요 — 지금은 의도적으로 독립된 서비스였을 가능성도 있음) 여부와 무관하게, (1)이 선행돼야 함.
3. K-Clean 저장소 위치 확인.
4. 정부 트랙 실행例시 보강(v3 권고 유지).
