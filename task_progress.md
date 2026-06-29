# Diagnóstico de Bugs - Progreso

## ✅ COMPLETADO
- [x] Login exitoso contra producción (ygumy44/C05m05)
- [x] Bug #1: PATCH funciona correctamente desde API directa (200 OK)
- [x] Bug #2: DELETE funciona correctamente desde API directa (204 No Content)
- [x] Bug #3: category-fields 404 - endpoint NO existe (no arreglar por ahora)
- [x] Bug #4: Error 500 al crear objeto con tipo != 'objeto' - CONFIRMADO
- [x] Búsqueda de 127.0.0.1:8000: 15 archivos encontrados
- [x] Confirmado: services/api.ts, services/aiHeartbeat.ts, lib/*, components/Card.astro son código muerto
- [x] Eliminar archivos muertos: services/api.ts, services/aiHeartbeat.ts, lib/api.ts, lib/toast.ts, lib/ui.ts, lib/constants.ts, components/Card.astro
- [x] Fix auth.ts: exportar API_BASE_URL con fallback '/api'
- [x] Fix 12 archivos .astro: importar API_BASE_URL desde auth.ts
- [x] Fix serializers.py: asignar estok en ObjetoCreateSerializer.create()
- [x] Verificar grep final: 0 ocurrencias de 127.0.0.1:8000
- [x] Verificar build de Astro
- [x] Bug #1 "Analizar con IA se traba": CORS fix implementado y verificado en servidor (204 OK). Causa raíz: LM Studio no está corriendo en el servidor (puerto 1234 sin proceso)

## 📋 PENDIENTE
- [ ] Bug #5: Error 500 al crear objeto con tipo != 'objeto' - Arreglar serializers.py
- [ ] Bug #6: Verificar que el fix de CORS en OPTIONS preflight funciona en producción
- [ ] Bug #7: Revisar heartbeat de IA (test_ia_stress) cuando LM Studio no está disponible
- [ ] Bug #8: Verificar que el frontend muestre error amigable cuando IA no disponible
- [ ] Bug #9: Revisar si hay otros endpoints que fallen por CORS
- [ ] Bug #10: Verificar que el cambio de estok activo funcione correctamente
- [ ] Bug #11: Revisar que la creación de objetos con imágenes funcione
- [ ] Bug #12: Verificar que la edición de objetos funcione correctamente
- [ ] Bug #13: Revisar que la eliminación de objetos funcione correctamente
- [ ] Bug #14: Verificar que la búsqueda de objetos funcione correctamente
- [ ] Bug #15: Revisar que la paginación funcione correctamente
- [ ] Bug #16: Verificar que los filtros funcionen correctamente
- [ ] Bug #17: Revisar que la exportación funcione correctamente
- [ ] Bug #18: Verificar que la importación funcione correctamente
- [ ] Bug #19: Revisar que los reportes funcionen correctamente
- [ ] Bug #20: Verificar que la sincronización funcione correctamente
