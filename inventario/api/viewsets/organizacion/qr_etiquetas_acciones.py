"""
Acciones de ETIQUETAS QR IMPRIMIBLES del `ContenedorViewSet` (mixin).

Expone las DOS caras del modal «🖨️ Imprimir QRs» de /almacenamiento y /objetos:

    GET /api/cajas/etiquetas_qr/            ← listado de cajas del modal
    GET /api/cajas/generar_pdf_qr/          ← alias público del PDF A4
    GET /api/contenedores/generar_pdf_qr/   ← ruta natural del router

UNIVERSO DE CAJAS: el de `services/qr_etiquetas_universo` (fuente ÚNICA) —
TODAS las cajas y contenedores del Estok, sin importar su categoría temática:

  · cajas físicas (`Contenedor` tipo CAJA) reconocidas por la canasta de
    «Elementos por ubicar» o marcadas `esta_llena=True`;
  · cajas registradas como `Objeto` (`es_contenedor=True` o `esta_llena=True`),
    que antes quedaban fuera porque el endpoint sólo consultaba `Contenedor`;
  · los espejos de dualidad Contenedor⇄Objeto se descartan (una sola etiqueta
    por bulto físico).

El listado del modal y el PDF salen del MISMO queryset, así la lista que ve el
operador y las etiquetas que recibe no pueden divergir nunca.

Parámetros de la query del PDF:
    filtro  = todas | nuevas | manual   (default: todas)
    ids     = uuid,uuid,…               (obligatorio cuando filtro=manual)
    formato = 3x3 | 2x2 | 4x4           (default: 3x3 · 9 etiquetas por hoja)
    marcar_impreso = 1 | 0              (default: 1 → `qr_impreso = True`)

La marca `qr_impreso` se actualiza SOLO cuando el PDF se generó sin errores; si
el operador sólo quiere previsualizar, manda `marcar_impreso=0`. Se escribe en
`Contenedor` y en `Objeto` según la naturaleza de cada caja.
"""

import logging
from datetime import datetime
from uuid import UUID

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from ....services.qr_etiquetas_universo import (
    FILTRO_MANUAL,
    FILTRO_NUEVAS,
    FILTRO_TODAS,
    construir_universo,
    filtrar_universo,
    marcar_impresas,
)
from ...tenant_activo import estok_id_de_request
from .helpers_organizacion import _validar_membresia

logger = logging.getLogger(__name__)

FILTROS = (FILTRO_TODAS, FILTRO_NUEVAS, FILTRO_MANUAL)


def _bool_param(valor, default=True):
    """Interpreta los booleanos de query string (1/0/true/false/si/no)."""
    if valor is None:
        return default
    return str(valor).strip().lower() not in ('0', 'false', 'no', 'off')


def _ids_seleccionados(crudo):
    """UUIDs válidos de `?ids=uuid,uuid,…` (los inválidos se descartan)."""
    ids = []
    for parte in str(crudo or '').split(','):
        try:
            ids.append(UUID(parte.strip()))
        except (TypeError, ValueError, AttributeError):
            continue
    return ids


def _estok_activo(request):
    """
    UUID del Estok activo (header `X-Estok-Id` o `?estok_id=`), ya validado.

    El tenant NUNCA se adivina: sin Estok resoluble la petición es 400 y sin
    membresía del usuario es 403 (misma regla que el resto del viewset).
    """
    estok_id = estok_id_de_request(request)
    if not estok_id:
        raise ValidationError(
            "Falta el header X-Estok-Id: las etiquetas pertenecen a un Estok activo."
        )
    try:
        estok_uuid = UUID(str(estok_id))
    except (TypeError, ValueError):
        raise ValidationError("El Estok activo especificado no es un UUID válido.")
    _validar_membresia(request.user, estok_uuid)
    return estok_uuid


class AccionesQrEtiquetasMixin:
    @action(detail=False, methods=['get'], url_path='etiquetas_qr')
    def etiquetas_qr(self, request):
        """
        Lista de cajas imprimibles que consume el modal «🖨️ Imprimir QRs».

        Misma fuente que el PDF (`construir_universo`): incluye las cajas
        físicas Y las registradas como Objeto, sin filtrar por categoría. Cada
        fila trae `tipo_entidad` ('caja' | 'objeto') y `qr_impreso` para que el
        cliente distinga las nuevas y arme la selección manual.
        """
        estok_uuid = _estok_activo(request)
        cajas = construir_universo(estok_uuid)
        return Response({
            'total': len(cajas),
            'results': [caja.como_dict() for caja in cajas],
        })

    @action(detail=False, methods=['get'], url_path='generar_pdf_qr')
    def generar_pdf_qr(self, request):
        """
        Devuelve el PDF de etiquetas QR de las cajas del Estok activo.

        El tenant sale SIEMPRE del header X-Estok-Id (o `?estok_id=`), nunca de
        una suposición: sin Estok resoluble la petición es 400.
        """
        estok_uuid = _estok_activo(request)

        # Import TARDÍO del generador (misma convención que export_actions.py del
        # informe PDF): si ReportLab no está en el despliegue, la acción responde
        # 503 sin tumbar el resto de la API.
        try:
            from ....services.qr_etiquetas_pdf_service import (
                FORMATO_POR_DEFECTO,
                FORMATOS_HOJA,
                construir_pdf_etiquetas_qr,
                formato_normalizado,
            )
        except ImportError as exc:
            logger.error('ReportLab no disponible para las etiquetas QR: %s', exc)
            return Response(
                {'error': 'El generador de etiquetas PDF no está disponible.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        filtro = (request.query_params.get('filtro') or FILTRO_TODAS).strip().lower()
        if filtro not in FILTROS:
            raise ValidationError("El filtro debe ser «todas», «nuevas» o «manual».")

        formato = (request.query_params.get('formato') or FORMATO_POR_DEFECTO).strip().lower()
        if formato not in FORMATOS_HOJA:
            raise ValidationError("El formato de hoja debe ser «3x3», «2x2» o «4x4».")

        ids = ()
        if filtro == FILTRO_MANUAL:
            ids = _ids_seleccionados(request.query_params.get('ids'))
            if not ids:
                raise ValidationError("La selección manual no incluye ninguna caja válida.")

        # UNIVERSO ÚNICO (cajas físicas + cajas-Objeto, sin mirar la categoría):
        # la MISMA lista que muestra el modal, para que el PDF nunca diverja.
        cajas = filtrar_universo(construir_universo(estok_uuid), filtro, ids)
        if not cajas:
            raise ValidationError("No hay cajas para imprimir con el filtro seleccionado.")

        try:
            pdf = construir_pdf_etiquetas_qr(cajas, formato=formato_normalizado(formato))
        except Exception as exc:  # noqa: BLE001 - se reporta con log + 500
            logger.exception('Error al generar las etiquetas QR: %s', exc)
            return Response(
                {'error': 'No se pudo generar el PDF de etiquetas QR.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Marca de impresión: sólo con el PDF ya generado correctamente.
        if _bool_param(request.query_params.get('marcar_impreso'), default=True):
            marcar_impresas(cajas)

        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = (
            'attachment; filename="etiquetas_qr_'
            + datetime.now().strftime('%Y-%m-%d_%H%M') + '.pdf"'
        )
        logger.info(
            'generar_pdf_qr cajas=%s formato=%s filtro=%s usuario=%s estok=%s',
            len(cajas), formato, filtro, request.user, estok_uuid,
        )
        return response
