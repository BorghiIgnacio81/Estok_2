"""
Bloques geométricos de ruta y paleta del INFORME PDF (ReportLab).

Módulo visual reutilizable: la paleta corporativa ámbar del inventario, el
cálculo de la RUTA ANALÍTICA de un objeto (Piso → Estok → División/Habitación
→ Mueble/Caja) y el flowable `BloqueRuta` que dibuja esa ruta como una cadena
de bloques unidos por flechas.

Lo consume inventario/services/informe_pdf_service.py. No toca la request ni
el ORM: es una capa puramente de dibujo.
"""

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus.flowables import Flowable

# =============================================================================
# PALETA CORPORATIVA (misma textura ámbar de la pantalla de inventario)
# =============================================================================
AMARILLO = colors.HexColor('#fde68a')
NARANJA = colors.HexColor('#fdba74')
AMBAR_CLARO = colors.HexColor('#fffbeb')
AMBAR_BORDE = colors.HexColor('#b45309')
TINTA = colors.HexColor('#111827')
GRIS = colors.HexColor('#6b7280')
BLANCO = colors.white
NEGRO = colors.black

ALTO_BLOQUE_RUTA = 15 * mm
MAX_PASOS_RUTA = 4


def recortar(texto: str, limite: int) -> str:
    """Recorta un texto largo con elipsis (los bloques tienen ancho fijo)."""
    texto = (texto or '').strip()
    return texto if len(texto) <= limite else texto[:limite - 1] + '…'


def ruta_de_objeto(objeto) -> list:
    """
    Pasos de la RUTA ANALÍTICA de un objeto como tuplas (etiqueta, valor),
    en el mismo orden que usan los minimapas del frontend:
    Piso → Estok → División → Habitación → Mueble/Caja.
    """
    estok = getattr(objeto, 'estok', None)
    ubicacion = getattr(objeto, 'ubicacion', None)
    contenedor = getattr(objeto, 'contenedor', None)

    if ubicacion is None and estok is None and contenedor is None:
        return [('Ubicación', 'Sin ubicación asignada')]

    pasos = []
    piso = ''
    if ubicacion is not None and hasattr(ubicacion, 'get_piso_display'):
        piso = ubicacion.get_piso_display() or ''
    if piso:
        pasos.append(('Piso', piso))
    if estok is not None:
        pasos.append(('Estok', estok.nombre))
    if ubicacion is not None:
        padre = getattr(ubicacion, 'parent_ubicacion', None)
        if padre is not None:
            pasos.append(('División', padre.nombre))
        pasos.append(('Habitación', ubicacion.nombre))
    if contenedor is not None:
        padre_contenedor = getattr(contenedor, 'parent_contenedor', None)
        if padre_contenedor is not None:
            pasos.append(('Mueble', padre_contenedor.nombre))
        pasos.append(('Contenedor', contenedor.nombre))

    return pasos[:MAX_PASOS_RUTA]


class BloqueRuta(Flowable):
    """
    Cadena horizontal de bloques geométricos (uno por paso de la ruta) unidos
    por flechas: el equivalente en PDF de la mini-guía analítica del frontend.
    Con `ahorro_tinta=True` se dibuja sin relleno y con bordes negros limpios.
    """

    def __init__(self, pasos, ahorro_tinta: bool = False):
        super().__init__()
        self.pasos = list(pasos)
        self.ahorro_tinta = ahorro_tinta
        self.width = 0
        self.height = ALTO_BLOQUE_RUTA

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return (self.width, self.height)

    # -- paleta -------------------------------------------------------------
    def _relleno_y_borde(self, indice: int):
        """(relleno, borde) del bloque: texturado ámbar o blanco/negro limpio."""
        if self.ahorro_tinta:
            return BLANCO, NEGRO
        return (AMARILLO if indice % 2 == 0 else NARANJA), AMBAR_BORDE

    def _colores_texto(self):
        if self.ahorro_tinta:
            return TINTA, GRIS
        return colors.HexColor('#78350f'), colors.HexColor('#92400e')

    def _color_linea(self):
        return NEGRO if self.ahorro_tinta else AMBAR_BORDE

    # -- dibujo -------------------------------------------------------------
    def draw(self):
        total = len(self.pasos)
        if total == 0 or self.width <= 0:
            return

        ancho_flecha = 5 * mm
        ancho_bloque = (self.width - ancho_flecha * (total - 1)) / total
        color_etiqueta, color_valor = self._colores_texto()

        for indice, (etiqueta, valor) in enumerate(self.pasos):
            x = indice * (ancho_bloque + ancho_flecha)
            self._bloque(x, ancho_bloque, indice, color_etiqueta, color_valor, etiqueta, valor)
            if indice < total - 1:
                self._flecha(x + ancho_bloque, self.height / 2, ancho_flecha)

    def _bloque(self, x, ancho, indice, color_etiqueta, color_valor, etiqueta, valor):
        relleno, borde = self._relleno_y_borde(indice)
        lienzo = self.canv
        lienzo.saveState()
        lienzo.setLineWidth(1.1 if self.ahorro_tinta else 0.8)
        lienzo.setStrokeColor(borde)
        lienzo.setFillColor(relleno)
        lienzo.roundRect(x, 0, ancho, self.height, 2 * mm, stroke=1, fill=1)
        lienzo.setFillColor(color_etiqueta)
        lienzo.setFont('Helvetica-Bold', 5.4)
        lienzo.drawCentredString(
            x + ancho / 2, self.height - 5.2 * mm, etiqueta.upper(),
        )
        lienzo.setFillColor(color_valor)
        lienzo.setFont('Helvetica', 6.8)
        lienzo.drawCentredString(
            x + ancho / 2, 4.2 * mm, recortar(valor, 22),
        )
        lienzo.restoreState()

    def _flecha(self, x, y, ancho):
        lienzo = self.canv
        color = self._color_linea()
        lienzo.saveState()
        lienzo.setStrokeColor(color)
        lienzo.setLineWidth(1.1 if self.ahorro_tinta else 0.8)
        lienzo.line(x + 1.2 * mm, y, x + ancho - 2.2 * mm, y)
        lienzo.setFillColor(color)
        camino = lienzo.beginPath()
        camino.moveTo(x + ancho - 2.2 * mm, y)
        camino.lineTo(x + ancho - 3.6 * mm, y + 1.1 * mm)
        camino.lineTo(x + ancho - 3.6 * mm, y - 1.1 * mm)
        camino.close()
        lienzo.drawPath(camino, stroke=0, fill=1)
        lienzo.restoreState()
