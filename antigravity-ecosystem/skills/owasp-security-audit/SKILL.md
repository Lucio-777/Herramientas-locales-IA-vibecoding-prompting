---
name: owasp-security-audit
description: >-
  Auditoría de seguridad y mitigación de vulnerabilidades basada en OWASP Top 10.
  Usar al auditar código, implementar autenticación o autorización, manipular datos sensibles,
  crear endpoints o validar entradas de usuario.
---

# Auditoría de Seguridad y Mitigación de Vulnerabilidades (OWASP Top 10)

Esta skill proporciona reglas y controles para garantizar que el código sea seguro por diseño (*Secure by Design*).

---

## 1. Los 10 Riesgos Críticos de OWASP y Cómo Mitigarlos

### A01: Broken Access Control (Control de Acceso Roto)
- **Regla**: Denegar el acceso por defecto (*Deny by default*).
- **Acción**: Validar permisos tanto en la capa de transporte (middleware de rutas) como en la capa de servicio/dominio (ej. verificar que el recurso pertenece al `userId` del token).
- **Evitar**: Confiar ciegamente en IDs enviados por el cliente (`req.body.userId`).

### A02: Cryptographic Failures (Fallos Criptográficos)
- **Regla**: Usar siempre algoritmos robustos y actualizados (Argon2id o bcrypt para contraseñas; AES-256-GCM para datos en reposo).
- **Acción**: Forzar HTTPS y HSTS. Nunca almacenar contraseñas en texto plano ni usar MD5 / SHA1.

### A03: Injection (Inyecciones SQL, NoSQL, OS Command)
- **Regla**: Nunca concatenar cadenas en consultas o comandos del sistema operativo.
- **Acción**: Utilizar sentencias preparadas (*parameterized queries*) u ORMs seguros. Sanitizar entradas si se invocan scripts externos.

### A04: Insecure Design (Diseño Inseguro)
- **Regla**: Implementar limitadores de tasa (*rate limiting*) en endpoints de autenticación, recuperación de contraseñas y operaciones costosas.
- **Acción**: Bloquear fuerza bruta y abusos de API.

### A05: Security Misconfiguration (Mala Configuración de Seguridad)
- **Regla**: Desactivar mensajes de depuración detallados y trazas de error (*stack traces*) en entornos de producción.
- **Acción**: Configurar cabeceras de seguridad HTTP (`Helmet`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`).

### A06: Vulnerable and Outdated Components (Componentes Desactualizados)
- **Acción**: Ejecutar auditorías automáticas de dependencias (`npm audit`, `pip-audit`, `snyk`) y bloquear paquetes con CVEs críticos.

### A07: Identification and Authentication Failures (Fallos de Identificación y Autenticación)
- **Regla**: JWTs con tiempo de vida corto (*short-lived access tokens*), firmas seguras (RS256 o HS256 con secretos de alta entropía) y almacenamiento en cookies `HttpOnly; Secure; SameSite=Strict`.

### A08: Software and Data Integrity Failures (Fallos de Integridad)
- **Regla**: Verificar firmas digitales y sumas de verificación (checksums) al descargar recursos externos o plugins.

### A09: Security Logging and Monitoring Failures (Fallos en Logs y Monitoreo)
- **Regla**: Registrar eventos de seguridad relevantes (intentos fallidos de login, cambios de privilegios).
- **Regla Crítica**: **NUNCA registrar credenciales, tarjetas de crédito ni PII en los logs**.

### A10: Server-Side Request Forgery (SSRF)
- **Regla**: Si el servidor realiza peticiones HTTP a URLs enviadas por el usuario, validar contra una lista blanca de dominios y bloquear rangos de IP privadas (`127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`).

---

## 2. Validación y Sanitización de Entradas

Validar rigurosamente el esquema de todo dato entrante antes de procesarlo:

```typescript
import { z } from 'zod';

export const CreateUserSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(12).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
  role: z.enum(['USER', 'ADMIN']).default('USER'),
});
```

---

## 3. Checklist Previo al Despliegue

- [ ] ¿Hay secretos o claves API hardcodeados en el código? (Verificar que se usen variables de entorno).
- [ ] ¿El archivo `.gitignore` excluye `.env`, `.pem`, `id_rsa` y certificados?
- [ ] ¿Los endpoints protegidos validan propiedad del recurso, no solo si el usuario está autenticado?
- [ ] ¿Están configuradas las cabeceras CORS de forma restrictiva (no usar `Access-Control-Allow-Origin: *` con credenciales)?
