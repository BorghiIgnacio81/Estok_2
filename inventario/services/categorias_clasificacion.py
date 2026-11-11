"""
REGLAS DE CLASIFICACIÓN DEL INVENTARIO POR NOMBRE DE CATEGORÍA.

Fuente ÚNICA de la normalización de nombres de categoría y de la familia
«Muebles», compartida por:

  - `arbol_inventario_muebles_objetos`: decide qué Objetos viajan a la sección
    «🗄 Muebles y Estructuras Móviles» del listado `/objetos`.
  - `api/serializers/objetos.ObjetoListSerializer`: expone `categoria_slug`
    (el mismo nombre normalizado) para que el cliente clasifique sin depender
    de coincidencias exactas ni de un fallback genérico.

NORMALIZACIÓN (no destructiva, sólo para comparar)
    minúsculas + sin tildes + espacios colapsados:

        «Muebles y Estructuras Móviles»  →  «muebles y estructuras moviles»
        «  MUEBLES  »                    →  «muebles»

    No se persiste nada: el nombre original de la categoría se conserva
    intacto en la base y en `categoria_nombre`.
"""

import unicodedata

# Nombres normalizados de la familia «Muebles». La categoría oficial del
# catálogo es «Muebles» (MLA436380); las variantes cubren el rótulo que muestra
# la sección del listado y los nombres largos creados a mano por el operador.
NOMBRES_CATEGORIA_MUEBLE = frozenset((
    'muebles',
    'mueble',
    'muebles y estructuras moviles',
    'muebles y estructura movil',
    'mueble y estructuras moviles',
    'mueble y estructura movil',
))


def normalizar_nombre_categoria(nombre) -> str:
    """
    Nombre de categoría normalizado para comparar: minúsculas, sin tildes y
    con los espacios colapsados. Devuelve '' si no hay texto.
    """
    texto = unicodedata.normalize('NFKD', str(nombre or ''))
    texto = ''.join(caracter for caracter in texto if not unicodedata.combining(caracter))
    return ' '.join(texto.casefold().split())


def es_categoria_mueble(nombre) -> bool:
    """
    True si el NOMBRE de la categoría pertenece a la familia «Muebles»
    («Muebles», «Muebles y Estructuras Móviles» y sus variantes).
    """
    return normalizar_nombre_categoria(nombre) in NOMBRES_CATEGORIA_MUEBLE
