---
name: git-worktree-parallel-dev
description: >-
  Aislamiento de ramas paralelas mediante `git worktree` y espacios de trabajo
  compartidos (`Workspace="share"`) en Antigravity para desarrollar múltiples
  features o experimentar sin ensuciar la rama principal ni perder el estado actual.
---

# Git Worktree & Parallel Feature Isolation

## Por Qué Usar Worktrees (Inspirado en `obra/superpowers`)
Cambiar de rama con `git checkout` mientras tienes servidores corriendo, cambios sin commitear o subagentes editando archivos provoca conflictos y pérdida de contexto. `git worktree` crea directorios separados enlazados al mismo repositorio `.git` sin duplicar el historial.

---

## 1. Flujo Nativo dentro de Antigravity
* **Cuando lances subagentes o swarms que editen código en paralelo:**
  * Pasa `Workspace="share"` en `invoke_subagent`, `swarm` o `run_workflow`. Antigravity crea y gestiona automáticamente un espacio aislado compartiendo el repositorio base sin duplicar almacenamiento.
* **Cuando el usuario quiera trabajar en dos ramas simultáneas en su IDE/terminal:**
  Usa `git worktree` manualmente siguiendo este protocolo.

---

## 2. Protocolo Manual con `git worktree`

### Paso 1: Crear un worktree aislado
Coloca los worktrees en un directorio hermano (o dentro de `.worktrees/` si está listado en `.gitignore`):

```powershell
# Verifica que estás en la raíz del repo
git status

# Crea una rama nueva en un directorio hermano aislado
git worktree add ../mi-proyecto-feat-auth -b feat/auth
```

### Paso 2: Verificar dependencias en el nuevo worktree
* Un worktree nuevo comparte el historial `.git`, pero **no** copia carpetas ignoradas como `node_modules` o `.venv`.
* Ejecuta la instalación rápida de dependencias (`pnpm install`, `uv sync`, etc.) dentro del worktree antes de correr tests.

### Paso 3: Verificación limpia antes de fusionar
1. Corre toda la suite de tests y linters (`ruff` / `biome` / `vitest` / `pytest`) dentro del worktree.
2. Si todo está en verde, fusiona desde la rama principal y limpia:

```powershell
# Desde el directorio principal
git merge --no-ff feat/auth

# Eliminar el worktree y la rama temporal cuando ya no se necesiten
git worktree remove ../mi-proyecto-feat-auth
git branch -d feat/auth
```

### Paso 4: Listar y limpiar worktrees huérfanos
```powershell
git worktree list
git worktree prune
```
