---
name: clean-architecture-patterns
description: >-
  Guía de diseño de software, Clean Architecture y principios SOLID.
  Usar cuando se diseñe la estructura de un proyecto, se refactoricen módulos,
  se creen modelos de dominio, casos de uso, servicios o capas de persistencia.
---

# Clean Architecture & Principios de Diseño de Software

Esta skill proporciona pautas para diseñar código modular, mantenible y desacoplado, siguiendo los principios de Clean Architecture y SOLID.

---

## 1. Regla de Dependencia Fundamental

> **Las dependencias de código solo pueden apuntar hacia adentro**. 
> Las capas internas de negocio nunca deben importar ni depender de detalles de las capas externas (frameworks, bases de datos, librerías HTTP).

```
   ┌────────────────────────────────────────────────────────┐
   │ 4. Frameworks & Drivers (Express, React, Prisma, AWS)  │
   │   ┌────────────────────────────────────────────────┐   │
   │   │ 3. Interface Adapters (Controllers, Presenters)│   │
   │   │   ┌────────────────────────────────────────┐   │   │
   │   │   │ 2. Application (Use Cases, DTOs)       │   │   │
   │   │   │   ┌────────────────────────────────┐   │   │   │
   │   │   │   │ 1. Domain (Entities, Rules)    │   │   │   │
   │   │   │   └────────────────────────────────┘   │   │   │
   │   │   └────────────────────────────────────────┘   │   │
   │   └────────────────────────────────────────────────┘   │
   └────────────────────────────────────────────────────────┘
```

---

## 2. Estructura de Directorios Estándar

```text
src/
├── domain/                    # Capa 1: Reglas de negocio puras (sin librerías externas)
│   ├── entities/              # Entidades con identidad única y lógica intrínseca
│   ├── value-objects/         # Objetos de valor inmutables (ej. Email, Money)
│   └── repositories/          # Interfaces (contratos) de acceso a datos
├── application/               # Capa 2: Casos de uso de la aplicación
│   ├── use-cases/             # Clases o funciones que orquestan el flujo de negocio
│   └── dtos/                  # Data Transfer Objects (entrada y salida)
├── infrastructure/            # Capa 3 & 4: Implementación técnica y detalles externos
│   ├── database/              # Implementación de repositorios (TypeORM, Prisma, SQL)
│   ├── services/              # Integraciones externas (Stripe, Twilio, Resend)
│   └── http/                  # Servidor, rutas, middlewares y controladores
└── main/                      # Punto de entrada y composición (Dependency Injection)
```

---

## 3. Principios SOLID Aplicados

1. **Single Responsibility (SRP)**: Cada clase/función tiene un único motivo de cambio. Un controlador no maneja lógica SQL; un caso de uso no serializa JSON.
2. **Open/Closed (OCP)**: Extender mediante interfaces y polimorfismo, evitando modificar código existente probado.
3. **Liskov Substitution (LSP)**: Cualquier subclase o implementación debe poder reemplazar a su abstracción sin alterar la validez del programa.
4. **Interface Segregation (ISP)**: Preferir múltiples interfaces pequeñas y específicas a una interfaz monolítica.
5. **Dependency Inversion (DIP)**: Los módulos de alto nivel no deben depender de módulos de bajo nivel; ambos dependen de abstracciones (interfaces).

---

## 4. Checklist de Validación Arquitectónica

Antes de finalizar una implementación:
- [ ] ¿El dominio está libre de imports a ORMs, bases de datos o frameworks web?
- [ ] ¿Los casos de uso reciben sus dependencias por inyección (constructor o parámetros)?
- [ ] ¿Las entidades validan sus propias invariantes al crearse?
- [ ] ¿Las excepciones de infraestructura son traducidas a errores de dominio legibles?
- [ ] ¿Es posible probar la lógica de negocio completa sin levantar una base de datos real?
