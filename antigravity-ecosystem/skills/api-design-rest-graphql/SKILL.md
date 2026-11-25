---
name: api-design-rest-graphql
description: >-
  Estándares y mejores prácticas para diseño de APIs RESTful y GraphQL.
  Usar al diseñar rutas, contratos de interfaz, modelos de request/response, paginación,
  manejo consistente de errores y políticas de idempotencia.
---

# Diseño de APIs: Estándares RESTful & GraphQL

Esta skill proporciona reglas claras para construir APIs consistentes, predecibles y de nivel empresarial.

---

## 1. Convenciones RESTful Estrictas

### Nombres de Recursos
- Usar siempre **sustantivos en plural**: `/api/v1/users`, `/api/v1/orders`.
- Jerarquías lógicas: `/api/v1/users/{userId}/orders`.
- Nunca usar verbos en los paths (❌ `/api/v1/getUsers`, ❌ `/api/v1/createOrder`).

### Mapeo Semántico de Verbos HTTP
| Método | Acción | Código HTTP Éxito | ¿Es Idempotente? |
| :--- | :--- | :--- | :--- |
| `GET` | Recuperar recurso(s) | `200 OK` | Sí |
| `POST` | Crear un recurso o ejecutar acción no idempotente | `201 Created` | No |
| `PUT` | Reemplazo completo de un recurso | `200 OK` / `204 No Content` | Sí |
| `PATCH`| Actualización parcial de campos | `200 OK` | Sí |
| `DELETE`| Eliminar un recurso | `200 OK` / `204 No Content` | Sí |

---

## 2. Formato Estándar de Errores (RFC 7807: Problem Details)

Todas las respuestas de error deben tener una estructura consistente y predecible:

```json
{
  "type": "https://api.tuempresa.com/errors/invalid-input",
  "title": "Invalid Request Payload",
  "status": 422,
  "detail": "El campo 'email' tiene un formato inválido.",
  "instance": "/api/v1/users",
  "code": "VALIDATION_FAILED",
  "timestamp": "2026-10-07T20:50:00Z",
  "errors": [
    {
      "field": "email",
      "message": "Debe ser una dirección de correo válida"
    }
  ]
}
```

---

## 3. Paginación y Filtrado

Para colecciones grandes, preferir **paginación basada en cursor** sobre `offset`/`limit` tradicional:

```http
GET /api/v1/products?limit=20&cursor=eyJpZCI6MTIzNH0=
```

Respuesta:
```json
{
  "data": [...],
  "pagination": {
    "hasMore": true,
    "nextCursor": "eyJpZCI6MTI1NH0=",
    "limit": 20
  }
}
```

---

## 4. Idempotencia en Operaciones Críticas

Para pagos, transferencias o creación de órdenes:
- Exigir cabecera `Idempotency-Key: <UUID>`.
- Cachear el resultado de la petición con esa clave (en Redis) durante 24 horas. Si el cliente reintenta con la misma clave, devolver la respuesta cacheada sin duplicar el cobro.

---

## 5. GraphQL: Buenas Prácticas

1. **Evitar problema N+1**: Utilizar siempre `DataLoader` para agrupar (*batching*) y cachear lecturas de la base de datos por petición.
2. **Paginación**: Seguir la especificación de conexiones de Relay (`edges`, `node`, `pageInfo`).
3. **Control de Complejidad**: Limitar la profundidad de consultas (*query depth limit*) para prevenir ataques de denegación de servicio.

---

## 6. Checklist de Calidad de API

- [ ] ¿Los nombres de las rutas están en minúsculas y usan guiones medios (`kebab-case`)?
- [ ] ¿Las respuestas exitosas de creación devuelven código `201` con la cabecera `Location` o el recurso creado?
- [ ] ¿Todos los errores devuelven un formato estructurado y códigos HTTP adecuados (400, 401, 403, 404, 409, 422)?
- [ ] ¿La API está versionada en la URL (ej. `/v1/`)?
