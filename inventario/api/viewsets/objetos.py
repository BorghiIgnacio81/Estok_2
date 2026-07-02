"""
ViewSet principal de Objetos con todas sus acciones especializadas.
"""

import logging
import csv
import base64
import time
import json
import os
from decimal import Decimal
from pathlib import Path

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.http import HttpResponse
from django.db.models import Q, Sum, Count

from ...models import (
    Objeto, Ubicacion, Contenedor, FotoObjeto,
    LibroRevista, Tecnologia, MuebleArte, Ropa,
)
from ..serializers import (
    ObjetoListSerializer, ObjetoDetailSerializer, ObjetoCreateSerializer,
    FotoObjetoUploadSerializer,
)
from ...services.ai_vision_service import AIVisionService, LMStudioClient, LM_STUDIO_TIMEOUT_ALTA_RES
from ...services.marketing_service import MarketingService
from ...services.stock_service import StockValuationService
from .base import HasRolePermission



logger = logging.getLogger(__name__)


class ObjetoViewSet(viewsets.ModelViewSet):
    """
    ViewSet principal para objetos del inventario.
    Soporta filtrado por tipo, ubicación, estado, etc.
    """
    queryset = Objeto.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_serializer_class(self):
        if self.action == 'list':
            return ObjetoListSerializer
        elif self.action in ('update', 'partial_update'):
            return ObjetoCreateSerializer
        return ObjetoDetailSerializer

    def create(self, request, *args, **kwargs):
        """
        Crea un objeto usando ObjetoCreateSerializer para validar/crear,
        pero retorna la respuesta usando ObjetoDetailSerializer para
        que incluya correctamente el tipo y datos específicos.
        """
        create_serializer = ObjetoCreateSerializer(data=request.data, context={'request': request})
        create_serializer.is_valid(raise_exception=True)
        objeto = create_serializer.save()

        objeto.refresh_from_db()

        detail_serializer = ObjetoDetailSerializer(objeto, context={'request': request})
        headers = self.get_success_headers(detail_serializer.data)
        return Response(detail_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def get_queryset(self):
        qs = Objeto.objects.all()

        # Filtrar por estok
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            qs = qs.filter(estok_id=estok_id)

        tipo = self.request.query_params.get('tipo')
        if tipo:
            if tipo == 'libro':
                qs = qs.filter(librorevista__isnull=False)
            elif tipo == 'tecnologia':
                qs = qs.filter(tecnologia__isnull=False)
            elif tipo == 'mueble':
                qs = qs.filter(mueblearte__isnull=False)
            elif tipo == 'ropa':
                qs = qs.filter(ropa__isnull=False)

        ubicacion = self.request.query_params.get('ubicacion')
        if ubicacion:
            qs = qs.filter(ubicacion_id=ubicacion)

        contenedor = self.request.query_params.get('contenedor')
        if contenedor:
            qs = qs.filter(contenedor_id=contenedor)

        estado = self.request.query_params.get('estado')
        if estado:
            qs = qs.filter(estado_conservacion=estado)

        estado_carga = self.request.query_params.get('estado_carga')
        if estado_carga:
            qs = qs.filter(estado_carga=estado_carga)

        dueno = self.request.query_params.get('dueno_original')
        if dueno:
            qs = qs.filter(dueno_original_id=dueno)

        beneficiario = self.request.query_params.get('beneficiario')
        if beneficiario:
            qs = qs.filter(beneficiario_id=beneficiario)

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                Q(nombre__icontains=search) |
                Q(descripcion__icontains=search)
            )

        incluir_eliminados = self.request.query_params.get('incluir_eliminados')
        if not incluir_eliminados:
            qs = qs.filter(deleted_at__isnull=True)

        return qs.select_related('ubicacion', 'contenedor').prefetch_related('fotos')

    # =========================================================================
    # ACCIONES DE IA
    # =========================================================================
    @action(detail=True, methods=['post'])
    def analizar_con_ia(self, request, pk=None):

        """Analiza un objeto usando IA local (LM Studio)."""
        objeto = self.get_object()
        foto_principal = objeto.fotos.filter(es_principal=True).first()
        if not foto_principal:
            foto_principal = objeto.fotos.first()

        if not foto_principal:
            return Response(
                {"error": "El objeto no tiene fotos para analizar"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            service = AIVisionService()
            image_path = Path(foto_principal.imagen.path)
            if not image_path.exists():
                return Response(
                    {"error": "El archivo de imagen no existe en el servidor"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            image_bytes = image_path.read_bytes()
            image_b64 = base64.b64encode(image_bytes).decode('utf-8')
            image_b64_comprimida = service._comprimir_imagen_base64(image_b64)
            resultado = service.procesar_imagen_desde_base64(image_b64_comprimida)

            if resultado.nombre:
                objeto.nombre = resultado.nombre
            if resultado.descripcion:
                objeto.descripcion = resultado.descripcion
            if resultado.estado_conservacion:
                objeto.estado_conservacion = resultado.estado_conservacion
            if resultado.color:
                objeto.color = resultado.color
            if resultado.precio_estimado_mercado:
                objeto.valor_estimado = Decimal(str(resultado.precio_estimado_mercado))

            objeto.campos_pendientes = resultado.campos_pendientes
            if resultado.campos_pendientes:
                objeto.estado_carga = 'incompleto'
            else:
                objeto.estado_carga = 'completo'

            objeto.save()

            return Response({
                "mensaje": "Análisis completado",
                "datos": resultado.to_dict(),
                "campos_pendientes": resultado.campos_pendientes,
            })

        except Exception as e:
            logger.error("Error al analizar con IA: %s", e)
            return Response(
                {"error": f"Error al analizar con IA: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'])
    def analizar_imagen(self, request):
        """
        Analiza una imagen recibida en Base64 usando IA.
        Soporta motores: 'local' (LM Studio) y 'gemini' (Google Gemini 2.5 Flash-Lite).
        Por defecto SOLO analiza y devuelve los datos (no crea el objeto).
        Si se envía `crear_objeto: true`, también crea el objeto en BD.
        """
        imagen_base64 = request.data.get('imagen_base64')
        if not imagen_base64:
            return Response(
                {"error": "Debes proporcionar 'imagen_base64'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        if ',' in imagen_base64:
            imagen_base64 = imagen_base64.split(',', 1)[1]

        motor = request.data.get('motor', 'local')
        if motor not in ('local', 'gemini'):
            return Response(
                {"error": "El motor debe ser 'local' o 'gemini'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        solo_analisis = request.data.get('solo_analisis', True)
        if isinstance(solo_analisis, str):
            solo_analisis = solo_analisis.lower() == 'true'

        es_segunda_foto = request.data.get('es_segunda_foto', False)
        if isinstance(es_segunda_foto, str):
            es_segunda_foto = es_segunda_foto.lower() == 'true'

        ubicacion_id = request.data.get('ubicacion_id')
        contenedor_id = request.data.get('contenedor_id')

        ubicacion = None
        contenedor = None

        if ubicacion_id:
            try:
                ubicacion = Ubicacion.objects.get(id=ubicacion_id)
            except Ubicacion.DoesNotExist:
                return Response(
                    {"error": "Ubicación no encontrada"},
                    status=status.HTTP_400_BAD_REQUEST
                )

        if contenedor_id:
            try:
                contenedor = Contenedor.objects.get(id=contenedor_id)
            except Contenedor.DoesNotExist:
                return Response(
                    {"error": "Contenedor no encontrado"},
                    status=status.HTTP_400_BAD_REQUEST
                )

        try:
            service = AIVisionService()
            resultado = service.procesar_imagen_desde_base64_con_motor(imagen_base64, motor=motor)

            response_data = {
                "mensaje": "Imagen analizada correctamente",
                "datos_ia": resultado.to_dict(),
                "campos_pendientes": resultado.campos_pendientes,
            }

            if resultado.categoria == 'libro' and not es_segunda_foto:
                necesita_segunda_foto = False
                motivo_segunda_foto = None

                if not resultado.isbn_issn:
                    necesita_segunda_foto = True
                    motivo_segunda_foto = "No se detectó código ISBN en la portada. " \
                        "Toma una foto de la PARTE TRASERA del libro para capturar el código de barras/ISBN."

                if resultado.confianza_general < 0.5:
                    necesita_segunda_foto = True
                    motivo_segunda_foto = (motivo_segunda_foto or "") + \
                        " La confianza en la identificación es baja. " \
                        "Toma una foto más clara de la portada o la parte trasera."

                response_data["necesita_segunda_foto"] = necesita_segunda_foto
                response_data["motivo_segunda_foto"] = motivo_segunda_foto

            if es_segunda_foto and resultado.isbn_issn:
                logger.info("✅ Segunda foto: ISBN detectado: %s", resultado.isbn_issn)
                response_data["isbn_detectado"] = resultado.isbn_issn

            if not solo_analisis:
                objeto_creado = service.crear_objeto_desde_vision(
                    vision_result=resultado,
                    user=request.user if request.user.is_authenticated else None,
                    ubicacion=ubicacion,
                    contenedor=contenedor,
                )

                if not objeto_creado:
                    return Response(
                        {"error": "Error al crear el objeto desde el análisis de IA"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR
                    )

                response_data["mensaje"] = "Objeto creado desde análisis de IA"
                response_data["objeto"] = objeto_creado

            return Response(response_data, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error("Error al analizar imagen Base64: %s", e)
            return Response(
                {"error": f"Error al analizar imagen: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # =========================================================================
    # ACCIONES DE MARKETING
    # =========================================================================
    @action(detail=True, methods=['post'])
    def generar_anuncios(self, request, pk=None):
        """Genera copys publicitarios para todas las plataformas."""
        objeto = self.get_object()

        objeto_data = {
            "nombre": objeto.nombre,
            "descripcion": objeto.descripcion,
            "valor_estimado": float(objeto.valor_estimado) if objeto.valor_estimado else None,
            "estado_conservacion": objeto.estado_conservacion,
            "color": objeto.color,
        }

        if hasattr(objeto, 'tecnologia'):
            objeto_data["categoria"] = "tecnologia"
            objeto_data["marca"] = objeto.tecnologia.marca
            objeto_data["modelo"] = objeto.tecnologia.modelo
        elif hasattr(objeto, 'librorevista'):
            objeto_data["categoria"] = "libro"
            objeto_data["autor"] = objeto.librorevista.autor
            objeto_data["anio"] = objeto.librorevista.anio
            objeto_data["nombre_serie"] = objeto.librorevista.nombre_serie
            objeto_data["titulo_tomo"] = objeto.librorevista.titulo_tomo
            objeto_data["numero_tomo"] = objeto.librorevista.numero_tomo
            objeto_data["editorial"] = objeto.librorevista.editorial
            objeto_data["idioma"] = objeto.librorevista.idioma
        elif hasattr(objeto, 'mueblearte'):
            objeto_data["categoria"] = "mueble"
        elif hasattr(objeto, 'ropa'):
            objeto_data["categoria"] = "ropa"
        else:
            objeto_data["categoria"] = "otro"

        try:
            service = MarketingService()
            paquete = service.generar_paquete_anuncios(objeto_data)

            return Response({
                "mensaje": "Anuncios generados correctamente",
                "anuncios": paquete.to_dict(),
            })

        except Exception as e:
            logger.error("Error al generar anuncios: %s", e)
            return Response(
                {"error": f"Error al generar anuncios: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def publicar_en(self, request, pk=None):
        """Marca un objeto como publicado en una plataforma."""
        objeto = self.get_object()
        plataforma = request.data.get('plataforma')

        if not plataforma:
            return Response(
                {"error": "Debes especificar 'plataforma'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        service = MarketingService()
        resultado = service.registrar_publicacion(objeto, plataforma)

        if resultado["success"]:
            return Response(resultado)
        return Response(resultado, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'])
    def estado_publicacion(self, request, pk=None):
        """Obtiene el estado de publicación del objeto."""
        objeto = self.get_object()
        service = MarketingService()
        return Response(service.obtener_estado_publicacion(objeto))

    # =========================================================================
    # ACCIONES DE STOCK Y VALORACIÓN
    # =========================================================================
    @action(detail=True, methods=['post'])
    def actualizar_precio(self, request, pk=None):
        """Actualiza el valor_estimado y registra en el historial."""
        objeto = self.get_object()
        valor_nuevo = request.data.get('valor_nuevo')
        motivo = request.data.get('motivo', '')

        if not valor_nuevo:
            return Response(
                {"error": "Debes especificar 'valor_nuevo'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            valor_nuevo = Decimal(str(valor_nuevo))
        except (ValueError, TypeError):
            return Response(
                {"error": "valor_nuevo debe ser un número válido"},
                status=status.HTTP_400_BAD_REQUEST
            )

        service = StockValuationService()
        resultado = service.registrar_cambio_precio(
            objeto, valor_nuevo, motivo=motivo, registrado_por=request.user
        )

        return Response(resultado.to_dict())

    @action(detail=True, methods=['get'])
    def historial_precios(self, request, pk=None):
        """Obtiene el historial de precios del objeto."""
        objeto = self.get_object()
        service = StockValuationService()
        return Response(service.obtener_historial_precios(objeto))

    @action(detail=True, methods=['get'])
    def plusvalia(self, request, pk=None):
        """Calcula la plusvalía/depreciación total del objeto."""
        objeto = self.get_object()
        service = StockValuationService()
        return Response(service.calcular_plusvalia_total(objeto))

    @action(detail=True, methods=['post'])
    def crear_alerta_stock(self, request, pk=None):
        """Crea una alerta de stock para el objeto."""

        objeto = self.get_object()
        nivel_minimo = request.data.get('nivel_minimo', 1)
        cantidad_actual = request.data.get('cantidad_actual', 1)

        service = StockValuationService()
        resultado = service.crear_alerta_stock(
            objeto,
            nivel_minimo=int(nivel_minimo),
            cantidad_actual=int(cantidad_actual),
            creada_por=request.user
        )

        return Response({
            "mensaje": "Alerta de stock creada/actualizada",
            "alerta": {
                "objeto": resultado.objeto_nombre,
                "cantidad_actual": resultado.cantidad_actual,
                "nivel_minimo": resultado.nivel_minimo,
                "necesita_reposicion": resultado.necesita_reposicion,
            }
        })

    # =========================================================================
    # ACCIONES DE EXPORTACIÓN Y ESTADÍSTICAS
    # =========================================================================
    @action(detail=False, methods=['get'])
    def exportar_csv(self, request):
        """Exporta el inventario completo a CSV."""
        objetos = self.get_queryset().select_related(
            'ubicacion', 'contenedor', 'dueno_original', 'beneficiario'
        )

        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="inventario_estok.csv"'
        response.write('\ufeff')

        writer = csv.writer(response)
        writer.writerow([
            'ID', 'Nombre', 'Tipo', 'Descripción', 'Estado Conservación',
            'Valor Estimado (USD)', 'Color', 'Ubicación', 'Contenedor',
            'Dueño Original', 'Beneficiario', 'Estado Carga',
            'Fecha Registro', 'Fecha Actualización'
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
    def test_ia_stress(self, request):
        """
        Endpoint de test de estrés para el servicio de IA.
        Soporta parámetro ?motor=local|gemini para verificar disponibilidad
        del motor seleccionado.
        """
        motor = request.query_params.get('motor', 'local')
        if motor not in ('local', 'gemini'):
            return Response(
                {"error": "El motor debe ser 'local' o 'gemini'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        start = time.time()

        if motor == 'gemini':
            return self._check_gemini_health(start)
        else:
            return self._check_lmstudio_health(start)

    def _check_lmstudio_health(self, start):
        """Verifica disponibilidad de LM Studio."""
        try:
            client = LMStudioClient()
            available = client._check_health()
            latency = int((time.time() - start) * 1000)

            if available:
                return Response({
                    "status": "ok",
                    "latency_ms": latency,
                    "model": "qwen2.5-vl-7b-instruct (LM Studio)",
                    "high_res_timeout": LM_STUDIO_TIMEOUT_ALTA_RES,
                    "message": f"IA conectada en {latency}ms. Timeout para alta resolución: {LM_STUDIO_TIMEOUT_ALTA_RES}s",
                })
            else:
                return Response({
                    "status": "error",
                    "latency_ms": latency,
                    "model": None,
                    "high_res_timeout": LM_STUDIO_TIMEOUT_ALTA_RES,
                    "message": f"LM Studio no responde en {latency}ms. Verifica que el servidor esté corriendo en http://localhost:1234",
                }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        except Exception as e:
            latency = int((time.time() - start) * 1000)
            return Response({
                "status": "error",
                "latency_ms": latency,
                "error": str(e),
                "message": f"Error de conexión en {latency}ms: {str(e)}",
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    def _check_gemini_health(self, start):
        """Verifica disponibilidad de Gemini (API key configurada)."""
        try:
            from ...services.ai_vision_service import GeminiClient
            gemini = GeminiClient()
            available = gemini._check_health()
            latency = int((time.time() - start) * 1000)

            if available:
                return Response({
                    "status": "ok",
                    "latency_ms": latency,
                    "model": "gemini-2.5-flash-lite (Google Gemini)",
                    "message": f"Gemini conectado en {latency}ms.",
                })
            else:
                return Response({
                    "status": "error",
                    "latency_ms": latency,
                    "model": None,
                    "message": "Gemini no está disponible. Verifica que GEMINI_API_KEY esté configurada en el servidor.",
                }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        except Exception as e:
            latency = int((time.time() - start) * 1000)
            return Response({
                "status": "error",
                "latency_ms": latency,
                "error": str(e),
                "message": f"Error de conexión con Gemini en {latency}ms: {str(e)}",
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    @action(detail=False, methods=['get'])
    def estadisticas(self, request):
        """Retorna estadísticas del inventario para el dashboard."""
        objetos = self.get_queryset()

        total_objetos = objetos.count()
        valor_total = objetos.aggregate(total=Sum('valor_estimado'))['total'] or 0
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
            'libro': float(objetos.filter(librorevista__isnull=False).aggregate(total=Sum('valor_estimado'))['total'] or 0),
            'tecnologia': float(objetos.filter(tecnologia__isnull=False).aggregate(total=Sum('valor_estimado'))['total'] or 0),
            'mueble': float(objetos.filter(mueblearte__isnull=False).aggregate(total=Sum('valor_estimado'))['total'] or 0),
            'ropa': float(objetos.filter(ropa__isnull=False).aggregate(total=Sum('valor_estimado'))['total'] or 0),
            'objeto': float(objetos.filter(
                librorevista__isnull=True, tecnologia__isnull=True,
                mueblearte__isnull=True, ropa__isnull=True,
            ).aggregate(total=Sum('valor_estimado'))['total'] or 0),
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
                "id": str(o.id), "nombre": o.nombre,
                "tipo": self._get_tipo(o),
                "valor_estimado": float(o.valor_estimado) if o.valor_estimado else None,
                "fecha_registro": o.fecha_registro.isoformat(),
            }
            for o in ultimos
        ]

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
    # ACCIONES DE FOTOS
    # =========================================================================
    @action(detail=True, methods=['post'])
    def subir_foto(self, request, pk=None):
        """Sube una foto para el objeto usando multipart/form-data."""
        objeto = self.get_object()
        serializer = FotoObjetoUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        imagen_file = serializer.validated_data['imagen']
        descripcion = serializer.validated_data.get('descripcion', '')
        es_principal = serializer.validated_data.get('es_principal', False)

        if imagen_file.size == 0:
            return Response(
                {"error": "El archivo de imagen está vacío"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validar tipo de imagen (compatible Python 3.13+)
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        content_type = getattr(imagen_file, 'content_type', None)
        if content_type and content_type not in allowed_types:
            return Response(
                {"error": f"Tipo de imagen no soportado: {content_type}. Permitidos: jpeg, png, gif, webp"},
                status=status.HTTP_400_BAD_REQUEST
            )

        foto = FotoObjeto.objects.create(
            objeto=objeto, imagen=imagen_file,
            descripcion=descripcion, es_principal=es_principal,
        )

        try:
            if foto.imagen and foto.imagen.path:
                if not os.path.exists(foto.imagen.path):
                    logger.error("INTEGRIDAD FALLIDA: La foto se guardó en BD pero no en disco: %s", foto.imagen.path)
        except Exception as e:
            logger.warning("No se pudo verificar integridad del archivo: %s", e)

        return Response(
            FotoObjetoUploadSerializer(foto).data,
            status=status.HTTP_201_CREATED
        )

    def _get_tipo(self, obj):
        if hasattr(obj, 'librorevista'):
            return 'libro'
        elif hasattr(obj, 'tecnologia'):
            return 'tecnologia'
        elif hasattr(obj, 'mueblearte'):
            return 'mueble'
        elif hasattr(obj, 'ropa'):
            return 'ropa'
        return 'objeto'
