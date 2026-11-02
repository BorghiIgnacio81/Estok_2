"""
GARANTÍA DE LAS CAJAS DECLARADAS POR OBJETO EN EL LISTADO DE OBJETOS.

PROBLEMA QUE RESUELVE
    La SECCIÓN 1 «📦 Cajas e Inventario Interno» combina dos naturalezas de
    caja: los Contenedores físicos (`arbol_inventario_datos.cajas_del_estok`) y
    los OBJETOS que el operador declaró como bulto (`Objeto.es_contenedor=True`)
    o clasificó con la categoría base «Cajas y Contenedores». Esos Objetos se
    clasifican hoy sobre el listado serializado que devuelve la API… pero ese
    listado se recorta por tenant (`estok_id`), y un registro histórico o EN
    TRÁNSITO podía quedar afuera de la sección y degradarse a «🧸 Objetos
    Sueltos o sin Caja».

QUÉ APORTA
    Completa el payload con los Objetos declarados caja/contenedor que el
    listado base NO trajo, resueltos por ORM
    (`arbol_inventario_datos.objetos_contenedor_del_estok`:
    `Q(categoria__nombre='Cajas y Contenedores') | Q(es_contenedor=True)`, sin
    importar si están dentro de un espacio, de otro contenedor o en tránsito).

    Los ítems viajan con el MISMO contrato de `ObjetoListSerializer`, así que el
    clasificador en memoria del servicio los deriva a la SECCIÓN 1 sin ninguna
    rama nueva. Los ids se resuelven con UNA query barata (`values_list`) y sólo
    se serializan los que faltan de verdad: el caso normal (cero faltantes) no
    paga el costo de un segundo serializado.
"""

from ..api.serializers import ObjetoListSerializer
from .arbol_inventario_datos import objetos_contenedor_del_estok


def cajas_declaradas_faltantes(estok_id, objetos_serializados, request=None):
    """
    Objetos declarados caja/contenedor del Estok que NO llegaron en el payload.

    Devuelve una lista (posiblemente vacía) con el contrato de
    `ObjetoListSerializer`, lista para extender el listado del árbol.
    """
    presentes = {str(od.get('id')) for od in objetos_serializados}
    faltantes = [
        ident
        for ident in objetos_contenedor_del_estok(estok_id).values_list('id', flat=True)
        if str(ident) not in presentes
    ]
    if not faltantes:
        return []
    return list(
        ObjetoListSerializer(
            objetos_contenedor_del_estok(estok_id).filter(id__in=faltantes),
            many=True,
            context={'request': request},
        ).data
    )
