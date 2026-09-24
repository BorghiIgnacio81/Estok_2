"""
Endpoint de Mudanza Inter-Estok: POST /api/inventario/mudanza/.

Protegido estrictamente:
  - Solo usuarios autenticados.
  - El usuario debe ser MIEMBRO del Estok de origen del elemento Y del
    Estok destino (validación manual multi-tenant; no confía en X-Estok-Id).
  - El destino espacial (ubicacion/contenedor) debe pertenecer al Estok
    destino.
  - Sin destino espacial (`en_transito` o body sin ubicación) el elemento
    aterriza en la ubicación limbo «En Tránsito» del Estok destino.
"""

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from ...models import Estok, Ubicacion, Contenedor, Objeto, Membresia
from ...services.mudanza_service import MudanzaService
from ..serializers import MudanzaSerializer

# Habitación «limbo» del Estok destino: receptora estática de los elementos que
# el usuario deja sin ubicación física (zona «En Tránsito» del tablero).
NOMBRE_LIMBO = 'En Tránsito'
# Nombre histórico del mismo limbo (compatibilidad: no duplicar habitaciones).
NOMBRE_LIMBO_LEGACY = 'Zona de Mudanza'


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


def _ubicacion_limbo(estok_destino):
    """
    Habitación limbo del Estok destino (zona «En Tránsito»).

    Los elementos que el operador suelta en «En Tránsito» no van a una
    habitación real: esperan en este espacio del inquilinato destino hasta que
    los ubique desde el visor ordinario (Almacenamiento). Se reutiliza la
    ubicación ya existente (incluida la histórica «Zona de Mudanza») para no
    acumular limbos duplicados.
    """
    ubicacion = Ubicacion.objects.filter(
        nombre=NOMBRE_LIMBO, estok=estok_destino,
    ).first()
    if ubicacion is None:
        ubicacion = Ubicacion.objects.filter(
            nombre=NOMBRE_LIMBO_LEGACY, estok=estok_destino,
        ).first()
    if ubicacion is None:
        ubicacion = Ubicacion.objects.create(
            nombre=NOMBRE_LIMBO,
            estok=estok_destino,
            piso='PLANTA_BAJA',
            grid_filas=1,
            grid_columnas=1,
            grid_colspan=1,
            grid_rowspan=1,
        )
    return ubicacion


class MudanzaView(APIView):
    """
    Transfiere un elemento MÓVIL (contenedor o objeto) entre Estoks.

    Cuerpo esperado por el drag & drop del tablero (POST /api/inventario/mudanza/):
      { "contenedor_id": uuid }  O  { "objeto_id": uuid }   (exactamente uno)
      { "estok_destino_id": uuid }                          (obligatorio)
      { "ubicacion_destino_id": uuid }        (Habitación destino donde se soltó)
      { "contenedor_destino_id": uuid }       (opcional: soltado dentro de un mueble)
      { "en_transito": true }                 (soltado en la zona «En Tránsito»:
                                               viaja al Estok destino SIN ubicación
                                               física; excluyente con las dos anteriores)

    La mutación completa corre en una sola transacción
    (ver services/mudanza_service.MudanzaService).
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = MudanzaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        en_transito = bool(data.get('en_transito'))

        # ------------------------------------------------------------------
        # ESTOK DESTINO + membresía
        # ------------------------------------------------------------------
        estok_destino = get_object_or_404(Estok, id=data['estok_destino_id'])
        _validar_membresia(request.user, estok_destino.id)

        # ------------------------------------------------------------------
        # DESTINO ESPACIAL (ubicacion / contenedor dentro del Estok destino)
        # ------------------------------------------------------------------
        contenedor_destino = None
        if en_transito:
            # Zona «En Tránsito»: el elemento NO se ancla a una habitación real.
            # Los contenedores aterrizan en la habitación limbo (`Contenedor.ubicacion`
            # es NOT NULL) y los objetos quedan huérfanos (`ubicacion=None`) dentro
            # del inquilinato destino, listos para ubicar desde el visor ordinario.
            ubicacion_destino = _ubicacion_limbo(estok_destino)
        elif data.get('contenedor_destino_id'):
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
            # Sin destino espacial: limbo del inquilinato destino.
            ubicacion_destino = _ubicacion_limbo(estok_destino)

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
                    en_transito=en_transito,
                )
            else:
                objeto = get_object_or_404(Objeto, id=data['objeto_id'])
                _validar_membresia(request.user, objeto.estok_id)
                resultado = MudanzaService.transferir_objeto(
                    objeto, estok_destino, ubicacion_destino, contenedor_destino,
                    en_transito=en_transito,
                )
        except ValidationError as exc:
            return Response(
                {'error': _detalle_error(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(resultado, status=status.HTTP_200_OK)
