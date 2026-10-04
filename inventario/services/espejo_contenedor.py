"""
Regla ÚNICA del backend para detectar los REGISTROS ESPEJO de un Contenedor.

CONTEXTO (REGLA DE DUALIDAD Contenedor + Objeto):
al crear un mueble/caja RAÍZ mudable, `organizacion._crear_registro_espejo_mudable`
inserta un Objeto VINCULADO al Contenedor para que el mueble sea 100% mudable en
la Mudanza Inter-Estok. Ese registro NO es un ítem de stock: solo duplica un
ESPACIO físico (mueble, caja, estantería).

EL BUG HISTÓRICO: la detección por IGUALDAD DE NOMBRE del criterio original falla
apenas el operador RENOMBRA el contenedor. Por ejemplo, el contenedor «Mueble 2»
pasó a llamarse «Cama cucheta» pero su espejo conservó el rótulo viejo, así que
`nombre = contenedor__nombre` era FALSO y el espejo sobrevivía al filtro,
apareciendo como una tarjeta «Mueble 2» fantasma en el tablero de Decisiones.

REGLA ROBUSTA (NO depende del nombre): un Objeto es ESPEJO —y por lo tanto NO es
un OBJETO final puro del inventario— cuando:
    1. Tiene contenedor (no está suelto).
    2. NO ocupa un casillero (parent_grid_row/parent_grid_col nulos): no está
       guardado de forma fina dentro del espacio.
    3. Y además (a) NO está clasificado como ítem (categoria nula) — esto cubre
       el espejo RENOMBRADO —, o (b) conserva el nombre homónimo de su contenedor
       y ese contenedor es un ESPACIO estructural (defensa en profundidad del
       criterio original e inmune a futuros cambios).

Validado en producción: excluye los 11 espejos (incluidos «Baul», «Escritorio
Pintura», «Cama cucheta»…) y conserva los 68 objetos reales del inventario.

Este módulo es puro respecto de los modelos (solo construye un `Q` de ORM); no
importa modelos para poder reutilizarse sin acoplamiento circular.
"""

from django.db.models import F, Q

from .taxonomia_contenedor import (
    TIPO_CAJA,
    TIPO_CONJUNTO,
    TIPO_MUEBLE_INMUEBLE,
    TIPO_MUEBLE_MOVIL,
)

# Tipos de Contenedor que representan un ESPACIO físico (jamás un ítem final).
TIPOS_ESPACIO = (
    TIPO_CONJUNTO,
    TIPO_MUEBLE_INMUEBLE,
    TIPO_MUEBLE_MOVIL,
    TIPO_CAJA,
)


def q_objeto_es_espejo():
    """
    `Q` de ORM que marca los registros ESPEJO (duales) de un Contenedor.

    Se usa con `.exclude(q_objeto_es_espejo())` para dejar SOLO los objetos
    finales del inventario. Funciona en cualquier jerarquía: no exige que el
    contenedor sea raíz ni mudable, a diferencia del criterio anterior.
    """
    return (
        Q(contenedor__isnull=False)
        & Q(parent_grid_row__isnull=True)
        & Q(parent_grid_col__isnull=True)
        & (
            Q(categoria__isnull=True)
            | (
                Q(nombre=F('contenedor__nombre'))
                & Q(contenedor__tipo__in=TIPOS_ESPACIO)
            )
        )
    )
