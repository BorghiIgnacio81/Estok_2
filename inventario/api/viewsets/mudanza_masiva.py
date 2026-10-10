"""
Endpoint de Migración MASIVA entre Estoks: POST /api/inventario/mudanza/todo/.

«Mudar Todo el Stock»: transfiere EN BLOQUE el inventario móvil del Estok
ORIGEN hacia el Estok DESTINO dejándolo «en tránsito», y purga físicamente los
elementos que el operador excluyó desde el modal de previsualización.

Protegido estrictamente (mismo contrato multi-tenant que la mudanza individual):
  - Sólo usuarios autenticados.
  - El usuario debe ser MIEMBRO del Estok ORIGEN (inquilinato ACTIVO, header
    `X-Estok-Id`) y del Estok DESTINO.
  - La purga de `excluir_ids` se acota SIEMPRE al Estok origen en el servicio.

Cuerpo esperado:
  { "estok_destino_id": uuid, "excluir_ids": [uuid, ...] }   # exclusión opcional
"""

from uuid import UUID

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from ...models import Estok
from ...services.mudanza_masiva_service import MudanzaMasivaService
from ..serializers import MudanzaMasivaSerializer
from .mudanza import _detalle_error, _validar_membresia


class MudanzaMasivaView(APIView):
    """Migra TODO el stock móvil del Estok activo hacia el Estok destino."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = MudanzaMasivaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # ------------------------------------------------------------------
        # ESTOK ORIGEN: inquilinato ACTIVO (header X-Estok-Id, con respaldo en
        # el cuerpo para scripts) + membresía.
        # ------------------------------------------------------------------
        estok_origen_id = (
            request.headers.get('X-Estok-Id')
            or request.data.get('estok_origen_id')
        )
        if not estok_origen_id:
            raise ValidationError(
                "Falta el Estok de origen: enviá el header X-Estok-Id del "
                "inquilinato activo."
            )
        try:
            estok_origen_uuid = UUID(str(estok_origen_id))
        except (TypeError, ValueError):
            raise ValidationError("El Estok activo (X-Estok-Id) no es un UUID válido.")
        estok_origen = get_object_or_404(Estok, id=estok_origen_uuid)

        # ------------------------------------------------------------------
        # ESTOK DESTINO
        # ------------------------------------------------------------------
        estok_destino = get_object_or_404(Estok, id=data['estok_destino_id'])
        if str(estok_origen.id) == str(estok_destino.id):
            raise ValidationError("El Estok destino debe ser distinto del Estok origen.")

        _validar_membresia(request.user, estok_origen.id)
        _validar_membresia(request.user, estok_destino.id)

        # ------------------------------------------------------------------
        # MIGRACIÓN MASIVA (una sola transacción, ver MudanzaMasivaService)
        # ------------------------------------------------------------------
        try:
            resultado = MudanzaMasivaService.mudar_todo(
                estok_origen, estok_destino, data.get('excluir_ids'),
            )
        except ValidationError as exc:
            return Response(
                {'error': _detalle_error(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(resultado, status=status.HTTP_200_OK)
