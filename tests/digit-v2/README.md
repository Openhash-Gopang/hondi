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
