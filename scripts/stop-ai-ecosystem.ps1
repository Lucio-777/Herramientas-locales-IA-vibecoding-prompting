# ==============================================================================
# VibeCoding - Detención Segura del Ecosistema de IA
# Detiene los procesos que escuchan en los puertos 3001 y 3002
# ==============================================================================

$ErrorActionPreference = "SilentlyContinue"

Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host " [VibeCoding] Deteniendo Ecosistema de IA en Segundo Plano" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Yellow

function Stop-ServiceByPort {
    param([int]$Port, [string]$ServiceName)
    
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            $pidToKill = $conn.OwningProcess
            $proc = Get-Process -Id $pidToKill -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Deteniendo $ServiceName (PID $pidToKill - $($proc.ProcessName))..." -ForegroundColor Yellow
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Milliseconds 500
        $check = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if (-not $check) {
            Write-Host "[OK] Puerto $Port liberado exitosamente." -ForegroundColor Green
        } else {
            Write-Host "[ADVERTENCIA] El puerto $Port aún tiene conexiones activas." -ForegroundColor Red
        }
    } else {
        Write-Host "[INFO] $ServiceName no estaba corriendo en puerto $Port." -ForegroundColor Gray
    }
}

Stop-ServiceByPort -Port 3001 -ServiceName "FreeLLMAPI"
Stop-ServiceByPort -Port 3002 -ServiceName "VibeCoding MCP Bridge"

Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host " [VibeCoding] Servicios Detenidos" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Yellow
