"""
Endpoint de Mudanza Inter-Estok: POST /api/inventario/mudanza/.

Protegido estrictamente:
  - Solo usuarios autenticados.
  - El usuario debe ser MIEMBRO del Estok de origen del elemento Y del
    Estok destino (validación manual multi-tenant; no confía en X-Estok-Id).
  - El destino espacial (ubicacion/contenedor) debe pertenecer al Estok
    destino.
  - Si no se indica destino espacial, se crea (o reutiliza) una ubicación
    "Zona de Mudanza" dentro del Estok destino.
"""

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from ...models import Estok, Ubicacion, Contenedor, Objeto, Membresia
from ...services.mudanza_service import MudanzaService
from ..serializers import MudanzaSerializer


def _validar_membresia(user, estok_id):
    """El usuario debe tener membresía activa en el Estok indicado."""
    if user.is_superuser:
        return
    if not Membresia.objects.filter(usuario=user, estok_id=estok_id).exists():
        raise PermissionDenied("No tenés membresía en uno de los Estoks de la operación.")


def _detalle_error(exc):
    detalle = exc.detail
    if isinstance(detalle, (list, tuple)):
        return ' '.join(str(d) for d in detalle)
    if isinstance(detalle, dict):
        return '; '.join(f"{k}: {v}" for k, v in detalle.items())
    return str(detalle)


class MudanzaView(APIView):
    """
    Transfiere un contenedor (con toda su cascada) o un objeto entre Estoks.
    Cuerpo esperado:
      { "contenedor_id": uuid }  O  { "objeto_id": uuid }
      { "estok_destino_id": uuid }                 (obligatorio)
      { "ubicacion_destino_id": uuid }             (opcional)
      { "contenedor_destino_id": uuid }            (opcional)
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = MudanzaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # ------------------------------------------------------------------
        # ESTOK DESTINO + membresía
        # ------------------------------------------------------------------
        estok_destino = get_object_or_404(Estok, id=data['estok_destino_id'])
        _validar_membresia(request.user, estok_destino.id)

        # ------------------------------------------------------------------
        # DESTINO ESPACIAL (ubicacion / contenedor dentro del Estok destino)
        # ------------------------------------------------------------------
        contenedor_destino = None
        if data.get('contenedor_destino_id'):
            contenedor_destino = get_object_or_404(
                Contenedor.objects.select_related('ubicacion__estok'),
                id=data['contenedor_destino_id'],
            )
            if contenedor_destino.ubicacion.estok_id != estok_destino.id:
                raise PermissionDenied("El contenedor destino no pertenece al Estok destino.")
            ubicacion_destino = contenedor_destino.ubicacion
        elif data.get('ubicacion_destino_id'):
            ubicacion_destino = get_object_or_404(
                Ubicacion.objects.select_related('estok'),
                id=data['ubicacion_destino_id'],
            )
            if ubicacion_destino.estok_id != estok_destino.id:
                raise PermissionDenied("La ubicación destino no pertenece al Estok destino.")
        else:
            # Zona de mudanza automática: destino espacial de respaldo.
            ubicacion_destino = Ubicacion.objects.filter(
                nombre='Zona de Mudanza', estok=estok_destino,
            ).first()
            if ubicacion_destino is None:
                ubicacion_destino = Ubicacion.objects.create(
                    nombre='Zona de Mudanza',
                    estok=estok_destino,
                    piso='PLANTA_BAJA',
                    grid_filas=1,
                    grid_columnas=1,
                    grid_colspan=1,
                    grid_rowspan=1,
                )

        # ------------------------------------------------------------------
        # TRANSFERENCIA (contenedor XOR objeto — garantizado por el serializer)
        # ------------------------------------------------------------------
        try:
            if data.get('contenedor_id'):
                contenedor = get_object_or_404(
                    Contenedor.objects.select_related('ubicacion__estok'),
                    id=data['contenedor_id'],
                )
                _validar_membresia(request.user, contenedor.ubicacion.estok_id)
                resultado = MudanzaService.transferir_contenedor(
                    contenedor, estok_destino, ubicacion_destino, contenedor_destino,
                )
            else:
                objeto = get_object_or_404(Objeto, id=data['objeto_id'])
                _validar_membresia(request.user, objeto.estok_id)
                resultado = MudanzaService.transferir_objeto(
                    objeto, estok_destino, ubicacion_destino, contenedor_destino,
                )
        except ValidationError as exc:
            return Response(
                {'error': _detalle_error(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(resultado, status=status.HTTP_200_OK)
