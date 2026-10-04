# Ajuste de memoria del BUILD (Coolify / Hetzner 4GB)

## Sintoma
La build muere por **OOM Killer** (exit 1), o el **streaming de logs de Coolify
se congela y finaliza cortado** durante el paso de build. Aclaracion (verificado
2026-10-04): **NO es un "truncamiento de secretos"**. El repo NO contiene
ninguna directiva `--mount=type=secret` (grep sobre todo el arbol = 0 resultados).
El corte del log es un sintoma de **presion de memoria**: BuildKit compila
etapas en paralelo, el pico combinado supera los 3.7 GB fisicos del VPS, el
daemon queda estrangulado y el socket de logs se cae.

## Estado REAL verificado del servidor (2026-10-04)
Evidencia obtenida por SSH a `178.156.224.212`:

| Item | Valor verificado |
|------|------------------|
| Hostname | `ubuntu-4gb-ash-1` |
| RAM total | 3.7 Gi (`nproc` = 3) |
| **Swap** | **4.0 Gi ACTIVA** (`/swapfile`, ~335 Mi en uso) |
| Persistencia swap | SI, en `/etc/fstab`: `/swapfile none swap sw 0 0` |
| Docker | 29.4.0 |
| `/etc/buildkit/buildkitd.toml` | **NO existe** (Opcion B aun sin aplicar) |
| Disco `/` | 75G total, 17G usados, 56G libres |

### Swap 4GB - EJECUTADO Y VERIFICADO
Registrado el 2026-10-04 en el VPS Hetzner. Evidencia cruda:
```
$ free -h
Swap:  4.0Gi  used: 335Mi  free: 3.7Gi

$ swapon --show
NAME      TYPE SIZE   USED PRIO
/swapfile file   4G 335.3M   -2

$ grep -i swap /etc/fstab
/swapfile none swap sw 0 0
```
La swap persiste reinicios (via `/etc/fstab`) y absorbe los picos de la build.

## Lo que YA se aplico en el repo (`Dockerfile.combined`)
1. **Serializacion forzada de las etapas de build**: la etapa `backend-builder`
   referencia a `frontend-builder` con `COPY --from=frontend-builder ...`. Esto
   obliga a BuildKit a terminar la etapa 1 (npm) **antes** de arrancar la 2 (pip).
2. **Serializacion forzada de la ETAPA FINAL (nuevo, 2026-10-04)**: el stage
   final (apt-get + nodejs) NO esperaba a las etapas de build. Hasta el primer
   `COPY --from=...` no habia arista de dependencia, asi que sus capas `RUN`
   podian correr EN PARALELO con `npm run build` y `pip install` (esto es lo que
   la version anterior de este doc daba por sentado y NO era cierto). Se agrego
   al inicio de la etapa final el copy-marcador
   `COPY --from=backend-builder /tmp/.frontend-builder-done /tmp/.builders-done`,
   que crea la arista y obliga a que TODA la build termine antes de arrancar
   apt/nodejs.
3. **Instalacion de Node.js fragmentada en 4 capas `RUN`** independientes.
4. **Limpieza agresiva en cada capa apt**: `apt-get clean` +
   `rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*`.

## Palancas REALES del lado Coolify / daemon (opcionales, refuerzo)
> NOTA IMPORTANTE: **NO existe una directiva de Dockerfile ni una variable de
> entorno estandar que limite el paralelismo de BuildKit.** El paralelismo lo
> controla el builder/daemon. No escribir `ENV BUILDKIT_*=...`,
> `ENV DOCKER_BUILDKIT=0` ni `ENV COMPOSE_DOCKER_CLI_BUILD=0` en el Dockerfile:
> **no hacen nada** (el cliente Docker lee `DOCKER_BUILDKIT` de SU propio
> entorno, no del Dockerfile; a lo sumo quedarian como variable muerta dentro de
> la imagen). Tampoco agregar `# syntax=docker/dockerfile:1` si el objetivo es
> *desactivar* BuildKit: esa directiva hace lo contrario (es el opt-in al
> frontend de BuildKit). Cualquier cambio de esta naturaleza va en la UI de
> Coolify (Opcion A) o en buildkitd (Opcion B), nunca en el Dockerfile.

### Opcion A - Builder legacy secuencial (mas contundente)
En **Coolify > App > Environment / Build**, agregar la variable:
```
DOCKER_BUILDKIT=0
```
El builder legacy compila **secuencialmente** (sin paralelismo de etapas).
Advertencia: `docker compose` v2 puede ignorar `DOCKER_BUILDKIT=0`; si no toma,
usar la Opcion B.

### Opcion B - Limitar el paralelismo de buildkitd (host) - PENDIENTE / A DECIDIR
Estado 2026-10-04: `/etc/buildkit/buildkitd.toml` **NO existe** en el VPS, asi
que la concurrencia de BuildKit sigue en su default (nproc = 3). Para aplicarlo,
en el VPS:
```bash
sudo mkdir -p /etc/buildkit
sudo tee /etc/buildkit/buildkitd.toml <<'TOML'
[worker.oci]
  max-parallelism = 1
TOML
sudo systemctl restart docker
```
ADVERTENCIA: `systemctl restart docker` reinicia el daemon y **corta todos los
contenedores en ejecucion** (Coolify, Traefik, Postgres, la app) = downtime.
Coordinar con el usuario antes de ejecutarlo. Con la swap ya activa + la
serializacion de la etapa final ya aplicada en `Dockerfile.combined`, esta
opcion pasa a ser refuerzo opcional.

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
