# ==============================================================================
# VibeCoding - Guardián de Arranque en Segundo Plano (Zero-Touch Windows Startup)
# Servicios: FreeLLMAPI (:3001) y VibeCoding MCP Bridge (:3002)
# ==============================================================================

$ErrorActionPreference = "SilentlyContinue"

$VibeCodingDir = Split-Path -Parent $PSScriptRoot
$FreeLlmDir    = Join-Path (Split-Path -Parent $VibeCodingDir) "freellmapi"
$LogsDir       = Join-Path $VibeCodingDir "logs"

if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

function Test-PortListening {
    param([int]$Port)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $success = $iar.AsyncWaitHandle.WaitOne(400, $false)
        if ($success -and $client.Connected) {
            $client.EndConnect($iar)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [VibeCoding] Verificando Ecosistema de IA en Segundo Plano" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Servicio FreeLLMAPI (Puerto 3001)
$is3001Active = Test-PortListening -Port 3001
if ($is3001Active) {
    Write-Host "[OK] FreeLLMAPI ya está activo y escuchando en http://127.0.0.1:3001" -ForegroundColor Green
} else {
    Write-Host "[INICIANDO] Levantando FreeLLMAPI en segundo plano..." -ForegroundColor Yellow
    $freellmLog = Join-Path $LogsDir "freellmapi.log"
    $freellmErr = Join-Path $LogsDir "freellmapi-error.log"
    
    Start-Process -FilePath "node" `
                  -ArgumentList "server/dist/index.js" `
                  -WorkingDirectory $FreeLlmDir `
                  -WindowStyle Hidden `
                  -RedirectStandardOutput $freellmLog `
                  -RedirectStandardError $freellmErr
                  
    # Espera activa de conexión
    $retries = 15
    while ($retries -gt 0 -and (-not (Test-PortListening -Port 3001))) {
        Start-Sleep -Milliseconds 400
        $retries--
    }
    
    if (Test-PortListening -Port 3001) {
        Write-Host "[OK] FreeLLMAPI iniciado con éxito en http://127.0.0.1:3001" -ForegroundColor Green
    } else {
        Write-Host "[ADVERTENCIA] FreeLLMAPI tardando en responder. Revisa: $freellmLog" -ForegroundColor Red
    }
}

# 2. Servicio MCP Bridge Multi-IDE (Puerto 3002)
$is3002Active = Test-PortListening -Port 3002
if ($is3002Active) {
    Write-Host "[OK] MCP Bridge ya está activo y escuchando en http://127.0.0.1:3002/mcp" -ForegroundColor Green
} else {
    Write-Host "[INICIANDO] Levantando MCP Bridge Daemon en segundo plano..." -ForegroundColor Yellow
    $mcpLog = Join-Path $LogsDir "mcp-bridge.log"
    $mcpErr = Join-Path $LogsDir "mcp-bridge-error.log"
    
    Start-Process -FilePath "node" `
                  -ArgumentList "out/server/mcpBridge.js --port 3002" `
                  -WorkingDirectory $VibeCodingDir `
                  -WindowStyle Hidden `
                  -RedirectStandardOutput $mcpLog `
                  -RedirectStandardError $mcpErr
                  
    # Espera activa de conexión
    $retries = 15
    while ($retries -gt 0 -and (-not (Test-PortListening -Port 3002))) {
        Start-Sleep -Milliseconds 400
        $retries--
    }
    
    if (Test-PortListening -Port 3002) {
        Write-Host "[OK] MCP Bridge iniciado con éxito en http://127.0.0.1:3002/mcp" -ForegroundColor Green
    } else {
        Write-Host "[ADVERTENCIA] MCP Bridge tardando en responder. Revisa: $mcpLog" -ForegroundColor Red
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [VibeCoding] Ecosistema Local Listo para Visual Studio, VS Code y Antigravity" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
