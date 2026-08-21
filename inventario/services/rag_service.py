"""
Servicio de RAG (Retrieval-Augmented Generation) para visión por IA.

Busca objetos ya catalogados en la base de datos para usarlos como contexto
en los prompts de los modelos de visión, mejorando la precisión de las
predicciones al dar ejemplos concretos del inventario del usuario.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def buscar_objetos_similares(max_resultados: int = 5) -> str:
    """
    Busca objetos ya catalogados en la BD para usarlos como contexto (RAG).
    Ayuda al modelo a ser más preciso basándose en objetos similares ya registrados.

    Args:
        max_resultados: Máximo de objetos a incluir como contexto.

    Returns:
        String con la lista de objetos similares formateada para el prompt,
        o string vacío si no hay objetos en la BD.
    """
    try:
        from ..models import Objeto
        from django.db.models import Q

        # Obtener objetos no eliminados, ordenados por fecha descendente
        objetos = Objeto.objects.filter(
            deleted_at__isnull=True
        ).exclude(
            Q(nombre__isnull=True) | Q(nombre__exact='') | Q(nombre__exact='Objeto sin nombre')
        ).order_by('-fecha_registro')[:max_resultados]

        if not objetos:
            return ""

        contexto = "OBJETOS YA CATALOGADOS EN TU INVENTARIO (usa como referencia):\n"
        for obj in objetos:
            try:
                # Taxonomía unificada: los datos específicos son campos
                # directos del propio Objeto (sin subclases multi-tabla).
                categoria_label = obj.categoria.nombre if obj.categoria else 'OTRO'

                detalles = f"- '{obj.nombre}'"
                if obj.autor or obj.editorial or obj.isbn_issn:
                    detalles += (
                        f" [LIBRO] autor:{obj.autor or '?'} "
                        f"editorial:{obj.editorial or '?'}"
                    )
                    if obj.isbn_issn:
                        detalles += f" ISBN:{obj.isbn_issn}"
                elif obj.marca or obj.modelo:
                    detalles += (
                        f" [TECNOLOGIA] marca:{obj.marca or '?'} "
                        f"modelo:{obj.modelo or '?'}"
                    )
                elif obj.material or obj.artista_fabricante:
                    detalles += (
                        f" [MUEBLE] material:{obj.material or '?'} "
                        f"artista:{obj.artista_fabricante or '?'}"
                    )
                elif obj.tamano:
                    detalles += f" [ROPA] talla:{obj.tamano or '?'}"
                else:
                    detalles += f" [OTRO]"

                detalles += f" categoria:{categoria_label}"

                if obj.estado_conservacion:
                    detalles += f" estado:{obj.estado_conservacion}"
                if obj.valor_estimado:
                    detalles += f" valor:${float(obj.valor_estimado):.2f}"

                contexto += detalles + "\n"
            except Exception:
                continue


        contexto += "\nUSA ESTOS OBJETOS COMO REFERENCIA para identificar el nuevo objeto.\n"
        return contexto

    except Exception as e:
        logger.warning("Error al buscar objetos similares para RAG: %s", e)
        return ""
