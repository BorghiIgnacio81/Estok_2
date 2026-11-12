"""
Mixin del CIERRE DE CICLO de las decisiones dentro del viewset de Objetos.

Rutas que expone dentro de /api/objetos/:

    POST /api/objetos/{id}/marcar_vendido/  → cierra la venta y registra el
                                              ingreso financiero
    POST /api/objetos/{id}/marcar_tirado/   → cierra el descarte (baja lógica)
    GET  /api/objetos/ventas/               → histórico + total por vendedor
    GET  /api/objetos/historico/            → objetos VENDIDOS y TIRADOS/DONADOS
                                              (sección «📜 Histórico» de la
                                              pestaña Decisiones)

Alimenta la Sección 1 («✅ Decisiones tomadas (En proceso)») de
/alertas-stock: los objetos con decisión permanecen ahí hasta que el usuario
presiona el botón de cierre.

La lógica de negocio vive en `inventario/services/cierre_service.py`: este mixin
sólo traduce HTTP ↔ servicio (sin duplicar reglas ni validaciones).

Permisos: el cierre exige la misma habilitación que el resto de la pestaña
Decisiones (dueño original, beneficiario o miembro con `can_edit` del Estok
activo). Lo valida `descarte_service.puede_decidir_descarte`.
"""

from decimal import Decimal

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


def _foto_principal(objeto):
    """
    URL de la foto principal del objeto archivado (None si no tiene fotos).

    El histórico muestra objetos que ya salieron del Estok activo: la foto se
    resuelve con la MISMA regla que las tarjetas del tablero (principal o, en su
    defecto, la primera cargada).
    """
    if not objeto:
        return None
    fotos = list(objeto.fotos.all())
    principal = next((foto for foto in fotos if foto.es_principal), None)
    foto = principal or (fotos[0] if fotos else None)
    return foto.imagen.url if foto and foto.imagen else None


def _datos_filtro_objeto(objeto):
    """
    Datos que la barra de filtros de /alertas-stock usa como HAYSTACK.

    Se devuelven también en el histórico (nombre, marca, categoría y
    propietario) para que el buscador y el filtro por propietario funcionen
    igual sobre las tarjetas del tablero y sobre las filas del histórico.
    """
    if not objeto:
        return {
            'marca': '',
            'categoria_nombre': None,
            'dueno_id': None,
            'dueno_nombre': None,
        }
    return {
        'marca': objeto.marca or '',
        'categoria_nombre': objeto.categoria.nombre if objeto.categoria else None,
        'dueno_id': str(objeto.dueno_original_id) if objeto.dueno_original_id else None,
        'dueno_nombre': _nombre_usuario(objeto.dueno_original),
    }


def _payload_venta(venta, incluir_historial=False):
    """
    Payload de un asiento `VentaObjeto` (fuente ÚNICA del histórico de ventas).

    Lo comparten GET /api/objetos/ventas/ (contabilidad por vendedor) y
    GET /api/objetos/historico/ (sección «📜 Histórico»), así el contrato de una
    venta no se duplica en dos endpoints. `incluir_historial` agrega la foto del
    objeto y el haystack del filtro (marca / categoría / propietario).
    """
    datos = {
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
    if incluir_historial:
        datos['nombre'] = venta.objeto_nombre
        datos['foto_principal'] = _foto_principal(venta.objeto)
        datos.update(_datos_filtro_objeto(venta.objeto))
    return datos


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

        resultados = [_payload_venta(venta) for venta in asientos]

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

    # ------------------------------------------------------------------
    # Histórico patrimonial (sección «📜 Histórico» de /alertas-stock)
    # ------------------------------------------------------------------
    @action(detail=False, methods=['get'])
    def historico(self, request):
        """
        Histórico patrimonial del Estok: objetos VENDIDOS y TIRADOS / DONADOS.

        GET /api/objetos/historico/

        Alimenta la sección «📜 Histórico: Objetos Vendidos y Tirados» de
        /alertas-stock. Un objeto entra acá EN CUANTO se cierra su ciclo:

          · VENDIDOS → asiento `VentaObjeto` creado por «✅ Marcar como
            Vendido»: precio final, fecha, canal y el USUARIO que concretó la
            venta (`usuario_vendedor`).
          · TIRADOS / DONADOS → objeto con baja lógica y decisión `tirar`
            conservada: fecha del descarte definitivo.

        Cada fila incluye el HAYSTACK de la barra de filtros de la página
        (nombre, marca, categoría y propietario) para que el buscador funcione
        igual que sobre las tarjetas del tablero.
        """
        estok_id = self._estok_activo(request)

        vendidos = []
        recaudado = Decimal('0')
        for venta in cierre_service.ventas_del_estok_con_objeto(estok_id):
            vendidos.append(_payload_venta(venta, incluir_historial=True))
            if venta.precio_venta is not None:
                recaudado += venta.precio_venta

        tirados = []
        for objeto in cierre_service.objetos_tirados_del_estok(estok_id):
            tirados.append({
                'id': str(objeto.id),
                'nombre': objeto.nombre,
                'foto_principal': _foto_principal(objeto),
                'descarte_en': (
                    objeto.deleted_at.isoformat() if objeto.deleted_at else None
                ),
                **_datos_filtro_objeto(objeto),
            })

        total = len(vendidos) + len(tirados)
        return Response({
            'count': total,
            'vendidos': vendidos,
            'tirados': tirados,
            'resumen': {
                'vendidos': len(vendidos),
                'tirados': len(tirados),
                'total': total,
                'recaudado': str(recaudado),
            },
        })

