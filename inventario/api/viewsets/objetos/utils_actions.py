"""
Mixins de utilidades varias para ObjetoViewSet.
Contiene: exportar_csv, estadisticas, owner_action, clear_owner_action,
subir_foto, buscar_precio_referencia (con caché + scraping + Gemini fallback).
"""

import logging
import csv
import os

from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status
from django.http import HttpResponse
from django.db.models import Sum
from django.core.cache import cache

from ....models import Objeto, Ubicacion, Contenedor, FotoObjeto
from ...serializers import FotoObjetoUploadSerializer
from ....services.precio_referencia_service import buscar_precio_referencia


logger = logging.getLogger(__name__)


class UtilsActionsMixin:
    """
    Mixin que agrega endpoints de utilidades al ViewSet.
    Depende de que la clase combinada herede de ObjetoViewSetBase.
    """

    # =========================================================================
    # ACCIÓN DEL DUEÑO ORIGINAL
    # =========================================================================
    @action(detail=True, methods=['post'])
    def owner_action(self, request, pk=None):
        """
        Permite al dueño original decidir qué hacer con el objeto.
        Body: {"action": "vender" | "conservar" | "tirar"}
        Solo el dueño original puede ejecutar esta acción.
        """
        objeto = self.get_object()
        action_val = request.data.get('action', '').strip().lower()

        valid_actions = [c[0] for c in Objeto.OWNER_ACTION_CHOICES]
        if action_val not in valid_actions:
            return Response(
                {
                    "error": (
                        f"Acción no válida. Opciones: {', '.join(valid_actions)}"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not objeto.dueno_original:
            return Response(
                {"error": "Este objeto no tiene un dueño original asignado"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if str(objeto.dueno_original_id) != str(request.user.id):
            return Response(
                {
                    "error": (
                        "Solo el dueño original puede decidir sobre este objeto"
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        objeto.owner_action = action_val
        objeto.save(update_fields=['owner_action'])

        action_labels = dict(Objeto.OWNER_ACTION_CHOICES)
        return Response({
            "mensaje": f"Acción '{action_labels[action_val]}' registrada correctamente",
            "owner_action": action_val,
        })

    @action(detail=True, methods=['delete'])
    def clear_owner_action(self, request, pk=None):
        """
        Limpia la decisión del dueño original (la vuelve a null/pendiente).
        Solo el dueño original puede ejecutar esta acción.
        """
        objeto = self.get_object()

        if not objeto.dueno_original:
            return Response(
                {"error": "Este objeto no tiene un dueño original asignado"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if str(objeto.dueno_original_id) != str(request.user.id):
            return Response(
                {
                    "error": (
                        "Solo el dueño original puede modificar esta decisión"
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        objeto.owner_action = None
        objeto.save(update_fields=['owner_action'])

        return Response({
            "mensaje": "Decisión eliminada. El objeto vuelve a estado pendiente.",
            "owner_action": None,
        })

    # =========================================================================
    # EXPORTACIÓN Y ESTADÍSTICAS
    # =========================================================================
    @action(detail=False, methods=['get'])
    def exportar_csv(self, request):
        """Exporta el inventario completo a CSV."""
        objetos = self.get_queryset().select_related(
            'ubicacion', 'contenedor', 'dueno_original', 'beneficiario',
        )

        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = (
            'attachment; filename="inventario_estok.csv"'
        )
        response.write('\ufeff')

        writer = csv.writer(response)
        writer.writerow([
            'ID', 'Nombre', 'Tipo', 'Descripción', 'Estado Conservación',
            'Valor Estimado (USD)', 'Color', 'Ubicación', 'Contenedor',
            'Dueño Original', 'Beneficiario', 'Estado Carga',
            'Fecha Registro', 'Fecha Actualización',
        ])

        for obj in objetos:
            tipo = self._get_tipo(obj)
            writer.writerow([
                str(obj.id), obj.nombre, tipo, obj.descripcion,
                obj.estado_conservacion,
                float(obj.valor_estimado) if obj.valor_estimado else '',
                obj.color,
                obj.ubicacion.nombre if obj.ubicacion else '',
                obj.contenedor.nombre if obj.contenedor else '',
                str(obj.dueno_original) if obj.dueno_original else '',
                str(obj.beneficiario) if obj.beneficiario else '',
                obj.estado_carga,
                obj.fecha_registro.isoformat() if obj.fecha_registro else '',
                obj.updated_at.isoformat() if obj.updated_at else '',
            ])

        return response

    @action(detail=False, methods=['get'])
    def estadisticas(self, request):
        """Retorna estadísticas del inventario para el dashboard."""
        objetos = self.get_queryset()

        total_objetos = objetos.count()
        valor_total = (
            objetos.aggregate(total=Sum('valor_estimado'))['total'] or 0
        )
        valor_promedio = valor_total / total_objetos if total_objetos > 0 else 0

        tipos = {
            'libro': objetos.filter(librorevista__isnull=False).count(),
            'tecnologia': objetos.filter(tecnologia__isnull=False).count(),
            'mueble': objetos.filter(mueblearte__isnull=False).count(),
            'ropa': objetos.filter(ropa__isnull=False).count(),
            'objeto': objetos.filter(
                librorevista__isnull=True, tecnologia__isnull=True,
                mueblearte__isnull=True, ropa__isnull=True,
            ).count(),
        }

        valor_por_tipo = {
            'libro': float(
                objetos.filter(librorevista__isnull=False)
                .aggregate(total=Sum('valor_estimado'))['total'] or 0
            ),
            'tecnologia': float(
                objetos.filter(tecnologia__isnull=False)
                .aggregate(total=Sum('valor_estimado'))['total'] or 0
            ),
            'mueble': float(
                objetos.filter(mueblearte__isnull=False)
                .aggregate(total=Sum('valor_estimado'))['total'] or 0
            ),
            'ropa': float(
                objetos.filter(ropa__isnull=False)
                .aggregate(total=Sum('valor_estimado'))['total'] or 0
            ),
            'objeto': float(
                objetos.filter(
                    librorevista__isnull=True, tecnologia__isnull=True,
                    mueblearte__isnull=True, ropa__isnull=True,
                ).aggregate(total=Sum('valor_estimado'))['total'] or 0
            ),
        }

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
            "objetos_por_tipo": tipos,
            "valor_por_tipo": valor_por_tipo,
            "objetos_por_estado": estados,
            "objetos_por_carga": carga,
            "ultimos_objetos": ultimos_data,
            "total_ubicaciones": total_ubicaciones,
            "total_contenedores": total_contenedores,
        })

    # =========================================================================
    # FOTOS
    # =========================================================================
    @action(detail=True, methods=['post'])
    def subir_foto(self, request, pk=None):
        """Sube una foto para el objeto usando multipart/form-data."""
        objeto = self.get_object()
        serializer = FotoObjetoUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )

        imagen_file = serializer.validated_data['imagen']
        descripcion = serializer.validated_data.get('descripcion', '')
        es_principal = serializer.validated_data.get('es_principal', False)

        if imagen_file.size == 0:
            return Response(
                {"error": "El archivo de imagen está vacío"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validar tipo de imagen (compatible Python 3.13+)
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        content_type = getattr(imagen_file, 'content_type', None)
        if content_type and content_type not in allowed_types:
            return Response(
                {
                    "error": (
                        f"Tipo de imagen no soportado: {content_type}. "
                        "Permitidos: jpeg, png, gif, webp"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        foto = FotoObjeto.objects.create(
            objeto=objeto, imagen=imagen_file,
            descripcion=descripcion, es_principal=es_principal,
        )

        try:
            if foto.imagen and foto.imagen.path:
                if not os.path.exists(foto.imagen.path):
                    logger.error(
                        "INTEGRIDAD FALLIDA: La foto se guardó en BD "
                        "pero no en disco: %s",
                        foto.imagen.path,
                    )
        except Exception as e:
            logger.warning("No se pudo verificar integridad del archivo: %s", e)

        return Response(
            FotoObjetoUploadSerializer(foto).data,
            status=status.HTTP_201_CREATED,
        )

    # =========================================================================
    # BÚSQUEDA DE PRECIO DE REFERENCIA (caché + scraping + Gemini fallback)
    # =========================================================================
    @action(detail=False, methods=['get'])
    def buscar_precio_referencia(self, request):
        """
        Busca precio de referencia para un objeto.
        Primero consulta caché en memoria (TTL 2h).
        Si no hay caché, intenta scraping de listado.mercadolibre.com.ar.
        Si falla, usa Gemini como fallback.

        GET /api/objetos/buscar_precio_referencia/?q=iphone+14&estado=bueno
        """
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response(
                {"error": "Debes proporcionar 'q' con el nombre del producto"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        estado = request.query_params.get('estado', 'bueno').strip()
        if estado not in ('excelente', 'bueno', 'regular', 'malo', 'muy_malo'):
            estado = 'bueno'

        # Clave de caché: incluye estado para que el ajuste no se pierda
        cache_key = f"precio_ref_{q.lower().strip()}_{estado}"
        resultado_cache = cache.get(cache_key)
        if resultado_cache is not None:
            logger.info("Cache hit para '%s' (%s)", q, estado)
            return Response(resultado_cache)

        try:
            resultado = buscar_precio_referencia(q, estado=estado)

            # Si se encontró precio, guardar en caché 2 horas
            if resultado.get("encontrado"):
                cache.set(cache_key, resultado, timeout=7200)
                logger.info(
                    "Cache set para '%s' (%s) por 2h", q, estado
                )
            else:
                # Si no se encontró, cache negativo más corto (5 min)
                # para evitar re-scrapear ante errores transitorios
                cache.set(cache_key, resultado, timeout=300)
                logger.info(
                    "Cache negativo para '%s' (%s) por 5min", q, estado
                )

            return Response(resultado)

        except Exception as e:
            logger.error("Error al buscar precio de referencia: %s", e)
            return Response({
                "encontrado": False,
                "fuente": None,
                "fuente_error": "error_interno",
                "titulo": None,
                "precio_original": None,
                "precio_ajustado": None,
                "link": None,
                "estado_aplicado": estado,
                "porcentaje_aplicado": None,
                "error": str(e),
            }, status=status.HTTP_200_OK)
