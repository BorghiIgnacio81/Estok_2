"""
Normalización ÚNICA de «Caja llena / lote en foto».

Compartida por las DOS entidades que pueden declarar un lote fotografiado:
  · `Contenedor` (caja/mueble físico del tablero de Almacenamiento).
  · `Objeto` con `es_contenedor=True` (caja registrada desde /objetos/nuevo).

REGLAS
  · `cantidad_objetos_lote <= 0` se normaliza a `null` (el frontend sólo lee
    cantidades > 0 para el badge «Caja llena (~40 objetos)»).
  · Sin `esta_llena=True` la cantidad SIEMPRE queda en `null`: una caja con
    espacio disponible no tiene lote declarado.

Vive en `services` (capa pura, sin DRF) para que cualquier serializer o
comando pueda aplicar exactamente el mismo criterio sin duplicar el código.
"""


def normalizar_caja_llena_lote(attrs, instancia=None):
    """Normaliza `esta_llena` + `cantidad_objetos_lote` en los attrs validados.

    :param attrs: dict de datos validados por DRF (se modifica in place).
    :param instancia: registro existente (PUT/PATCH) o None (POST).
    :return: el mismo dict `attrs`, ya normalizado.
    """
    if 'cantidad_objetos_lote' in attrs:
        cantidad = attrs.get('cantidad_objetos_lote')
        if cantidad is not None and cantidad <= 0:
            attrs['cantidad_objetos_lote'] = None
    esta_llena = attrs.get(
        'esta_llena',
        getattr(instancia, 'esta_llena', False) if instancia is not None else False,
    )
    if not esta_llena:
        attrs['cantidad_objetos_lote'] = None
    return attrs
