# deploy.ps1 - 나비 배포 스크립트
# 사용법: .\deploy.ps1 "커밋 메시지"
#
# 사전 준비 (한 번만):
#   [System.Environment]::SetEnvironmentVariable('CF_API_TOKEN', '토큰', 'User')
#   [System.Environment]::SetEnvironmentVariable('CF_ZONE_ID', 'ZoneID', 'User')

param([string]$msg = "")

# 1. SW 캐시 버전 갱신
$date = Get-Date -Format "yyyyMMdd-HHmm"
$swContent = Get-Content "sw.js" -Raw
$swContent = $swContent -replace "const CACHE_NAME\s+=\s+'gopang-[\w-]+'", "const CACHE_NAME    = 'gopang-$date'"
Set-Content -Path "sw.js" -Value $swContent -NoNewline
Write-Host "SW 캐시 버전: gopang-$date"

# 2. git add
git add -A

# 3. 커밋 메시지
if ($msg -eq "") {
    $msg = "deploy: $date"
}
git commit -m $msg

# 4. push
git push
Write-Host "배포 완료: $msg"

# 5. Cloudflare 캐시 강제 퍼지 (sw.js)
Write-Host "--- Cloudflare 캐시 퍼지 시작 ---"

$cfToken = $env:CF_API_TOKEN
$cfZone = $env:CF_ZONE_ID

if ([string]::IsNullOrEmpty($cfToken)) {
    Write-Host "CF_API_TOKEN 환경변수가 없어 캐시 퍼지를 건너뜁니다."
}
elseif ([string]::IsNullOrEmpty($cfZone)) {
    Write-Host "CF_ZONE_ID 환경변수가 없어 캐시 퍼지를 건너뜁니다."
}
else {
    $purgeUrl = "https://api.cloudflare.com/client/v4/zones/" + $cfZone + "/purge_cache"
    $purgeHeaders = @{}
    $purgeHeaders["Authorization"] = "Bearer " + $cfToken
    $purgeHeaders["Content-Type"] = "application/json"
    $purgeFiles = @("https://hondi.net/sw.js", "https://www.hondi.net/sw.js")
    $purgeBodyObj = @{}
    $purgeBodyObj["files"] = $purgeFiles
    $purgeBody = $purgeBodyObj | ConvertTo-Json

    try {
        $resp = Invoke-RestMethod -Method POST -Uri $purgeUrl -Headers $purgeHeaders -Body $purgeBody
        if ($resp.success -eq $true) {
            Write-Host "Cloudflare 캐시 퍼지 완료: sw.js"
        }
        else {
            Write-Host "Cloudflare 캐시 퍼지 실패"
            $resp | ConvertTo-Json -Depth 5
        }
    }
    catch {
        Write-Host "Cloudflare 캐시 퍼지 요청 중 오류 발생"
        Write-Host $_.Exception.Message
    }
}

# 6. 배포 완료 push 브로드캐스트 (켜져 있는 클라이언트 즉시 업데이트 체크 유도)
Write-Host "--- 업데이트 push 브로드캐스트 시작 ---"

$pushSecret = $env:DEPLOY_PUSH_SECRET
if ([string]::IsNullOrEmpty($pushSecret)) {
    Write-Host "DEPLOY_PUSH_SECRET 환경변수가 없어 push 브로드캐스트를 건너뜁니다."
}
else {
    $broadcastUrl = "https://gopang-proxy.tensor-city.workers.dev/push/broadcast"
    $broadcastBodyObj = @{ secret = $pushSecret }
    $broadcastBody = $broadcastBodyObj | ConvertTo-Json

    try {
        $bResp = Invoke-RestMethod -Method POST -Uri $broadcastUrl -ContentType "application/json" -Body $broadcastBody
        Write-Host ("push 브로드캐스트 완료: 전체 " + $bResp.total + "건 중 " + $bResp.sent + "건 전송 (실패 " + $bResp.failed + "건)")
    }
    catch {
        Write-Host "push 브로드캐스트 요청 중 오류 발생"
        Write-Host $_.Exception.Message
    }
}

Write-Host "--- 배포 스크립트 종료 ---"
