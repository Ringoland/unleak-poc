$ErrorActionPreference = "Stop"
$base = "http://localhost:3000"
function Get-Ok($path) { Invoke-RestMethod -Uri "$base$path" -Method Get -TimeoutSec 5 | Out-Null }
Get-Ok "/ok";  Write-Host "ok ✓"
try { Get-Ok "/fail"; throw "Expected /fail to error" } catch { Write-Host "fail ✓ (expected)" }
try {
  Invoke-RestMethod -Uri "$base/slow" -Method Get -TimeoutSec 5 | Out-Null
  Write-Host "slow ✓ (completed)"
} catch { Write-Host "slow ✓ (timeout)" }
$body = @{ urls = @("/ok","/fail","/slow") } | ConvertTo-Json
$run = Invoke-RestMethod -Uri "$base/api/runs" -Method Post -ContentType "application/json" -Body $body
$runId = $run.id; Write-Host "runId: $runId"
$runData = Invoke-RestMethod -Uri "$base/api/runs/$runId" -Method Get
$runData | ConvertTo-Json -Depth 6
