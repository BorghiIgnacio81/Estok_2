"""
JERARQUÍA ÚNICA de resolución de la UBICACIÓN (contenedor / espacio / planta)
de un Objeto del inventario.

POR QUÉ EXISTE (fix «Contenedor ausente»)
=========================================
La tarjeta de un objeto en /objetos mostraba «contenedor ausente» cuando
`Objeto.contenedor` era NULL, aunque el objeto SÍ estuviera asignado a un
espacio o a una planta. El nombre del contenedor se leía con un lookup crudo
(`source='contenedor.nombre'`), que devuelve None sin mirar el resto de la
jerarquía espacial.

ORDEN DE FALLBACK (contrato único, backend + modelo)
====================================================
  1. `objeto.contenedor.nombre`      → mueble / caja física que lo aloja.
  2. `objeto.objeto_padre.nombre`    → «Espacio» lógico: un Objeto declarado
                                       como contenedor (`es_contenedor=True`)
                                       que lo contiene.
  3. `objeto.ubicacion.nombre`       → espacio/habitación («Espacio Único») o
                                       planta/división asignada directamente.
  4. Solo si los TRES son nulos → `Contenedor ausente`.

Sin N+1: la cadena de ancestros se recorre únicamente sobre relaciones YA
precargadas (`select_related`) por los querysets de la API; si un eslabón no
está en la caché del ORM, la cadena se corta en el último nombre disponible.
Este módulo es PURO respecto de los modelos (solo `getattr`), para poder
importarse desde el modelo y desde los serializers sin acoplamiento circular.
"""

# Texto de último recurso: sólo aparece cuando el objeto no tiene NINGUNA
# referencia espacial (ni contenedor, ni espacio lógico, ni ubicación).
TEXTO_CONTENEDOR_AUSENTE = 'Contenedor ausente'

# Tope de profundidad: la jerarquía real nunca supera 4-5 niveles.
PROFUNDIDAD_MAXIMA = 5


def _nombre_de(pieza) -> str:
    """Nombre legible de una pieza espacial (str vacío si no tiene)."""
    return str(getattr(pieza, 'nombre', '') or '').strip()


def _padre_precargado(pieza, campo):
    """
    Relación padre YA cacheada por `select_related`.

    Se lee `fields_cache` a propósito: acceder a la FK sin precarga dispararía
    una query por nivel (N+1) en los listados de la API.
    """
    estado = getattr(pieza, '_state', None)
    cache = getattr(estado, 'fields_cache', None) or {}
    return cache.get(campo)


def cadena_contenedores(contenedor) -> list[str]:
    """Nombres desde el contenedor RAÍZ hasta el contenedor DIRECTO."""
    cadena: list[str] = []
    actual = contenedor
    while actual is not None and len(cadena) < PROFUNDIDAD_MAXIMA:
        nombre = _nombre_de(actual)
        if nombre:
            cadena.append(nombre)
        actual = _padre_precargado(actual, 'parent_contenedor')
    return list(reversed(cadena))


def cadena_objetos_contenedor(objeto) -> list[str]:
    """Nombres de los Objetos contenedores («espacios») desde la raíz al directo."""
    cadena: list[str] = []
    actual = getattr(objeto, 'objeto_padre', None) if objeto is not None else None
    while actual is not None and len(cadena) < PROFUNDIDAD_MAXIMA:
        nombre = _nombre_de(actual)
        if nombre:
            cadena.append(nombre)
        actual = _padre_precargado(actual, 'objeto_padre')
    return list(reversed(cadena))


def nombre_contenedor_objeto(objeto) -> str | None:
    """
    Nombre del contenedor/espacio del objeto según la JERARQUÍA DE FALLBACK.

    Devuelve None únicamente cuando el objeto no tiene contenedor, ni espacio
    lógico (`objeto_padre`) ni ubicación asignada.
    """
    if objeto is None:
        return None

    contenedor = getattr(objeto, 'contenedor', None)
    if contenedor is not None:
        nombre = _nombre_de(contenedor)
        if nombre:
            return nombre

    cadena_espacios = cadena_objetos_contenedor(objeto)
    if cadena_espacios:
        return cadena_espacios[-1]

    ubicacion = getattr(objeto, 'ubicacion', None)
    if ubicacion is not None:
        nombre = _nombre_de(ubicacion)
        if nombre:
            return nombre

    return None


def ruta_ubicacion_objeto(objeto) -> str | None:
    """
    RUTA FÍSICA legible: «Habitación · Espacio · Mueble · Caja».

    La ubicación (planta/habitación) va primero por ser el ancla geográfica; la
    cadena de contención se agrega después. Si el objeto no tiene contenedor
    físico pero sí un Objeto contenedor («espacio»), la cadena de ese espacio
    ocupa su lugar. Devuelve None si no hay ninguna referencia espacial.
    """
    if objeto is None:
        return None

    nombres: list[str] = []
    ubicacion = getattr(objeto, 'ubicacion', None)
    if ubicacion is not None:
        nombre_ubicacion = _nombre_de(ubicacion)
        if nombre_ubicacion:
            nombres.append(nombre_ubicacion)

    cadena = cadena_contenedores(getattr(objeto, 'contenedor', None))
    if not cadena:
        cadena = cadena_objetos_contenedor(objeto)
    nombres.extend(cadena)

    return ' · '.join(nombres) or None


def etiqueta_ubicacion_objeto(objeto) -> str:
    """
    Ruta completa del objeto o, SOLO si todo es nulo, `Contenedor ausente`.

    Es el valor que consume `ubicacion_display` en la API: la tarjeta de
    /objetos nunca más rotula «contenedor ausente» a un objeto que sí está
    asignado a un espacio o a una planta.
    """
    return ruta_ubicacion_objeto(objeto) or TEXTO_CONTENEDOR_AUSENTE


def tiene_ubicacion_resoluble(objeto) -> bool:
    """True si el objeto tiene contenedor, espacio lógico o ubicación real."""
    return nombre_contenedor_objeto(objeto) is not None
