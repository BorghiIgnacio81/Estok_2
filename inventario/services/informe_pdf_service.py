"""
Servicio de INFORME PDF del inventario (ReportLab).

Construye el informe descargable de la pestaña Objetos a partir de los
parámetros que envía el Modal Unificado de Exportación:

    incluir_mapas   → añade los BLOQUES GEOMÉTRICOS DE RUTA de cada objeto
                      (PDF_BLOQUES_RUTA.BloqueRuta). Si es False, la sección de
                      mapas no se dibuja.
    mostrar_precios → incluye la columna/celda de PRECIO (valor estimado) en la
                      tabla y el total valorado del resumen. Si es False, la
                      celda del precio no se escribe.
    ahorro_tinta    → remueve los fondos texturados amarillos/naranjas y pinta
                      bordes negros limpios (modo impresión económica).

Este módulo es PURO (no toca la request ni el ORM): recibe iterables de
`Objeto` ya cargados con select_related y devuelve los bytes del PDF. La vista
(api/viewsets/objetos/export_actions.py) es la única responsable del tenant.
"""

import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .pdf_bloques_ruta import (
    AMBAR_BORDE,
    AMBAR_CLARO,
    BLANCO,
    BloqueRuta,
    GRIS,
    NEGRO,
    TINTA,
    ruta_de_objeto,
)

MARGEN = 12 * mm
ANCHO_UTIL = 174 * mm


# =============================================================================
# HELPERS
# =============================================================================
def _esc(valor) -> str:
    """Escapa el texto para el mini-HTML de ReportLab (Paragraph)."""
    if valor is None:
        return ''
    return (
        str(valor)
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
    )


def _precio(valor) -> str:
    """Formatea el valor estimado (USD) con separador de miles."""
    if valor in (None, ''):
        return '—'
    try:
        return 'USD {:,}'.format(round(float(valor), 2))
    except (TypeError, ValueError):
        return '—'


# =============================================================================
# ESTILOS
# =============================================================================
def _estilos():
    return {
        'titulo': ParagraphStyle(
            'Titulo', fontName='Helvetica-Bold', fontSize=17, leading=20,
            textColor=TINTA, spaceAfter=1,
        ),
        'subtitulo': ParagraphStyle(
            'Subtitulo', fontName='Helvetica', fontSize=8.5, leading=11,
            textColor=GRIS,
        ),
        'seccion': ParagraphStyle(
            'Seccion', fontName='Helvetica-Bold', fontSize=11, leading=14,
            textColor=TINTA, spaceBefore=5, spaceAfter=3,
        ),
        'celda': ParagraphStyle(
            'Celda', fontName='Helvetica', fontSize=7, leading=9, textColor=TINTA,
        ),
        'celda_centro': ParagraphStyle(
            'CeldaCentro', fontName='Helvetica', fontSize=7, leading=9,
            textColor=TINTA, alignment=TA_CENTER,
        ),
        'objeto': ParagraphStyle(
            'Objeto', fontName='Helvetica-Bold', fontSize=8, leading=10,
            textColor=TINTA,
        ),
        'pie': ParagraphStyle(
            'Pie', fontName='Helvetica', fontSize=7, leading=9, textColor=GRIS,
        ),
    }


def _estilo_tabla(ahorro_tinta: bool):
    """Estilo de tabla: ámbar texturado o blanco con bordes negros limpios."""
    if ahorro_tinta:
        fondo_cabecera, fondo_filas, borde, tinta_cabecera = (
            BLANCO, [BLANCO, BLANCO], NEGRO, NEGRO,
        )
    else:
        fondo_cabecera = colors.HexColor('#f59e0b')
        fondo_filas = [AMBAR_CLARO, BLANCO]
        borde = AMBAR_BORDE
        tinta_cabecera = BLANCO

    return TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, borde),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), fondo_filas),
        ('BACKGROUND', (0, 0), (-1, 0), fondo_cabecera),
        ('TEXTCOLOR', (0, 0), (-1, 0), tinta_cabecera),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ])


# =============================================================================
# SECCIONES DEL INFORME
# =============================================================================
def _encabezado(estilos, estok_nombre, opciones, total):
    """Portada del informe: identidad, fecha, alcance y opciones aplicadas."""
    fecha = datetime.now().strftime('%d/%m/%Y %H:%M')
    marcadores = [
        'Rutas ' + ('incluidas' if opciones['incluir_mapas'] else 'omitidas'),
        'Precios ' + ('visibles' if opciones['mostrar_precios'] else 'ocultos'),
        'Ahorro de tinta ' + ('activo' if opciones['ahorro_tinta'] else 'inactivo'),
    ]
    texto = (
        '<b>Estok:</b> ' + _esc(estok_nombre or 'Sin Estok')
        + ' &nbsp;·&nbsp; <b>Emitido:</b> ' + fecha
        + ' &nbsp;·&nbsp; <b>Objetos:</b> ' + str(total)
        + ' &nbsp;·&nbsp; ' + _esc(' · '.join(marcadores))
    )
    return [
        Paragraph('Informe de Inventario', estilos['titulo']),
        Paragraph('Estok · rutas, valoración y trazabilidad del inventario', estilos['subtitulo']),
        Spacer(1, 3 * mm),
        Paragraph(texto, estilos['subtitulo']),
        Spacer(1, 4 * mm),
    ]


def _resumen(estilos, objetos, opciones):
    """Tabla resumen: totales y valoración (solo si mostrar_precios)."""
    encabezados = ['Objetos listados', 'Con contenedor', 'Contenedores lógicos']
    valores = [
        str(len(objetos)),
        str(sum(1 for o in objetos if o.contenedor_id)),
        str(sum(1 for o in objetos if getattr(o, 'es_contenedor', False))),
    ]
    if opciones['mostrar_precios']:
        valor = sum(float(o.valor_estimado) for o in objetos if o.valor_estimado)
        encabezados.append('Valor total estimado')
        valores.append(_precio(valor))

    tabla = Table(
        [encabezados, valores],
        hAlign='LEFT',
        colWidths=[ANCHO_UTIL / len(encabezados)] * len(encabezados),
    )
    tabla.setStyle(_estilo_tabla(opciones['ahorro_tinta']))
    return [Paragraph('Resumen', estilos['seccion']), tabla, Spacer(1, 4 * mm)]


def _columnas_tabla(opciones):
    """
    Encabezados y anchos de la tabla principal.
    La columna PRECIO se omite por completo si mostrar_precios es False.
    """
    columnas = [
        ('ID', 20 * mm),
        ('Nombre', 54 * mm),
        ('Tipo', 16 * mm),
        ('Estado', 17 * mm),
    ]
    if opciones['mostrar_precios']:
        columnas.append(('Precio (USD)', 24 * mm))
    columnas += [
        ('Ubicación', 27 * mm),
        ('Contenedor', 27 * mm),
        ('Decisión', 19 * mm),
    ]
    return columnas


def _tabla_objetos(estilos, objetos, opciones):
    """Tabla principal del inventario (con o sin la columna de precio)."""
    columnas = _columnas_tabla(opciones)
    filas = [[Paragraph(_esc(c[0]), estilos['celda_centro']) for c in columnas]]

    for objeto in objetos:
        fila = [
            Paragraph(_esc(str(objeto.id)[:8]), estilos['celda']),
            Paragraph(_esc(objeto.nombre), estilos['celda']),
            Paragraph(
                _esc(objeto.categoria.nombre if objeto.categoria else '—'),
                estilos['celda_centro'],
            ),
            Paragraph(_esc(objeto.get_estado_conservacion_display()), estilos['celda_centro']),
        ]
        if opciones['mostrar_precios']:
            fila.append(Paragraph(_precio(objeto.valor_estimado), estilos['celda_centro']))
        fila += [
            Paragraph(_esc(objeto.ubicacion.nombre if objeto.ubicacion else '—'), estilos['celda']),
            Paragraph(_esc(objeto.contenedor.nombre if objeto.contenedor else '—'), estilos['celda']),
            Paragraph(
                _esc(objeto.get_owner_action_display() if objeto.owner_action else '—'),
                estilos['celda_centro'],
            ),
        ]
        filas.append(fila)

    tabla = Table(
        filas,
        colWidths=[c[1] for c in columnas],
        repeatRows=1,
        hAlign='LEFT',
    )
    tabla.setStyle(_estilo_tabla(opciones['ahorro_tinta']))
    return [Paragraph('Detalle del inventario', estilos['seccion']), tabla]


def _seccion_rutas(estilos, objetos, opciones):
    """
    Mapas analíticos de ruta: la sección se OMITE por completo cuando
    `incluir_mapas` es False (no se dibuja ningún bloque geométrico).
    """
    if not opciones['incluir_mapas']:
        return []

    flujo = [Paragraph('Mapas analíticos de ruta', estilos['seccion'])]
    for objeto in objetos:
        flujo.append(Paragraph(
            _esc(objeto.nombre) + '  <font size="6.5" color="#6b7280">'
            + _esc(str(objeto.id)[:8]) + '</font>',
            estilos['objeto'],
        ))
        flujo.append(
            BloqueRuta(ruta_de_objeto(objeto), ahorro_tinta=opciones['ahorro_tinta'])
        )
        flujo.append(Spacer(1, 2.4 * mm))
    return flujo


# =============================================================================
# API PÚBLICA
# =============================================================================
def construir_informe_pdf(objetos, estok_nombre='', opciones=None) -> bytes:
    """
    Genera el PDF del informe y devuelve los bytes listos para el HttpResponse.

    `objetos` debe venir con select_related de: ubicacion,
    ubicacion__parent_ubicacion, contenedor, contenedor__parent_contenedor,
    estok y categoria.
    """
    opciones = {
        'incluir_mapas': True,
        'mostrar_precios': True,
        'ahorro_tinta': False,
        **(opciones or {}),
    }
    objetos = list(objetos)
    estilos = _estilos()

    buffer = io.BytesIO()
    documento = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=MARGEN,
        rightMargin=MARGEN,
        topMargin=MARGEN,
        bottomMargin=MARGEN,
        title='Informe de Inventario Estok',
        author='Estok',
    )

    flujo = _encabezado(estilos, estok_nombre, opciones, len(objetos))
    flujo += _resumen(estilos, objetos, opciones)
    if objetos:
        flujo += _tabla_objetos(estilos, objetos, opciones)
        flujo += [Spacer(1, 5 * mm)]
        flujo += _seccion_rutas(estilos, objetos, opciones)
    else:
        flujo.append(
            Paragraph('No hay objetos en el alcance seleccionado.', estilos['celda'])
        )

    flujo.append(Spacer(1, 5 * mm))
    flujo.append(Paragraph(
        'Generado automáticamente por Estok · '
        + datetime.now().strftime('%d/%m/%Y %H:%M'),
        estilos['pie'],
    ))

    documento.build(flujo)
    return buffer.getvalue()
