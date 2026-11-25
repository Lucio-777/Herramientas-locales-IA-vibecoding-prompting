---
name: conventional-commits-pr
description: >-
  Estándar de Git para Conventional Commits, ramas ordenadas y revisión exhaustiva de Pull Requests.
  Usar al preparar commits, crear resúmenes de cambios, redactar descripciones de PRs o revisar código.
---

# Flujo de Trabajo Git: Conventional Commits & Pull Requests

Esta skill estandariza el historial de versiones y las revisiones de código en equipo.

---

## 1. Convención de Mensajes de Commit (Conventional Commits v1.0.0)

Estructura requerida:
```text
<tipo>[alcance opcional]: <descripción concisa en imperativo>

[cuerpo explicativo opcional: qué se hizo y por qué]

[pie de página opcional: referencias a issues o breaking changes]
```

### Tipos Permitidos:
- **`feat`**: Nueva funcionalidad para el usuario.
- **`fix`**: Corrección de un bug.
- **`refactor`**: Cambio en el código que no corrige un bug ni añade una función.
- **`perf`**: Cambio en el código que mejora el rendimiento.
- **`test`**: Añadir o corregir pruebas existentes.
- **`docs`**: Cambios exclusivos en la documentación.
- **`style`**: Formato de código (espacios, punto y coma) sin impacto en lógica.
- **`chore`**: Tareas de mantenimiento, actualización de dependencias o scripts auxiliares.
- **`ci`**: Cambios en archivos de integración continua (GitHub Actions, GitLab CI).

### Ejemplo:
```text
feat(auth): implement refresh token rotation with redis

Store hashed refresh tokens in Redis with 7-day TTL to allow
seamless session renewal and immediate revocation on suspicious activity.

Closes #142
BREAKING CHANGE: The /api/v1/login response payload now returns refreshToken in an HttpOnly cookie instead of JSON body.
```

---

## 2. Estrategia de Ramas (*Branching*)

Nomenclatura estándar:
- `feat/nombre-corta-feature`
- `fix/id-o-descripcion-del-bug`
- `refactor/area-a-mejorar`
- `chore/actualizacion-o-tarea`

---

## 3. Plantilla de Pull Request (PR)

Al abrir o documentar un PR, incluir:

```markdown
## 📌 Contexto y Objetivo
Resumen claro de cuál es el problema que resuelve este PR.

## 🛠 Cambios Implementados
- [x] Agregado middleware de validación con Zod.
- [x] Implementado caso de uso `RegisterUser`.
- [x] Creados tests unitarios y de integración.

## 🧪 Pruebas Realizadas
- Pruebas unitarias: `npm test` (100% pasando).
- Prueba manual en entorno local con payload de prueba.

## ⚠️ Breaking Changes
- ¿Introduce algún cambio incompatible? (Sí / No). Si sí, detallar migración.
```

---

## 4. Checklist para Revisión de Código (Code Review)

- [ ] ¿El commit describe claramente el **por qué**, no solo el **qué**?
- [ ] ¿Los cambios se limitan al alcance de la tarea sin incluir archivos no relacionados?
- [ ] ¿Se eliminaron logs de depuración (`console.log`, `print`)?
- [ ] ¿Se actualizaron o añadieron los tests correspondientes?
