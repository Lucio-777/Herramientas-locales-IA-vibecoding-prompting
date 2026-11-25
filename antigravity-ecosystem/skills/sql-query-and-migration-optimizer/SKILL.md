---
name: sql-query-and-migration-optimizer
description: >-
  Optimiza consultas SQL, diseños de índices y migraciones de esquemas sin tiempo
  de inactividad (zero-downtime Expand/Contract) para PostgreSQL y SQLite. Úsala
  cuando diseñes o optimices queries SQL, analices problemas de N+1, crees índices
  o modifiques tablas en producción.
---

# SQL Query & Migration Optimizer

## Regla Principal: Medir Antes de Asumir
Nunca optimices ni des por buena una consulta SQL basándote solo en intuición. Cuando tengas acceso a los servidores MCP `postgres` o `sqlite` (o a la base de datos local), verifica el plan de ejecución real.

## 1. Flujo de Diagnóstico de Consultas
1. **Inspeccionar el plan de ejecución:**
   * En PostgreSQL:
     ```sql
     EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <TU_QUERY>;
     ```
   * En SQLite:
     ```sql
     EXPLAIN QUERY PLAN <TU_QUERY>;
     ```
2. **Señales de alerta en el plan:**
   * `Seq Scan` sobre tablas grandes (`>10,000` filas) filtrando por columnas selectivas.
   * `Nested Loop` con estimaciones erróneas de cardinalidad (`rows=` muy distinto de `actual rows=`).
   * `Sort` en disco (`Sort Method: external merge Disk`) o `Hash Batches > 1`.
   * Bucles N+1 en el código de aplicación (consulta por cada elemento en vez de `JOIN`, `IN`, `ANY($1)` o DataLoader).

## 2. Estrategia de Índices (PostgreSQL / SQLite)
* **B-Tree:** Igualdad y rangos (`=`, `<`, `>`, `BETWEEN`, `ORDER BY`). En índices compuestos, ordena columnas por **igualdad primero, rango después**.
* **Covering Index (`INCLUDE` en Postgres):** Evita acceder al heap (`Index Only Scan`) incluyendo columnas pequeñas consultadas en el `SELECT`.
* **Índice Parcial (`WHERE`):** Ideal cuando solo se consulta una fracción de filas (ej. `WHERE deleted_at IS NULL` o `WHERE status = 'pending'`).
* **GIN:** Obligatorio para búsquedas dentro de `JSONB`, arrays o `tsvector`.
* **Evitar funciones sobre columnas indexadas:** `WHERE LOWER(email) = ...` anula un índice normal salvo que exista un índice funcional `ON users (LOWER(email))`.

## 3. Migraciones Zero-Downtime (Patrón Expand/Contract)
En tablas en producción, **nunca** hagas `ALTER TABLE ... RENAME COLUMN`, `DROP COLUMN` o `ADD COLUMN ... NOT NULL DEFAULT` con bloqueo de tabla si hay código activo leyendo la versión anterior:

1. **Fase Expand (Compatible hacia atrás):**
   * Agrega la nueva columna como `NULL` (operación instantánea de metadatos).
   * En PostgreSQL, crea índices con `CREATE INDEX CONCURRENTLY` (fuera de transacción).
   * Despliega código que escriba en ambas columnas (doble escritura) y lea de la nueva con fallback a la vieja.
2. **Fase Backfill (Por lotes):**
   * Migra filas históricas en lotes pequeños (`1,000` a `5,000` filas por transacción con pausa breve) para evitar saturar WAL/locks.
3. **Fase Contract (Limpieza):**
   * Solo después de que todo el código en producción lea/escriba exclusivamente la nueva columna, agrega restricciones `NOT VALID` → `VALIDATE CONSTRAINT` y elimina la columna antigua.
