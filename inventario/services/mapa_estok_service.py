"""
Persistencia atómica del Mapa de Estok (Wizard espacial multi-nivel).

Crea la jerarquía completa asociada a un Estok en UNA sola transacción:
  - Nivel 1: Ubicaciones división (parent_grid_row/col sobre el macro-plano).
  - Nivel 2: Ubicaciones habitación (parent_ubicacion = división).
  - Nivel 3: Contenedores mueble grande (ubicacion = habitación).
  - Nivel 4: Contenedores estantería (parent_contenedor = mueble grande).

Validación de coherencia: cada celda declara sus coordenadas
(parent_grid_row / parent_grid_col) y el servicio las contrasta contra la
grilla del nodo padre (filas × columnas, incluyendo configuraciones
asimétricas grid_filas_config), rechazando cualquier coordenada
inconsistente antes de insertar.
"""

from django.db import transaction
from rest_framework.exceptions import ValidationError

from ..models import Ubicacion, Contenedor

MAX_GRILLA = 12

NIVEL_2_KEY = 'nivel_2'
NIVEL_3_KEY = 'nivel_3'
NIVEL_4_KEY = 'nivel_4'


# =============================================================================
# HELPERS DE GRILLA
# =============================================================================

def _clamp(valor, nombre, por_defecto):
    try:
        entero = int(valor)
    except (TypeError, ValueError):
        raise ValidationError(f"{nombre} debe ser un entero.")
    return max(1, min(MAX_GRILLA, entero or por_defecto))


def _config_de_filas(config, filas, columnas):
    """Normaliza grid_filas_config a un arreglo de largo `filas` (o None si uniforme)."""
    if not config:
        return None
    if not isinstance(config, list) or len(config) != filas:
        raise ValidationError("grid_filas_config debe tener una entrada por fila.")
    normalizado = [_clamp(c, 'grid_filas_config', columnas) for c in config]
    if all(c == columnas for c in normalizado):
        return None
    return normalizado


def _columnas_por_fila(filas, columnas, config):
    if config:
        return [config[i] if i < len(config) else columnas for i in range(filas)]
    return [columnas] * filas


def _coordenadas_de_indice(indice, filas, columnas_por_fila):
    """Convierte un índice plano (0-based) en (fila, columna) 1-based."""
    fila = 1
    restante = indice
    while fila <= filas:
        cols = columnas_por_fila[fila - 1]
        if restante < cols:
            return fila, restante + 1
        restante -= cols
        fila += 1
    raise ValidationError("Hay más celdas que las permitidas por la grilla padre.")


def _validar_coordenadas(indice, filas, columnas_por_fila, fila_enviada, col_enviada):
    """Valida y devuelve las coordenadas (fila, columna) definitivas de una celda."""
    if fila_enviada is None or col_enviada is None:
        raise ValidationError(
            f"Cada celda debe declarar parent_grid_row y parent_grid_col (celda {indice + 1})."
        )
    fila_esperada, col_esperada = _coordenadas_de_indice(indice, filas, columnas_por_fila)
    if int(fila_enviada) != fila_esperada or int(col_enviada) != col_esperada:
        raise ValidationError(
            f"Coordenadas inconsistentes en la celda {indice + 1}: se esperaba "
            f"F{fila_esperada}·C{col_esperada} y se recibió F{fila_enviada}·C{col_enviada}."
        )
    return fila_esperada, col_esperada


def _grilla_de_celda(celda):
    """Normaliza la sub-grilla propia de una celda (filas, columnas, config, cols_por_fila)."""
    filas = _clamp(celda.get('grid_filas'), 'grid_filas', 3)
    columnas = _clamp(celda.get('grid_columnas'), 'grid_columnas', 3)
    config = _config_de_filas(celda.get('grid_filas_config'), filas, columnas)
    return filas, columnas, config, _columnas_por_fila(filas, columnas, config)


# =============================================================================
# SERVICIO PRINCIPAL
# =============================================================================

class MapaEstokService:
    """Crea la jerarquía espacial completa de un Estok en una sola transacción."""

    @staticmethod
    @transaction.atomic
    def guardar_mapa(estok, payload):
        """
        Crea Ubicaciones y Contenedores asociados herméticamente a `estok`.
        Lanza rest_framework.exceptions.ValidationError si la estructura
        es incoherente; en ese caso la transacción entera se revierte.
        """
        filas = _clamp(payload.get('grid_filas'), 'grid_filas', 2)
        columnas = _clamp(payload.get('grid_columnas'), 'grid_columnas', 2)
        config = _config_de_filas(payload.get('grid_filas_config'), filas, columnas)
        cols_por_fila = _columnas_por_fila(filas, columnas, config)

        total_ubicaciones = 0
        total_contenedores = 0

        for indice, celda in enumerate(payload.get('nivel_1') or []):
            fila, col = _validar_coordenadas(
                indice, filas, cols_por_fila,
                celda.get('parent_grid_row'), celda.get('parent_grid_col'),
            )
            division = Ubicacion.objects.create(
                nombre=celda['nombre'].strip() or f'División F{fila}·C{col}',
                estok=estok,
                piso='PRIMER_PISO' if fila == 1 else 'PLANTA_BAJA',
                parent_grid_row=fila,
                parent_grid_col=col,
                grid_colspan=1,
                grid_rowspan=1,
                **dict(zip(
                    ('grid_filas', 'grid_columnas', 'grid_filas_config'),
                    _grilla_de_celda(celda)[:3],
                )),
            )
            total_ubicaciones += 1
            total_ubicaciones += MapaEstokService._crear_habitaciones(division, celda)

        estok.grid_filas = filas
        estok.grid_columnas = columnas
        estok.grid_filas_config = config
        estok.save(update_fields=['grid_filas', 'grid_columnas', 'grid_filas_config', 'updated_at'])

        return {
            'estok_id': str(estok.id),
            'estok_nombre': estok.nombre,
            'grid_filas': filas,
            'grid_columnas': columnas,
            'ubicaciones_creadas': total_ubicaciones,
            'contenedores_creados': total_contenedores,
        }

    # ---------------------------------------------------------------------------
    # NIVEL 2: Habitaciones (Ubicacion con parent_ubicacion = división)
    # ---------------------------------------------------------------------------

    @staticmethod
    def _crear_habitaciones(division, celda):
        sub_filas, sub_columnas, sub_config, sub_cols_por_fila = _grilla_de_celda(celda)
        total = 0
        for indice, hijo in enumerate(celda.get(NIVEL_2_KEY) or []):
            fila, col = _validar_coordenadas(
                indice, sub_filas, sub_cols_por_fila,
                hijo.get('parent_grid_row'), hijo.get('parent_grid_col'),
            )
            habitacion = Ubicacion.objects.create(
                nombre=hijo['nombre'].strip() or f'Habitación F{fila}·C{col}',
                estok=division.estok,
                parent_ubicacion=division,
                parent_grid_row=fila,
                parent_grid_col=col,
                grid_colspan=1,
                grid_rowspan=1,
                **dict(zip(
                    ('grid_filas', 'grid_columnas', 'grid_filas_config'),
                    _grilla_de_celda(hijo)[:3],
                )),
            )
            total += 1
            total += MapaEstokService._crear_muebles(habitacion, hijo)
        return total

    # ---------------------------------------------------------------------------
    # NIVEL 3: Muebles grandes (Contenedor con ubicacion = habitación)
    # ---------------------------------------------------------------------------

    @staticmethod
    def _crear_muebles(habitacion, celda):
        sub_filas, sub_columnas, sub_config, sub_cols_por_fila = _grilla_de_celda(celda)
        total = 0
        for indice, hijo in enumerate(celda.get(NIVEL_3_KEY) or []):
            fila, col = _validar_coordenadas(
                indice, sub_filas, sub_cols_por_fila,
                hijo.get('parent_grid_row'), hijo.get('parent_grid_col'),
            )
            mueble = Contenedor.objects.create(
                nombre=hijo['nombre'].strip() or f'Mueble F{fila}·C{col}',
                ubicacion=habitacion,
                parent_contenedor=None,
                parent_grid_row=fila,
                parent_grid_col=col,
                **dict(zip(
                    ('grid_filas', 'grid_columnas', 'grid_filas_config'),
                    _grilla_de_celda(hijo)[:3],
                )),
            )
            total += 1
            total += MapaEstokService._crear_estanterias(mueble, hijo)
        return total

    # ---------------------------------------------------------------------------
    # NIVEL 4: Estanterías (Contenedor con parent_contenedor = mueble)
    # ---------------------------------------------------------------------------

    @staticmethod
    def _crear_estanterias(mueble, celda):
        sub_filas, sub_columnas, sub_config, sub_cols_por_fila = _grilla_de_celda(celda)
        total = 0
        for indice, hijo in enumerate(celda.get(NIVEL_4_KEY) or []):
            fila, col = _validar_coordenadas(
                indice, sub_filas, sub_cols_por_fila,
                hijo.get('parent_grid_row'), hijo.get('parent_grid_col'),
            )
            Contenedor.objects.create(
                nombre=hijo['nombre'].strip() or f'Estantería F{fila}·C{col}',
                ubicacion=mueble.ubicacion,
                parent_contenedor=mueble,
                parent_grid_row=fila,
                parent_grid_col=col,
                **dict(zip(
                    ('grid_filas', 'grid_columnas', 'grid_filas_config'),
                    _grilla_de_celda(hijo)[:3],
                )),
            )
            total += 1
        return total

