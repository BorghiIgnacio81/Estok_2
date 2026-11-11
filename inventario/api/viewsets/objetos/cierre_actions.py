"""
Mixin del CIERRE DE CICLO de las decisiones dentro del viewset de Objetos.

Rutas que expone dentro de /api/objetos/:

    POST /api/objetos/{id}/marcar_vendido/  → cierra la venta y registra el
                                              ingreso financiero
    POST /api/objetos/{id}/marcar_tirado/   → cierra el descarte (baja lógica)
    GET  /api/objetos/ventas/               → histórico + total por vendedor

Alimenta la Sección 1 («✅ Decisiones tomadas (En proceso)») de
/alertas-stock: los objetos con decisión permanecen ahí hasta que el usuario
presiona el botón de cierre.

La lógica de negocio vive en `inventario/services/cierre_service.py`: este mixin
sólo traduce HTTP ↔ servicio (sin duplicar reglas ni validaciones).

Permisos: el cierre exige la misma habilitación que el resto de la pestaña
Decisiones (dueño original, beneficiario o miembro con `can_edit` del Estok
activo). Lo valida `descarte_service.puede_decidir_descarte`.
"""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from ....api.tenant_activo import estok_id_de_request
from ....services import cierre_service, descarte_service


def _nombre_usuario(usuario):
    """Nombre legible del vendedor (o None cuando no hay cuenta asociada)."""
    if not usuario:
        return None
    return usuario.get_full_name() or usuario.username


class CierreActionsMixin:
    """Cierre del ciclo de una decisión patrimonial (vender / tirar)."""

    # ------------------------------------------------------------------
    # Helpers internos
    # ------------------------------------------------------------------
    @staticmethod
    def _estok_activo(request):
        """Tenant activo del request (header X-Estok-Id con fallback a query)."""
        return estok_id_de_request(request)

    @staticmethod
    def _error_cierre(mensaje, codigo=status.HTTP_400_BAD_REQUEST):
        """Respuesta de error uniforme del módulo ({'error': mensaje})."""
        return Response({'error': mensaje}, status=codigo)

    def _sin_permiso_cierre(self):
        """403 estándar del cierre (mismo padrón que la pestaña Decisiones)."""
        return self._error_cierre(
            'Solo el dueño, el beneficiario o un miembro con permiso de edición '
            'puede cerrar el ciclo de este objeto.',
            status.HTTP_403_FORBIDDEN,
        )

    # ------------------------------------------------------------------
    # Cierre · VENDER (ingreso financiero + archivo del objeto)
    # ------------------------------------------------------------------
    @action(detail=True, methods=['post'], url_path='marcar_vendido')
    def marcar_vendido(self, request, pk=None):
        """
        Cierra el ciclo de un objeto con decisión de Vender.

        POST /api/objetos/{id}/marcar_vendido/
             { "precio_venta": "150.00", "moneda": "USD", "canal": "mercadolibre" }

        Crea el asiento `VentaObjeto` —ingreso financiero contabilizado junto
        al `usuario_vendedor` autenticado— y ARCHIVA el objeto (baja lógica):
        deja de formar parte del Estok activo.
        """
        objeto = self.get_object()
        if not descarte_service.puede_decidir_descarte(request.user, objeto):
            return self._sin_permiso_cierre()

        try:
            venta = cierre_service.marcar_vendido(
                objeto,
                request.user,
                precio_venta=request.data.get('precio_venta'),
                canal=request.data.get('canal'),
                moneda=request.data.get('moneda'),
                estok_id=self._estok_activo(request),
            )
        except ValueError as error:
            return self._error_cierre(str(error))

        return Response(
            {
                'mensaje': (
                    f"✅ \"{objeto.nombre}\" quedó marcado como VENDIDO y salió del "
                    'Estok activo. El ingreso quedó registrado.'
                ),
                'objeto_id': str(objeto.id),
                'venta': {
                    'id': str(venta.id),
                    'objeto_nombre': venta.objeto_nombre,
                    'precio_venta': (
                        str(venta.precio_venta) if venta.precio_venta is not None else None
                    ),
                    'moneda': venta.moneda,
                    'canal': venta.canal,
                    'usuario_vendedor_id': (
                        str(venta.usuario_vendedor_id)
                        if venta.usuario_vendedor_id else None
                    ),
                    'usuario_vendedor_nombre': _nombre_usuario(venta.usuario_vendedor),
                    'vendido_en': venta.vendido_en.isoformat(),
                },
            },
            status=status.HTTP_201_CREATED,
        )

    # ------------------------------------------------------------------
    # Cierre · TIRAR / DONAR (baja lógica del Estok activo)
    # ------------------------------------------------------------------
    @action(detail=True, methods=['post'], url_path='marcar_tirado')
    def marcar_tirado(self, request, pk=None):
        """
        Cierra el ciclo de un objeto con decisión de Tirar / Donar.

        POST /api/objetos/{id}/marcar_tirado/

        Aplica la baja lógica (el objeto abandona el Estok activo) respetando el
        período de gracia: mientras el plazo siga vigente, el objeto todavía
        puede ser reclamado y el cierre se rechaza con HTTP 400.
        """
        objeto = self.get_object()
        if not descarte_service.puede_decidir_descarte(request.user, objeto):
            return self._sin_permiso_cierre()

        try:
            cierre_service.marcar_tirado(objeto, request.user)
        except ValueError as error:
            return self._error_cierre(str(error))

        return Response({
            'mensaje': (
                f"🗑️ \"{objeto.nombre}\" quedó marcado como TIRADO / DONADO y salió "
                'del Estok activo.'
            ),
            'objeto_id': str(objeto.id),
        })

    # ------------------------------------------------------------------
    # Contabilidad del Estok (histórico de ventas por vendedor)
    # ------------------------------------------------------------------
    @action(detail=False, methods=['get'])
    def ventas(self, request):
        """
        Histórico de ventas del Estok activo (ingresos registrados).

        GET /api/objetos/ventas/

        Devuelve el listado de asientos (objeto, precio, moneda, canal, fecha y
        `usuario_vendedor_id`) y el resumen acumulado por vendedor.
        """
        estok_id = self._estok_activo(request)
        asientos = cierre_service.ventas_del_estok(estok_id)

        resultados = [
            {
                'id': str(venta.id),
                'objeto_id': str(venta.objeto_id) if venta.objeto_id else None,
                'objeto_nombre': venta.objeto_nombre,
                'precio_venta': (
                    str(venta.precio_venta) if venta.precio_venta is not None else None
                ),
                'moneda': venta.moneda,
                'canal': venta.canal,
                'canal_label': venta.get_canal_display(),
                'usuario_vendedor_id': (
                    str(venta.usuario_vendedor_id) if venta.usuario_vendedor_id else None
                ),
                'usuario_vendedor_nombre': _nombre_usuario(venta.usuario_vendedor),
                'vendido_en': venta.vendido_en.isoformat() if venta.vendido_en else None,
            }
            for venta in asientos
        ]

        vendedores = []
        for fila in cierre_service.resumen_por_vendedor(estok_id):
            nombre = ' '.join(
                parte for parte in (
                    fila['usuario_vendedor__first_name'],
                    fila['usuario_vendedor__last_name'],
                ) if parte
            ).strip()
            vendedores.append({
                'usuario_vendedor_id': (
                    str(fila['usuario_vendedor_id'])
                    if fila['usuario_vendedor_id'] else None
                ),
                'usuario_vendedor_nombre': (
                    nombre or fila['usuario_vendedor__username'] or None
                ),
                'cantidad': fila['cantidad'],
                'total': str(fila['total']) if fila['total'] is not None else None,
            })

        return Response({
            'count': len(resultados),
            'results': resultados,
            'vendedores': vendedores,
        })
