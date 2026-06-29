param(
    [switch]$SkipTypecheck,
    [ValidateSet('all', 'smoke', 'live', 'mutations')]
    [string]$Scope = 'all'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repoRoot 'web'
$liveWebUrl = 'http://127.0.0.1:5188'
$liveApiHealthUrl = 'http://127.0.0.1:5189/health'

if (-not (Test-Path $webDir)) {
    throw "web 디렉토리를 찾지 못했습니다: $webDir"
}

function Test-RequiredUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 10
        if (-not $response.StatusCode -or $response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
            throw "$Label 응답 코드 비정상: $($response.StatusCode)"
        }
    }
    catch {
        throw "$Label 확인 실패: $Url`n먼저 analytics 로컬 스택을 올리세요. 예: pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\cmd-analytics-local.ps1`n원인: $($_.Exception.Message)"
    }
}

Push-Location $webDir
try {
    if ($Scope -eq 'live') {
        Write-Host '[INFO] Checking live analytics endpoints...' -ForegroundColor Cyan
        Test-RequiredUrl -Url $liveWebUrl -Label 'Analytics web'
        Test-RequiredUrl -Url $liveApiHealthUrl -Label 'Analytics api'
    }

    if (-not $SkipTypecheck) {
        Write-Host '[INFO] Running frontend typecheck...' -ForegroundColor Cyan
        npm run typecheck
        if ($LASTEXITCODE -ne 0) {
            throw "typecheck 실패 (exit=$LASTEXITCODE)"
        }
    }

    $scriptName = switch ($Scope) {
        'smoke' { 'test:e2e:ai-ops:smoke' }
        'live' { 'test:e2e:ai-ops:live' }
        'mutations' { 'test:e2e:ai-ops:mutations' }
        default { 'test:e2e:ai-ops' }
    }

    Write-Host "[INFO] Running $scriptName..." -ForegroundColor Cyan
    npm run $scriptName
    if ($LASTEXITCODE -ne 0) {
        throw "$scriptName 실패 (exit=$LASTEXITCODE)"
    }

    Write-Host '[INFO] AI 운영 센터 웹 검증 완료.' -ForegroundColor Green
}
finally {
    Pop-Location
}
