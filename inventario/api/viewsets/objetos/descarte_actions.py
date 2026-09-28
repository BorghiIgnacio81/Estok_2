"""
Mixins de DESCARTE con período de gracia y administración física del espacio.

Rutas que expone dentro de /api/objetos/:

    GET  /api/objetos/contexto_descarte/       → tiempos de gracia + permisos
    POST /api/objetos/{id}/ordenar_descarte/   → abre la orden de tirar
    POST /api/objetos/{id}/cancelar_descarte/  → reclama (conservar / mudar)
    POST /api/objetos/{id}/confirmar_descarte/ → baja física (Admin. Físico)
    POST /api/objetos/{id}/despachar_envio/    → despacho del envío (Admin. Físico)

Toda la lógica de negocio vive en inventario/services/descarte_service.py:
este mixin solo traduce HTTP ↔ servicio (sin duplicar reglas).

Permisos:
  - ordenar / cancelar el descarte → mismo padrón que la pestaña Decisiones
    (dueño original, beneficiario o miembro con `can_edit`).
  - confirmar el descarte final y despachar envíos → SOLO Administrador Físico
    (Role.es_administrador_fisico, nombre de rol de almacén o superusuario).
"""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from ....services import descarte_service
from .decisiones_actions import payload_objeto_decision


class DescarteActionsMixin:
    """Período de gracia del descarte y acciones físicas del espacio."""

    # ------------------------------------------------------------------
    # Helpers internos
    # ------------------------------------------------------------------
    @staticmethod
    def _estok_id(request):
        """Tenant activo del request (header X-Estok-Id con fallback a query)."""
        return (
            request.headers.get('X-Estok-Id')
            or request.query_params.get('estok_id')
        )

    @staticmethod
    def _error(mensaje, codigo=status.HTTP_400_BAD_REQUEST):
        """Respuesta de error uniforme del módulo ({'error': mensaje})."""
        return Response({'error': mensaje}, status=codigo)

    def _sin_permiso_fisico(self):
        """403 estándar cuando la acción exige presencia física en el almacén."""
        return self._error(
            'Solo un Administrador Físico del Estok (Encargado de Almacén) '
            'puede ejecutar esta acción.',
            status.HTTP_403_FORBIDDEN,
        )

    def _es_administrador_fisico(self, request):
        return descarte_service.es_administrador_fisico(
            request.user, self._estok_id(request)
        )

    # ------------------------------------------------------------------
    # Contexto (tiempos de gracia y permisos del usuario logueado)
    # ------------------------------------------------------------------
    @action(detail=False, methods=['get'])
    def contexto_descarte(self, request):
        """
        Contexto del período de gracia para el Estok activo.

        GET /api/objetos/contexto_descarte/

        La UI NO hardcodea las opciones de gracia: las recibe de acá, junto con
        la cantidad de usuarios activos (que define si el selector es
        obligatorio) y si el usuario logueado es Administrador Físico.
        """
        estok_id = self._estok_id(request)
        return Response({
            'tiempos_gracia': descarte_service.tiempos_gracia(),
            'total_usuarios_activos': descarte_service.total_usuarios_activos(estok_id),
            'requiere_tiempo_gracia': descarte_service.requiere_tiempo_gracia(estok_id),
            'puede_administrar_fisico': self._es_administrador_fisico(request),
        })

    # ------------------------------------------------------------------
    # Orden de descarte (abre el período de gracia)
    # ------------------------------------------------------------------
    @action(detail=True, methods=['post'])
    def ordenar_descarte(self, request, pk=None):
        """
        Ordena tirar el objeto persistiendo el fin EXACTO del período de gracia.

        POST /api/objetos/{id}/ordenar_descarte/  { "tiempo_gracia": "3_dias" }

        El tiempo de gracia es OBLIGATORIO cuando el Estok tiene más de un
        usuario activo (lo valida el service); con un solo usuario el descarte
        se ordena sin plazo y queda listo para la ejecución física.
        """
        objeto = self.get_object()
        if not descarte_service.puede_decidir_descarte(request.user, objeto):
            return self._error(
                'Solo el dueño, el beneficiario o un miembro con permiso de '
                'edición puede ordenar el descarte de este objeto.',
                status.HTTP_403_FORBIDDEN,
            )

        try:
            descarte_service.ordenar_descarte(
                objeto, request.data.get('tiempo_gracia'), request.user
            )
        except ValueError as error:
            return self._error(str(error))

        etiqueta = descarte_service.etiqueta_gracia(request.data.get('tiempo_gracia'))
        mensaje = (
            f"🗑️ \"{objeto.nombre}\" pasó al bloque de descarte. "
            f"Período de reclamo: {etiqueta}. Mientras esté vigente, cualquiera "
            "puede reclamarlo para conservarlo o mudarlo."
            if etiqueta
            else f"🗑️ \"{objeto.nombre}\" quedó listo para el descarte físico."
        )
        return Response({
            'mensaje': mensaje,
            'objeto': payload_objeto_decision(objeto, request),
        })

    # ------------------------------------------------------------------
    # Reclamo (cancela la orden mutando el estado)
    # ------------------------------------------------------------------
    @action(detail=True, methods=['post'])
    def cancelar_descarte(self, request, pk=None):
        """
        RECLAMA el objeto antes de que venza el período de gracia.

        POST /api/objetos/{id}/cancelar_descarte/  { "accion": "conservar" | "mudar" }
        """
        objeto = self.get_object()
        if not descarte_service.puede_decidir_descarte(request.user, objeto):
            return self._error(
                'Solo el dueño, el beneficiario o un miembro con permiso de '
                'edición puede reclamar este objeto.',
                status.HTTP_403_FORBIDDEN,
            )

        try:
            descarte_service.cancelar_descarte(objeto, request.data.get('accion'))
        except ValueError as error:
            return self._error(str(error))

        destino = (
            'la lista de protección (Conservar)'
            if objeto.owner_action == 'conservar'
            else 'la mudanza inter-Estok (Mudar)'
        )
        return Response({
            'mensaje': (
                f"✅ \"{objeto.nombre}\" fue reclamado y salió del descarte: "
                f"ahora figura en {destino}."
            ),
            'objeto': payload_objeto_decision(objeto, request),
        })

    # ------------------------------------------------------------------
    # Descarte físico final (solo Administrador Físico)
    # ------------------------------------------------------------------
    @action(detail=True, methods=['post'])
    def confirmar_descarte(self, request, pk=None):
        """
        CONFIRMA el descarte definitivo del objeto (baja lógica).

        POST /api/objetos/{id}/confirmar_descarte/

        Exige que el período de gracia ya haya vencido y que el usuario sea
        Administrador Físico del Estok activo.
        """
        if not self._es_administrador_fisico(request):
            return self._sin_permiso_fisico()

        objeto = self.get_object()
        try:
            descarte_service.confirmar_descarte(objeto, request.user)
        except ValueError as error:
            return self._error(str(error))

        return Response({
            'mensaje': f"🗑️ \"{objeto.nombre}\" fue descartado definitivamente del almacén.",
            'objeto_id': str(objeto.id),
        })

    # ------------------------------------------------------------------
    # Despacho del envío vendido (solo Administrador Físico)
    # ------------------------------------------------------------------
    @action(detail=True, methods=['post'])
    def despachar_envio(self, request, pk=None):
        """
        Marca como DESPACHADO el envío de un objeto vendido.

        POST /api/objetos/{id}/despachar_envio/
        """
        if not self._es_administrador_fisico(request):
            return self._sin_permiso_fisico()

        objeto = self.get_object()
        try:
            descarte_service.despachar_envio(objeto, request.user)
        except ValueError as error:
            return self._error(str(error))

        return Response({
            'mensaje': f"📦 Envío de \"{objeto.nombre}\" marcado como despachado.",
            'objeto': payload_objeto_decision(objeto, request),
        })
