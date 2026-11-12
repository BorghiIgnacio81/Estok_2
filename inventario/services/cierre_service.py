"""
CIERRE DEL CICLO DE UNA DECISIÓN (Sección 1 de /alertas-stock).

Un objeto con decisión tomada permanece en el Estok ACTIVO hasta que su ciclo
termina. Este servicio centraliza los DOS cierres posibles:

  · VENDER  → `marcar_vendido()`: registra el asiento financiero
    (`VentaObjeto`, con `usuario_vendedor`) y archiva el objeto.
  · TIRAR   → `marcar_tirado()`: delega la baja lógica en
    `descarte_service.confirmar_descarte` (mismo guardia de período de gracia).

En ambos casos el objeto SALE del Estok activo con baja lógica
(`Objeto.deleted_at`) y pasa al histórico/archivado: la información no se
pierde, sólo deja de listarse en el inventario vivo.

Fuente ÚNICA de la regla: la vista HTTP (`api/viewsets/objetos/cierre_actions.py`)
sólo traduce HTTP ↔ servicio, sin duplicar validaciones.
"""

import logging
from decimal import Decimal, InvalidOperation

from django.db.models import Count, Sum
from django.utils import timezone

from ..models import Objeto, VentaObjeto
from . import descarte_service

logger = logging.getLogger(__name__)


# Estados de decisión que significan «marcado para vender» (mismo criterio que
# el tablero de Decisiones: `para_vender` es alias histórico de lectura).
DECISIONES_VENTA = ('vender', 'para_vender')

# Canales válidos para el asiento financiero (los ofrece el modelo).
CANALES_VALIDOS = tuple(clave for clave, _ in VentaObjeto.CANAL_CHOICES)
MONEDAS_VALIDAS = tuple(clave for clave, _ in VentaObjeto.MONEDA_CHOICES)


def _precio(valor):
    """
    Normaliza el precio recibido a Decimal(2) o None.

    Acepta None / cadena vacía (venta sin importe declarado) y lanza ValueError
    con mensaje legible cuando el valor no es numérico o es negativo.
    """
    if valor is None:
        return None
    texto = str(valor).strip().replace(',', '.')
    if not texto:
        return None
    try:
        precio = Decimal(texto)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError('El precio de venta no es un número válido.')
    if precio < 0:
        raise ValueError('El precio de venta no puede ser negativo.')
    return precio.quantize(Decimal('0.01'))


def _canal(valor):
    """Canal normalizado (cae a Mercado Libre cuando no se informa)."""
    canal = str(valor or '').strip().lower()
    if not canal:
        return VentaObjeto.CANAL_MERCADOLIBRE
    if canal not in CANALES_VALIDOS:
        raise ValueError(
            'Canal de venta inválido. Opciones: ' + ', '.join(CANALES_VALIDOS) + '.'
        )
    return canal


def _moneda(valor):
    """Moneda normalizada (USD por defecto, igual que `valor_estimado`)."""
    moneda = str(valor or '').strip().upper()
    if not moneda:
        return VentaObjeto.MONEDA_USD
    if moneda not in MONEDAS_VALIDAS:
        raise ValueError(
            'Moneda inválida. Opciones: ' + ', '.join(MONEDAS_VALIDAS) + '.'
        )
    return moneda


def _estok_del_asiento(objeto, estok_id=None):
    """
    Estok al que se imputa la venta.

    Prioriza el Estok del objeto y cae al tenant activo del request para las
    cargas legacy con `Objeto.estok` nulo (así el ingreso no queda huérfano).
    """
    return objeto.estok_id or estok_id


# =============================================================================
# CIERRE · VENDER (registra el ingreso financiero)
# =============================================================================

def marcar_vendido(
    objeto,
    usuario=None,
    precio_venta=None,
    canal=None,
    moneda=None,
    estok_id=None,
):
    """
    Cierra el ciclo de una decisión de Venta.

    Crea el asiento `VentaObjeto` (ingreso + `usuario_vendedor`) y archiva el
    objeto con baja lógica. Lanza ValueError (la vista responde HTTP 400)
    cuando el objeto no tiene decisión de venta activa, ya salió del Estok
    activo o el precio/moneda/canal no son válidos.
    """
    if objeto.owner_action not in DECISIONES_VENTA:
        raise ValueError('El objeto no tiene una decisión de venta activa.')
    if objeto.deleted_at is not None:
        raise ValueError('El objeto ya salió del Estok activo.')

    precio = _precio(precio_venta)
    if precio is None and objeto.valor_estimado is not None:
        # Sin precio declarado se registra el valor estimado del inventario.
        precio = _precio(objeto.valor_estimado)

    vendedor = usuario if getattr(usuario, 'is_authenticated', False) else None

    venta = VentaObjeto.objects.create(
        objeto=objeto,
        objeto_nombre=objeto.nombre,
        estok_id=_estok_del_asiento(objeto, estok_id),
        usuario_vendedor=vendedor,
        precio_venta=precio,
        moneda=_moneda(moneda),
        canal=_canal(canal),
    )

    objeto.deleted_at = timezone.now()
    objeto.fecha_limite_descarte = None
    objeto.save(update_fields=['deleted_at', 'fecha_limite_descarte', 'updated_at'])

    logger.info(
        "Venta registrada del objeto %s (Estok %s) por %s — %s %s",
        objeto.id,
        venta.estok_id,
        getattr(vendedor, 'username', 'sistema'),
        venta.precio_venta,
        venta.moneda,
    )
    return venta


# =============================================================================
# CIERRE · TIRAR / DONAR (baja lógica del Estok activo)
# =============================================================================

def marcar_tirado(objeto, usuario=None):
    """
    Cierra el ciclo de una decisión de Tirar / Donar.

    Reutiliza `descarte_service.confirmar_descarte` (ÚNICA implementación de la
    baja lógica): exige que el período de gracia haya vencido y limpia el plazo.
    """
    if objeto.owner_action != 'tirar':
        raise ValueError('El objeto no tiene una orden de descarte activa.')
    return descarte_service.confirmar_descarte(objeto, usuario)


# =============================================================================
# CONTABILIDAD (consulta del histórico de ventas del Estok)
# =============================================================================

def ventas_del_estok(estok_id=None):
    """Histórico de ventas del Estok activo, la más reciente primero."""
    qs = VentaObjeto.objects.select_related('usuario_vendedor', 'objeto')
    if estok_id:
        qs = qs.filter(estok_id=estok_id)
    return qs.order_by('-vendido_en')


def resumen_por_vendedor(estok_id=None):
    """
    Total vendido por cada usuario (`usuario_vendedor_id`).

    Alimenta la contabilidad del Estok: cantidad de ventas e importe acumulado
    por vendedor, de mayor a menor.
    """
    return list(
        ventas_del_estok(estok_id)
        .values(
            'usuario_vendedor_id',
            'usuario_vendedor__username',
            'usuario_vendedor__first_name',
            'usuario_vendedor__last_name',
        )
        .annotate(total=Sum('precio_venta'), cantidad=Count('id'))
        .order_by('-total')
    )


# =============================================================================
# HISTÓRICO PATRIMONIAL (objetos que completaron su ciclo)
# -----------------------------------------------------------------------------
# Alimenta la sección «📜 Histórico: Objetos Vendidos y Tirados» de
# /alertas-stock. Un objeto entra al histórico EN CUANTO se cierra su ciclo:
#   · VENDIDO  → asiento `VentaObjeto` (precio, fecha y usuario que vendió).
#   · TIRADO / DONADO → baja lógica con la decisión `tirar` conservada.
# =============================================================================

# Decisión patrimonial que deja al objeto en el histórico de descartes.
DECISION_TIRAR = 'tirar'


def ventas_del_estok_con_objeto(estok_id=None):
    """
    Ventas del Estok con los datos del objeto YA precargados (histórico).

    A diferencia de `ventas_del_estok()` (contabilidad pura), el histórico de la
    pestaña Decisiones pinta la foto, la marca, la categoría y el propietario de
    cada objeto vendido: se precargan acá para no disparar una consulta por
    asiento.
    """
    return (
        ventas_del_estok(estok_id)
        .select_related('objeto__categoria', 'objeto__dueno_original')
        .prefetch_related('objeto__fotos')
    )


def objetos_tirados_del_estok(estok_id=None):
    """
    Objetos que completaron su ciclo patrimonial por DESCARTE (tirados o
    donados): conservan la decisión `tirar` y ya tienen baja lógica
    (`deleted_at`), por lo que salieron del Estok activo.

    El descarte más reciente queda primero. Los objetos VENDIDOS no entran acá:
    su asiento financiero los representa en `ventas_del_estok_con_objeto()`.
    """
    qs = (
        Objeto.objects.filter(
            deleted_at__isnull=False,
            owner_action=DECISION_TIRAR,
        )
        .select_related('categoria', 'dueno_original', 'beneficiario')
        .prefetch_related('fotos')
        .order_by('-deleted_at')
    )
    if estok_id:
        qs = qs.filter(estok_id=estok_id)
    return qs
