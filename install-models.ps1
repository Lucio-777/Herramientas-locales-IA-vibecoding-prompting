# Script de instalacion y actualizacion de modelos para VibeCoding Local
# Hardware Optimizado: 13th Gen Intel Core i7-1355U / 16 GB RAM / Intel Iris Xe

$ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Instalador de Modelos Locales para Desarrollo Full-Stack" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Modelos recomendados para 16GB RAM + CPU Intel Core i7
$models = @(
    @{ Name = "qwen2.5-coder:7b"; Description = "Modelo Principal de Codigo Full-Stack (JS/TS, React, Node, Python, SQL)" },
    @{ Name = "deepseek-r1:8b";   Description = "Razonamiento Profundo y Arquitectura de Sistemas" },
    @{ Name = "qwen2.5-coder:3b"; Description = "Ultra-rapido para autocompletado y ediciones ligeras" },
    @{ Name = "nomic-embed-text"; Description = "Embeddings y RAG para busqueda semantica en el workspace" }
)

foreach ($m in $models) {
    Write-Host "`n>> Instalando/Verificando: $($m.Name) - $($m.Description)" -ForegroundColor Yellow
    & $ollama pull $m.Name
}

Write-Host "`n[OK] Modelos listos. Estado actual:" -ForegroundColor Green
& $ollama list
