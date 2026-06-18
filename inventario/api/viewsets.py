"""
ViewSets para la API REST del sistema de inventario.

Define los endpoints CRUD para todos los modelos,
incluyendo endpoints especializados para servicios de IA,
marketing y control de stock.
"""

import logging
from decimal import Decimal
from typing import Dict, Any

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.db.models import Q, F

from ..models import (
    Role, CustomUser, Ubicacion, Contenedor,
    Objeto, LibroRevista, Tecnologia, MuebleArte, Ropa,
    FotoObjeto, HistorialPrecio, AlertaStock,
)
from .serializers import (
    RoleSerializer, UserSerializer, UserCreateSerializer,
    UbicacionSerializer, ContenedorSerializer,
    ObjetoListSerializer, ObjetoDetailSerializer, ObjetoCreateSerializer,
    FotoObjetoSerializer, FotoObjetoUploadSerializer,
    HistorialPrecioSerializer, AlertaStockSerializer,
)
from ..services.ai_vision_service import AIVisionService
from ..services.qr_service import QRService
from ..services.marketing_service import MarketingService
from ..services.stock_service import StockValuationService

logger = logging.getLogger(__name__)


# =============================================================================
# PERMISOS PERSONALIZADOS BASADOS EN ROLES
# =============================================================================
class HasRolePermission(permissions.BasePermission):
    """
    Permiso basado en el rol del usuario.
    Verifica los campos booleanos del Role asociado.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False
        if user.is_superuser:
            return True

        role = getattr(user, 'role', None)
        if not role:
            return False

        # Mapear acciones HTTP a permisos
        action_map = {
            'list': 'can_read',
            'retrieve': 'can_read',
            'create': 'can_write',
            'update': 'can_edit',
            'partial_update': 'can_edit',
            'destroy': 'can_delete',
        }

        action = getattr(view, 'action', None)
        if action in action_map:
            return getattr(role, action_map[action], False)

        return False


# =============================================================================
# VIEWSETS DE USUARIOS Y ROLES
# =============================================================================
class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]


class UserViewSet(viewsets.ModelViewSet):
    queryset = CustomUser.objects.all()
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        return UserSerializer

    @action(detail=False, methods=['get'])
    def me(self, request):
        """Retorna el usuario autenticado actual."""
        serializer = UserSerializer(request.user)
        return Response(serializer.data)


# =============================================================================
# VIEWSETS DE ORGANIZACIÓN ESPACIAL
# =============================================================================
class UbicacionViewSet(viewsets.ModelViewSet):
    queryset = Ubicacion.objects.all()
    serializer_class = UbicacionSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]


class ContenedorViewSet(viewsets.ModelViewSet):
    queryset = Contenedor.objects.all()
    serializer_class = ContenedorSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        ubicacion_id = self.request.query_params.get('ubicacion')
        if ubicacion_id:
            qs = qs.filter(ubicacion_id=ubicacion_id)
        return qs

    @action(detail=True, methods=['get'])
    def qr_code(self, request, pk=None):
        """
        Obtiene la URL del código QR del contenedor.
        """
        contenedor = self.get_object()
        qr_service = QRService()
        qr_url = qr_service.obtener_qr_url(contenedor)
        return Response({
            "contenedor_id": str(contenedor.id),
            "contenedor_nombre": contenedor.nombre,
            "qr_code_url": qr_url,
            "objetos_count": contenedor.objetos.count(),
        })

    @action(detail=True, methods=['post'])
    def regenerar_qr(self, request, pk=None):
        """
        Regenera el código QR del contenedor.
        """
        contenedor = self.get_object()
        qr_service = QRService()
        qr_path = qr_service.regenerar_qr(str(contenedor.id), contenedor.nombre)
        if qr_path:
            contenedor.qr_code_image = qr_path
            contenedor.save(update_fields=['qr_code_image'])
            return Response({
                "mensaje": "QR regenerado correctamente",
                "qr_code_url": qr_service.obtener_qr_url(contenedor),
            })
        return Response(
            {"error": "Error al regenerar el QR"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    @action(detail=False, methods=['get'])
    def escanear(self, request):
        """
        Endpoint para escanear un QR de contenedor.
        Recibe el ID del contenedor (desde el QR escaneado) y
        retorna los objetos dentro de ese contenedor.

        Query params:
            - qr_data: URL completa escaneada del QR
            - contenedor_id: UUID del contenedor (alternativa directa)
        """
        qr_data = request.query_params.get('qr_data')
        contenedor_id = request.query_params.get('contenedor_id')

        if qr_data:
            # Extraer ID del contenedor desde la URL del QR
            contenedor_id = QRService.decode_qr_data(qr_data)

        if not contenedor_id:
            return Response(
                {"error": "Debes proporcionar 'qr_data' o 'contenedor_id'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            contenedor = get_object_or_404(Contenedor, id=contenedor_id)
            objetos = Objeto.objects.filter(
                contenedor=contenedor,
                deleted_at__isnull=True
            ).select_related('ubicacion')

            from .serializers import ObjetoListSerializer
            serializer = ObjetoListSerializer(objetos, many=True, context={'request': request})

            return Response({
                "contenedor": {
                    "id": str(contenedor.id),
                    "nombre": contenedor.nombre,
                    "ubicacion": contenedor.ubicacion.nombre,
                    "qr_code_url": QRService().obtener_qr_url(contenedor),
                },
                "objetos": serializer.data,
                "total_objetos": len(serializer.data),
            })

        except Exception as e:
            logger.error("Error al escanear QR: %s", e)
            return Response(
                {"error": f"Error al procesar el QR: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )


# =============================================================================
# VIEWSET DE OBJETOS (PRINCIPAL)
# =============================================================================
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
        elif self.action in ('create', 'update', 'partial_update'):
            return ObjetoCreateSerializer
        return ObjetoDetailSerializer

    def get_queryset(self):
        qs = Objeto.objects.all()

        # Filtro por tipo de objeto
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

        # Filtro por ubicación
        ubicacion = self.request.query_params.get('ubicacion')
        if ubicacion:
            qs = qs.filter(ubicacion_id=ubicacion)

        # Filtro por contenedor
        contenedor = self.request.query_params.get('contenedor')
        if contenedor:
            qs = qs.filter(contenedor_id=contenedor)

        # Filtro por estado de conservación
        estado = self.request.query_params.get('estado')
        if estado:
            qs = qs.filter(estado_conservacion=estado)

        # Filtro por estado de carga
        estado_carga = self.request.query_params.get('estado_carga')
        if estado_carga:
            qs = qs.filter(estado_carga=estado_carga)

        # Filtro por dueño original
        dueno = self.request.query_params.get('dueno_original')
        if dueno:
            qs = qs.filter(dueno_original_id=dueno)

        # Filtro por beneficiario
        beneficiario = self.request.query_params.get('beneficiario')
        if beneficiario:
            qs = qs.filter(beneficiario_id=beneficiario)

        # Búsqueda por texto
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                Q(nombre__icontains=search) |
                Q(descripcion__icontains=search)
            )

        # Incluir o excluir eliminados (soft delete)
        incluir_eliminados = self.request.query_params.get('incluir_eliminados')
        if not incluir_eliminados:
            qs = qs.filter(deleted_at__isnull=True)

        return qs.select_related('ubicacion', 'contenedor').prefetch_related('fotos')

    # =========================================================================
    # ACCIONES ESPECIALIZADAS
    # =========================================================================
    @action(detail=True, methods=['post'])
    def analizar_con_ia(self, request, pk=None):
        """
        Analiza un objeto usando IA local (LM Studio).
        Requiere que el objeto tenga al menos una foto.

        Optimizado para GPU Radeon RX 9060 XT:
        - Comprime la imagen antes de enviarla a la GPU
        - Maneja timeouts dinámicos según resolución
        - Retorna datos estructurados + campos pendientes
        """
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

            # Leer la imagen y comprimirla antes de enviar a GPU
            from pathlib import Path
            import base64

            image_path = Path(foto_principal.imagen.path)
            if not image_path.exists():
                return Response(
                    {"error": "El archivo de imagen no existe en el servidor"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Leer y codificar la imagen a Base64
            image_bytes = image_path.read_bytes()
            image_b64 = base64.b64encode(image_bytes).decode('utf-8')

            # Comprimir para GPU (reduce VRAM usage en Radeon RX 9060 XT)
            image_b64_comprimida = service._comprimir_imagen_base64(image_b64)

            # Analizar con la imagen comprimida
            resultado = service.procesar_imagen_desde_base64(image_b64_comprimida)

            # Actualizar campos del objeto con los datos de IA
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

            # Actualizar campos pendientes y estado
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
        Analiza una imagen recibida en Base64 usando IA local (LM Studio).
        Por defecto SOLO analiza y devuelve los datos (no crea el objeto).
        Si se envía `crear_objeto: true`, también crea el objeto en BD.

        Body (JSON):
        {
            "imagen_base64": "data:image/jpeg;base64,...",
            "solo_analisis": true,  (default: true - no crea objeto)
            "ubicacion_id": "uuid-opcional",
            "contenedor_id": "uuid-opcional",
            "es_segunda_foto": false  (si es la segunda foto de la parte trasera del libro)
        }

        Retorna los datos analizados por IA + campos pendientes.
        Si solo_analisis=false, también retorna el objeto creado.
        Si detecta un libro sin ISBN, sugiere tomar segunda foto de la parte trasera.
        """
        imagen_base64 = request.data.get('imagen_base64')
        if not imagen_base64:
            return Response(
                {"error": "Debes proporcionar 'imagen_base64'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Limpiar el prefijo data:image/...;base64, si existe
        if ',' in imagen_base64:
            imagen_base64 = imagen_base64.split(',', 1)[1]

        solo_analisis = request.data.get('solo_analisis', True)
        # Convertir string "true"/"false" a booleano si viene como string
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
            resultado = service.procesar_imagen_desde_base64(imagen_base64)

            # Preparar respuesta base con los datos de IA
            response_data = {
                "mensaje": "Imagen analizada correctamente",
                "datos_ia": resultado.to_dict(),
                "campos_pendientes": resultado.campos_pendientes,
            }

            # Si es un libro y NO es la segunda foto, verificar si necesita segunda foto
            # para obtener el ISBN de la parte trasera
            if resultado.categoria == 'libro' and not es_segunda_foto:
                necesita_segunda_foto = False
                motivo_segunda_foto = None
                
                # Si no se detectó ISBN, sugerir segunda foto de la parte trasera
                if not resultado.isbn_issn:
                    necesita_segunda_foto = True
                    motivo_segunda_foto = "No se detectó código ISBN en la portada. " \
                        "Toma una foto de la PARTE TRASERA del libro para capturar el código de barras/ISBN."
                
                # Si la confianza es baja en el título o autor, también sugerir
                if resultado.confianza_general < 0.5:
                    necesita_segunda_foto = True
                    motivo_segunda_foto = (motivo_segunda_foto or "") + \
                        " La confianza en la identificación es baja. " \
                        "Toma una foto más clara de la portada o la parte trasera."
                
                response_data["necesita_segunda_foto"] = necesita_segunda_foto
                response_data["motivo_segunda_foto"] = motivo_segunda_foto

            # Si es la segunda foto (parte trasera), priorizar la extracción del ISBN
            if es_segunda_foto and resultado.isbn_issn:
                logger.info("✅ Segunda foto: ISBN detectado: %s", resultado.isbn_issn)
                response_data["isbn_detectado"] = resultado.isbn_issn

            # Si no es solo análisis, crear el objeto en la base de datos
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

    @action(detail=True, methods=['post'])
    def generar_anuncios(self, request, pk=None):
        """
        Genera copys publicitarios para todas las plataformas.
        """
        objeto = self.get_object()

        # Construir datos del objeto para el servicio de marketing
        objeto_data = {
            "nombre": objeto.nombre,
            "descripcion": objeto.descripcion,
            "valor_estimado": float(objeto.valor_estimado) if objeto.valor_estimado else None,
            "estado_conservacion": objeto.estado_conservacion,
            "color": objeto.color,
        }

        # Agregar datos específicos según el tipo
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
        """
        Marca un objeto como publicado en una plataforma.
        Body: {"plataforma": "facebook|instagram|mercadolibre"}
        """
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

    @action(detail=True, methods=['post'])
    def actualizar_precio(self, request, pk=None):
        """
        Actualiza el valor_estimado y registra en el historial.
        Body: {"valor_nuevo": 150.00, "motivo": "Revalorización"}
        """
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

    @action(detail=False, methods=['get'])
    def buscar_precio_mercadolibre(self, request):
        """
        Busca precios de referencia en MercadoLibre Argentina.
        Usa la API pública de MercadoLibre (sin autenticación).

        Query params:
            q (str): Término de búsqueda (ej: "iPhone 14", "Cien Años de Soledad")
            limit (int): Cantidad de resultados (default: 5, max: 10)

        Retorna:
            {
                "resultados": [
                    {
                        "titulo": "iPhone 14 Pro 128GB",
                        "precio": 1500.00,
                        "moneda": "ARS",
                        "url": "https://...",
                        "vendedor": "MercadoLibre",
                        "condicion": "new",
                        "ubicacion": "Capital Federal"
                    }
                ],
                "promedio": 1500.00,
                "minimo": 1200.00,
                "maximo": 1800.00,
                "cantidad": 5,
                "fuente": "mercadolibre"
            }
        """
        import requests as req_lib

        query = request.query_params.get('q', '').strip()
        if not query:
            return Response(
                {"error": "Debes proporcionar 'q' (término de búsqueda)"},
                status=status.HTTP_400_BAD_REQUEST
            )

        limit = min(int(request.query_params.get('limit', 5)), 10)

        try:
            # API pública de MercadoLibre Argentina (MLA)
            url = "https://api.mercadolibre.com/sites/MLA/search"
            params = {
                "q": query,
                "limit": limit,
                "sort": "price_asc",
            }

            logger.info("🔍 Buscando en MercadoLibre: '%s' (limit=%d)", query, limit)
            response = req_lib.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            resultados = []
            for item in data.get('results', []):
                resultados.append({
                    "titulo": item.get('title', ''),
                    "precio": item.get('price', 0),
                    "moneda": item.get('currency_id', 'ARS'),
                    "url": item.get('permalink', ''),
                    "vendedor": item.get('seller', {}).get('nickname', 'Desconocido'),
                    "condicion": item.get('condition', ''),
                    "ubicacion": item.get('address', {}).get('city_name', ''),
                })

            precios = [r['precio'] for r in resultados if r['precio'] > 0]

            return Response({
                "resultados": resultados,
                "promedio": sum(precios) / len(precios) if precios else 0,
                "minimo": min(precios) if precios else 0,
                "maximo": max(precios) if precios else 0,
                "cantidad": len(resultados),
                "fuente": "mercadolibre",
            })

        except req_lib.exceptions.Timeout:
            logger.error("Timeout al consultar MercadoLibre")
            return Response(
                {"error": "La consulta a MercadoLibre tardó demasiado. Intenta de nuevo."},
                status=status.HTTP_504_GATEWAY_TIMEOUT
            )
        except req_lib.exceptions.RequestException as e:
            logger.error("Error al consultar MercadoLibre: %s", e)
            return Response(
                {"error": f"Error al consultar MercadoLibre: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY
            )

    @action(detail=True, methods=['post'])
    def crear_alerta_stock(self, request, pk=None):
        """
        Crea una alerta de stock para el objeto.
        Body: {"nivel_minimo": 2, "cantidad_actual": 1}
        """
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

    @action(detail=False, methods=['get'])
    def exportar_csv(self, request):
        """
        Exporta el inventario completo a CSV.
        """
        import csv
        from django.http import HttpResponse

        objetos = Objeto.objects.filter(deleted_at__isnull=True).select_related(
            'ubicacion', 'contenedor', 'dueno_original', 'beneficiario'
        )

        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="inventario_estok.csv"'
        response.write('\ufeff')  # BOM para Excel

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
        Verifica conectividad con LM Studio y mide latencia.
        Útil para diagnóstico en hardware real (RX 9060 XT).

        Retorna:
            - status: 'ok' | 'error'
            - latency_ms: tiempo de respuesta en milisegundos
            - model: nombre del modelo detectado
            - high_res_timeout: si el timeout extendido está configurado
        """
        import time
        from ..services.ai_vision_service import LMStudioClient, LM_STUDIO_TIMEOUT_ALTA_RES

        start = time.time()
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

    @action(detail=False, methods=['get'])
    def estadisticas(self, request):

        """
        Retorna estadísticas del inventario para el dashboard.
        Incluye valor_por_tipo para el gráfico de barras del Dashboard.
        """
        from django.db.models import Sum, Count, Q

        objetos = Objeto.objects.filter(deleted_at__isnull=True)

        total_objetos = objetos.count()
        valor_total = objetos.aggregate(total=Sum('valor_estimado'))['total'] or 0
        valor_promedio = valor_total / total_objetos if total_objetos > 0 else 0

        # Objetos por tipo
        tipos = {
            'libro': objetos.filter(librorevista__isnull=False).count(),
            'tecnologia': objetos.filter(tecnologia__isnull=False).count(),
            'mueble': objetos.filter(mueblearte__isnull=False).count(),
            'ropa': objetos.filter(ropa__isnull=False).count(),
            'objeto': objetos.filter(
                librorevista__isnull=True,
                tecnologia__isnull=True,
                mueblearte__isnull=True,
                ropa__isnull=True,
            ).count(),
        }

        # VALOR POR TIPO (para gráfico de barras del Dashboard)
        valor_por_tipo = {
            'libro': float(objetos.filter(librorevista__isnull=False).aggregate(total=Sum('valor_estimado'))['total'] or 0),
            'tecnologia': float(objetos.filter(tecnologia__isnull=False).aggregate(total=Sum('valor_estimado'))['total'] or 0),
            'mueble': float(objetos.filter(mueblearte__isnull=False).aggregate(total=Sum('valor_estimado'))['total'] or 0),
            'ropa': float(objetos.filter(ropa__isnull=False).aggregate(total=Sum('valor_estimado'))['total'] or 0),
            'objeto': float(objetos.filter(
                librorevista__isnull=True,
                tecnologia__isnull=True,
                mueblearte__isnull=True,
                ropa__isnull=True,
            ).aggregate(total=Sum('valor_estimado'))['total'] or 0),
        }

        # Objetos por estado de conservación
        estados = {}
        for choice in Objeto._meta.get_field('estado_conservacion').choices:
            key = choice[0]
            count = objetos.filter(estado_conservacion=key).count()
            if count > 0:
                estados[key] = count

        # Objetos por estado de carga
        carga = {}
        for choice in Objeto.ESTADO_CARGA_CHOICES:
            key = choice[0]
            count = objetos.filter(estado_carga=key).count()
            if count > 0:
                carga[key] = count

        # Últimos objetos registrados
        ultimos = objetos.order_by('-fecha_registro')[:5]
        ultimos_data = [
            {
                "id": str(o.id),
                "nombre": o.nombre,
                "tipo": self._get_tipo(o),
                "valor_estimado": float(o.valor_estimado) if o.valor_estimado else None,
                "fecha_registro": o.fecha_registro.isoformat(),
            }
            for o in ultimos
        ]

        # Total ubicaciones y contenedores
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

    @action(detail=True, methods=['post'])
    def subir_foto(self, request, pk=None):
        """
        Sube una foto para el objeto usando multipart/form-data.
        Verifica integridad: el archivo debe existir en disco después de guardar,
        y los metadatos (descripción, es_principal) deben persistir correctamente.
        """
        objeto = self.get_object()
        serializer = FotoObjetoUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        imagen_file = serializer.validated_data['imagen']
        descripcion = serializer.validated_data.get('descripcion', '')
        es_principal = serializer.validated_data.get('es_principal', False)

        # Validar que el archivo no esté vacío
        if imagen_file.size == 0:
            return Response(
                {"error": "El archivo de imagen está vacío"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validar tipo de archivo
        import imghdr
        allowed_types = ['jpeg', 'png', 'gif', 'webp']
        file_type = imghdr.what(imagen_file)
        if file_type and file_type not in allowed_types:
            return Response(
                {"error": f"Tipo de imagen no soportado: {file_type}. Permitidos: {', '.join(allowed_types)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        foto = FotoObjeto.objects.create(
            objeto=objeto,
            imagen=imagen_file,
            descripcion=descripcion,
            es_principal=es_principal,
        )

        # VERIFICACIÓN DE INTEGRIDAD: Confirmar que el archivo existe en disco
        try:
            if foto.imagen and foto.imagen.path:
                import os
                if not os.path.exists(foto.imagen.path):
                    logger.error("INTEGRIDAD FALLIDA: La foto se guardó en BD pero no en disco: %s", foto.imagen.path)
                    # Reintentar guardar
                    foto.imagen.save(imagen_file.name, imagen_file, save=True)
                    if not os.path.exists(foto.imagen.path):
                        return Response(
                            {"error": "Error de almacenamiento: no se pudo guardar la imagen en disco"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR
                        )
                logger.info("INTEGRIDAD OK: Foto guardada en %s (tamaño: %d bytes, tipo: %s)",
                           foto.imagen.path, foto.imagen.size, file_type or 'desconocido')
        except Exception as e:
            logger.error("Error verificando integridad de foto: %s", e)

        # Si es principal, desmarcar las demás
        if foto.es_principal:
            FotoObjeto.objects.filter(objeto=objeto).exclude(id=foto.id).update(es_principal=False)

        serializer_out = FotoObjetoSerializer(foto, context={'request': request})
        return Response(
            serializer_out.data,
            status=status.HTTP_201_CREATED
        )


    @action(detail=True, methods=['post'])
    def soft_delete(self, request, pk=None):
        """Realiza un soft delete del objeto."""
        objeto = self.get_object()
        objeto.delete()  # Llama al método soft delete
        return Response({"mensaje": f"Objeto '{objeto.nombre}' eliminado (soft delete)"})

    @action(detail=True, methods=['post'])
    def restaurar(self, request, pk=None):
        """Restaura un objeto eliminado (soft delete)."""
        objeto = self.get_object()
        if objeto.deleted_at:
            objeto.deleted_at = None
            objeto.save(update_fields=['deleted_at'])
            return Response({"mensaje": f"Objeto '{objeto.nombre}' restaurado"})
        return Response({"mensaje": "El objeto no estaba eliminado"})


# =============================================================================
# VIEWSET DE FOTOS
# =============================================================================
class FotoObjetoViewSet(viewsets.ModelViewSet):
    queryset = FotoObjeto.objects.all()
    serializer_class = FotoObjetoSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        objeto_id = self.request.query_params.get('objeto')
        if objeto_id:
            qs = qs.filter(objeto_id=objeto_id)
        return qs

    @action(detail=True, methods=['post'])
    def hacer_principal(self, request, pk=None):
        """Marca una foto como principal del objeto."""
        foto = self.get_object()
        FotoObjeto.objects.filter(objeto=foto.objeto).exclude(id=foto.id).update(es_principal=False)
        foto.es_principal = True
        foto.save(update_fields=['es_principal'])
        return Response({"mensaje": "Foto marcada como principal"})


# =============================================================================
# VIEWSET DE HISTORIAL DE PRECIOS
# =============================================================================
class HistorialPrecioViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet de solo lectura para el historial de precios.
    Los cambios de precio se registran a través de ObjetoViewSet.actualizar_precio.
    """
    queryset = HistorialPrecio.objects.all()
    serializer_class = HistorialPrecioSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        objeto_id = self.request.query_params.get('objeto')
        if objeto_id:
            qs = qs.filter(objeto_id=objeto_id)
        return qs.select_related('objeto', 'registrado_por')


# =============================================================================
# VIEWSET DE ALERTAS DE STOCK
# =============================================================================
class AlertaStockViewSet(viewsets.ModelViewSet):
    queryset = AlertaStock.objects.all()
    serializer_class = AlertaStockSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        objeto_id = self.request.query_params.get('objeto')
        if objeto_id:
            qs = qs.filter(objeto_id=objeto_id)

        solo_activas = self.request.query_params.get('activas')
        if solo_activas:
            qs = qs.filter(activa=True)

        solo_reponer = self.request.query_params.get('reponer')
        if solo_reponer:
            qs = qs.filter(activa=True, cantidad_actual__lte=F('nivel_minimo'))

        return qs.select_related('objeto')

    @action(detail=False, methods=['get'])
    def resumen(self, request):
        """Retorna un resumen de todas las alertas."""
        from ..services.stock_service import StockValuationService
        service = StockValuationService()
        return Response({
            "alertas_activas": service.obtener_alertas_activas(),
            "a_reponer": service.obtener_objetos_a_reponer(),
        })


