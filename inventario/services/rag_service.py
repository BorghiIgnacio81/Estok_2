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
                # Intentar obtener datos del modelo hijo
                libro = None
                tecnologia = None
                mueble = None
                ropa = None
                try:
                    libro = obj.librorevista
                except Exception:
                    pass
                try:
                    tecnologia = obj.tecnologia
                except Exception:
                    pass
                try:
                    mueble = obj.mueblearte
                except Exception:
                    pass
                try:
                    ropa = obj.ropa
                except Exception:
                    pass

                detalles = f"- '{obj.nombre}'"
                if libro:
                    detalles += f" [LIBRO] autor:{libro.autor or '?'} editorial:{libro.editorial or '?'}"
                    if libro.isbn_issn:
                        detalles += f" ISBN:{libro.isbn_issn}"
                elif tecnologia:
                    detalles += f" [TECNOLOGIA] marca:{tecnologia.marca or '?'} modelo:{tecnologia.modelo or '?'}"
                elif mueble:
                    detalles += f" [MUEBLE] material:{mueble.material or '?'} artista:{mueble.artista_fabricante or '?'}"
                elif ropa:
                    detalles += f" [ROPA] talla:{ropa.tamano or '?'}"
                else:
                    detalles += f" [OTRO]"

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
