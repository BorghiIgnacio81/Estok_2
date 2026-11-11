"""
TAXONOMÍA ESTRICTA DE CONTENEDORES (5 tipos físicos obligatorios).

El inventario separa sin ambigüedad CINCO naturalezas físicas:

  - CONJUNTO        → conjunto/estructura interna de un mueble (estante,
                      cajonera, cajón de Nivel 3/4). Es PURA ESTRUCTURA: se
                      excluye de la SECCIÓN 3 del listado de Objetos, de las
                      bandejas de «por ubicar» y de la Mudanza Inter-Estok.
  - MUEBLE_INMUEBLE → mueble FIJO adherido a su cuarto (ropero empotrado).
                      Anclado: nunca se arrastra ni se elimina. Fuerza
                      `es_inmueble = True`.
  - MUEBLE_MOVIL    → mueble mudable (ropero espejo, archivador). Listado en la
                      SECCIÓN 3 y único mueble mudable del inventario.
  - CAJA            → contenedor móvil de inventario (SECCIÓN 1).
  - OBJETO          → contenedor que representa un ítem fino suelto.

REGLA DE FÍSICA (restricción de arrastre y eliminación):
  - MOVILES = CAJA, OBJETO, MUEBLE_MOVIL → se mudan entre cuartos y Estoks.
  - ANCLADOS = CONJUNTO, MUEBLE_INMUEBLE → bloqueados ante acciones de
    arrastre o eliminación FUERA de su cuarto de origen, y omitidos por
    completo de las bandejas de «Elementos por ubicar» y de las columnas de
    mudanza cruzada.

Este módulo es el ÚNICO origen de la clasificación automática: lo usan el
modelo `Contenedor` (al crear desde cualquier modal/botonera/servicio) y los
serializers/viewsets. NO define ni importa modelos, para poder reutilizarse sin
acoplamiento circular; el sondeo de jerarquía contra la base vive en
`inventario/services/transito_interno.py`.
"""

import re

# Sólo el constructor `Q` del ORM: este módulo NO importa modelos del proyecto,
# así que el aislamiento anti-circular del encabezado queda intacto.
from django.db.models import Q

TIPO_CONJUNTO = 'CONJUNTO'
TIPO_MUEBLE_INMUEBLE = 'MUEBLE_INMUEBLE'
TIPO_MUEBLE_MOVIL = 'MUEBLE_MOVIL'
TIPO_CAJA = 'CAJA'
TIPO_OBJETO = 'OBJETO'

# Lista canónica de los 5 tipos (whitelist de validación de los serializers).
TIPOS = (
    TIPO_CONJUNTO,
    TIPO_MUEBLE_INMUEBLE,
    TIPO_MUEBLE_MOVIL,
    TIPO_CAJA,
    TIPO_OBJETO,
)

# Clasificación por física de traslado: ÚNICA regla del backend.
TIPOS_ANCLADOS = (TIPO_CONJUNTO, TIPO_MUEBLE_INMUEBLE)
TIPOS_MOVILES = (TIPO_CAJA, TIPO_OBJETO, TIPO_MUEBLE_MOVIL)
TIPOS_MUEBLE = (TIPO_MUEBLE_MOVIL, TIPO_MUEBLE_INMUEBLE)
# Solo estos elementos pueden quedar «En Tránsito Interno» al soltarse dentro
# de un mueble anfitrión con sub-divisiones, sin estante definitivo.
TIPOS_TRANSITO_INTERNO = (TIPO_CAJA, TIPO_OBJETO)

# Rótulos por defecto de las botoneras/motores de creación vigentes:
#   visorHabitacion  → "Mueble 1"
#   visorContenedor* → "Estante 1" / "Estante F2·C1"
#   wizard Mapa Estok→ "Mueble F1·C2" / "Estantería F2·C1"
#   almacenamiento   → "Mueble F1·C2" (mueble encastrado en la grilla)
RE_NOMBRE_MUEBLE = re.compile(r'^mueble(\s|$)', re.IGNORECASE)
RE_NOMBRE_ESTANTE = re.compile(
    r'^(estante|estanter[ií]a|cajonera|caj[oó]n)(\s|$)', re.IGNORECASE,
)
# Rótulos de muebles EMPOTRADOS/FIJOS (Nivel 3 estructural): un placard, un
# ropero empotrado o una alacena son estructuras ANCLADAS al ambiente. Nunca
# deben degradarse a CAJA (ítem de stock móvil) ni emitir un Objeto espejo.
RE_NOMBRE_MUEBLE_INMUEBLE = re.compile(
    r'^(placard|ropero|armario|alacena|vestidor|closet|empotrad[oa]|'
    r'biblioteca|vitrina|escritorio fijo|modulo)(\s|$)',
    re.IGNORECASE,
)

# =====================================================================
# RÓTULO DE CAJA («Caja 02», «Cajas 03», «Caja de herramientas»)
# ---------------------------------------------------------------------
# Tercera vía de declaración de una CAJA: el operador la crea desde la
# botonera y el NOMBRE es la única señal persistida. La regla es el PREFIJO
# «Caja»/«Cajas»: todo registro cuyo rótulo EMPIEZA por esa palabra es un
# bulto contenedor y jamás un objeto suelto (clasificación definitiva: el
# operador no debe marcar ningún checkbox a mano).
# Fuente ÚNICA del patrón en el backend: la consumen la clasificación de
# Objetos (`arbol_inventario_objetos_contenedor`, `clasificacion_contenedor_
# objeto`), el filtro de la canasta (`api/viewsets/organizacion/filtros_
# bandeja`) y los filtros ORM de la API.
# Espejo en el cliente: `frontend/src/lib/taxonomiaContenedor.ts`.
# =====================================================================
PATRON_NOMBRE_CAJA = r'^\s*cajas?'
RE_NOMBRE_CAJA = re.compile(PATRON_NOMBRE_CAJA, re.IGNORECASE)

# Categoría organizativa de los bultos contenedores («Cajas y Contenedores» y
# sus variantes manuales: «Cajas / Contenedores», «Cajas/Contenedor»…).
# El patrón VIGENTE es `PATRON_CATEGORIA_CONTENEDOR` (más abajo): cubre también
# «Cajas», «Baúles», «Organizadores», «Maletas»… Este se conserva por
# compatibilidad con los módulos que lo importan como referencia.
PATRON_CATEGORIA_CAJA = r'^cajas?\s*(?:y|/)\s*contenedores?$'


def es_nombre_de_mueble(nombre):
    """True si el rótulo es el de un mueble por defecto ("Mueble 1"/"Mueble F1·C2")."""
    return bool(RE_NOMBRE_MUEBLE.match(str(nombre or '').strip()))


def es_nombre_de_mueble_inmueble(nombre):
    """True si el rótulo es el de un mueble EMPOTRADO/FIJO (placard, alacena…)."""
    return bool(RE_NOMBRE_MUEBLE_INMUEBLE.match(str(nombre or '').strip()))


def es_nombre_de_estante(nombre):
    """True si el rótulo es el de una sub-división ("Estante 1"/"Estantería F2·C1")."""
    return bool(RE_NOMBRE_ESTANTE.match(str(nombre or '').strip()))


def es_nombre_de_caja(nombre) -> bool:
    """True si el rótulo EMPIEZA por «Caja»/«Cajas» («Caja 02», «Cajas 03»…)."""
    return bool(RE_NOMBRE_CAJA.match(str(nombre or '').strip()))


# =====================================================================
# CATEGORÍAS QUE DECLARAN SUS OBJETOS COMO CONTENEDOR
# =====================================================================
# Nombres (normalizados: minúsculas y sin acentos) de las categorías que
# autorizan a marcar `Objeto.es_contenedor = True` SIN checkbox manual (ver
# `clasificacion_contenedor_objeto.declara_contenedor`).
#
# Además de la categoría organizativa completa se aceptan los nombres cortos
# que el operador crea a mano («Cajas», «Baúles», «Organizadores», «Maletas»…):
# son las ÚNICAS categorías que declaran bultos contenedores.
#
# ⚠️ NO usar `Categoria.es_contenedor` para esta decisión: ese campo significa
# «categoría de Mercado Libre que contiene subcategorías» y la siembra oficial
# lo deja en True para TODAS las categorías (Muebles, Materiales, Electrónica…).
# Leerlo acá convertía cualquier objeto con categoría en caja
# (bug real: una escalera y una mesa aparecieron en «📦 Cajas e Inventario
# Interno»). Ver `management/commands/corregir_es_contenedor.py`.
NOMBRES_CATEGORIA_CONTENEDOR = (
    'cajas y contenedores',
    'cajas y contenedor',
    'cajas / contenedores',
    'cajas/contenedores',
    'contenedores',
    'contenedor',
    'organizadores',
    'organizador',
    'cajas',
    'caja',
    'baules',
    'baul',
    'maletas',
    'maleta',
    'valijas',
    'valija',
    'canastos',
    'canasto',
)
CATEGORIAS_QUE_DECLARAN_CONTENEDOR = frozenset(NOMBRES_CATEGORIA_CONTENEDOR)

# Cada vocal admite su versión acentuada, así «Baúles»/«Baules» y
# «Organización»… se reconocen sin depender de `unaccent` (PostgreSQL/SQLite).
_VOCAL_TOLERANTE = {
    'a': '[aá]', 'e': '[eé]', 'i': '[ií]', 'o': '[oó]', 'u': '[uú]',
}


def _variante_regex(nombre):
    """Regex de un nombre normalizado, tolerante a tildes («baules» → «ba[uú]les»)."""
    partes = []
    for caracter in nombre:
        if caracter == ' ':
            # Cualquier cantidad de espacios: «Cajas  y  Contenedores».
            partes.append(r'\s+')
            continue
        partes.append(_VOCAL_TOLERANTE.get(caracter, re.escape(caracter)))
    return ''.join(partes)


# Patrón ÚNICO de categoría contenedora: lo usan el predicado de Python
# (`es_categoria_que_declara_contenedor`) y el filtro ORM (`qe_categoria_de_caja`),
# así la regla no puede divergir entre el listado y la validación.
PATRON_CATEGORIA_CONTENEDOR = r'^\s*(?:%s)\s*$' % '|'.join(
    _variante_regex(nombre) for nombre in NOMBRES_CATEGORIA_CONTENEDOR
)
RE_CATEGORIA_CONTENEDOR = re.compile(
    PATRON_CATEGORIA_CONTENEDOR, re.IGNORECASE,
)


def es_categoria_que_declara_contenedor(nombre) -> bool:
    """
    True si el NOMBRE de la categoría declara bultos contenedores.

    Regla ÚNICA compartida por el serializer, la señal post_save, el listado
    jerárquico, el filtro ORM de cajas y el comando de reparación de datos.
    """
    return bool(RE_CATEGORIA_CONTENEDOR.match(str(nombre or '').strip()))


def es_categoria_de_caja(nombre) -> bool:
    """
    [ALIAS] Misma regla que `es_categoria_que_declara_contenedor`.

    Se conserva el nombre histórico para los importadores existentes, pero
    ahora cubre TODAS las categorías contenedoras («Cajas», «Baúles»,
    «Organizadores», «Maletas»…) y no sólo «Cajas y Contenedores».
    """
    return es_categoria_que_declara_contenedor(nombre)


def qe_nombre_de_caja(campo='nombre'):
    """
    Q ORM de «el rótulo del registro EMPIEZA por «Caja»/«Cajas»».

    Permite que PostgreSQL reconozca como CAJA a una pieza cuyo único indicio
    persistido es el nombre (Cajas creadas sin marca ni categoría), sin
    traer filas a Python. `__iregex` está soportado tanto en PostgreSQL como en
    el SQLite de desarrollo (Django registra la función REGEXP).
    """
    return Q(**{f'{campo}__iregex': PATRON_NOMBRE_CAJA})


def qe_categoria_de_caja(campo='categoria__nombre'):
    """
    Q ORM de «la categoría del registro declara bultos contenedores».

    Usa el MISMO patrón que el predicado de Python (categorías contenedoras
    explícitas, tolerante a tildes), para que el filtro del listado y la
    validación del alta no puedan divergir.
    """
    return Q(**{f'{campo}__iregex': PATRON_CATEGORIA_CONTENEDOR})


def inferir_tipo_contenedor(contenedor, *, tipo_explicito=False):
    """
    Resuelve el tipo taxonómico legítimo de un Contenedor al CREARLO.

    Reglas (en orden de prioridad):

      1. `tipo_explicito=True` → se respeta el valor enviado por el cliente.
      2. `es_inmueble=True`    → MUEBLE_INMUEBLE (mueble fijo del cuarto).
      3. Rótulo "Estante/Estantería/Cajonera/Cajón ..." → CONJUNTO.
      4. `parent_contenedor` definido → CONJUNTO (conjunto/estructura interna
         del mueble anfitrión; Nivel 3/4).
      5. Rótulo "Mueble ..."   → MUEBLE_MOVIL.
      6. Encastrado en la grilla de la habitación (`parent_grid_row/col`) →
         MUEBLE_MOVIL.
      7. Resto → CAJA (contenedor móvil de objetos).

    Un mueble raíz MUDABLE (`es_inmueble=False`) es SIEMPRE MUEBLE_MOVIL,
    tenga o no sub-divisiones internas: sus CONJUNTOS viajan con él en
    cascada, sin alterar su condición de mudable.
    """
    if tipo_explicito and getattr(contenedor, 'tipo', None):
        return contenedor.tipo

    if getattr(contenedor, 'es_inmueble', False):
        return TIPO_MUEBLE_INMUEBLE

    nombre = getattr(contenedor, 'nombre', '')
    if es_nombre_de_estante(nombre):
        return TIPO_CONJUNTO

    if getattr(contenedor, 'parent_contenedor_id', None):
        return TIPO_CONJUNTO

    if es_nombre_de_mueble_inmueble(nombre):
        return TIPO_MUEBLE_INMUEBLE

    if es_nombre_de_mueble(nombre):
        return TIPO_MUEBLE_MOVIL

    if (
        getattr(contenedor, 'parent_grid_row', None) is not None
        or getattr(contenedor, 'parent_grid_col', None) is not None
    ):
        return TIPO_MUEBLE_MOVIL

    return TIPO_CAJA


def es_mueble(pieza):
    """True si la pieza es un mueble (MUEBLE_MOVIL o MUEBLE_INMUEBLE)."""
    return getattr(pieza, 'tipo', None) in TIPOS_MUEBLE


def es_caja_movil(pieza):
    """
    True si la pieza es una CAJA móvil: CONTENIDO puro del inventario.

    Una caja móvil (`tipo='CAJA'` y `es_inmueble=False`) es un contenedor
    pequeño de objetos que el operador mueve de un lugar a otro. NUNCA es una
    división/estante estructural de un mueble ni un espacio fijo del plano, por
    lo que su Drop jamás puede alterar la cuadrícula de divisiones del mueble
    anfitrión. Es la ÚNICA definición del concepto en todo el backend (la usan
    el serializer y el endpoint de actualización de almacenamiento).
    """
    return (
        getattr(pieza, 'tipo', None) == TIPO_CAJA
        and not getattr(pieza, 'es_inmueble', False)
    )


def es_movible(pieza):
    """
    True si la pieza es MOVIBLE: CAJA, OBJETO o MUEBLE_MOVIL (y no anclada).

    Es la whitelist POSITIVA de la física de traslado: los elementos movibles
    son los ÚNICOS que pueden mudarse entre cuartos y Estoks, y los únicos que
    deben listarse en las bandejas de «Elementos por ubicar» y en las columnas
    de la mudanza cruzada. Su complemento son los tipos ANCLADOS
    (CONJUNTO, MUEBLE_INMUEBLE) más cualquier `es_inmueble=True`.
    """
    return (
        not es_anclado(pieza)
        and getattr(pieza, 'tipo', None) in TIPOS_MOVILES
    )


def es_anclado(pieza):
    """
    True si la pieza está ANCLADA a su cuarto de origen.

    Los tipos CONJUNTO (estructura interna del mueble) y MUEBLE_INMUEBLE
    (mueble fijo adherido al cuarto) quedan estrictamente BLOQUEADOS ante
    acciones de arrastre o eliminación fuera de su cuarto de origen y se
    omiten por completo de las bandejas y de la mudanza cruzada. Un
    `es_inmueble=True` es anclado por definición, sin importar su tipo.
    """
    if getattr(pieza, 'es_inmueble', False):
        return True
    return getattr(pieza, 'tipo', None) in TIPOS_ANCLADOS


def es_pieza_estructural(pieza):
    """
    True si la pieza es FIJA y dueña de su grilla de casilleros.

    Un mueble (MUEBLE_MOVIL / MUEBLE_INMUEBLE), su mueble inmueble
    (`es_inmueble=True`) o una de sus sub-divisiones internas (CONJUNTO)
    mapean su propia cuadrícula de casilleros (`parent_grid_row/col`): esa
    grilla es EXCLUSIVA del mueble y sólo sirve para mapear coordenadas y
    saber qué sección del minimapa resaltar.
    """
    return es_anclado(pieza) or es_mueble(pieza)


# =====================================================================
# ARQUITECTURA FIJA EN UN PLANO (geometría elástica persistida)
# ---------------------------------------------------------------------
# Un contenedor que TIENE coordenadas geométricas propias dentro de un plano
# (ui_left/ui_top fuera del origen, o una altura MODELADA distinta de 'auto')
# es una pieza FIJA de la arquitectura: ocupa un lugar clavado en el lienzo de
# su cuarto/mueble y por lo tanto NUNCA es un bulto transportable. Los
# «Espacios» de las habitaciones nacen así (tipo=CAJA sin sub-divisiones con
# ui_left='6%', ui_top='8%', ui_height='24%'), y sin esta regla contaminaban
# la canasta de «Elementos por ubicar».
#
# `ui_width` queda FUERA del veredicto a propósito: su default de modelo es
# '100%' (no cero) en TODOS los contenedores, así que no distingue una pieza
# modelada de un bulto suelto; la POSICIÓN (ui_left/ui_top) y la ALTURA
# modelada sí lo hacen.
# =====================================================================
CAMPOS_GEOMETRIA_FIJA = ('ui_left', 'ui_top', 'ui_height')

# Valores que significan «sin geometría»: default del modelo o cero exacto.
VALORES_SIN_GEOMETRIA = (
    '', '0', '0%', '0px', 'auto',
    '0.0', '0.0%', '0.00', '0.00%',
)


def tiene_geometria_de_plano(pieza):
    """
    True si la pieza posee coordenadas geométricas FIJAS en un plano.

    Regla matemática estricta: cualquier `ui_*` posicional distinto de
    cero/nulo (o una altura modelada distinta de 'auto') declara la pieza como
    ARQUITECTURA FIJA del lienzo, excluida de las bandejas de elementos
    movibles. Espejo exacto del cliente
    (`lib/taxonomiaContenedor.tieneGeometriaDePlano`).
    """
    def desviado(valor):
        crudo = str(valor if valor is not None else '').strip().lower()
        return crudo not in VALORES_SIN_GEOMETRIA

    return any(
        desviado(getattr(pieza, campo, None)) for campo in CAMPOS_GEOMETRIA_FIJA
    )


# =====================================================================
# ESPEJO ORM DEL PREDICADO ANTERIOR (para los `get_queryset` de los viewsets)
# ---------------------------------------------------------------------
# Misma regla matemática, expresada como `Q` de Django: la usan los filtros
# `?movibles=true` y `?bandeja=true` de Contenedor para DESCARTAR en PostgreSQL
# (no en Python) la arquitectura clavada en el lienzo. Se movió acá desde
# viewsets/organizacion/contenedores.py (Lote 27) para que el predicado y su
# espejo vivan juntos y para sostener el límite de 400 líneas de ese archivo.
# =====================================================================

def qe_geometria_de_plano():
    """
    Q ORM de «la pieza posee geometría FIJA en un plano».

    Cualquier `ui_*` posicional distinto de cero/nulo (o una altura modelada
    distinta de 'auto') marca la pieza como arquitectura clavada en el lienzo.
    """
    qe = Q()
    for campo in CAMPOS_GEOMETRIA_FIJA:
        qe |= Q(**{f'{campo}__isnull': False}) & ~Q(**{f'{campo}__in': VALORES_SIN_GEOMETRIA})
    return qe
