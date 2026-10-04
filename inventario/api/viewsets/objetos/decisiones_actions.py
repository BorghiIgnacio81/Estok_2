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

from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import F

from ....models import DecisionVotacion, Objeto
from ....services import descarte_service
from ....services.taxonomia_contenedor import (
    TIPO_CAJA,
    TIPO_CONJUNTO,
    TIPO_MUEBLE_INMUEBLE,
    TIPO_MUEBLE_MOVIL,
)


def nombre_mostrable(usuario):
    """Nombre legible de un usuario (o None si no hay usuario)."""
    if not usuario:
        return None
    return usuario.get_full_name() or usuario.username


def _url_publicacion(objeto):
    """
    Enlace externo a la publicación del objeto, si se puede reconstruir.

    Solo el módulo de Mercado Libre devuelve `permalink` y el objeto no lo
    persiste; se arma con el id de ítem cuando el despliegue tiene el campo
    legacy `meli_id`. Sin él, el frontend enlaza a la ficha interna.
    """
    meli_id = getattr(objeto, 'meli_id', None) or getattr(objeto, 'meli_item_id', None)
    if not meli_id:
        return None
    return f"https://articulo.mercadolibre.com.ar/{str(meli_id).strip()}"


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

    return {
        "id": str(obj.id),
        "nombre": obj.nombre,
        "foto_principal": foto.imagen.url if foto and foto.imagen else None,
        "estado_conservacion": obj.estado_conservacion,
        "valor_estimado": str(obj.valor_estimado) if obj.valor_estimado else None,
        "categoria_nombre": obj.categoria.nombre if obj.categoria else None,
        # --- Publicación (Bloque 3) ---
        "plataformas_publicadas": list(obj.plataformas_publicadas or []),
        # Enlace externo a la publicación cuando el objeto tiene id de Mercado
        # Libre persistido (campo legacy `meli_id`, presente solo en algunos
        # despliegues); si no, la UI enlaza a la ficha interna del objeto.
        "url_publicacion": _url_publicacion(obj),
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


class DecisionesActionsMixin:
    """Endpoints de decisión (dueño original / Estok) sobre el inventario."""

    # ------------------------------------------------------------------
    # Helpers internos
    # ------------------------------------------------------------------
    @staticmethod
    def _estok_id(request):
        """Tenant activo del request (header X-Estok-Id con fallback a query)."""
        return (
            request.headers.get('X-Estok-Id')
            or request.query_params.get('estok_id')
        )

    def _objetos_del_estok(self):
        """
        Queryset base del tablero (sin bajas lógicas, optimizado sin N+1).

        FILTRO TAXONÓMICO ESTRICTO — SOLO OBJETOS FINALES DEL INVENTARIO:
        los muebles y espacios (CONJUNTO / MUEBLE_INMUEBLE / MUEBLE_MOVIL) y las
        cajas (CAJA) NO son ítems de inventario y jamás deben figurar acá. El
        backend los persiste como `Contenedor` y, por la REGLA DE DUALIDAD,
        inserta además un registro ESPEJO en `Objeto` con el MISMO nombre del
        contenedor y SIN coordenadas de casillero. Esos espejos son los que
        aparecían como «Mueble 1» / «Mueble 2» en el panel de decisiones. Se
        excluyen de raíz en el ORM con la MISMA regla del servicio de árbol
        (services/arbol_inventario_service.py → `_es_registro_espejo`).
        """
        qs = (
            Objeto.objects.select_related(
                'ubicacion', 'contenedor', 'dueno_original', 'beneficiario',
                'categoria', 'despachado_por',
            )
            .prefetch_related('fotos')
            .filter(deleted_at__isnull=True)
        )

        # Excluye los registros espejo de muebles/cajas RAÍZ mudables: el
        # contenedor asociado es de tipo CONJUNTO / MUEBLE_INMUEBLE /
        # MUEBLE_MOVIL / CAJA, el nombre coincide con el del contenedor y no
        # tiene coordenadas de casillero. Los objetos sueltos (sin contenedor)
        # y los objetos reales dentro de una caja (nombre propio o casillero
        # asignado) NO se ven afectados.
        qs = qs.exclude(
            contenedor__tipo__in=(
                TIPO_CONJUNTO, TIPO_MUEBLE_INMUEBLE, TIPO_MUEBLE_MOVIL, TIPO_CAJA,
            ),
            contenedor__parent_contenedor__isnull=True,
            contenedor__es_inmueble=False,
            parent_grid_row__isnull=True,
            parent_grid_col__isnull=True,
            nombre=F('contenedor__nombre'),
        )

        estok_id = self._estok_id(self.request)
        if estok_id:
            qs = qs.filter(estok_id=estok_id)
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
            self._objetos_del_estok()
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

            if accion == 'vender':
                clave = (
                    'vender_publicados'
                    if payload['plataformas_publicadas']
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

