# Ajuste de memoria del BUILD (Coolify / Hetzner 4GB)

## Sintoma
La build muere por **OOM Killer** (exit 1): BuildKit compila en paralelo la
etapa del frontend (`npm ci` + `npm run build`) y las etapas del backend, y el
pico de RAM combinado supera los 4 GB fisicos del VPS.

## Lo que YA se aplico en el repo (`Dockerfile.combined`)
1. **Serializacion forzada de etapas**: la etapa `backend-builder` referencia a
   `frontend-builder` con `COPY --from=frontend-builder ...`. Esto obliga a
   BuildKit a terminar la etapa 1 (npm) **antes** de arrancar la 2 (pip), y a la
   etapa final (apt/nodejs) despues de ambas. Elimina el pico de RAM en paralelo.
2. **Instalacion de Node.js fragmentada en 4 capas `RUN`** independientes.
3. **Limpieza agresiva en cada capa apt**: `apt-get clean` +
   `rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*`.

## Palancas REALES del lado Coolify / daemon (opcionales, refuerzo)
> NOTA IMPORTANTE: **NO existe una directiva de Dockerfile ni una variable de
> entorno estandar que limite el paralelismo de BuildKit.** El paralelismo lo
> controla el builder/daemon. No escribir `ENV BUILDKIT_*=...` en el Dockerfile:
> no hace nada.

### Opcion A - Builder legacy secuencial (mas contundente)
En **Coolify > App > Environment / Build**, agregar la variable:
```
DOCKER_BUILDKIT=0
```
El builder legacy compila **secuencialmente** (sin paralelismo de etapas).
Advertencia: `docker compose` v2 puede ignorar `DOCKER_BUILDKIT=0`; si no toma,
usar la Opcion B.

### Opcion B - Limitar el paralelismo de buildkitd (host)
En el VPS, editar `/etc/buildkit/buildkitd.toml`:
```toml
[worker.oci]
  max-parallelism = 1
```
Y reiniciar el daemon:
```bash
systemctl restart docker
```

### Opcion C - Swap (absorbe picos)
En el VPS:
```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
```
Persistir en `/etc/fstab`:
```
/swapfile none swap sw 0 0
```

## Verificacion
Despues del cambio, relanzar el Redeploy en Coolify y confirmar en el log que
las etapas corren **una despues de otra** (no intercaladas) y que no aparece
`Killed` / `exit code 1` por OOM.
