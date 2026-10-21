"""
Aplicación del bloque de objeto PREFIJADO (`objeto_*`) en un PUT/PATCH del
espacio que lo contiene.

Fuente ÚNICA del contrato que comparten:
  · `PUT /contenedores/{id}/` (modal técnico del mueble), y
  · `PATCH /ubicaciones/{id}/` (edición de la ubicación con un mueble declarado
    adentro, seleccionado por `objeto_contenedor_id`).

El bloque viaja con los datos técnicos del espacio en la MISMA petición; la
validación vive en `PropiedadesObjetoEspacioSerializer` y la persistencia en
`inventario.services.objeto_espacio`.
"""

from ...serializers import PropiedadesObjetoEspacioSerializer
from ....services.objeto_espacio import (
    guardar_propiedades_objeto,
    propiedades_desde_payload,
)


def aplicar_propiedades_objeto(contenedor, request):
    """
    Persiste el bloque `objeto_*` del request sobre el Objeto espejo del
    Contenedor indicado.

    Devuelve None cuando el payload no trae propiedades de objeto (p. ej. un
    Drop de reubicación o un PATCH que sólo renombra el espacio), de modo que
    el guardado técnico del espacio no se altera.
    """
    datos = propiedades_desde_payload(request.data, prefijo='objeto_')
    if not datos:
        return None
    serializer = PropiedadesObjetoEspacioSerializer(
        data=datos,
        context={'request': request, 'contenedor': contenedor},
    )
    serializer.is_valid(raise_exception=True)
    return guardar_propiedades_objeto(contenedor, serializer.validated_data)
