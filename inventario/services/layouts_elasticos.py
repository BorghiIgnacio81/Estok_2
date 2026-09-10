"""
Compatibilidad de layouts matriciales previos → diseño elástico 2D (ui_*).

Los Estoks creados con el diseño matricial anterior posicionaban cada elemento
por coordenadas de grilla (`parent_grid_row` / `parent_grid_col`, opcionalmente
con `grid_colspan` / `grid_rowspan` / `grid_filas_config`). El nuevo motor 2D
trabaja con geometría elástica relativa en porcentaje del lienzo
(`ui_left` / `ui_top` / `ui_width` / `ui_height`).

Este módulo recalcula la disposición vieja y puebla los campos ui_* de forma
proporcional (una celda de una grilla R×C ocupa 100/R % de alto y 100/C % de
ancho), garantizando que los layouts anteriores se actualicen de forma inmediata
y automática al nuevo sistema visual sin perder objetos ni romper el
aislamiento multi-tenant.

Idempotente: solo convierte registros que aún conservan `ui_height` vacío o
'en auto' (default histórico), que es la firma del layout matricial viejo.
"""


def _pct(valor):
    """Formatea un porcentaje elástico (string) redondeado a 2 decimales."""
    return f"{round(float(valor), 2)}%"


def geometria_elastica_desde_grilla(row, col, filas, columnas, colspan=1, rowspan=1):
    """
    Convierte una celda (fila, columna) 1-based de una grilla filas×columnas a
    geometría elástica relativa (porcentajes del lienzo contenedor).
    """
    filas = max(1, int(filas or 1))
    columnas = max(1, int(columnas or 1))
    fila = min(max(1, int(row or 1)), filas)
    columna = min(max(1, int(col or 1)), columnas)
    cs = max(1, int(colspan or 1))
    rs = max(1, int(rowspan or 1))

    ancho_celda = 100.0 / columnas
    alto_celda = 100.0 / filas
    return {
        'ui_left': _pct((columna - 1) * ancho_celda),
        'ui_top': _pct((fila - 1) * alto_celda),
        'ui_width': _pct(min(100.0, cs * ancho_celda)),
        'ui_height': _pct(min(100.0, rs * alto_celda)),
    }


def _columnas_de_fila(config, fila, columnas_default):
    """Columnas reales de una fila según `grid_filas_config` (grilla asimétrica)."""
    if isinstance(config, (list, tuple)) and 1 <= fila <= len(config):
        return max(1, int(config[fila - 1] or columnas_default or 1))
    return max(1, int(columnas_default or 1))


def _necesita_migracion(obj):
    """True si el registro sigue con el layout matricial (sin geometría elástica)."""
    alto = (obj.ui_height or '').strip().lower()
    return alto in ('', 'auto')


def _grilla_de_ubicacion(u):
    """Dimensiones (filas, columnas) del lienzo que contiene a la Ubicación."""
    padre = u.parent_ubicacion
    filas = (padre.grid_filas if padre else None) or u.grid_filas or 3
    col_default = (padre.grid_columnas if padre else None) or u.grid_columnas or 3
    config = padre.grid_filas_config if padre else u.grid_filas_config
    columnas = _columnas_de_fila(config, u.parent_grid_row or 1, col_default)
    return max(1, int(filas)), columnas


def _grilla_de_contenedor(c):
    """Dimensiones (filas, columnas) del lienzo que contiene al Contenedor.

    - Con `parent_contenedor`: la grilla interna del mueble padre.
    - Sin padre (mueble raíz en una habitación): la sub-grilla de la Ubicación.
    """
    if c.parent_contenedor_id:
        padre = c.parent_contenedor
        filas = padre.grid_filas or 3
        col_default = padre.grid_columnas or 3
        config = padre.grid_filas_config
    else:
        room = c.ubicacion
        filas = (room.grid_filas if room else None) or 3
        col_default = (room.grid_columnas if room else None) or 3
        config = room.grid_filas_config if room else None
    columnas = _columnas_de_fila(config, c.parent_grid_row or 1, col_default)
    return max(1, int(filas)), columnas


def migrar_ubicaciones(estok_id=None, dry_run=False):
    """Backfill de las Ubicaciones (habitaciones) con layout matricial previo."""
    from inventario.models import Ubicacion

    qs = Ubicacion.objects.filter(parent_grid_row__isnull=False)
    if estok_id:
        qs = qs.filter(estok_id=estok_id)

    cambiados = 0
    for u in qs.select_related('parent_ubicacion').iterator():
        if not _necesita_migracion(u):
            continue
        filas, columnas = _grilla_de_ubicacion(u)
        geo = geometria_elastica_desde_grilla(
            u.parent_grid_row, u.parent_grid_col or 1, filas, columnas,
            u.grid_colspan or 1, u.grid_rowspan or 1,
        )
        cambiados += 1
        if not dry_run:
            Ubicacion.objects.filter(pk=u.pk).update(**geo)
    return cambiados


def migrar_contenedores(estok_id=None, dry_run=False):
    """Backfill de los Contenedores (muebles y estantes internos) con layout previo."""
    from inventario.models import Contenedor

    qs = Contenedor.objects.filter(parent_grid_row__isnull=False)
    if estok_id:
        qs = qs.filter(ubicacion__estok_id=estok_id)

    cambiados = 0
    for c in qs.select_related('parent_contenedor', 'ubicacion').iterator():
        if not _necesita_migracion(c):
            continue
        filas, columnas = _grilla_de_contenedor(c)
        geo = geometria_elastica_desde_grilla(
            c.parent_grid_row, c.parent_grid_col or 1, filas, columnas,
        )
        cambiados += 1
        if not dry_run:
            Contenedor.objects.filter(pk=c.pk).update(**geo)
    return cambiados


def migrar_layouts(estok_id=None, dry_run=False):
    """Recalcula TODOS los layouts matriciales previos del Estok (o global)."""
    return {
        'ubicaciones': migrar_ubicaciones(estok_id, dry_run),
        'contenedores': migrar_contenedores(estok_id, dry_run),
        'dry_run': bool(dry_run),
    }
