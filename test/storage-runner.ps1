$ErrorActionPreference = 'Stop'
$setupJson = & node (Join-Path $PSScriptRoot 'storage-runner.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Storage test setup failed' }
$setup = $setupJson | ConvertFrom-Json
& $setup.binary -no-remote -profile $setup.profile -headless
$timer = [System.Diagnostics.Stopwatch]::StartNew()
while (-not (Test-Path -LiteralPath $setup.resultFile)) {
    if ($timer.Elapsed.TotalSeconds -ge 45) { throw "Storage tests timed out: $($setup.profile)" }
    Start-Sleep -Milliseconds 250
}
$result = Get-Content -LiteralPath $setup.resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($result.failure) { throw $result.failure }
Write-Output "PASS: $($result.passed.Count) storage checks in Zotero $($result.version)"
$result.passed | ForEach-Object { Write-Output "  $_" }
Write-Output "Result: $($setup.resultFile)"
