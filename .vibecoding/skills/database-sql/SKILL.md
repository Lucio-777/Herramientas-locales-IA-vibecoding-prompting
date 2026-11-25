---
name: Database & SQL / Prisma
description: Diseño de esquemas de bases de datos relacionales, optimización de queries SQL, migraciones e integración con ORMs (Prisma, Drizzle).
tags: [database, sql, postgresql, mysql, prisma, backend]
---

# Habilidad Database & SQL / Prisma

## Principios de Modelado
1. **Normalización y Relaciones**:
   - Claves foráneas explícitas e índices en columnas de búsqueda frecuente (`WHERE`, `JOIN`, `ORDER BY`).
   - Restricciones de unicidad e integridad referencial (`ON DELETE CASCADE` o `RESTRICT` según el caso).
2. **Consultas Eficientes**:
   - Evita problemas de N+1 queries utilizando `include` o joins adecuados.
   - Paginación obligatoria mediante cursores o `limit`/`offset` para colecciones grandes.
3. **Transacciones y Consistencia**:
   - Agrupa operaciones dependientes dentro de transacciones (`prisma.$transaction`).
