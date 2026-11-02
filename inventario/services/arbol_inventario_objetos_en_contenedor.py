"""
SECCIÓN «📦 Objetos en Contenedor» del listado de Objetos (`/objetos`).

PROBLEMA QUE RESUELVE
    Los objetos guardados DENTRO de una caja, de un mueble o de un espacio
    lógico sólo aparecían como viñetas plegadas dentro de la tarjeta de su
    contenedor. Al quitar los filtros —o al filtrar por categoría
    («Coleccionables», «Artesanías»)— el ítem quedaba oculto y el inventario
    parecía incompleto.

QUÉ DEVUELVE
    Una LISTA PLANA (sin jerarquía) de los objetos que viven dentro de algún
    contenedor, para que el cliente pinte una tarjeta por ítem con la insignia
    de su ubicación («📦 En Caja 02»). Cada ítem conserva el payload completo de
    `ObjetoListSerializer` y agrega:

      · `tipo='objeto'`        → mismo contrato que las viñetas del árbol.
      · `contenedor_tipo`      → 'caja' | 'mueble' | 'espacio'.
      · `contenedor_etiqueta`  → nombre legible del contenedor que lo aloja.

    NUNCA duplica: las tarjetas de contenedor siguen mostrando su contenido
    plegado, «Objetos Sueltos o sin Caja» sólo lista los ítems sin hogar y los
    propios contenedores (Objetos declarados caja) se listan como TARJETA de la
    SECCIÓN 1, no como ítem contenido.

OPTIMIZACIÓN
    Se resuelve en memoria sobre el listado YA serializado y los mapas de
    contenedores del Estok: cero consultas N+1.
"""

from .arbol_inventario_datos import clave_orden_natural

# Etiquetas de la insignia por naturaleza física del contenedor.
ETIQUETA_TIPO_CONTENEDOR = {
    'caja': '📦 En',
    'mueble': '🗄 En',
    'espacio': '🧩 En',
}


def etiqueta_contenedor(tipo, nombre) -> str:
    """Insignia legible de la tarjeta: «📦 En Caja 02»."""
    prefijo = ETIQUETA_TIPO_CONTENEDOR.get(tipo, '📦 En')
    limpio = str(nombre or '').strip()
    return f'{prefijo} {limpio}' if limpio else ''


def objetos_en_contenedor(
    objetos_serializados,
    *,
    cajas_por_id,
    contenedores_por_id,
    ids_objeto_contenedor,
    es_espejo=None,
):
    """
    Lista plana de Objetos que viven DENTRO de un contenedor del Estok.

    `ids_objeto_contenedor` son los Objetos declarados caja/contenedor: se
    excluyen porque se listan como TARJETA de la SECCIÓN 1. `es_espejo` es el
    predicado de dualidad Contenedor ⇄ Objeto (registro espejo del propio
    espacio), que nunca debe aparecer como ítem contenido.
    """
    declarados = {str(ident) for ident in (ids_objeto_contenedor or ())}
    items = []

    for od in objetos_serializados or []:
        if str(od.get('id')) in declarados:
            continue

        contenedor_id = od.get('contenedor')
        if contenedor_id:
            clave = str(contenedor_id)
            if clave in cajas_por_id:
                tipo, contenedor = 'caja', cajas_por_id[clave]
            elif clave in contenedores_por_id:
                tipo, contenedor = 'mueble', contenedores_por_id[clave]
            else:
                # Contenedor fantasma (borrado/migrado): el objeto se recupera
                # en «Objetos Sueltos o sin Caja», nunca acá.
                continue
            if es_espejo is not None and es_espejo(od, contenedor):
                continue
            nombre = str(getattr(contenedor, 'nombre', '') or '')
            items.append({
                **od,
                'tipo': 'objeto',
                'contenedor_tipo': tipo,
                'contenedor_etiqueta': nombre,
            })
            continue

        # Sin contenedor físico: sólo entra si cuelga de un Objeto contenedor
        # («espacio» lógico declarado por el operador).
        padre = od.get('objeto_padre')
        if padre and str(padre) in declarados:
            items.append({
                **od,
                'tipo': 'objeto',
                'contenedor_tipo': 'espacio',
                'contenedor_etiqueta': str(od.get('objeto_padre_nombre') or ''),
            })

    items.sort(
        key=lambda o: (
            clave_orden_natural(o.get('contenedor_etiqueta') or ''),
            clave_orden_natural(o.get('nombre') or ''),
        ),
    )
    return items
