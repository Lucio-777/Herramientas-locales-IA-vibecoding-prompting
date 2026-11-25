# ==============================================================================
# Instalador Completo del Ecosistema Antigravity + VibeCoding Local + FreeLLMAPI
# ==============================================================================
param(
    [switch]$SkipOllamaModels,
    [switch]$SkipFreeLlmBuild
)

$ErrorActionPreference = "Stop"

$UserHome = $env:USERPROFILE
$GeminiDir = Join-Path $UserHome ".gemini"
$ConfigDir = Join-Path $GeminiDir "config"
$ScratchDir = Join-Path $GeminiDir "antigravity-ide\scratch"
$TargetRepoDir = Join-Path $ScratchDir "Herramientas-locales-IA-vibecoding-prompting"
$FreeLlmDir = Join-Path $ScratchDir "freellmapi"
$CurrentRepoDir = Split-Path -Parent $PSScriptRoot

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  Instalador de Ecosistema Antigravity + VibeCoding Local" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Crear estructura base
$requiredDirs = @(
    $GeminiDir,
    $ConfigDir,
    (Join-Path $ConfigDir "rules"),
    (Join-Path $ConfigDir "skills"),
    (Join-Path $ConfigDir "plugins"),
    (Join-Path $ConfigDir "hooks"),
    $ScratchDir
)
foreach ($d in $requiredDirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
}

# 2. Sincronizar repositorio hacia la ruta estándar si se ejecutó desde otra ubicación
$normCurrent = [System.IO.Path]::GetFullPath($CurrentRepoDir).TrimEnd('\')
$normTarget = [System.IO.Path]::GetFullPath($TargetRepoDir).TrimEnd('\')
if ($normCurrent -ne $normTarget) {
    Write-Host "[1/7] Sincronizando repositorio a ruta estándar: $TargetRepoDir" -ForegroundColor Yellow
    if (-not (Test-Path $TargetRepoDir)) {
        New-Item -ItemType Directory -Path $TargetRepoDir -Force | Out-Null
    }
    robocopy $normCurrent $normTarget /E /XD node_modules out logs .vibecoding\backups /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Write-Host "[ERROR] Error copiando repositorio con robocopy (código $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
    $global:LASTEXITCODE = 0
} else {
    Write-Host "[1/7] Repositorio ya ubicado en ruta estándar: $TargetRepoDir" -ForegroundColor Green
}

# 3. Clonar y compilar FreeLLMAPI (:3001)
Write-Host "[2/7] Verificando FreeLLMAPI en $FreeLlmDir..." -ForegroundColor Yellow
if (-not (Test-Path $FreeLlmDir)) {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        git clone https://github.com/tashfeenahmed/freellmapi.git $FreeLlmDir
    } else {
        Write-Host "[ERROR] Git no está instalado. Instala Git y vuelve a ejecutar." -ForegroundColor Red
        exit 1
    }
}

if (-not $SkipFreeLlmBuild) {
    Push-Location $FreeLlmDir
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Host "      Instalando dependencias de FreeLLMAPI..." -ForegroundColor Gray
            npm install
        }
        if (-not (Test-Path "server\dist\index.js")) {
            Write-Host "      Compilando FreeLLMAPI..." -ForegroundColor Gray
            npm run build
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path "server\dist\index.js")) {
                npm run build:server
            }
        }
        if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
            Copy-Item ".env.example" ".env" -Force
            Write-Host "      [INFO] Se creó .env desde .env.example en FreeLLMAPI. Configura tus llaves en el dashboard :3001." -ForegroundColor Cyan
        }
    } finally {
        Pop-Location
    }
}

# 4. Instalar dependencias y compilar VibeCoding Local
Write-Host "[3/7] Instalando dependencias y compilando VibeCoding Local..." -ForegroundColor Yellow
Push-Location $TargetRepoDir
try {
    if (-not (Test-Path "node_modules")) {
        npm install
    }
    npm run compile
} finally {
    Pop-Location
}

# 5. Instalar extensión en Antigravity IDE y VS Code
Write-Host "[4/7] Instalando extensión VibeCoding Local en Antigravity IDE / VS Code..." -ForegroundColor Yellow
$vsixPath = Join-Path $TargetRepoDir "vibe-coding-local-0.2.0.vsix"
$ideClis = @("antigravity", "agy", "code")
foreach ($cli in $ideClis) {
    if ((Get-Command $cli -ErrorAction SilentlyContinue) -and (Test-Path $vsixPath)) {
        try {
            & $cli --install-extension $vsixPath --force | Out-Null
            Write-Host "      Instalada via CLI '$cli'." -ForegroundColor Green
        } catch {
            Write-Host "      [AVISO] No se pudo instalar con '$cli', usando copia directa." -ForegroundColor Gray
        }
    }
}

$extTargets = @(
    (Join-Path $UserHome ".antigravity-ide\extensions\undefined_publisher.vibe-coding-local-0.2.0"),
    (Join-Path $UserHome ".vscode\extensions\undefined_publisher.vibe-coding-local-0.2.0")
)
foreach ($extDir in $extTargets) {
    $parentExt = Split-Path -Parent $extDir
    if (Test-Path $parentExt) {
        if (-not (Test-Path $extDir) -and (Test-Path $vsixPath)) {
            $tmpExtract = Join-Path $env:TEMP ("vibecoding_vsix_" + [Guid]::NewGuid().ToString("N"))
            try {
                Copy-Item $vsixPath "$tmpExtract.zip" -Force
                Expand-Archive -Path "$tmpExtract.zip" -DestinationPath $tmpExtract -Force
                if (Test-Path (Join-Path $tmpExtract "extension")) {
                    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
                    Copy-Item -Path (Join-Path $tmpExtract "extension\*") -Destination $extDir -Recurse -Force
                }
            } finally {
                Remove-Item "$tmpExtract.zip" -Force -ErrorAction SilentlyContinue
                Remove-Item $tmpExtract -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        if (Test-Path $extDir) {
            Copy-Item -Path (Join-Path $TargetRepoDir "out\*") -Destination (Join-Path $extDir "out") -Recurse -Force
            Copy-Item -Path (Join-Path $TargetRepoDir "package.json") -Destination (Join-Path $extDir "package.json") -Force
            Write-Host "      Sincronizada en: $extDir" -ForegroundColor Green
        }
    }
}

# 6. Copiar GEMINI.md, rules, skills, plugins y hooks
Write-Host "[5/7] Instalando skills, plugins, reglas globales y hooks..." -ForegroundColor Yellow
$EcoDir = Join-Path $TargetRepoDir "antigravity-ecosystem"
if (-not (Test-Path $EcoDir)) {
    Write-Host "[ERROR] No se encontró el directorio antigravity-ecosystem en $TargetRepoDir" -ForegroundColor Red
    exit 1
}

Copy-Item (Join-Path $EcoDir "GEMINI.md") (Join-Path $ConfigDir "GEMINI.md") -Force
Copy-Item (Join-Path $EcoDir "GEMINI.md") (Join-Path $GeminiDir "GEMINI.md") -Force
Copy-Item (Join-Path $EcoDir "rules\*") (Join-Path $ConfigDir "rules") -Recurse -Force
Copy-Item (Join-Path $EcoDir "skills\*") (Join-Path $ConfigDir "skills") -Recurse -Force
Copy-Item (Join-Path $EcoDir "plugins\*") (Join-Path $ConfigDir "plugins") -Recurse -Force
Copy-Item (Join-Path $EcoDir "hooks\*") (Join-Path $ConfigDir "hooks") -Recurse -Force

# 7. Generar mcp_config.json, hooks.json y base SQLite vacía si no existe
Write-Host "[6/7] Configurando servidores MCP globales y hooks.json..." -ForegroundColor Yellow
$dbPath = Join-Path $ScratchDir "database.db"
if (-not (Test-Path $dbPath)) {
    New-Item -ItemType File -Path $dbPath -Force | Out-Null
}

$escapedHome = $UserHome.Replace('\', '\\')
$posixHome = $UserHome.Replace('\', '/')

$mcpTemplatePath = Join-Path $EcoDir "mcp_config.template.json"
$mcpOutPath = Join-Path $ConfigDir "mcp_config.json"
if (Test-Path $mcpOutPath) {
    Copy-Item $mcpOutPath "$mcpOutPath.bak" -Force
}
$mcpContent = (Get-Content $mcpTemplatePath -Raw -Encoding UTF8).Replace("__USER_HOME__", $escapedHome)
Set-Content -Path $mcpOutPath -Value $mcpContent -Encoding UTF8 -Force

$hooksTemplatePath = Join-Path $EcoDir "hooks.template.json"
$hooksOutPath = Join-Path $ConfigDir "hooks.json"
$hooksContent = (Get-Content $hooksTemplatePath -Raw -Encoding UTF8).Replace("__USER_HOME_POSIX__", $posixHome)
Set-Content -Path $hooksOutPath -Value $hooksContent -Encoding UTF8 -Force

# 8. Modelos opcionales de Ollama (Nivel 4 Offline)
if (-not $SkipOllamaModels) {
    $ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if ((Test-Path $ollamaExe) -or (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Write-Host "[INFO] Ollama detectado. Puedes instalar modelos locales ejecutando: $TargetRepoDir\install-models.ps1" -ForegroundColor Cyan
    } else {
        Write-Host "[INFO] Ollama no detectado (opcional, solo requerido para Nivel 4 Offline)." -ForegroundColor Gray
    }
}

# 9. Registrar arranque en Windows y levantar servicios
Write-Host "[7/7] Registrando inicio automático y arrancando servicios en segundo plano..." -ForegroundColor Yellow
& (Join-Path $TargetRepoDir "scripts\register-startup.ps1")
& (Join-Path $TargetRepoDir "scripts\start-ai-ecosystem.ps1")
& (Join-Path $TargetRepoDir "scripts\status-ai-ecosystem.ps1")

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  Instalación completada. Reinicia Antigravity IDE para cargar" -ForegroundColor Green
Write-Host "  todas las skills, plugins, hooks y los 9 servidores MCP." -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
