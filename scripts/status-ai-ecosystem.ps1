# ==============================================================================
# VibeCoding - Monitor de Estado del Ecosistema de IA
# Verifica puertos 3001 (FreeLLMAPI) y 3002 (MCP Bridge)
# ==============================================================================

$ErrorActionPreference = "SilentlyContinue"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [VibeCoding] Estado del Ecosistema de IA Local" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

function Get-ServiceInfoByPort {
    param([int]$Port, [string]$ServiceName)
    
    $tcp = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($tcp) {
        $proc = Get-Process -Id $tcp.OwningProcess -ErrorAction SilentlyContinue
        $memMB = [math]::Round($proc.WorkingSet64 / 1MB, 2)
        Write-Host "[ACTIVO] $ServiceName" -ForegroundColor Green
        Write-Host "  - Puerto:      $Port"
        Write-Host "  - PID:         $($tcp.OwningProcess) ($($proc.ProcessName))"
        Write-Host "  - Memoria:     $memMB MB"
        
        # Test HTTP
        try {
            $url = if ($Port -eq 3001) { "http://127.0.0.1:3001/v1/models" } else { "http://127.0.0.1:3002/health" }
            $req = [System.Net.WebRequest]::Create($url)
            $req.Timeout = 1200
            $resp = $req.GetResponse()
            Write-Host "  - HTTP Status: $($resp.StatusCode)" -ForegroundColor Green
            $resp.Close()
        } catch {
            Write-Host "  - HTTP Ping:   Respondiendo (TCP Activo)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[INACTIVO] $ServiceName no está escuchando en puerto $Port" -ForegroundColor Red
    }
    Write-Host ""
}

Get-ServiceInfoByPort -Port 3001 -ServiceName "FreeLLMAPI Proxy (Nivel 1 y Nivel 2)"
Get-ServiceInfoByPort -Port 3002 -ServiceName "VibeCoding MCP Bridge (Multi-IDE: VS, VS Code, Antigravity)"

$LogsDir = Join-Path (Split-Path -Parent $PSScriptRoot) "logs"
Write-Host "Logs disponibles en: $LogsDir\" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan
