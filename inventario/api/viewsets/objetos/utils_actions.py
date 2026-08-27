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
    def owner_actions(self, request):
        """
        Lista objetos agrupados por la decisión del dueño (owner_action).
        GET /api/objetos/owner_actions/?action=vender (opcional, filtra por tipo)
        GET /api/objetos/owner_actions/ → devuelve todos agrupados
        """
        estok_id = (
            request.headers.get('X-Estok-Id')
            or request.query_params.get('estok_id')
        )

        qs = Objeto.objects.select_related(
            'ubicacion', 'contenedor', 'dueno_original', 'beneficiario',
            'categoria',
        ).filter(deleted_at__isnull=True)

        if estok_id:
            qs = qs.filter(estok_id=estok_id)

        # Filtro opcional por acción específica
        action_filter = request.query_params.get('action', '').strip().lower()
        if action_filter in ['vender', 'conservar', 'tirar']:
            qs = qs.filter(owner_action=action_filter)
        else:
            # Solo objetos que tienen una decisión tomada
            qs = qs.filter(owner_action__isnull=False)

        action_labels = dict(Objeto.OWNER_ACTION_CHOICES)

        objetos = []
        for obj in qs:
            tipo = self._get_tipo(obj)
            objetos.append({
                "id": str(obj.id),
                "nombre": obj.nombre,
                "tipo": tipo,
                "valor_estimado": str(obj.valor_estimado) if obj.valor_estimado else None,
                "estado_conservacion": obj.estado_conservacion,
                "owner_action": obj.owner_action,
                "owner_action_label": action_labels.get(obj.owner_action, obj.owner_action) if obj.owner_action else None,
                # Necesario en el frontend de Alertas/Decisiones para decidir si
                # el objeto YA fue publicado en Mercado Libre (regla del botón
                # "Publicar": solo owner_action == 'vender' y sin publicar en ML).
                "plataformas_publicadas": list(obj.plataformas_publicadas or []),
                "dueno_original": str(obj.dueno_original) if obj.dueno_original else None,
                "dueno_original_nombre": obj.dueno_original.get_full_name() if obj.dueno_original else None,
                "beneficiario": str(obj.beneficiario) if obj.beneficiario else None,
                "beneficiario_nombre": obj.beneficiario.get_full_name() if obj.beneficiario else None,
                "ubicacion": obj.ubicacion.nombre if obj.ubicacion else None,
                "contenedor": obj.contenedor.nombre if obj.contenedor else None,
                "categoria": obj.categoria.nombre if obj.categoria else None,
                "fecha_registro": obj.fecha_registro.isoformat() if obj.fecha_registro else None,
            })

        # Agrupar por acción
        grupos = {"vender": [], "conservar": [], "tirar": []}
        for obj in objetos:
            action = obj["owner_action"]
            if action in grupos:
                grupos[action].append(obj)

        # Calcular totales por grupo
        resumen = {}
        for action, items in grupos.items():
            valores = [float(i["valor_estimado"]) for i in items if i["valor_estimado"]]
            resumen[action] = {
                "label": action_labels.get(action, action),
                "count": len(items),
                "valor_total": sum(valores),
            }

        return Response({
            "resumen": resumen,
            "grupos": grupos,
            "objetos": objetos,  # lista plana también
        })

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

    # ------------------------------------------------------------------
    # Helpers del gráfico de decisiones (barras apiladas del dashboard)
    # ------------------------------------------------------------------
    @staticmethod
    def _objeto_publicado_en_ml(obj) -> bool:
        """
        Indica si un objeto fue publicado en Mercado Libre.

        Regla robusta y FLEXIBLE: NO depende de estados estrictos de la API
        externa (tipo `meli_status='active'`) que pueden estar vacíos en la
        base de datos local de producción. Se aceptan DOS señales equivalentes:

          1. `meli_id` válido (no nulo, no cadena vacía ni solo espacios)
             → el item ya existe en ML. Señal canónica del Dashboard.
          2. `'mercadolibre'` en `plataformas_publicadas` → señal histórica
             del repo (publicaciones registradas antes de existir meli_id).

        Se consultan ambas para tolerar datos cargados por flujos distintos
        en producción donde solo una de las dos esté poblada.
        """
        # Señal canónica: ID del item publicado en Mercado Libre.
        # getattr tolera esquemas donde el campo aún no existe (repo local)
        # y usa el campo real donde ya fue agregado (producción).
        meli_id = getattr(obj, 'meli_id', None)
        if isinstance(meli_id, str):
            meli_id = meli_id.strip()
        if meli_id:
            return True

        # Señal histórica: la plataforma 'mercadolibre' puede venir como
        # lista JSON (esquema actual) o como string separado por comas.
        plataformas = obj.plataformas_publicadas or []
        if isinstance(plataformas, str):
            plataformas = [p.strip() for p in plataformas.split(',')]
        return any(
            str(p).strip().lower() == 'mercadolibre'
            for p in plataformas
        )

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
