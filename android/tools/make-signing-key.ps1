# 나비웹 앱 개인 서명키 생성 (Windows PowerShell). 사용자 PC 에서 한 번만 실행한다.
# 1) 키 파일과 비밀번호를 ~\naviweb-keys 에 만든다 (이 폴더를 반드시 백업: 키를 잃으면 앱 업데이트 불가)
# 2) gh(GitHub CLI)가 로그인돼 있으면 GitHub secrets 4개를 자동 등록한다. 없으면 수동 등록 방법을 안내한다.
# 3) 인증서 지문(SHA-256)을 출력한다 — 이 값을 Claude 에게 알려 주면 assetlinks.json 을 갱신한다.
$ErrorActionPreference = 'Stop'
$repo  = 'Openhash-Gopang/hondi'
$dir   = Join-Path $HOME 'naviweb-keys'
$ks    = Join-Path $dir 'naviweb-release.keystore'
$alias = 'naviweb'
if (Test-Path $ks) { throw "이미 키가 있습니다: $ks (덮어쓰지 않습니다)" }
if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) { throw 'keytool 이 없습니다. JDK 17 을 설치한 뒤 다시 실행하세요.' }
New-Item -ItemType Directory -Force $dir | Out-Null

function New-Pw { -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | ForEach-Object {[char]$_}) }
$pw = New-Pw
keytool -genkeypair -v -keystore $ks -alias $alias -keyalg RSA -keysize 4096 -validity 10000 `
  -storepass $pw -keypass $pw -dname 'CN=Naviweb, O=Naviweb Inc., C=KR'
if ($LASTEXITCODE -ne 0) { throw 'keytool 실패' }

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ks))
Set-Content -Path (Join-Path $dir 'keystore.b64.txt') -Value $b64 -NoNewline
Set-Content -Path (Join-Path $dir 'passwords.txt') -Value "alias=$alias`nstorepass=$pw`nkeypass=$pw"

$fp = (keytool -list -v -keystore $ks -alias $alias -storepass $pw | Select-String 'SHA256:').ToString().Trim()
Write-Host "`n=== 인증서 지문 ===`n$fp`n"

if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh auth status 2>$null
  if ($LASTEXITCODE -eq 0) {
    $b64 | gh secret set NAVIWEB_KEYSTORE_B64 --repo $repo
    $pw  | gh secret set NAVIWEB_KEYSTORE_PASSWORD --repo $repo
    $alias | gh secret set NAVIWEB_KEY_ALIAS --repo $repo
    $pw  | gh secret set NAVIWEB_KEY_PASSWORD --repo $repo
    Write-Host 'GitHub secrets 4개 등록 완료'
  } else { Write-Host 'gh 로그인이 안 되어 있습니다 — 아래 수동 등록을 하세요.' }
}
Write-Host @"

[수동 등록] GitHub → $repo → Settings → Secrets and variables → Actions → New repository secret
  NAVIWEB_KEYSTORE_B64      = $dir\keystore.b64.txt 의 내용
  NAVIWEB_KEYSTORE_PASSWORD = $dir\passwords.txt 의 storepass
  NAVIWEB_KEY_ALIAS         = naviweb
  NAVIWEB_KEY_PASSWORD      = $dir\passwords.txt 의 keypass

[중요] $dir 폴더 전체를 USB·비밀번호 관리자 등 안전한 곳에 백업하세요. 이 폴더는 GitHub 에 올리지 마세요.
위의 SHA256 지문을 Claude 에게 알려 주세요.
"@
