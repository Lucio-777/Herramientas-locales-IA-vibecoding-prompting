---
name: docker-k8s-hardening
description: >-
  Mejores prácticas para contenedorización, Dockerfiles seguros y manifiestos de Kubernetes/IaC.
  Usar al empaquetar aplicaciones, escribir Dockerfiles, docker-compose o preparar configuraciones de infraestructura.
---

# Contenedorización Segura y Hardening de Docker & Kubernetes

Esta skill define patrones de producción para crear imágenes de contenedor ligeras, reproducibles y seguras.

---

## 1. Patrón Dockerfile Multi-Stage de Producción

Siempre separar la etapa de compilación (*builder*) de la etapa de ejecución (*runner*):

```dockerfile
# 1. Etapa de Dependencias y Compilación
FROM node:20-alpine AS builder
WORKDIR /app

# Optimizar caché de capas: copiar manifests antes del código
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --production

# 2. Etapa Final Mínima y Segura
FROM node:20-alpine AS runner
WORKDIR /app

# Crear usuario sin privilegios root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production
ENV PORT=3000

# Copiar únicamente los artefactos necesarios
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Cambiar al usuario sin privilegios
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
```

---

## 2. Reglas Críticas de Docker

1. **Nunca correr como Root**: Siempre declarar `USER appuser` en la imagen final.
2. **Archivos `.dockerignore`**: Excluir siempre `.git`, `node_modules`, `.env`, tests y documentación.
3. **Versiones Específicas**: Evitar la etiqueta `:latest`. Usar etiquetas inmutables (ej. `node:20.11-alpine` o digest SHA256).
4. **Optimización de Capas**: Colocar las instrucciones que menos cambian al principio para aprovechar el caché de Docker.

---

## 3. Seguridad en Manifiestos de Kubernetes

Todo despliegue debe implementar un `securityContext` restrictivo:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
      containers:
        - name: app
          image: mi-registro/api-service:v1.0.0
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          resources:
            limits:
              cpu: "500m"
              memory: "512Mi"
            requests:
              cpu: "100m"
              memory: "128Mi"
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 20
          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
```

---

## 4. Checklist de Validación de Contenedores

- [ ] ¿El contenedor corre bajo un usuario no-root?
- [ ] ¿Se implementó un healthcheck funcional?
- [ ] ¿El filesystem raíz es de solo lectura o los directorios temporales usan un `tmpfs`?
- [ ] ¿Se definieron límites y solicitudes de CPU y Memoria (`resources`)?
