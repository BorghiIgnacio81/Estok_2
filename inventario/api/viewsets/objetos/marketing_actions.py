"""
Mixins de acciones de marketing para ObjetoViewSet.
Contiene: generar_anuncios, publicar_en, estado_publicacion.
"""

import logging

from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status

from ....services.marketing_service import MarketingService


logger = logging.getLogger(__name__)


class MarketingActionsMixin:
    """
    Mixin que agrega endpoints de marketing al ViewSet.
    Depende de que la clase combinada herede de ObjetoViewSetBase.
    """

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
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'])
    def publicar_en(self, request, pk=None):
        """Marca un objeto como publicado en una plataforma."""
        objeto = self.get_object()
        plataforma = request.data.get('plataforma')

        if not plataforma:
            return Response(
                {"error": "Debes especificar 'plataforma'"},
                status=status.HTTP_400_BAD_REQUEST,
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

    @action(detail=True, methods=['get'])
    def preview_publicacion(self, request, pk=None):
        """
        Devuelve los datos necesarios para el formulario de publicación:
        - Fotos del objeto (URLs)
        - Título, descripción y precio sugeridos (IA + precio referencia)
        - Datos del objeto
        GET /api/objetos/{id}/preview_publicacion/
        """
        objeto = self.get_object()

        # Fotos - usar URL pública del frontend (ML necesita HTTPS público)
        frontend_base = 'https://eeestok.duckdns.org'
        fotos = [
            {
                "id": str(f.id),
                "url": f"{frontend_base}{f.imagen.url}" if f.imagen else None,
                "es_principal": f.es_principal,
                "descripcion": f.descripcion,
            }
            for f in objeto.fotos.all().order_by('-es_principal', 'fecha_subida')
        ]

        # Datos del objeto para marketing
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

        # Generar anuncios con IA
        try:
            service = MarketingService()
            paquete = service.generar_paquete_anuncios(objeto_data)
        except Exception as e:
            logger.error("Error al generar anuncios: %s", e)
            paquete = None

        # Precio de referencia
        from ....services.precio_referencia_service import buscar_precio_referencia
        try:
            precio_ref = buscar_precio_referencia(objeto.nombre, estado=objeto.estado_conservacion)
        except Exception:
            precio_ref = None

        data = {
            "fotos": fotos,
            "objeto": objeto_data,
            "plataformas_publicadas": objeto.plataformas_publicadas or [],
        }

        if paquete:
            anuncios = paquete.to_dict()
            data["anuncios"] = {
                "mercadolibre": anuncios.get("mercadolibre"),
                "facebook": anuncios.get("facebook"),
            }
        else:
            data["anuncios"] = None

        if precio_ref and precio_ref.get("encontrado"):
            data["precio_referencia"] = {
                "precio_original": precio_ref.get("precio_original"),
                "precio_ajustado": precio_ref.get("precio_ajustado"),
                "fuente": precio_ref.get("fuente"),
                "link": precio_ref.get("link"),
            }
        else:
            data["precio_referencia"] = None

        return Response(data)
