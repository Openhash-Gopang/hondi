# WINDOWS_PATCH_DEPLOY_TROUBLESHOOTING_v1_0.md
## Claude가 생성한 파일(zip/patch)을 Windows PowerShell에서 Openhash-Gopang/hondi에 반영할 때 겪은 실패와 해법

작성일: 2026-09-09 | 작성자: 주피터님 지시, Claude 작성 (SP 시민용 설명 초안 배포 세션에서 실제로 겪은 문제 기록)

> 이 문서는 "다음에 같은 종류의 배포를 할 때 똑같은 실패를 반복하지 않기 위한" 체크리스트다.
> 원인 진단에 3번의 시행착오가 있었으므로, 각 실패의 **진짜 원인**과 **최종 해법**만 정리한다.

---

## 환경 전제

- 작업 PC: Windows, PowerShell, 사용자 홈 경로에 한글(`C:\Users\주피터\...`) 포함
- 저장소 로컬 클론: `C:\Users\주피터\Downloads\hondi`
- Claude가 만든 결과물은 브라우저를 통해 항상 `C:\Users\주피터\Downloads\` **루트**에 저장됨 (repo 폴더 안이 아님)

---

## 실패 1 — `Expand-Archive`가 "경로에 잘못된 문자가 있습니다" 오류를 냄

**증상**:
```
New-Object : "1"개의 인수가 있는 ".ctor"을(를) 호출하는 동안 예외가 발생했습니다. "경로에 잘못된 문자가 있습니다."
```

**시도했다가 틀렸던 진단**: zip 안의 파일명이 한글이라서 그런가 싶어 `README_적용방법.txt` → `README.txt`로 바꿔봤지만 **재발**했다.

**진짜 원인**: `Expand-Archive`(PowerShell 내장, 구형 .NET `System.IO.Compression.ZipFile` 기반)는 **압축 해제 대상 경로 자체**(`...\Downloads\hondi\_incoming`)에 비-ASCII 문자(`주피터`)가 있으면 이 컴퓨터의 .NET/코드페이지 설정에 따라 이 예외를 던지는 것으로 확인됐다. zip 안의 파일명 문제가 아니었다.

**해법 — `Expand-Archive` 대신 `tar` 사용**:
```powershell
tar -xf .\받은파일.zip -C .\_incoming
```
Windows 10/11에 `tar.exe`(bsdtar)가 기본 내장돼 있고, 이 경로 문제를 겪지 않는다.

**주의**: `tar`도 zip 안에 **한글 파일명 항목**이 있으면 콘솔 코드페이지에 따라 그 항목만 깨져서 개별 오류(`Invalid empty pathname` 등)를 낼 수 있다(실패 2 참고). 그러니 **zip을 만드는 쪽(Claude)이 zip 내부 파일명을 전부 ASCII로만 구성**하는 것이 근본 해법이다 — 압축 해제하는 쪽 환경을 바꿀 필요가 없어진다.

---

## 실패 2 — `tar`가 특정 항목에서 `Invalid empty pathname` 오류

**증상**:
```
README_?곸슜諛\251\353쾿.txt: Invalid empty pathname: Unknown error
tar.exe: Error exit delayed from previous errors.
```

**원인**: 이건 사용자가 받은 zip이 **한글 파일명이 남아있던 예전 버전**이었기 때문이다(브라우저의 동일 파일명 캐싱 등으로 이전 다운로드가 재사용될 수 있음). `tar`는 이 한글 파일명 항목 하나만 실패시키고 **나머지 파일은 정상 추출**했다(`sp-descriptions-draft.json`은 이어지는 단계에서 정상 발견됨) — 하지만 종료 코드는 실패로 리턴되므로, 스크립트에서 `tar` 종료 코드로 전체 성공 여부를 판단하면 안 된다.

**해법(Claude 쪽, 산출물 생성 시)**:
- zip 안에 넣는 모든 파일명을 **영문/숫자/하이픈/언더스코어만** 사용한다. 한글 파일명은 절대 넣지 않는다(내용은 한글이어도 무방, 파일명만 문제).
- zip을 재생성할 때는 기존 zip을 **먼저 삭제**하고 새로 만든다(`zip -r` 은 기존 zip에 append/update하므로, 이름을 바꾼 파일을 추가해도 옛 이름의 항목이 그대로 남아 있을 수 있다 — 실제로 이번에 한 번 겪었다).
- 배포 zip 완성 후 `unzip -l`로 내부 파일명 목록을 눈으로 확인하고 나서 제출한다.

**해법(사용자 쪽)**: 혹시 위 원칙을 지킨 새 zip인데도 이 오류가 나면, 브라우저 캐시 때문에 옛 파일이 재사용됐을 가능성이 높다 — 새로 받은 zip의 파일 크기/수정시각을 확인하거나, 다른 파일명으로 다시 요청한다.

---

## 실패 3 — `git am`이 "Patch format detection failed"

**증상**:
```
git am .\_incoming\0001-xxx.patch
Patch format detection failed.
```

**원인 (이게 가장 중요한 근본 원인)**: Claude가 패치 파일을 만들 때 **`git diff`** 로 만들었는데, 사용자에게는 **`git am`** 으로 적용하라고 안내했다. 이 둘은 다른 형식이다:

| 명령 | 만드는 형식 | 적용에 필요한 명령 |
|---|---|---|
| `git diff` | 순수 unified diff (`diff --git ...`로 바로 시작) | **`git apply`** |
| `git format-patch` | 이메일(mbox) 형식 (`From <hash>`, `From:`, `Date:`, `Subject:` 헤더로 시작) | **`git am`** |

`git am`은 mbox 헤더가 없는 파일을 받으면 "무슨 형식인지 모르겠다"며 바로 실패한다. `git diff` 결과물에는 그 헤더가 없으므로 항상 실패한다.

**해법 — 앞으로 지킬 규칙**:
- Claude가 **`git diff`로 패치를 만들었다면 → 사용자에게 `git apply`로 적용하라고 안내**한다.
- Claude가 **`git format-patch`로 패치를 만들었다면 → `git am`으로 적용**하라고 안내한다(이 경우 커밋 메시지·작성자 정보가 그대로 재생성됨).
- 둘을 섞어서 안내하지 않는다. **패치 파일 첫 줄이 `diff --git`으로 시작하면 무조건 `git apply`**, `From `으로 시작하면 `git am`.
- 확실하지 않으면 적용 전에 `head -3 패치파일.patch`로 첫 줄을 확인하고 명령을 고른다.

**보너스**: `git apply` 실행 전에 `git apply --check 패치파일.patch`로 먼저 충돌 여부만 조용히 검사할 수 있다(실제로 적용하지 않음). 원격이 그 사이 움직였을 가능성이 있는 이 저장소 특성상, 매번 먼저 이걸로 확인하는 습관을 권장한다.

---

## 다음 세션을 위한 최종 체크리스트

패치·데이터 파일을 만들어 배포할 때:

1. **zip 내부 파일명은 전부 ASCII만** 사용한다 (한글 파일명 금지, 내용은 한글 가능).
2. zip을 재생성할 때는 **기존 zip 파일을 먼저 삭제**하고 새로 만든다.
3. 패치 파일을 `git diff`로 만들었으면, 안내 문구에 **`git apply`**를 쓴다. `git format-patch`로 만들었으면 **`git am`**을 쓴다. 섞지 않는다.
4. 압축 해제는 `Expand-Archive` 대신 **`tar -xf ... -C 목적지`** 를 기본으로 안내한다(경로에 한글 사용자명이 있는 이 환경에서 `Expand-Archive`는 재현성 있게 실패한다).
5. 사용자가 받는 파일은 항상 `C:\Users\주피터\Downloads\` **루트**에 저장되므로, repo 작업 폴더로 옮기는 `Copy-Item` 단계를 먼저 넣는다.
6. 이 저장소(`Openhash-Gopang/hondi`)는 여러 세션이 동시에 커밋하므로, 적용 직전에 항상 `git pull origin main`으로 최신화하고, `git apply --check`로 충돌 여부를 먼저 확인한다.
7. `data/` 같은 새 폴더/파일 추가는 패치(diff) 대상이 아니라 **별도로 `git add`+`commit`** 해야 한다는 걸 안내문에 명시한다 — 패치 파일 하나에 코드 변경과 신규 데이터 파일 추가를 섞지 않는 편이 사용자가 단계별로 따라가기 쉽다.

## 관련 문서
- `docs/SP-AUTHOR-AUTOMATION_v1_0.md` — SP 갱신 자동화 원칙(사람이 최종 반영)
- `.github/workflows/` 하위 — 이 저장소의 CI 기반 검증 워크플로들
