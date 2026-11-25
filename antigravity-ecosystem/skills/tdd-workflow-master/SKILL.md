---
name: tdd-workflow-master
description: >-
  Metodología rigurosa de Test-Driven Development (TDD) y Red-Green-Refactor.
  Usar al crear nuevas funciones de lógica de negocio, corregir bugs complejos o
  escribir suites de pruebas unitarias, de integración o e2e.
---

# Metodología Rigurosa de Test-Driven Development (TDD)

Esta skill guía el desarrollo guiado por pruebas garantizando calidad, diseño desacoplado y alta cobertura de casos extremos (*edge cases*).

---

## 1. El Ciclo Red-Green-Refactor

```
     ┌──────────────┐
     │  1. RED      │ Escribir una prueba pequeña que falle
     └──────┬───────┘
            ▼
     ┌──────────────┐
     │  2. GREEN    │ Escribir el código mínimo para pasarla
     └──────┬───────┘
            ▼
     ┌──────────────┐
     │  3. REFACTOR │ Limpiar código sin romper ninguna prueba
     └──────┬───────┘
            │
            └───────── Repetir con el siguiente caso
```

### Reglas de Oro
1. **No escribir código de producción** a menos que sea para hacer pasar un test fallido.
2. **Escribir solo el test mínimo** que baste para fallar (un fallo de compilación o error de aserción cuenta como fallo).
3. **Escribir solo el código mínimo de producción** que haga pasar el test inmediatamente.

---

## 2. Pirámide de Pruebas

1. **Unit Tests (70%)**: Rápidos, en memoria, prueban funciones puras, entidades y casos de uso con dependencias mockeadas/stubs.
2. **Integration Tests (20%)**: Prueban interacción entre componentes reales (ej. Repositorio contra base de datos en contenedor, llamadas a API interna).
3. **E2E Tests (10%)**: Flujos completos de usuario extremo a extremo (ej. Playwright / Cypress / Supertest).

---

## 3. Patrón AAA (Arrange - Act - Assert)

Estructurar cada test rigurosamente en tres secciones:

```typescript
describe('CreateUserUseCase', () => {
  it('should throw an error if the email is already in use', async () => {
    // 1. Arrange (Preparar datos y stubs)
    const existingUser = UserMother.create({ email: 'test@example.com' });
    userRepository.findByEmail.mockResolvedValue(existingUser);

    // 2. Act (Ejecutar la acción a probar)
    const resultPromise = useCase.execute({ email: 'test@example.com', name: 'John' });

    // 3. Assert (Verificar el resultado esperado)
    await expect(resultPromise).rejects.toThrow(UserAlreadyExistsError);
    expect(userRepository.save).not.toHaveBeenCalled();
  });
});
```

---

## 4. Matriz de Casos Borde (*Edge Cases*) Obligatorios

Siempre evaluar y probar los siguientes escenarios:
- [ ] **Valores Nulos y Vacíos**: `null`, `undefined`, cadenas vacías `""`, arrays vacíos `[]`.
- [ ] **Límites de Rango**: Valores menores al mínimo, exactamente en el límite y mayores al máximo.
- [ ] **Formatos Inválidos**: Emails con caracteres extraños, fechas imposibles, payloads malformados.
- [ ] **Condiciones de Carrera / Concurrencia**: Solicitudes simultáneas con el mismo identificador.
- [ ] **Errores de Red y Fallos Externos**: Timeout en servicios de terceros, caída de base de datos.

---

## 5. Checklist de Verificación de Calidad

- [ ] ¿El test falla de forma legible y descriptiva antes de implementar el código?
- [ ] ¿El test es determinista (no depende de la hora actual, fechas fijas sin mock, ni orden de ejecución)?
- [ ] ¿Cada test prueba un solo concepto lógico?
- [ ] ¿Se ejecutan todos los tests del suite en verde antes de dar por cerrada la tarea?
