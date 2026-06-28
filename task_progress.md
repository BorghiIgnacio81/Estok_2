# Diagnóstico de Bugs - Progreso

- [x] Login exitoso contra producción (ygumy44/C05m05)
- [x] Bug #1: PATCH funciona correctamente desde API directa (200 OK)
- [x] Bug #2: DELETE funciona correctamente desde API directa (204 No Content)
- [x] Bug #3: category-fields 404 - endpoint NO existe (no arreglar por ahora)
- [x] Bug #4: Error 500 al crear objeto con tipo != 'objeto' - CONFIRMADO
- [x] Búsqueda de 127.0.0.1:8000: 15 archivos encontrados
- [x] Confirmado: services/api.ts, services/aiHeartbeat.ts, lib/*, components/Card.astro son código muerto
- [ ] Eliminar archivos muertos: services/api.ts, services/aiHeartbeat.ts, lib/api.ts, lib/toast.ts, lib/ui.ts, lib/constants.ts, components/Card.astro
- [ ] Fix auth.ts: exportar API_BASE_URL con fallback '/api'
- [ ] Fix 12 archivos .astro: importar API_BASE_URL desde auth.ts
- [ ] Fix serializers.py: asignar estok en ObjetoCreateSerializer.create()
- [ ] Verificar grep final: 0 ocurrencias de 127.0.0.1:8000
- [ ] Verificar build de Astro
