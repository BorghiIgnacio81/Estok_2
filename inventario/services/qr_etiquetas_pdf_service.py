"""
Servicio de ETIQUETAS QR IMPRIMIBLES para cajas (ReportLab, hoja A4).

Genera el PDF que se imprime desde el modal «🖨️ Imprimir QRs» de
/almacenamiento y /objetos. Cada etiqueta de la grilla incluye:

  · el código QR del contenedor (PNG en alta resolución generado EN MEMORIA por
    `services/qr_service.QRService.generar_png`: no depende de que el archivo
    media/qrcodes/*.png exista en el contenedor de producción),
  · el NOMBRE de la caja en negrita (ej. «Caja 03 - Revistas»),
  · su ID/CÓDIGO corto,
  · su ubicación asignada (Habitación › Mueble contenedor).

Formatos soportados — mismo contrato que el selector del modal:
    '3x3' → 9 etiquetas por hoja A4 (DEFAULT)
    '2x2' → 4 etiquetas por hoja A4
    '4x4' → 16 etiquetas por hoja A4

Este módulo es PURO respecto del ORM y del request: recibe una lista de
`Contenedor` YA filtrada por tenant (api/viewsets/organizacion/
qr_etiquetas_acciones.py) y devuelve los bytes del PDF. NO marca `qr_impreso`:
esa decisión es de la vista, cuando el PDF se generó correctamente.
"""

import io
import logging
import math

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from .qr_service import QRService

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURACIÓN DE LA HOJA
# =============================================================================
# (columnas, filas) de la grilla de etiquetas por hoja A4.
FORMATOS_HOJA = {
    '2x2': (2, 2),
    '3x3': (3, 3),
    '4x4': (4, 4),
}
FORMATO_POR_DEFECTO = '3x3'

MARGEN = 8 * mm          # margen de la hoja
PIE_ALTO = 6 * mm        # franja reservada al pie («hoja X/Y»)
MARGEN_ETIQUETA = 1.2 * mm
RESOLUCION_QR = 24       # píxeles por módulo del QR (alta resolución de impresión)

COLOR_BORDE = colors.HexColor('#d4d4d8')
COLOR_TINTA = colors.HexColor('#111827')
COLOR_GRIS = colors.HexColor('#6b7280')
COLOR_ACENTO = colors.HexColor('#b45309')

# Tamaños de fuente (nombre, código, ubicación) por densidad de grilla.
_FUENTES = {
    '2x2': (13.0, 9.5, 10.0),
    '3x3': (10.0, 7.5, 8.0),
    '4x4': (7.5, 6.0, 6.5),
}


def formato_normalizado(formato):
    """Devuelve la clave de formato válida ('3x3' por defecto)."""
    clave = str(formato or '').strip().lower()
    return clave if clave in FORMATOS_HOJA else FORMATO_POR_DEFECTO


# =============================================================================
# TEXTO
# =============================================================================
def _recortar(texto, fuente, tamano, ancho_max):
    """Recorta una palabra que no entra en el ancho disponible (con «…»)."""
    recorte = texto
    while recorte and stringWidth(recorte + '…', fuente, tamano) > ancho_max:
        recorte = recorte[:-1]
    return (recorte.rstrip() + '…') if recorte else ''


def _envolver(texto, fuente, tamano, ancho_max, max_lineas=2):
    """
    Ajusta el texto al ancho de la etiqueta en, como máximo, `max_lineas`.

    El corte es por palabras; si el texto excede las líneas permitidas, la
    última termina en «…» para que el rótulo nunca se desborde de la celda.
    """
    palabras = str(texto or '').split()
    if not palabras:
        return []

    lineas = []
    actual = ''
    for palabra in palabras:
        prueba = (actual + ' ' + palabra).strip()
        if not actual or stringWidth(prueba, fuente, tamano) <= ancho_max:
            actual = prueba
        else:
            lineas.append(actual)
            actual = palabra
    if actual:
        lineas.append(actual)

    if len(lineas) > max_lineas:
        lineas = lineas[:max_lineas]
        lineas[-1] = _recortar(lineas[-1], fuente, tamano, ancho_max)

    return [
        linea if stringWidth(linea, fuente, tamano) <= ancho_max
        else _recortar(linea, fuente, tamano, ancho_max)
        for linea in lineas
    ]


# =============================================================================
# DATOS DE LA ETIQUETA
# =============================================================================
def ruta_ubicacion(caja):
    """
    Ubicación asignada de la caja en una sola línea: «Habitación › Mueble».

    El mueble contenedor se resuelve EN VIVO contra la FK padre (misma regla de
    herencia dinámica que `ContenedorSerializer.procedencia_nombre`), nunca de
    un valor denormalizado.
    """
    partes = []
    ubicacion = getattr(caja, 'ubicacion', None)
    if ubicacion is not None and getattr(ubicacion, 'nombre', ''):
        partes.append(str(ubicacion.nombre).strip())

    if getattr(caja, 'parent_contenedor_id', None):
        padre = getattr(caja, 'parent_contenedor', None)
        if padre is not None and getattr(padre, 'nombre', ''):
            partes.append(str(padre.nombre).strip())

    return ' › '.join([p for p in partes if p]) or 'Sin ubicación asignada'


def _datos_etiqueta(caja, qr_service):
    """Arma el contenido imprimible de UNA caja."""
    try:
        png = qr_service.generar_png(str(caja.id), box_size=RESOLUCION_QR)
    except Exception as exc:  # noqa: BLE001 - una caja sin QR no aborta la hoja
        logger.error('No se pudo generar el QR de la caja %s: %s', caja.id, exc)
        png = None

    return {
        'nombre': str(getattr(caja, 'nombre', '') or 'Caja sin nombre').strip(),
        'codigo': 'ID ' + str(caja.id)[:8].upper(),
        'ubicacion': ruta_ubicacion(caja),
        'png': png,
    }


# =============================================================================
# DIBUJO
# =============================================================================
def _dibujar_etiqueta(pdf, datos, x, y, ancho, alto, fuentes):
    """Dibuja una etiqueta completa (marco, QR, nombre, código y ubicación)."""
    tam_nombre, tam_codigo, tam_ubicacion = fuentes
    interior = ancho - 8 * mm

    pdf.saveState()

    # Marco redondeado + franja de acento superior.
    pdf.setStrokeColor(COLOR_BORDE)
    pdf.setLineWidth(0.6)
    pdf.roundRect(
        x + MARGEN_ETIQUETA, y + MARGEN_ETIQUETA,
        ancho - 2 * MARGEN_ETIQUETA, alto - 2 * MARGEN_ETIQUETA,
        3 * mm, stroke=1, fill=0,
    )
    pdf.setFillColor(COLOR_ACENTO)
    pdf.rect(
        x + MARGEN_ETIQUETA, y + alto - 3 * mm,
        ancho - 2 * MARGEN_ETIQUETA, 1.2 * mm,
        stroke=0, fill=1,
    )

    # QR centrado en la parte superior de la celda.
    tam_qr = max(min(interior, alto - 30 * mm), 18 * mm)
    qr_y = y + alto - 4 * mm - tam_qr
    if datos['png']:
        pdf.drawImage(
            ImageReader(io.BytesIO(datos['png'])),
            x + (ancho - tam_qr) / 2, qr_y,
            width=tam_qr, height=tam_qr,
            preserveAspectRatio=True, mask='auto',
        )
    else:
        pdf.setStrokeColor(COLOR_BORDE)
        pdf.rect(x + (ancho - tam_qr) / 2, qr_y, tam_qr, tam_qr, stroke=1, fill=0)
        pdf.setFont('Helvetica', tam_codigo)
        pdf.setFillColor(COLOR_GRIS)
        pdf.drawCentredString(x + ancho / 2, qr_y + tam_qr / 2, 'QR no disponible')

    # Nombre en NEGRITA (hasta 2 líneas).
    cursor = qr_y - 3.5 * mm
    pdf.setFillColor(COLOR_TINTA)
    pdf.setFont('Helvetica-Bold', tam_nombre)
    for linea in _envolver(datos['nombre'], 'Helvetica-Bold', tam_nombre, interior):
        cursor -= tam_nombre * 1.15
        pdf.drawCentredString(x + ancho / 2, cursor, linea)

    # Código/ID corto.
    cursor -= tam_codigo * 1.7
    pdf.setFont('Helvetica', tam_codigo)
    pdf.setFillColor(COLOR_GRIS)
    pdf.drawCentredString(x + ancho / 2, cursor, datos['codigo'])

    # Ubicación asignada (hasta 2 líneas, sin invadir el borde inferior).
    pdf.setFont('Helvetica', tam_ubicacion)
    pdf.setFillColor(COLOR_TINTA)
    for linea in _envolver(datos['ubicacion'], 'Helvetica', tam_ubicacion, interior):
        if cursor - tam_ubicacion * 1.4 < y + 3 * mm:
            break
        cursor -= tam_ubicacion * 1.35
        pdf.drawCentredString(x + ancho / 2, cursor, linea)

    pdf.restoreState()


def _dibujar_pie(pdf, numero_hoja, total_hojas, formato):
    """Pie de página: formato de grilla y numeración de hojas."""
    ancho_pagina, _ = A4
    pdf.setFont('Helvetica', 7)
    pdf.setFillColor(COLOR_GRIS)
    pdf.drawCentredString(
        ancho_pagina / 2, 4 * mm,
        'Etiquetas QR · Estok · grilla %s · hoja %s de %s'
        % (formato, numero_hoja, total_hojas),
    )


# =============================================================================
# API PÚBLICA
# =============================================================================
def construir_pdf_etiquetas_qr(cajas, formato=FORMATO_POR_DEFECTO, titulo='Etiquetas QR'):
    """
    Genera el PDF de etiquetas QR y devuelve los bytes listos para el HttpResponse.

    Args:
        cajas: iterable de `Contenedor` con select_related('ubicacion',
            'parent_contenedor').
        formato: '2x2' | '3x3' | '4x4' (cualquier otro valor cae en el default).
        titulo: título interno del documento PDF.

    Returns:
        Contenido binario del PDF.
    """
    formato = formato_normalizado(formato)
    columnas, filas = FORMATOS_HOJA[formato]
    por_hoja = columnas * filas
    fuentes = _FUENTES[formato]

    cajas = list(cajas)
    total_hojas = max(1, int(math.ceil(len(cajas) / float(por_hoja))))

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    pdf.setTitle('%s · Estok' % titulo)
    pdf.setAuthor('Estok')

    ancho_pagina, alto_pagina = A4
    ancho_grilla = ancho_pagina - 2 * MARGEN
    alto_grilla = alto_pagina - 2 * MARGEN - PIE_ALTO
    ancho_celda = ancho_grilla / columnas
    alto_celda = alto_grilla / filas

    qr_service = QRService()

    if not cajas:
        # Hoja informativa: la vista normalmente rechaza este caso antes.
        pdf.setFont('Helvetica', 12)
        pdf.setFillColor(COLOR_TINTA)
        pdf.drawCentredString(
            ancho_pagina / 2, alto_pagina / 2,
            'No hay cajas para imprimir con el filtro seleccionado.',
        )
        pdf.save()
        return buffer.getvalue()

    for indice, caja in enumerate(cajas):
        posicion = indice % por_hoja
        if posicion == 0:
            if indice:
                pdf.showPage()
            _dibujar_pie(pdf, indice // por_hoja + 1, total_hojas, formato)

        fila, columna = divmod(posicion, columnas)
        x = MARGEN + columna * ancho_celda
        y = MARGEN + PIE_ALTO + alto_grilla - (fila + 1) * alto_celda
        _dibujar_etiqueta(
            pdf, _datos_etiqueta(caja, qr_service),
            x, y, ancho_celda, alto_celda, fuentes,
        )

    pdf.save()
    return buffer.getvalue()
