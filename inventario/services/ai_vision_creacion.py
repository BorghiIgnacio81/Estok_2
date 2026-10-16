"""
Mixin de AIVisionService: creacion de Objeto a partir de un VisionResult.
Extraido de ai_vision_service.py (Fase A refactor preventivo).
"""

import logging
from decimal import Decimal
from typing import Optional, Dict, Any

from .ai_vision_nucleo import VisionResult

logger = logging.getLogger(__name__)


class AIVisionCreacionMixin:
    """AIVisionService - creacion de Objeto (taxonomia unificada + historial)."""

    def crear_objeto_desde_vision(
        self,
        vision_result: VisionResult,
        user=None,
        ubicacion=None,
        contenedor=None,
        estok=None,
    ) -> Optional[Dict[str, Any]]:
        """
        Crea un Objeto directamente (sin subclases multi-tabla) a partir de
        un resultado de visión. Asigna la Categoria oficial según el
        meli_category_id detectado. Registra automáticamente el precio en el
        Historial de Precios.

        Args:
            vision_result: Resultado del análisis de visión.
            user: Usuario que realiza la carga (opcional).
            ubicacion: Ubicación del objeto (opcional).
            contenedor: Contenedor del objeto (opcional).
            estok: Estok al que pertenece el objeto (opcional, aislamiento
                   multi-tenant).

        Returns:
            Dict con el objeto creado y metadatos, o None si falla.
        """
        from ..models import Objeto, HistorialPrecio, Categoria

        try:
            from django.db import transaction

            with transaction.atomic():
                estado_carga = 'completo'
                if vision_result.campos_pendientes:
                    estado_carga = 'incompleto'

                # Resolver la categoría oficial de las 11 Meli.
                # OJO: `vision_result.meli_category_id` es la key del contrato
                # JSON que devuelve el motor de IA; el campo del modelo es
                # `mercadolibre_category_id`.
                categoria = None
                if vision_result.meli_category_id:
                    if estok is not None:
                        categoria = Categoria.objects.filter(
                            mercadolibre_category_id=vision_result.meli_category_id,
                            estok=estok,
                        ).first()
                    if categoria is None:
                        categoria = Categoria.objects.filter(
                            mercadolibre_category_id=vision_result.meli_category_id,
                        ).first()

                objeto = Objeto.objects.create(
                    nombre=vision_result.nombre or "Objeto sin nombre",
                    descripcion=vision_result.descripcion,
                    estok=estok,
                    ubicacion=ubicacion,
                    contenedor=contenedor,
                    categoria=categoria,
                    estado_conservacion=vision_result.estado_conservacion or 'bueno',
                    valor_estimado=(
                        Decimal(str(vision_result.precio_estimado_mercado))
                        if vision_result.precio_estimado_mercado else None
                    ),
                    color=vision_result.color,
                    # Campos específicos migrados (antes subclases multi-tabla)
                    autor=vision_result.autor,
                    marca=vision_result.marca,
                    anio=vision_result.anio,
                    isbn_issn=vision_result.isbn_issn,
                    edicion=vision_result.edicion,
                    nombre_serie=vision_result.nombre_serie,
                    titulo_tomo=vision_result.titulo_tomo,
                    numero_tomo=vision_result.numero_tomo,
                    editorial=vision_result.editorial,
                    idioma=vision_result.idioma,
                    estado_carga=estado_carga,
                    campos_pendientes=vision_result.campos_pendientes,
                )

                if vision_result.precio_estimado_mercado:
                    HistorialPrecio.objects.create(
                        objeto=objeto,
                        valor_anterior=None,
                        valor_nuevo=Decimal(str(vision_result.precio_estimado_mercado)),
                        motivo="Valoración inicial por IA",
                        registrado_por=user,
                    )

                logger.info(
                    "Objeto creado desde visión: '%s' (categoría: %s, meli_id: %s, estado: %s)",
                    objeto.nombre,
                    objeto.categoria.nombre if objeto.categoria else None,
                    vision_result.meli_category_id,
                    estado_carga,
                )

                return {
                    "id": str(objeto.id),
                    "nombre": objeto.nombre,
                    "categoria": objeto.categoria.nombre if objeto.categoria else None,
                    "meli_category_id": vision_result.meli_category_id,
                    "estado_carga": estado_carga,
                    "campos_pendientes": vision_result.campos_pendientes,
                    "valor_estimado": float(vision_result.precio_estimado_mercado)
                    if vision_result.precio_estimado_mercado else None,
                }

        except Exception as e:
            logger.error("Error al crear objeto desde visión: %s", e)
            return None
