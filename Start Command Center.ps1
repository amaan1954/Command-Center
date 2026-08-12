$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-NetTCPConnection -LocalPort 11434 -State Listen)) {
    $ollama = (Get-Command ollama).Source
    if ($ollama) {
        Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 2
    }
}

if (-not (Get-NetTCPConnection -LocalPort 8766 -State Listen)) {
    Start-Process -FilePath "python" -ArgumentList "app.py" -WorkingDirectory $root -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

Start-Process -FilePath (Join-Path $root "index.html")
