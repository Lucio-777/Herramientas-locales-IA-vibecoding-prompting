---
name: antigravity-workflow-patterns
description: >-
  Recetas prácticas y patrones de orquestación en Python para la herramienta nativa
  `run_workflow` de Antigravity (paralelismo multiagente, auditoría triple pre-PR,
  pipelines TDD y delegación híbrida con vibecoding-mcp). Úsala cuando una tarea
  se divida en múltiples archivos, módulos o ángulos de revisión independientes.
---

# Patrones de Orquestación con `run_workflow`

Usa `run_workflow` cuando la orquestación sea programática (bucles sobre listas de archivos, fan-out en paralelo y agregación, o pipelines por fases). Para una sola tarea delegada, usa `invoke_subagent`.

## Reglas Clave de `run_workflow`
* Siempre define un `schema` JSON estricto en cada `agent(...)` para forzar salidas estructuradas mediante `finish`.
* Usa `workspace="branch"` o `"share"` cuando los agentes editen archivos en paralelo; usa `"inherit"` para lectores/auditores.
* Usa `model="flash"` o `"flash_lite"` para escaneos mecánicos de alto volumen, reservando `"inherit"` o `"pro"` para síntesis y arquitectura.

---

## Patrón 1: Auditoría Triple Paralela Pre-PR (Seguridad + Tests + Calidad)
Lanza simultáneamente tres perspectivas especializadas sobre los archivos modificados y agrega los hallazgos:

```python
import subprocess

phase("Obtener cambios del diff")
diff_files = subprocess.check_output(
    ["git", "diff", "--name-only", "HEAD"], text=True
).splitlines()

if not diff_files:
    log("No hay archivos modificados.")
else:
    schema = {
        "type": "object",
        "properties": {
            "passed": {"type": "boolean"},
            "critical_issues": {"type": "array", "items": {"type": "string"}},
            "warnings": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["passed", "critical_issues", "warnings"],
    }

    phase("Auditoría paralela")
    sec, tst, rev = await parallel(
        [
            ("security-auditor", "Audita vulnerabilidades OWASP, secretos o inyecciones"),
            ("test-engineer", "Evalúa cobertura de tests y casos borde faltantes"),
            ("code-reviewer", "Evalúa correctitud, complejidad, duplicación y tipos"),
        ],
        lambda spec: agent(
            f"{spec[1]} en los siguientes archivos modificados: {diff_files}.",
            schema=schema,
            type_name=spec[0],
            role=f"Pre-PR {spec[0]}",
        ),
    )

    for name, res in [("Security", sec), ("Testing", tst), ("Review", rev)]:
        log(f"[{name}] passed={res['passed']} | critical={len(res['critical_issues'])}")
        for issue in res["critical_issues"]:
            log(f"  - CRITICAL: {issue}")
```

---

## Patrón 2: Fan-Out Sharded de Tests o Refactorización por Archivo
Para generar tests o documentar decenas de archivos sin saturar un solo contexto:

```python
phase("Descubrir archivos objetivo")
targets = await agent(
    "Lista los archivos fuente en src/ que aún no tienen archivo de test asociado. Solo rutas.",
    schema={"type": "array", "items": {"type": "string"}},
    model="flash",
)

phase("Generar o validar en paralelo")
results = await parallel(
    targets,
    lambda path: agent(
        f"Analiza {path} y propón los casos de prueba unitarios críticos (happy path + edge cases).",
        schema={"type": "string"},
        role=f"Test plan {path}",
        model="flash",
    ),
)
for path, plan in zip(targets, results):
    log(f"=== {path} ===\n{plan}")
```

---

## Patrón 3: Bucle Conversacional Revisor → Corrector (`pipeline`)
Cuando un agente revisor debe mantener su memoria entre iteraciones para validar si los arreglos realmente cerraron los hallazgos:

```python
reviewer = agent(
    "Eres un revisor estricto. Verifica correcciones contra el código real.",
    type_name="code-reviewer",
    role="Iterative Reviewer",
)
findings = await reviewer(
    "Lista los bugs reales en el módulo indicado.",
    {"type": "array", "items": {"type": "string"}},
)
if findings:
    fixes = await parallel(
        findings,
        lambda bug: agent(
            f"Corrige únicamente este bug sin romper la API pública: {bug}",
            schema={"type": "string"},
            workspace="share",
            role="Fixer",
        ),
    )
    ok = await reviewer(
        f"Se aplicaron estas correcciones: {fixes}. ¿Quedaron resueltos todos los bugs?",
        {"type": "boolean"},
    )
    log(f"Aprobación final del revisor: {ok}")
del reviewer
```
