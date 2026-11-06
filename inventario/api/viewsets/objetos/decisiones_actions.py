"""
Mixin del módulo de DECISIONES dentro del viewset de Objetos.

Expone los DOS tableros que consumen la pestaña "Decisiones" del frontend:

    GET /api/objetos/pendientes_decision/   → Bloque 1 (objetos SIN decisión)
    GET /api/objetos/panel_decisiones/      → Bloques 3, 4 y 5 (ya decididos) +
                                              Alerta Rojo del Bloque 2
                                              (descartes con gracia vigente)

Vive en su propio mixin (igual que ia_actions / stock_actions /
marketing_actions / descarte_actions) para que cada módulo tenga su endpoint
aislado y utilities no siga creciendo.

Criterio del Bloque 1 (única fuente de verdad, sin duplicar la regla del
service de votaciones):
  - SOLO objetos finales del inventario: se excluyen los muebles y espacios
    (CONJUNTO / MUEBLE_INMUEBLE / MUEBLE_MOVIL) y las cajas (CAJA), que el
    backend registra como Contenedor (+ un registro espejo en Objeto).
  - `owner_action` nulo: todavía no se decidió Vender / Conservar / Tirar.
  - sin baja lógica (`deleted_at` nulo).
  - SIN votación abierta: cuando el objeto tiene Dueño y el Beneficiario está
    vacío, decide el Estok en democracia
    (inventario/services/decisiones_service.py) y esos objetos se listan en
    /api/decisiones/pendientes/ ("Votaciones pendientes del Estok"), nunca
    duplicados acá.

El payload de cada objeto es ÚNICO (`payload_objeto_decision`) y lo comparten
los dos endpoints y el mixin de descarte: no se duplica el armado de tarjetas.

Aislamiento multi-tenant: SIEMPRE por el header X-Estok-Id.
"""

from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from ....models import DecisionVotacion, Objeto
from ....api.tenant_activo import estok_id_de_request
from ....services import descarte_service, decisiones_service
from ....services import mercadolibre_estado
from ....services.espejo_contenedor import (
    q_objeto_es_espejo,
    q_objeto_espejo_explicito,
)

# Estados de decisión patrimonial que significan «marcado para vender».
# El modelo persiste el valor canónico `vender` (Objeto.OWNER_ACTION_CHOICES);
# `para_vender` se acepta como alias de LECTURA por compatibilidad con cargas
# históricas/importaciones, para que ningún objeto quede fuera del bloque.
DECISIONES_VENTA = ('vender', 'para_vender')


def nombre_mostrable(usuario):
    """Nombre legible de un usuario (o None si no hay usuario)."""
    if not usuario:
        return None
    return usuario.get_full_name() or usuario.username


def _estado_publicacion(objeto):
    """
    Estado REAL de la publicación del objeto (fuente única).

    Delega en services/mercadolibre_estado.py, que traduce el `status` que
    Mercado Libre reportó (active / paused / closed) al estado canónico que
    pintan las tarjetas: publicado / pausada / finalizada / sin_publicar.
    El `item_id` legacy y el `permalink` los resuelve el propio servicio.
    """
    return mercadolibre_estado.estado_publicacion(objeto)


def payload_objeto_decision(obj, request):
    """
    Payload plano de un objeto del módulo de Decisiones.

    Lo consumen la grilla de pendientes (Bloque 1), los grupos ya decididos
    (Bloques 3, 4 y 5) y el Alerta Rojo de descartes en gracia (Bloque 2): foto,
    título, ubicación, decisión tomada, fin del período de gracia y despacho.
    """
    fotos = list(obj.fotos.all())
    principal = next((f for f in fotos if f.es_principal), None)
    foto = principal or (fotos[0] if fotos else None)

    usuario_id = getattr(request.user, 'id', None)
    # El objeto "espera al usuario" cuando él es el dueño original o el
    # beneficiario designado: ese caso usa el endpoint dedicado
    # POST /api/objetos/{id}/owner_action/ (regla del dueño original).
    # El resto de la grilla fija la decisión por el CRUD (PUT del objeto).
    es_decision_propia = bool(usuario_id) and usuario_id in (
        obj.dueno_original_id, obj.beneficiario_id,
    )
    plataformas = list(obj.plataformas_publicadas or [])
    # ESTADO REAL DE LA PUBLICACIÓN (fuente única: services/mercadolibre_estado):
    # si Mercado Libre reporta el ítem pausado/finalizado, la tarjeta deja de
    # decir «Publicado listo para vender» y muestra el estado verdadero.
    info_ml = _estado_publicacion(obj)
    # Otras plataformas (facebook/instagram) siguen contando como «publicado»
    # aunque Mercado Libre no tenga publicación.
    otras_plataformas = [
        plataforma for plataforma in plataformas
        if str(plataforma).strip().lower() != 'mercadolibre'
    ]
    publicado = bool(info_ml['publicado']) or bool(otras_plataformas)
    if info_ml['estado'] != mercadolibre_estado.ESTADO_SIN_PUBLICAR:
        estado_publicacion = info_ml['estado']
        estado_publicacion_label = info_ml['label']
    elif publicado:
        estado_publicacion = 'publicado'
        estado_publicacion_label = 'Publicado'
    else:
        estado_publicacion = mercadolibre_estado.ESTADO_SIN_PUBLICAR
        estado_publicacion_label = mercadolibre_estado.ETIQUETAS[
            mercadolibre_estado.ESTADO_SIN_PUBLICAR
        ]

    return {
        "id": str(obj.id),
        "nombre": obj.nombre,
        "foto_principal": foto.imagen.url if foto and foto.imagen else None,
        "estado_conservacion": obj.estado_conservacion,
        "valor_estimado": str(obj.valor_estimado) if obj.valor_estimado else None,
        "categoria_nombre": obj.categoria.nombre if obj.categoria else None,
        # --- Publicación (Bloque 3 + sección destacada de venta) ---
        "plataformas_publicadas": plataformas,
        "publicado": publicado,
        "estado_publicacion": estado_publicacion,
        "estado_publicacion_label": estado_publicacion_label,
        # Estado NATIVO que reporta Mercado Libre (active / paused / closed) y
        # la advertencia lista para mostrar en la tarjeta.
        "publicacion_status": info_ml['status'] or None,
        "publicacion_activa": info_ml['activa'],
        "publicacion_aviso": info_ml['aviso'],
        # PERMALINK guardada de la publicación VIGENTE (None si está finalizada,
        # eliminada o si todavía no se sincronizó su permalink real): sin URL la
        # UI NO dibuja «Ver publicación», así nadie termina en un 404 de
        # Mercado Libre. Nunca se arma con el item_id.
        "url_publicacion": info_ml['url'],

        "dueno_original": (
            str(obj.dueno_original_id) if obj.dueno_original_id else None
        ),
        "dueno_original_nombre": nombre_mostrable(obj.dueno_original),
        "dueno_externo_nombre": (obj.dueno_externo_nombre or '').strip() or None,
        "beneficiario": (
            str(obj.beneficiario_id) if obj.beneficiario_id else None
        ),
        "beneficiario_nombre": nombre_mostrable(obj.beneficiario),
        "es_decision_propia": es_decision_propia,
        "ubicacion": str(obj.ubicacion_id) if obj.ubicacion_id else None,
        "ubicacion_nombre": obj.ubicacion.nombre if obj.ubicacion else None,
        "contenedor": str(obj.contenedor_id) if obj.contenedor_id else None,
        "contenedor_nombre": obj.contenedor.nombre if obj.contenedor else None,
        # --- Decisión tomada (Bloques 3, 4 y 5) ---
        "owner_action": obj.owner_action,
        "owner_action_label": (
            obj.get_owner_action_display() if obj.owner_action else None
        ),
        # --- Período de gracia del descarte (Alerta Rojo + Bloque 4) ---
        "descartado_en": obj.descartado_en.isoformat() if obj.descartado_en else None,
        "fecha_limite_descarte": (
            obj.fecha_limite_descarte.isoformat() if obj.fecha_limite_descarte else None
        ),
        "en_periodo_gracia": obj.en_periodo_gracia,
        "segundos_para_descarte": obj.segundos_para_descarte,
        "descarte_listo_para_ejecutar": obj.descarte_listo_para_ejecutar,
        # --- Despacho del envío (solo Administrador Físico) ---
        "despachado_en": obj.despachado_en.isoformat() if obj.despachado_en else None,
        "despachado_por_nombre": nombre_mostrable(obj.despachado_por),
    }


def respuesta_decision_denegada(objeto, request):
    """
    Guardia ÚNICA de las decisiones directas (vender / conservar / tirar).

    Delega en `decisiones_service.validar_decision_directa` y traduce el
    veredicto a HTTP, para que TODOS los puntos de entrada (endpoint dedicado,
    CRUD y limpieza) compartan una sola regla sin duplicarla.

    Devuelve `None` cuando la acción PROCEDE, o una `Response` lista para
    retornar:
      · HTTP 403 → el objeto pertenece a OTRO usuario del sistema.
      · HTTP 202 → dueño externo/fallecido: muta a votación del Estok (FOMO).
    """
    resultado = decisiones_service.validar_decision_directa(
        objeto, request.user, creado_por=request.user,
    )
    if resultado.estado == decisiones_service.DECISION_PERMITIDA:
        return None
    if resultado.estado == decisiones_service.DECISION_DERIVADA:
        return Response(
            {
                'requiere_votacion': True,
                'votacion_id': (
                    str(resultado.votacion.id) if resultado.votacion else None
                ),
                'owner_action': None,
                'mensaje': resultado.motivo,
            },
            status=status.HTTP_202_ACCEPTED,
        )
    return Response(
        {'error': resultado.motivo}, status=status.HTTP_403_FORBIDDEN
    )


class DecisionesActionsMixin:
    """Endpoints de decisión (dueño original / Estok) sobre el inventario."""

    # ------------------------------------------------------------------
    # Helpers internos
    # ------------------------------------------------------------------
    @staticmethod
    def _estok_id(request):
        """Tenant activo del request (header X-Estok-Id con fallback a query)."""
        return estok_id_de_request(request)

    def _objetos_del_estok(self):
        """
        Queryset base del tablero (sin bajas lógicas, optimizado sin N+1).

        FILTRO TAXONÓMICO ESTRICTO — SOLO OBJETOS FINALES DEL INVENTARIO:
        los muebles, cajas y espacios NO son ítems de stock y jamás deben
        figurar acá. El backend los persiste como `Contenedor` y, por la REGLA
        DE DUALIDAD, inserta además un registro ESPEJO en `Objeto` (que se veía
        como «Mueble 1» / «Mueble 2» en el tablero). Esos espejos se excluyen de
        raíz con la regla ESTRUCTURAL ÚNICA del servicio `espejo_contenedor`,
        que NO depende del nombre del contenedor (a prueba de renombrados).
        """
        qs = (
            Objeto.objects.select_related(
                'ubicacion', 'contenedor', 'dueno_original', 'beneficiario',
                'categoria', 'despachado_por',
                # Estado real de la publicación en Mercado Libre sin N+1.
                'publicacion_ml',
            )
            .prefetch_related('fotos')
            .filter(deleted_at__isnull=True)
        )

        # Excluye de raíz TODO registro espejo (dual de un Contenedor): muebles,
        # cajas y espacios que no son objetos finales del inventario. Los
        # objetos sueltos (sin contenedor) y los objetos reales (clasificados o
        # guardados en un casillero) NO se ven afectados.
        qs = qs.exclude(q_objeto_es_espejo())

        estok_id = self._estok_id(self.request)
        if estok_id:
            qs = qs.filter(estok_id=estok_id)
        return qs

    def _objetos_con_decision(self):
        """
        Queryset base de los objetos que YA tienen una decisión patrimonial.

        REGLA DE RECUPERACIÓN (fix del listado «Objetos para Vender»):
        a diferencia de `_objetos_del_estok`, este queryset NO aplica la
        heurística estructural de espejos (`q_objeto_es_espejo`). Una decisión
        HUMANA explícita (vender / conservar / tirar / mudar) pesa más que esa
        heurística: si el objeto fue marcado, DEBE aparecer en el tablero.
        Solo se descarta la marca EXPLÍCITA de espejo de contenedor
        (`especificaciones.es_espejo_contenedor = true`, NULL-safe).

        Multi-tenant: incluye además los objetos legacy con `estok` nulo que
        cuelgan de una ubicación del Estok activo, para que una carga vieja
        marcada para vender nunca desaparezca del listado.
        """
        qs = (
            Objeto.objects.select_related(
                'ubicacion', 'contenedor', 'dueno_original', 'beneficiario',
                'categoria', 'despachado_por',
                # Estado real de la publicación en Mercado Libre sin N+1.
                'publicacion_ml',
            )
            .prefetch_related('fotos')
            .filter(deleted_at__isnull=True)
            .exclude(q_objeto_espejo_explicito())
        )

        estok_id = self._estok_id(self.request)
        if estok_id:
            qs = qs.filter(
                Q(estok_id=estok_id)
                | Q(estok__isnull=True, ubicacion__estok_id=estok_id)
            )
        return qs

    @staticmethod
    def _ids_en_votacion():
        """Objetos ya en votación democrática (no vuelven a los bloques de decisión)."""
        return DecisionVotacion.objects.filter(
            estado=DecisionVotacion.ESTADO_PENDIENTE
        ).values('objeto_id')

    # ------------------------------------------------------------------
    # Bloque 1: objetos SIN decisión
    # ------------------------------------------------------------------
    @action(detail=False, methods=['get'])
    def pendientes_decision(self, request):
        """
        Lista los objetos del Estok activo que esperan una decisión.

        GET /api/objetos/pendientes_decision/
        """
        qs = (
            self._objetos_del_estok()
            .filter(owner_action__isnull=True)
            .exclude(id__in=self._ids_en_votacion())
            .order_by('-fecha_registro')
        )

        resultados = [payload_objeto_decision(obj, request) for obj in qs]
        return Response({
            "count": len(resultados),
            "results": resultados,
            "total_usuarios_activos": descarte_service.total_usuarios_activos(
                self._estok_id(request)
            ),
        })

    # ------------------------------------------------------------------
    # Bloque destacado: objetos CON decisión de VENTA (acceso rápido)
    # ------------------------------------------------------------------
    @action(detail=False, methods=['get'], url_path='en_venta')
    def en_venta(self, request):
        """
        Objetos del Estok activo marcados EXPLÍCITAMENTE para vender.

        GET /api/objetos/en_venta/

        Alimenta la sección destacada 🏷️ «Objetos con Decisión de Venta /
        Listos para Publicar» de la cima de /alertas-stock, para que el usuario
        tenga a mano los objetos que decidió publicar (Mercado Libre / Facebook)
        sin depender del resto del tablero.

        Reglas (explícitas, sin exclusiones implícitas):
          · `owner_action` en DECISIONES_VENTA (`vender`; alias `para_vender`).
          · sin baja lógica.
          · mismo Estok activo del header X-Estok-Id (+ legacy sin estok con
            ubicación del Estok activo).
          · se descarta SOLO la marca explícita de espejo de contenedor: una
            decisión humana de vender NUNCA se pierde por la heurística
            estructural (fix del listado «Objetos para Vender»).

        NO excluye objetos con votación pendiente: si la decisión de venta ya
        está persistida, el objeto DEBE aparecer acá. Devuelve el payload único
        `payload_objeto_decision` (nombre, foto, valor, ubicación y estado de
        publicación) + un resumen para el encabezado.
        """
        qs = (
            self._objetos_con_decision()
            .filter(owner_action__in=DECISIONES_VENTA)
            .order_by('-updated_at')
        )

        resultados = [payload_objeto_decision(obj, request) for obj in qs]
        publicados = sum(1 for obj in resultados if obj['publicado'])
        valor_total = sum(
            float(obj['valor_estimado'])
            for obj in resultados
            if obj['valor_estimado']
        )

        return Response({
            "count": len(resultados),
            "results": resultados,
            "resumen": {
                "total": len(resultados),
                "sin_publicar": len(resultados) - publicados,
                "publicados": publicados,
                "valor_total": valor_total,
            },
        })

    # ------------------------------------------------------------------
    # Bloques 3, 4 y 5 + Alerta Rojo del Bloque 2
    # ------------------------------------------------------------------
    @action(detail=False, methods=['get'])
    def panel_decisiones(self, request):
        """
        Tablero de objetos YA decididos, agrupado por bloque de la UI.

        GET /api/objetos/panel_decisiones/

        Bloques devueltos:
          - vender_sin_publicar → decisión Vender, sin publicar en ninguna
            plataforma (la UI ofrece armar el formulario de Mercado Libre).
          - vender_publicados   → decisión Vender y ya publicados (link 🔗).
          - tirar               → decisión Tirar (en espera de la ejecución
            física o del fin del tiempo de reclamo).
          - conservar           → lista de protección (Bloque 5).
          - en_mudanza          → reclamados antes del descarte para mudarse.
          - descartes_en_gracia → subconjunto de `tirar` con plazo de reclamo
            VIGENTE: alimenta el Alerta Rojo con contador regresivo.
        """
        estok_id = self._estok_id(request)
        decididos = (
            self._objetos_con_decision()
            .filter(owner_action__isnull=False)
            .exclude(id__in=self._ids_en_votacion())
            .order_by('-updated_at')
        )

        grupos = {
            'vender_sin_publicar': [],
            'vender_publicados': [],
            'tirar': [],
            'conservar': [],
            'en_mudanza': [],
        }
        descartes = []

        for obj in decididos:
            payload = payload_objeto_decision(obj, request)
            accion = obj.owner_action

            if accion in DECISIONES_VENTA:
                clave = (
                    'vender_publicados'
                    if payload['publicado']
                    else 'vender_sin_publicar'
                )
                grupos[clave].append(payload)
            elif accion == 'tirar':
                grupos['tirar'].append(payload)
                if payload['en_periodo_gracia']:
                    descartes.append(payload)
            elif accion == 'mudar':
                grupos['en_mudanza'].append(payload)
            else:
                grupos['conservar'].append(payload)

        # Los descartes en gracia se ordenan por vencimiento (el más urgente
        # primero): el contador del Alerta Rojo muestra siempre el caso crítico.
        descartes.sort(key=lambda p: p['fecha_limite_descarte'] or '')

        resumen = {clave: len(items) for clave, items in grupos.items()}
        resumen['descartes_en_gracia'] = len(descartes)
        resumen['total_usuarios_activos'] = descarte_service.total_usuarios_activos(estok_id)

        return Response({
            **grupos,
            'descartes_en_gracia': descartes,
            'resumen': resumen,
            'permisos': {
                'puede_administrar_fisico': descarte_service.es_administrador_fisico(
                    request.user, estok_id
                ),
            },
            'tiempos_gracia': descarte_service.tiempos_gracia(),
        })

