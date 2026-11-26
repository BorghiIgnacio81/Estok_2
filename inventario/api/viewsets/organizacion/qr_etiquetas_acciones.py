"""
Acciones de ETIQUETAS QR IMPRIMIBLES del `ContenedorViewSet` (mixin).

Expone el PDF A4 que imprime el modal «🖨️ Imprimir QRs» de /almacenamiento y
/objetos:

    GET /api/cajas/generar_pdf_qr/            ← alias público (inventario/api/urls.py)
    GET /api/contenedores/generar_pdf_qr/     ← ruta natural del router

Parámetros de la query:
    filtro  = todas | nuevas | manual   (default: todas)
    ids     = uuid,uuid,…               (obligatorio cuando filtro=manual)
    formato = 3x3 | 2x2 | 4x4           (default: 3x3 · 9 etiquetas por hoja)
    marcar_impreso = 1 | 0              (default: 1 → `qr_impreso = True`)

UNIVERSO DE CAJAS: exactamente el mismo de la canasta «🧺 Elementos por ubicar»
(`aplicar_filtro_bandeja`: whitelist de caja móvil + canales de reconocimiento).
Así nunca se imprime el QR de una habitación «Espacio N» ni de un mueble.

La marca `qr_impreso` se actualiza SOLO cuando el PDF se generó sin errores;
si el operador sólo quiere previsualizar, manda `marcar_impreso=0`.
"""

import logging
from datetime import datetime
from uuid import UUID

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from ....models import Contenedor
from ...tenant_activo import estok_id_de_request
from .filtros_bandeja import aplicar_filtro_bandeja
from .helpers_organizacion import _validar_membresia

logger = logging.getLogger(__name__)

FILTRO_TODAS = 'todas'
FILTRO_NUEVAS = 'nuevas'
FILTRO_MANUAL = 'manual'
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


class AccionesQrEtiquetasMixin:
    @action(detail=False, methods=['get'], url_path='generar_pdf_qr')
    def generar_pdf_qr(self, request):
        """
        Devuelve el PDF de etiquetas QR de las cajas del Estok activo.

        El tenant sale SIEMPRE del header X-Estok-Id (o `?estok_id=`), nunca de
        una suposición: sin Estok resoluble la petición es 400.
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

        cajas_qs = (
            Contenedor.objects
            .select_related('ubicacion', 'parent_contenedor')
            .filter(ubicacion__estok_id=estok_uuid)
        )
        cajas_qs = aplicar_filtro_bandeja(cajas_qs, estok_id)

        if filtro == FILTRO_NUEVAS:
            cajas_qs = cajas_qs.filter(qr_impreso=False)
        elif filtro == FILTRO_MANUAL:
            ids = _ids_seleccionados(request.query_params.get('ids'))
            if not ids:
                raise ValidationError("La selección manual no incluye ninguna caja válida.")
            cajas_qs = cajas_qs.filter(id__in=ids)

        cajas = list(cajas_qs.order_by('nombre'))
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
            Contenedor.objects.filter(id__in=[c.id for c in cajas]).update(
                qr_impreso=True,
            )

        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = (
            'attachment; filename="etiquetas_qr_'
            + datetime.now().strftime('%Y-%m-%d_%H%M') + '.pdf"'
        )
        logger.info(
            'generar_pdf_qr cajas=%s formato=%s filtro=%s usuario=%s estok=%s',
            len(cajas), formato, filtro, request.user, estok_id,
        )
        return response
