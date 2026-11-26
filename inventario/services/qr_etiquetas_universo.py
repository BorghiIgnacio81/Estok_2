"""
UNIVERSO ÚNICO DE CAJAS IMPRIMIBLES del modal «🖨️ Imprimir QRs».

POR QUÉ EXISTE
    El modal de /almacenamiento y /objetos listaba sólo los `Contenedor` que
    entraban por los canales de reconocimiento de la canasta «Elementos por
    ubicar» (`?bandeja=true`). Las cajas que el operador registró como OBJETO
    (`Objeto.es_contenedor=True`, p. ej. «Caja de adaptadores y cables» o «Caja
    Colección de revistas ¡HOLA! Argentina») NO son `Contenedor`: viven en la
    SECCIÓN 1 de /objetos y jamás aparecían en la lista de impresión, aunque su
    tarjeta sí se puede rotular con QR. Además, una caja de lote fotografiado
    (`esta_llena=True`) podía quedar fuera si no estaba declarada movible.

REGLA ÚNICA (sin mirar la CATEGORÍA temática de ningún registro)
    Es caja imprimible todo registro que cumpla AL MENOS una condición:

      · `Contenedor` con `tipo='CAJA'`, `es_inmueble=False` (tipo_entidad
        'caja') reconocido por la canasta —declaración explícita, tránsito
        interno, rótulo «Caja…» o limbo— **o** marcado `esta_llena=True`.
      · `Objeto` con `es_contenedor=True` **o** `esta_llena=True`
        (tipo_entidad 'objeto'), esté donde esté y con la categoría que tenga
        («Revistas», «Electrónica», «Libros»… da igual).

    Los ESPEJOS de dualidad Contenedor⇄Objeto se excluyen SIEMPRE: su caja real
    ya es un `Contenedor` propio y se imprimiría dos veces el mismo bulto.

    Lo usan los DOS extremos del modal, para que la lista que ve el operador y
    el PDF que recibe no puedan divergir:
      · GET /api/cajas/etiquetas_qr/            (listado del modal)
      · GET /api/cajas/generar_pdf_qr/          (PDF A4 + marca `qr_impreso`)

CONTRATO DE SALIDA
    `CajaEtiquetaQr` es el DTO que consumen el generador de PDF y el listado:
    expone `id`, `nombre`, `tipo_entidad`, `qr_impreso` y la ruta de ubicación
    ya resuelta (`ubicacion_nombre` / `parent_contenedor_nombre`), sin importar
    si el registro físico es un `Contenedor` o un `Objeto`.
"""

from dataclasses import dataclass
from uuid import UUID

from django.db.models import Q

from ..models import Contenedor, Objeto
from .espejo_contenedor import q_objeto_espejo_explicito
from .taxonomia_contenedor import TIPO_CAJA
from .ubicacion_objeto import ruta_ubicacion_objeto

# Tipos de entidad del payload (mismo vocabulario que el arrastre del frontend:
# lib/arrastreEntidad.ts → 'caja' | 'objeto' | 'espacio').
TIPO_ENTIDAD_CAJA = 'caja'
TIPO_ENTIDAD_OBJETO = 'objeto'

# Filtros del modal (contrato de la query string).
FILTRO_TODAS = 'todas'
FILTRO_NUEVAS = 'nuevas'
FILTRO_MANUAL = 'manual'


@dataclass(frozen=True)
class CajaEtiquetaQr:
    """
    Caja imprimible normalizada (Contenedor ⇄ Objeto) para el PDF de etiquetas.

    `id` es el UUID REAL del registro físico: es lo que viaja en la selección
    manual (`?ids=`) y lo que se codifica dentro del QR.
    """

    id: UUID
    nombre: str
    tipo_entidad: str
    qr_impreso: bool
    ubicacion_nombre: str | None
    parent_contenedor_nombre: str | None

    def como_dict(self) -> dict:
        """Contrato JSON del listado del modal (GET /api/cajas/etiquetas_qr/)."""
        return {
            'id': str(self.id),
            'nombre': self.nombre,
            'tipo_entidad': self.tipo_entidad,
            'qr_impreso': bool(self.qr_impreso),
            'ubicacion_nombre': self.ubicacion_nombre,
            'parent_contenedor_nombre': self.parent_contenedor_nombre,
        }



# =============================================================================
# QUERYSETS DEL UNIVERSO
# =============================================================================
def _contenedores_imprimibles(estok_id):
    """
    `Contenedor` imprimibles del Estok: cajas reconocidas ∪ cajas de lote.

    La regla de reconocimiento es la MISMA de la canasta «Elementos por ubicar»
    (`aplicar_filtro_bandeja`), para no degradar el universo que ya funcionaba.
    Se suma cualquier caja declarada LLENA (`esta_llena=True`): una caja con el
    contenido fotografiado como lote es un bulto real aunque su movilidad no se
    haya declarado nunca.

    El import de `aplicar_filtro_bandeja` es TARDÍO a propósito: ese módulo vive
    en el paquete de viewsets, que a su vez importa este servicio (vía
    `qr_etiquetas_acciones`). Importarlo en el encabezado cerraría un ciclo.
    """
    from ..api.viewsets.organizacion.filtros_bandeja import aplicar_filtro_bandeja

    base = (
        Contenedor.objects
        .select_related('ubicacion', 'parent_contenedor')
        .filter(ubicacion__estok_id=estok_id, tipo=TIPO_CAJA, es_inmueble=False)
    )
    reconocidas = aplicar_filtro_bandeja(base, estok_id)
    llenas = base.filter(esta_llena=True)
    return (reconocidas | llenas).distinct().order_by('nombre')


def _objetos_imprimibles(estok_id):
    """
    `Objeto` declarados CAJA (o caja de lote) del Estok, sin filtro de categoría.

    La tenencia replica `arbol_inventario_datos.objetos_contenedor_del_estok`:
    un registro histórico sin `estok_id` se recupera por la habitación o por el
    contenedor que lo aloja. Los espejos de dualidad quedan fuera (su caja real
    es un `Contenedor` y se imprimiría dos veces).
    """
    tenencia = (
        Q(estok_id=estok_id)
        | Q(estok__isnull=True, ubicacion__estok_id=estok_id)
        | Q(estok__isnull=True, contenedor__ubicacion__estok_id=estok_id)
    )
    return (
        Objeto.objects
        .select_related('ubicacion', 'contenedor', 'contenedor__ubicacion', 'objeto_padre')
        .filter(deleted_at__isnull=True)
        .filter(tenencia)
        .filter(Q(es_contenedor=True) | Q(esta_llena=True))
        .exclude(q_objeto_espejo_explicito())
        .order_by('nombre')
    )


# =============================================================================
# NORMALIZACIÓN AL DTO
# =============================================================================
def _nombre_de(pieza) -> str | None:
    """Nombre legible de una pieza espacial (None si no tiene)."""
    nombre = str(getattr(pieza, 'nombre', '') or '').strip()
    return nombre or None


def _padre_de_contenedor(contenedor) -> str | None:
    """Mueble/caja que aloja al contenedor (sólo el padre inmediato)."""
    if not getattr(contenedor, 'parent_contenedor_id', None):
        return None
    return _nombre_de(getattr(contenedor, 'parent_contenedor', None))


def _desde_contenedor(contenedor) -> CajaEtiquetaQr:
    """DTO de un `Contenedor` (caja física del tablero de Almacenamiento)."""
    return CajaEtiquetaQr(
        id=contenedor.id,
        nombre=_nombre_de(contenedor) or 'Caja sin nombre',
        tipo_entidad=TIPO_ENTIDAD_CAJA,
        qr_impreso=bool(contenedor.qr_impreso),
        ubicacion_nombre=_nombre_de(getattr(contenedor, 'ubicacion', None)),
        parent_contenedor_nombre=_padre_de_contenedor(contenedor),
    )


def _desde_objeto(objeto) -> CajaEtiquetaQr:
    """
    DTO de un `Objeto` declarado caja (SECCIÓN 1 de /objetos).

    Ruta de ubicación: la habitación propia del objeto o, si no la tiene, la del
    contenedor que lo aloja; después el contenedor / espacio lógico inmediato.
    """
    ubicacion = _nombre_de(getattr(objeto, 'ubicacion', None))
    contenedor = getattr(objeto, 'contenedor', None)
    if ubicacion is None and contenedor is not None:
        ubicacion = _nombre_de(getattr(contenedor, 'ubicacion', None))

    padre = _nombre_de(contenedor)
    if padre is None:
        padre = _nombre_de(getattr(objeto, 'objeto_padre', None))

    # Respaldo: si no hay habitación ni padre, la ruta completa del servicio de
    # ubicación evita imprimir «Sin ubicación» en una caja que sí tiene espacio.
    if ubicacion is None and padre is None:
        ubicacion = ruta_ubicacion_objeto(objeto) or None

    return CajaEtiquetaQr(
        id=objeto.id,
        nombre=_nombre_de(objeto) or 'Caja sin nombre',
        tipo_entidad=TIPO_ENTIDAD_OBJETO,
        qr_impreso=bool(getattr(objeto, 'qr_impreso', False)),
        ubicacion_nombre=ubicacion,
        parent_contenedor_nombre=padre,
    )


# =============================================================================
# API PÚBLICA
# =============================================================================
def construir_universo(estok_id) -> list[CajaEtiquetaQr]:
    """
    TODAS las cajas imprimibles del Estok activo, sin importar su categoría.

    Devuelve la lista ya normalizada y ordenada por nombre: el PDF y el listado
    del modal consumen exactamente la misma.
    """
    cajas = [_desde_contenedor(c) for c in _contenedores_imprimibles(estok_id)]
    cajas.extend(_desde_objeto(o) for o in _objetos_imprimibles(estok_id))
    return sorted(cajas, key=lambda caja: (caja.nombre or '').casefold())


def filtrar_universo(cajas, filtro=FILTRO_TODAS, ids=()):
    """
    Aplica el filtro del modal a la lista ya construida.

    `nuevas` deja sólo las que nunca se imprimieron (`qr_impreso=False`) y
    `manual` la selección explícita de `ids`. Un filtro desconocido no recorta
    nada: la validación estricta vive en la vista.
    """
    if filtro == FILTRO_NUEVAS:
        return [caja for caja in cajas if not caja.qr_impreso]
    if filtro == FILTRO_MANUAL:
        seleccion = {str(ident) for ident in ids}
        return [caja for caja in cajas if str(caja.id) in seleccion]
    return list(cajas)


def marcar_impresas(cajas) -> None:
    """
    Marca `qr_impreso=True` en las cajas incluidas en el PDF.

    Se escribe SIEMPRE por modelo (`Contenedor` y `Objeto`) con `update()`: no
    dispara señales y no toca ninguna otra columna.
    """
    ids_contenedor = [caja.id for caja in cajas if caja.tipo_entidad == TIPO_ENTIDAD_CAJA]
    ids_objeto = [caja.id for caja in cajas if caja.tipo_entidad == TIPO_ENTIDAD_OBJETO]
    if ids_contenedor:
        Contenedor.objects.filter(id__in=ids_contenedor).update(qr_impreso=True)
    if ids_objeto:
        Objeto.objects.filter(id__in=ids_objeto).update(qr_impreso=True)