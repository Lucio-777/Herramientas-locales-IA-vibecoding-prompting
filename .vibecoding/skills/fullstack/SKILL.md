---
name: FullStack Architecture
description: Guía de arquitectura para desarrollo full-stack moderno con TypeScript, APIs REST/tRPC y desacoplamiento limpio.
tags: [fullstack, typescript, web, backend, frontend, architecture, api]
---

# Habilidad Full-Stack Architecture

## Principios Clave
1. **Tipado End-to-End**: Comparte interfaces y tipos de TypeScript entre frontend y backend para consistencia total.
2. **Separación de Capas**:
   - Componentes UI (reactivos, desacoplados, estilos CSS modulares o Tailwind).
   - Capa de Estado y Hooks (manejo de queries, mutaciones y estado global).
   - Backend APIs (validación con Zod, controladores limpios, respuestas uniformes).
   - Acceso a Datos (ORM/Query builders, migraciones declarativas).
3. **Manejo Estructurado de Errores**:
   - Respuestas HTTP estandarizadas: `{ success: boolean, data?: T, error?: string }`.
4. **Seguridad y Performance**:
   - Variables de entorno estrictas (`.env.example`).
   - Paginación y límites en consultas a bases de datos.
