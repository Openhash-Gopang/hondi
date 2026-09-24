# 혼디 숫자 코드 v2 테스트

```powershell
cd tests\digit-v2
npm install
npm run test:unit            # 서명된 청구 레코드 + Worker 핸들러 (19개, 수 초)
npm run consts               # 코어의 레이아웃 상수를 consts.json으로
pip install pillow numpy     # 최초 1회
$env:QUICK=1; npm run gen    # 빠른 점검(약 275장). 전체(3,300장)는 QUICK 없이, 수 분 걸림
npm run test:recog           # 인식 시뮬레이션 — 요약 표 출력
node real.mjs 사진.png       # 실제 사진/스크린샷 한 장 인식
```
합격 기준: **오인식(WRONG)·오탐(FALSE-ACCEPT) 0건**. 거절(reject)은 안전한 실패라 허용한다.

## 로고 검증
`hondi-digit-core.js`의 `LOGO_TEMPLATE`은 `assets/hondi-net-logo.png`에서 만든 48×8 템플릿이다. 로고 이미지를 바꾸면
`node make-logo-template.mjs`의 출력으로 교체하고, `LOGO`(잉크 범위 상수)도 맞춰야 한다.
`S6_fake_logo` 스위트(검은 막대·블록·줄무늬·점·다른 글자)는 전부 거절되어야 한다.

## 어수선한 화면(S7)
실기기 테스트에서 "코드 아래에 다른 화면 요소가 있으면 숫자열을 못 찾는" 결함이 나왔다(맨 아래 덩어리를 숫자열로 가정).
이제 로고를 먼저 찾고 그 아래에서만 숫자열을 찾는다. `S7_clutter` 스위트는 코드 위·아래에 글자줄·슬라이더·버튼을 둔 장면이며,
오인식 0건이 유지되어야 한다(거절은 허용).
