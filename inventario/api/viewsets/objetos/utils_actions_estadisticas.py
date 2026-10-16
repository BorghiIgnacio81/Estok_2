"""
Endpoint `estadisticas` de ObjetoViewSet, separado de utils_actions.py para
mantener el limite de 400 lineas (Fase A refactor preventivo).
"""

import logging
import os

from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status
from django.db.models import Sum
from django.core.cache import cache

from ....models import Objeto, Ubicacion, Contenedor, FotoObjeto
from ...serializers import FotoObjetoUploadSerializer
from ....services.mercadolibre_oauth import get_valid_access_token
from ....services.precio_referencia_service import buscar_precio_referencia
from .decisiones_actions import respuesta_decision_denegada


logger = logging.getLogger(__name__)


class UtilsEstadisticasMixin:
    """Endpoint `estadisticas`: KPIs agregados del dashboard."""

    @action(detail=False, methods=['get'])
    def estadisticas(self, request):
        """Retorna estadísticas del inventario para el dashboard."""
        objetos = self.get_queryset()

        total_objetos = objetos.count()
        valor_total = (
            objetos.aggregate(total=Sum('valor_estimado'))['total'] or 0
        )
        valor_promedio = valor_total / total_objetos if total_objetos > 0 else 0

        # Taxonomía unificada: la clasificación es EXCLUSIVAMENTE por la FK
        # `categoria` (las 11 categorías oficiales de Mercado Libre).
        # El dashboard consume estas claves de forma dinámica (ya NO hay
        # "tipo" legado: ni LibroRevista, Tecnologia, MuebleArte ni Ropa).
        categorias_nombre = [
            'Muebles', 'Arte', 'Coleccionables', 'Antigüedades', 'Jardín',
            'Computación', 'Electrónica', 'Cocina', 'Hogar',
            'Herramientas', 'Materiales',
        ]
        objetos_por_categoria = {c: 0 for c in categorias_nombre}
        valor_por_categoria = {c: 0.0 for c in categorias_nombre}

        # Decisiones por usuario (dueño original) para el gráfico de barras
        # horizontales apiladas del dashboard: Vender (Publicado / No
        # publicado), Conservar, Tirar y Sin decisión.
        decisiones_por_usuario: dict = {}

        for obj in objetos.select_related('categoria', 'dueno_original'):
            cat = obj.categoria.nombre if obj.categoria else 'Sin categoría'
            objetos_por_categoria[cat] = (
                objetos_por_categoria.get(cat, 0) + 1
            )
            if obj.valor_estimado:
                valor_por_categoria[cat] = (
                    valor_por_categoria.get(cat, 0.0)
                    + float(obj.valor_estimado)
                )

            # Solo los objetos con dueño original asignado participan del
            # gráfico de decisiones por usuario.
            dueno = obj.dueno_original
            if dueno:
                uid = str(dueno.id)
                entry = decisiones_por_usuario.setdefault(uid, {
                    "usuario_id": uid,
                    "usuario_nombre": (
                        dueno.get_full_name().strip() or dueno.username
                    ),
                    "vender_publicado": 0,
                    "vender_no_publicado": 0,
                    "conservar": 0,
                    "tirar": 0,
                    "sin_decision": 0,
                })
                if obj.owner_action == 'vender':
                    # Casillero "Vender · Publicado" (verde claro del Dashboard):
                    # cuenta CUALQUIER objeto con decisión 'vender' que tenga un
                    # meli_id válido (no nulo ni vacío) o que esté marcado como
                    # publicado en Mercado Libre. Regla flexible para que el
                    # gráfico de barras se pinte de forma correcta.
                    if self._objeto_publicado_en_ml(obj):
                        entry["vender_publicado"] += 1
                    else:
                        entry["vender_no_publicado"] += 1
                elif obj.owner_action == 'conservar':
                    entry["conservar"] += 1
                elif obj.owner_action == 'tirar':
                    entry["tirar"] += 1
                else:
                    entry["sin_decision"] += 1

        # Orden descendente por total de objetos para que los usuarios más
        # activos queden arriba en el gráfico.
        decisiones_por_usuario = sorted(
            decisiones_por_usuario.values(),
            key=lambda e: (
                e["vender_publicado"] + e["vender_no_publicado"]
                + e["conservar"] + e["tirar"] + e["sin_decision"]
            ),
            reverse=True,
        )


        estados = {}
        for choice in Objeto._meta.get_field('estado_conservacion').choices:
            key = choice[0]
            count = objetos.filter(estado_conservacion=key).count()
            if count > 0:
                estados[key] = count

        carga = {}
        for choice in Objeto.ESTADO_CARGA_CHOICES:
            key = choice[0]
            count = objetos.filter(estado_carga=key).count()
            if count > 0:
                carga[key] = count

        ultimos = objetos.order_by('-fecha_registro')[:5]
        ultimos_data = [
            {
                "id": str(o.id),
                "nombre": o.nombre,
                "tipo": self._get_tipo(o),
                "valor_estimado": (
                    float(o.valor_estimado) if o.valor_estimado else None
                ),
                "fecha_registro": o.fecha_registro.isoformat(),
            }
            for o in ultimos
        ]

        estok_id = (
            self.request.headers.get('X-Estok-Id')
            or self.request.query_params.get('estok_id')
        )
        if estok_id:
            total_ubicaciones = Ubicacion.objects.filter(
                estok_id=estok_id
            ).count()
            total_contenedores = Contenedor.objects.filter(
                ubicacion__estok_id=estok_id
            ).count()
        else:
            total_ubicaciones = Ubicacion.objects.count()
            total_contenedores = Contenedor.objects.count()

        return Response({
            "total_objetos": total_objetos,
            "valor_total_inventario": float(valor_total),
            "valor_promedio": float(valor_promedio),
            "objetos_por_categoria": objetos_por_categoria,
            "valor_por_categoria": valor_por_categoria,
            "objetos_por_estado": estados,
            "objetos_por_carga": carga,
            "decisiones_por_usuario": decisiones_por_usuario,
            "ultimos_objetos": ultimos_data,
            "total_ubicaciones": total_ubicaciones,
            "total_contenedores": total_contenedores,
        })


