@echo off
chcp 65001 > nul
echo ========================================================
echo   VibeCoding Local - Servidor Ollama y Entorno Local
echo ========================================================
echo.

rem 1. Verificar si Ollama esta corriendo
curl -s http://127.0.0.1:11434/api/tags > nul
if %errorlevel% neq 0 (
    echo [*] Iniciando servidor de Ollama en segundo plano...
    start "" /b "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve
    timeout /t 3 /nobreak > nul
) else (
    echo [OK] Servidor Ollama ya esta en ejecucion en http://127.0.0.1:11434
)

echo.
echo [*] Modelos instalados actualmente:
"%LOCALAPPDATA%\Programs\Ollama\ollama.exe" list
echo.
echo [OK] Extension VibeCoding Local instalada en VS Code y Antigravity IDE.
echo Presiona cualquier tecla para salir...
pause > nul
