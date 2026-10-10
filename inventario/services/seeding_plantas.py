"""
Seeding canónico de las plantas (divisiones raíz) de un Estok multi-planta.

Al fundarse un Estok con MÁS de una planta (`cantidad_pisos > 1`), el backend
materializa en PostgreSQL, en UNA sola transacción, las N divisiones reales del
inmueble (una por planta) y fija `grid_filas = cantidad_pisos` para que el
macro-plano nazca coherente con la cantidad de pisos declarada.

Etiquetas canónicas (caso estricto de 2 plantas):
  - fila 1 (arriba) → «Planta Alta»
  - fila 2 (abajo)  → «Planta Baja»

Esto desterró el alta "en blanco": el modelador interactivo de Almacenamiento
recibe la casa con sus plantas ya dibujadas, listas para encastar habitaciones.
Módulo FUENTE ÚNICA: lo consume EstokCreateSerializer (alta de usuario/admin).
"""

from django.db import transaction

from ..models import Ubicacion

# =============================================================================
# ETIQUETAS CANÓNICAS
# =============================================================================

# Caso estricto de 2 plantas: los nombres son EXACTOS (Ignacio).
ETIQUETAS_DOS_PLANTAS = {
    1: 'Planta Alta',
    2: 'Planta Baja',
}


def etiqueta_canonica(fila: int, total: int) -> str:
    """
    Nombre canónico de la planta de la `fila` indicada (1-based) para un inmueble
    de `total` plantas. Para 2 plantas devuelve el par exacto «Planta Alta» /
    «Planta Baja»; para el resto, un nombre estable por fila.
    """
    if total == 2:
        return ETIQUETAS_DOS_PLANTAS.get(fila, f'Planta {fila}')
    if fila == 1:
        return 'Planta Alta'
    if fila == total:
        return 'Planta Baja'
    return f'Planta {fila}'


# =============================================================================
# SERVICIO
# =============================================================================

@transaction.atomic
def sembrar_plantas_canonicas(estok):
    """
    Siembra las N divisiones raíz del Estok (N = `cantidad_pisos`) de forma
    atómica. Idempotente: si una fila ya tiene su división raíz, no la duplica.

    Devuelve la cantidad de divisiones efectivamente sembradas (0 si el Estok es
    de una sola planta o si ya estaban todas creadas).
    """
    try:
        total = int(estok.cantidad_pisos or 1)
    except (TypeError, ValueError):
        total = 1

    # Modo Planta Única (1 piso): el contenedor «Departamento» se crea perezoso
    # desde el front; acá no se siembra nada.
    if total <= 1:
        return 0

    creadas = 0
    for fila in range(1, total + 1):
        ya_existe = Ubicacion.objects.filter(
            estok=estok,
            parent_ubicacion__isnull=True,
            parent_grid_row=fila,
        ).exists()
        if ya_existe:
            continue
        Ubicacion.objects.create(
            nombre=etiqueta_canonica(fila, total),
            estok=estok,
            piso='PRIMER_PISO' if fila == 1 else 'PLANTA_BAJA',
            parent_grid_row=fila,
            parent_grid_col=1,
            grid_colspan=1,
            grid_rowspan=1,
        )
        creadas += 1

    # grid_filas = cantidad_pisos (el macro-plano se abre en N filas = plantas).
    if estok.grid_filas != total:
        estok.grid_filas = total
        estok.save(update_fields=['grid_filas', 'updated_at'])

    return creadas
