---
name: web-vitals-accessibility
description: >-
  Optimización de rendimiento frontend (Core Web Vitals) y accesibilidad universal (WCAG 2.1 AA).
  Usar al construir o refactorizar interfaces de usuario, componentes UI o mejorar velocidad y accesibilidad.
---

# Frontend: Core Web Vitals & Accesibilidad (a11y)

Esta skill garantiza que las interfaces sean ultrarrápidas, fluidas e inclusivas para todos los usuarios.

---

## 1. Métricas de Core Web Vitals

| Métrica | Objetivo Ideal | Qué mide | Cómo optimizar |
| :--- | :--- | :--- | :--- |
| **LCP** (Largest Contentful Paint) | `< 2.5s` | Velocidad de carga percibida del contenido principal | Preload de la imagen héroe, fuentes críticas con `font-display: swap`, SSR / SSG. |
| **INP** (Interaction to Next Paint) | `< 200ms` | Capacidad de respuesta a interacciones del usuario | Evitar bloquear el hilo principal, trocear tareas largas (*chunking* con `requestIdleCallback` o Web Workers), optimizar re-renders. |
| **CLS** (Cumulative Layout Shift) | `< 0.1` | Estabilidad visual durante la carga | Declarar siempre atributos `width` y `height` en imágenes y vídeos, reservar espacio para banners con `min-height`. |

---

## 2. Accesibilidad Universal (WCAG 2.1 AA)

### A. Semántica HTML Primero
- Preferir siempre elementos nativos antes de simularlos con `<div>`:
  - Usar `<button>` en lugar de `<div onClick={...}>`.
  - Usar `<nav>`, `<main>`, `<header>`, `<footer>`, `<aside>`, `<article>`.

### B. Navegación Completa por Teclado
- Todo elemento interactivo debe ser alcanzable mediante `Tab`.
- El indicador de foco (`:focus-visible`) **nunca debe eliminarse** (`outline: none` sin reemplazo está prohibido).
- Diálogos y modales deben:
  1. Atrapar el foco (*Focus Trap*) mientras estén abiertos.
  2. Cerrarse al presionar la tecla `Escape`.
  3. Devolver el foco al elemento que los activó al cerrarse.

### C. Contraste de Colores
- Texto normal: ratio mínimo de contraste de **4.5:1** contra el fondo.
- Texto grande o elementos de interfaz: ratio mínimo de **3:1**.

### D. Roles y Atributos ARIA
- Usar `aria-label` cuando un botón o enlace no tiene texto visible (ej. botones con solo un icono).
- Usar `aria-expanded="true/false"` para desplegables y menús acordeón.
- Usar `aria-live="polite"` para notificaciones o alertas dinámicas.

---

## 3. Checklist de Auditoría Frontend

- [ ] ¿Todas las imágenes tienen atributos `alt` descriptivos (o `alt=""` si son decorativas)?
- [ ] ¿Se puede utilizar y navegar la página completa utilizando únicamente el teclado?
- [ ] ¿Las imágenes tienen dimensiones explícitas para evitar saltos de pantalla (CLS)?
- [ ] ¿Los campos de formulario cuentan con un `<label>` asociado mediante `for` / `id`?
- [ ] ¿Las fuentes web están optimizadas y precargadas?
