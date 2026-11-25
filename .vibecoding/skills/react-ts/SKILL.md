---
name: React & TypeScript Moderno
description: Mejores prácticas para desarrollo de frontend con React 18/19, TypeScript, hooks personalizados y rendimiento óptimo.
tags: [react, typescript, frontend, web, jsx, tsx, hooks, ui]
---

# Habilidad React & TypeScript Moderno

## Directrices de Desarrollo
1. **Tipado Estricto de Props y Estado**:
   - Usa `interface Props { ... }` con tipos explícitos para cada componente.
   - Evita `any`; usa genéricos o tipos unión cuando sea necesario.
2. **Componentes Funcionales Limpios**:
   - Mantén componentes concisos (< 150 líneas cuando sea posible).
   - Extrae lógica compleja a Custom Hooks (`useUserData`, `useDebounce`, etc.).
3. **Optimización de Renderizado**:
   - Usa `useMemo` y `useCallback` en cálculos pesados y funciones pasadas a hijos memoizados.
   - Renderiza listas siempre con keys únicas y estables (nunca el índice del array si la lista muta).
4. **Accesibilidad (a11y) y Estilos**:
   - Etiquetas semánticas de HTML5 (`<main>`, `<nav>`, `<article>`, `<button>` en lugar de `<div>` con onClick).
   - Soporte para navegación por teclado y contraste adecuado de colores.
