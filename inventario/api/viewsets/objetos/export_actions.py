"""
Acciones de EXPORTACIÓN del inventario (ObjetoViewSet).

Contiene los DOS endpoints del Modal Unificado de Exportación de la pestaña
Objetos ("Exportar Datos / Informe"):

  GET /api/objetos/exportar_csv/?alcance=completo|objetos|contenedores
      CSV UTF-8 con BOM (Excel-friendly). El parámetro `alcance` filtra las
      filas antes de escribirlas:
        - completo     → filas de Objeto (todas) + filas de Contenedor.
        - objetos      → solo filas de Objeto (equivalentes a all()).
        - contenedores → solo filas de Contenedor.
      En este esquema el "tipo" CAJA/MUEBLE vive en el modelo `Contenedor`
      (taxonomía estricta de inventario/services/taxonomia_contenedor.py), así
      que el filtro pedido `filter(tipo='CAJA')` se aplica sobre Contenedor y
      excluye los ESTANTE (sub-divisiones internas, fuera de todo listado).

  GET /api/objetos/exportar_pdf/?incluir_mapas=&mostrar_precios=&ahorro_tinta=
      Informe PDF (ReportLab) armado por services/informe_pdf_service.py.

Aislamiento multi-tenant: el Estok activo sale SIEMPRE del header X-Estok-Id
(o de ?estok_id= como respaldo). No se reimplementa auth: la vista hereda
permission_classes del base y el frontend centraliza los headers en
services/auth (getAuthHeaders → Authorization + X-Estok-Id).
"""

import csv
import logging
import uuid
from datetime import datetime

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from ....models import Contenedor, Estok
from ....services.taxonomia_contenedor import TIPO_CAJA, TIPO_MUEBLE

logger = logging.getLogger(__name__)

# =============================================================================
# CONSTANTES DE EXPORTACIÓN
# =============================================================================
ALCANCE_COMPLETO = 'completo'
ALCANCE_OBJETOS = 'objetos'
ALCANCE_CONTENEDORES = 'contenedores'

# Alias tolerantes (el CSV viejo no enviaba `alcance`: default = completo).
_ALIAS_ALCANCE = {
    'todo': ALCANCE_COMPLETO,
    'todos': ALCANCE_COMPLETO,
    'all': ALCANCE_COMPLETO,
    'objeto': ALCANCE_OBJETOS,
    'objetos': ALCANCE_OBJETOS,
    'contenedor': ALCANCE_CONTENEDORES,
    'contenedores': ALCANCE_CONTENEDORES,
    'caja': ALCANCE_CONTENEDORES,
    'cajas': ALCANCE_CONTENEDORES,
    'mueble': ALCANCE_CONTENEDORES,
    'muebles': ALCANCE_CONTENEDORES,
}

ENCABEZADOS_CSV = [
    'Entidad', 'ID', 'Nombre', 'Tipo', 'Descripción', 'Estado Conservación',
    'Valor Estimado (USD)', 'Color', 'Ubicación', 'Contenedor',
    'Dueño Original', 'Beneficiario', 'Estado Carga',
    'Fecha Registro', 'Fecha Actualización',
]

# Opciones de formato del informe PDF y su valor por defecto.
OPCIONES_PDF = (
    ('incluir_mapas', True),
    ('mostrar_precios', True),
    ('ahorro_tinta', False),
)


class ExportActionsMixin:
    """
    Mixin de exportación (CSV / PDF) para el ViewSet de Objetos.
    Depende de que la clase combinada herede de ObjetoViewSetBase, que aporta
    `get_queryset()` (ya aislado por Estok) y el helper `_get_tipo()`.
    """

    # ------------------------------------------------------------------
    # Tenant activo (X-Estok-Id) y parámetros de la query string
    # ------------------------------------------------------------------
    def _estok_activo_crudo(self) -> str:
        return (
            self.request.headers.get('X-Estok-Id')
            or self.request.query_params.get('estok_id')
            or ''
        ).strip()

    def _estok_activo_id(self):
        """
        UUID del Estok activo, o None si no se envió header.
        Si el header existe pero no es un UUID válido se responde 400 (mismo
        criterio que ContenedorViewSet.perform_update).
        """
        crudo = self._estok_activo_crudo()
        if not crudo:
            return None
        try:
            return uuid.UUID(crudo)
        except (TypeError, ValueError):
            raise ValidationError(
                'El header X-Estok-Id no es un UUID válido.'
            )

    def _bool_param(self, nombre: str, default: bool) -> bool:
        """Lee un booleano de la query string ('false', '0' y 'no' son False)."""
        crudo = self.request.query_params.get(nombre)
        if crudo is None:
            return default
        return str(crudo).strip().lower() in ('true', '1', 'si', 'sí', 'yes', 'on')

    @staticmethod
    def _normalizar_alcance(valor) -> str:
        return _ALIAS_ALCANCE.get((valor or '').strip().lower(), ALCANCE_COMPLETO)

    # ------------------------------------------------------------------
    # Consultas
    # ------------------------------------------------------------------
    def _objetos_para_exportar(self):
        """Objetos del Estok activo con todas las relaciones ya precargadas."""
        return self.get_queryset().select_related(
            'ubicacion', 'ubicacion__parent_ubicacion',
            'contenedor', 'contenedor__parent_contenedor',
            'estok', 'categoria', 'dueno_original', 'beneficiario',
        )

    def _contenedores_del_estok(self):
        """
        Cajas y muebles del Estok activo (excluye los ESTANTE internos, que
        quedan fuera de todo listado de inventario).
        """
        qs = Contenedor.objects.select_related(
            'ubicacion', 'parent_contenedor',
        ).filter(
            tipo__in=(TIPO_CAJA, TIPO_MUEBLE),
        )
        estok_id = self._estok_activo_id()
        if estok_id:
            qs = qs.filter(ubicacion__estok_id=estok_id)
        return qs.order_by('ubicacion__nombre', 'nombre')

    def _nombre_estok_activo(self) -> str:
        estok_id = self._estok_activo_id()
        if not estok_id:
            return ''
        return (
            Estok.objects.filter(id=estok_id)
            .values_list('nombre', flat=True)
            .first()
            or ''
        )

    # ------------------------------------------------------------------
    # Filas del CSV (una por entidad)
    # ------------------------------------------------------------------
    def _filas_objetos(self, objetos):
        for obj in objetos:
            yield [
                'OBJETO', str(obj.id), obj.nombre, self._get_tipo(obj),
                obj.descripcion, obj.estado_conservacion,
                float(obj.valor_estimado) if obj.valor_estimado else '',
                obj.color,
                obj.ubicacion.nombre if obj.ubicacion else '',
                obj.contenedor.nombre if obj.contenedor else '',
                str(obj.dueno_original) if obj.dueno_original else '',
                str(obj.beneficiario) if obj.beneficiario else '',
                obj.estado_carga,
                obj.fecha_registro.isoformat() if obj.fecha_registro else '',
                obj.updated_at.isoformat() if obj.updated_at else '',
            ]

    @staticmethod
    def _filas_contenedores(contenedores):
        for cont in contenedores:
            yield [
                'CONTENEDOR', str(cont.id), cont.nombre, cont.tipo,
                cont.descripcion, '',
                '', cont.material or '',
                cont.ubicacion.nombre if cont.ubicacion else '',
                cont.parent_contenedor.nombre if cont.parent_contenedor else '',
                '', '',
                'lleno' if cont.espacio_lleno else '',
                cont.created_at.isoformat() if cont.created_at else '',
                cont.updated_at.isoformat() if cont.updated_at else '',
            ]

    # ==================================================================
    # GET /api/objetos/exportar_csv/?alcance=...
    # ==================================================================
    @action(detail=False, methods=['get'])
    def exportar_csv(self, request):
        """
        Exporta el inventario a CSV según el alcance elegido en el modal:
        `completo` (objetos + contenedores), `objetos` o `contenedores`.
        """
        alcance = self._normalizar_alcance(request.query_params.get('alcance'))
        self._estok_activo_id()  # 400 temprano si el header está malformado

        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = (
            f'attachment; filename="inventario_estok_{alcance}.csv"'
        )
        response.write('\ufeff')

        writer = csv.writer(response)
        writer.writerow(ENCABEZADOS_CSV)

        filas = 0
        if alcance in (ALCANCE_COMPLETO, ALCANCE_OBJETOS):
            for fila in self._filas_objetos(self._objetos_para_exportar()):
                writer.writerow(fila)
                filas += 1
        if alcance in (ALCANCE_COMPLETO, ALCANCE_CONTENEDORES):
            for fila in self._filas_contenedores(self._contenedores_del_estok()):
                writer.writerow(fila)
                filas += 1

        logger.info(
            'exportar_csv alcance=%s filas=%s usuario=%s estok=%s',
            alcance, filas, request.user, self._estok_activo_crudo() or '-',
        )
        return response

    # ==================================================================
    # GET /api/objetos/exportar_pdf/?incluir_mapas=&mostrar_precios=&ahorro_tinta=
    # ==================================================================
    @action(detail=False, methods=['get'])
    def exportar_pdf(self, request):
        """
        Informe PDF del inventario del Estok activo. Los tres booleanos de
        formato se aplican en services/informe_pdf_service.py:
          - incluir_mapas   → dibuja (o no) los bloques geométricos de ruta.
          - mostrar_precios → escribe (u omite) la celda del precio.
          - ahorro_tinta    → bordes negros limpios sin fondos ámbar.
        """
        try:
            from ....services.informe_pdf_service import construir_informe_pdf
        except ImportError as exc:  # ReportLab ausente en el despliegue
            logger.error('ReportLab no disponible para el informe PDF: %s', exc)
            return Response(
                {'error': 'El generador de informes PDF no está disponible.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        opciones = {nombre: self._bool_param(nombre, default)
                    for nombre, default in OPCIONES_PDF}
        objetos = list(self._objetos_para_exportar())

        try:
            pdf = construir_informe_pdf(
                objetos,
                estok_nombre=self._nombre_estok_activo(),
                opciones=opciones,
            )
        except Exception as exc:  # noqa: BLE001 - se reporta con log + 500
            logger.exception('Error al generar el informe PDF: %s', exc)
            return Response(
                {'error': 'No se pudo generar el informe PDF.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = (
            'attachment; filename="informe_estok_'
            + datetime.now().strftime('%Y-%m-%d') + '.pdf"'
        )
        logger.info(
            'exportar_pdf objetos=%s opciones=%s usuario=%s estok=%s',
            len(objetos), opciones, request.user,
            self._estok_activo_crudo() or '-',
        )
        return response
