---
name: Node.js & REST API Design
description: Construcción de APIs y microservicios robustos con Node.js, Express/Fastify, validación Zod y autenticación segura.
tags: [nodejs, backend, api, express, fastify, rest, typescript]
---

# Habilidad Node.js & REST API Design

## Estructura Recomendada
- `routes/`: Definición de endpoints y métodos HTTP.
- `controllers/`: Manejo de peticiones y respuestas.
- `services/`: Lógica de negocio independiente del framework web.
- `middlewares/`: Autenticación, logging, rate limiting y manejo centralizado de errores.
- `validators/`: Esquemas de validación con Zod o Joi.

## Reglas de Implementación
1. **Validación Inmediata**: Valida `req.body`, `req.params` y `req.query` antes de ejecutar cualquier lógica.
2. **Middleware de Errores Global**:
   - Captura excepciones asíncronas con wrapper o soporte nativo de Express 5 / Fastify.
   - Retorna códigos de estado HTTP semánticos (400 Bad Request, 401 Unauthorized, 404 Not Found, 500 Internal Server Error).
3. **Seguridad**:
   - Headers de seguridad con `helmet`.
   - Hashing seguro de contraseñas con `bcrypt` o `argon2`.
   - Tokens JWT con expiración corta y refresh tokens rotativos.
