---
name: api-contract-fuzzing
description: >-
  Verificación automatizada de contratos API (OpenAPI, GraphQL) mediante
  Property-Based Fuzzing con Schemathesis y pruebas HTTP declarativas en texto
  plano con Hurl. Úsala después de crear o modificar endpoints REST/GraphQL.
---

# API Contract Fuzzing & Declarative HTTP Testing

## Cuándo Usar Esta Skill
* Cada vez que implementes o modifiques rutas en FastAPI, Express, NestJS, Django, Go o cualquier API que exponga OpenAPI/Swagger o GraphQL.
* Para detectar errores `500 Internal Server Error`, validaciones faltantes o discrepancias entre el código y el esquema OpenAPI.

---

## 1. Fuzzing de Contrato con Schemathesis (Property-Based Testing)
`Schemathesis` lee tu especificación OpenAPI/GraphQL y genera cientos de payloads límite (nulos, enteros negativos, strings Unicode, tipos incorrectos) para probar todos tus endpoints automáticamente.

### Regla de Seguridad Crítica
* Ejecuta `schemathesis` **ÚNICAMENTE** contra entornos locales (`http://127.0.0.1:PORT`) o staging con base de datos de pruebas. **Nunca** contra producción.

### Comandos Estándar
```powershell
# Levantar el servidor local de pruebas y ejecutar fuzzing sobre OpenAPI
schemathesis run http://127.0.0.1:8000/openapi.json --checks all

# Si el servidor requiere cabecera de autenticación de prueba
schemathesis run http://127.0.0.1:8000/openapi.json -H "Authorization: Bearer test-token" --checks all

# Limitar cantidad de ejemplos para validación rápida en CI/local
schemathesis run http://127.0.0.1:8000/openapi.json --max-examples 20
```

### Qué Verifica `--checks all`
1. `not_a_server_error`: Ninguna entrada válida o inválida debe provocar HTTP `5xx`.
2. `status_code_conformance`: Los códigos devueltos coinciden con los documentados en OpenAPI.
3. `response_schema_conformance`: El JSON de respuesta cumple exactamente con el esquema declarado.
4. `content_type_conformance`: Cabeceras `Content-Type` correctas.

---

## 2. Pruebas Declarativas de Integración con Hurl
Para flujos de negocio multi-paso (Login → Crear recurso → Consultar → Eliminar), crea archivos `.hurl` versionables en `tests/api/`:

```hurl
# tests/api/auth_and_items.hurl
POST http://127.0.0.1:8000/auth/login
{
  "email": "test@example.com",
  "password": "secret"
}
HTTP 200
[Captures]
token: jsonpath "$.access_token"

GET http://127.0.0.1:8000/items
Authorization: Bearer {{token}}
HTTP 200
[Asserts]
jsonpath "$" isCollection
header "Content-Type" contains "application/json"
```

Ejecuta la suite completa con:
```powershell
hurl --test tests/api/*.hurl
```
