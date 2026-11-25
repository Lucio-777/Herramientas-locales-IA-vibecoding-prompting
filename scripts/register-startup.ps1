# ==============================================================================
# Registrar VibeCoding AI Ecosystem en el Inicio de Windows
# ==============================================================================

$startScript = Join-Path $PSScriptRoot "start-ai-ecosystem.ps1"
$startupDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Startup)
$destination = Join-Path $startupDir "VibeCoding-AI-Ecosystem.vbs"

$vbsContent = @"
' ==============================================================================
' VibeCoding - Lanzador 100% Silencioso (Zero-Touch Windows Startup)
' Generado dinamicamente por register-startup.ps1
' ==============================================================================

Set WshShell = CreateObject("WScript.Shell")
strCommand = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$startScript"""
WshShell.Run strCommand, 0, False
"@

Set-Content -Path $destination -Value $vbsContent -Encoding ASCII -Force
if (Test-Path $destination) {
    Write-Host "[OK] Registrado en Inicio de Windows:" -ForegroundColor Green
    Write-Host "     $destination -> $startScript" -ForegroundColor Cyan
} else {
    Write-Host "[ERROR] No se pudo escribir en la carpeta de Inicio." -ForegroundColor Red
}
