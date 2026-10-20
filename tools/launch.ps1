param([int]$Port = 8080, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$serverPath = Join-Path $PSScriptRoot 'serve.mjs'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host 'Node.js is required: https://nodejs.org'; exit 1 }

# Match this exact absolute script argument, never another project's serve.mjs.
$pathPattern = '(?:"' + [regex]::Escape($serverPath) + '"|(?<=\s)' + [regex]::Escape($serverPath) + '(?=\s|$))'
$oldServers = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $pathPattern })
foreach ($process in $oldServers) {
  Write-Host "Stopping Tracker server (PID $($process.ProcessId))"
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  try { Wait-Process -Id $process.ProcessId -Timeout 5 -ErrorAction SilentlyContinue } catch { }
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "Port $Port belongs to another program. It was not stopped."
  exit 1
}
Write-Host "Gym Tracker: http://localhost:$Port/ (Ctrl+C to stop)"
# Open only after a successful bind, without racing the first browser request.
if (-not $NoBrowser) {
  $job = Start-Job -ArgumentList $Port -ScriptBlock {
    param($serverPort)
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
      try {
        $response = Invoke-WebRequest "http://localhost:$serverPort/" -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -eq 200) { Start-Process "http://localhost:$serverPort/"; return }
      } catch { }
    }
  }
}
try { & $node.Source $serverPath $Port; $serverExit = $LASTEXITCODE }
finally { if ($job) { Remove-Job $job -Force -ErrorAction SilentlyContinue } }
exit $serverExit