"""
Mixin de utilidades varias para ObjetoViewSet.
Contiene: estadisticas, owner_action, clear_owner_action,
subir_foto, buscar_precio_referencia (con caché + MLA validado + Gemini fallback).

Las exportaciones (CSV + informe PDF) viven en export_actions.py.
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


from .utils_actions_estadisticas import UtilsEstadisticasMixin

class UtilsActionsMixin(UtilsEstadisticasMixin):
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

        # GUARDIA DE DECISIÓN DIRECTA (vender / conservar / tirar):
        #   - objeto de OTRO usuario del sistema → HTTP 403.
        #   - dueño externo/fallecido            → HTTP 202 (muta a VOTACIÓN FOMO).
        # Cierra el bypass de cualquier editor/superusuario sobre objetos ajenos.
        denegada = respuesta_decision_denegada(objeto, request)
        if denegada is not None:
            return denegada

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

        # Misma guardia de decisión directa que `owner_action`: dueño ajeno →
        # 403; dueño externo/fallecido → votación del Estok (Alerta FOMO).
        denegada = respuesta_decision_denegada(objeto, request)
        if denegada is not None:
            return denegada

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
        Busca precio de referencia para un objeto (SIEMPRE en pesos argentinos).
        Primero consulta MercadoLibre ARGENTINA (site MLA) con validación de
        coincidencia de título y moneda ARS; si no hay match confiable, estima
        con Gemini. Los resultados se cachean (2h si hay precio, 5min si no).

        GET /api/objetos/buscar_precio_referencia/?q=iphone+14&estado=bueno
            &categoria=MLA1430&isbn=9789500712345&autor=cortazar

        `categoria` es OPCIONAL y acepta el ID oficial de Mercado Libre
        («MLA1430»), el nombre («Ropa» / «👕 Ropa») o el subtipo («ropa»): el
        servicio la traduce y, si la búsqueda filtrada no devuelve ítems,
        reintenta sin filtro (fallback automático). Sin resultados se responde
        200 con los precios en `null` y un `mensaje` claro: nunca se devuelve un
        error de conexión inventado.

        `isbn` + `autor` son OPCIONALES (libros): habilitan la búsqueda FLEXIBLE
        del servicio — estricta por ISBN (edición exacta) + complementaria por
        «Título + Autor» (mercado local) cuando la edición es rara o la muestra
        es escasa. El ISBN también se detecta dentro de `q` cuando no se envía.
        """
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response(
                {"error": "Debes proporcionar 'q' con el nombre del producto"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        estado = request.query_params.get('estado', 'bueno').strip()
        if estado not in (
            'nuevo', 'como_nuevo', 'excelente', 'bueno', 'regular', 'malo', 'muy_malo',
        ):
            estado = 'bueno'

        # Categoría del objeto (opcional): restringe la búsqueda en MLA y habilita
        # el fallback sin filtro. Se acepta `categoria` y su alias histórico.
        categoria = (
            request.query_params.get('categoria')
            or request.query_params.get('categoria_id')
            or ''
        ).strip()

        # Atributos técnicos del LIBRO (opcionales): ISBN de la edición y autor.
        isbn = request.query_params.get('isbn', '').strip()
        autor = request.query_params.get('autor', '').strip()

        # Clave de caché: incluye estado, categoría, ISBN y autor para que el
        # ajuste y el conjunto de resultados no se mezclen entre búsquedas
        # distintas (dos ediciones del mismo título dan precios distintos).
        cache_key = (
            f"precio_ref_{q.lower().strip()}_{estado}_"
            f"{categoria.lower().strip()}_{isbn.lower().strip()}_{autor.lower().strip()}"
        )
        resultado_cache = cache.get(cache_key)
        if resultado_cache is not None:
            logger.info("Cache hit para '%s' (%s, %s)", q, estado, categoria or 'sin categoría')
            return Response(resultado_cache)

        # Token OAuth de ML del usuario (si lo tiene): habilita la API oficial
        # pineada a MLA en vez del scraping. Sin token se sigue con scraping.
        try:
            access_token = get_valid_access_token(request.user)
        except Exception as e:  # noqa: BLE001 - nunca debe romper la búsqueda
            logger.warning("Sin token de ML para %s: %s", request.user, e)
            access_token = None

        try:
            resultado = buscar_precio_referencia(
                q,
                estado=estado,
                access_token=access_token,
                categoria=categoria or None,
                isbn=isbn or None,
                autor=autor or None,
            )

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
                "moneda": None,
                "link": None,
                "estado_aplicado": estado,
                "porcentaje_aplicado": None,
                "muestras": None,
                # Texto para el usuario: el frontend muestra `mensaje` tal cual
                # (lib/precioReferencia.ts) en vez de inventar un error de red.
                "mensaje": (
                    "No se pudo buscar el precio de referencia en Mercado Libre. "
                    "Intentá de nuevo en unos minutos."
                ),
                "error": str(e),
            }, status=status.HTTP_200_OK)
