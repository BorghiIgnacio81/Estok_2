"""
Servicio de Control de Stock y Valoración.

Gestiona el seguimiento de precios (historial de valor_estimado)
y las alertas de stock/reposición para objetos del inventario.

Funcionalidades:
  - Registrar cambios de precio y calcular plusvalía/depreciación
  - Gestionar alertas de stock con niveles mínimos
  - Detectar objetos que necesitan reposición
"""

import logging
from decimal import Decimal
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field, asdict

from django.utils import timezone
from django.db import transaction
from django.db.models import F

logger = logging.getLogger(__name__)


# =============================================================================
# ESTRUCTURAS DE DATOS
# =============================================================================
@dataclass
class CambioPrecioResult:
    """Resultado del registro de un cambio de precio."""
    objeto_id: str
    objeto_nombre: str
    valor_anterior: Optional[Decimal]
    valor_nuevo: Decimal
    diferencia: Decimal
    porcentaje_cambio: Optional[Decimal]
    tipo_cambio: str  # plusvalia, depreciacion, sin_cambio
    historial_id: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "objeto_id": self.objeto_id,
            "objeto_nombre": self.objeto_nombre,
            "valor_anterior": float(self.valor_anterior) if self.valor_anterior else None,
            "valor_nuevo": float(self.valor_nuevo),
            "diferencia": float(self.diferencia),
            "porcentaje_cambio": float(self.porcentaje_cambio) if self.porcentaje_cambio else None,
            "tipo_cambio": self.tipo_cambio,
            "historial_id": self.historial_id,
        }


@dataclass
class AlertaStockResult:
    """Resultado de la verificación de alertas de stock."""
    objeto_id: str
    objeto_nombre: str
    cantidad_actual: int
    nivel_minimo: int
    necesita_reposicion: bool
    alerta_id: str


# =============================================================================
# SERVICIO DE STOCK Y VALORACIÓN
# =============================================================================
class StockValuationService:
    """
    Servicio para gestionar el historial de precios y alertas de stock.
    """

    def __init__(self):
        pass

    # =========================================================================
    # HISTORIAL DE PRECIOS
    # =========================================================================
    @transaction.atomic
    def registrar_cambio_precio(
        self,
        objeto,
        valor_nuevo: Decimal,
        motivo: str = "",
        registrado_por=None
    ) -> CambioPrecioResult:
        """
        Registra un cambio en el valor_estimado de un objeto.
        Guarda el valor anterior, calcula diferencia y porcentaje.

        Args:
            objeto: Instancia del modelo Objeto.
            valor_nuevo: Nuevo valor estimado.
            motivo: Razón del cambio (ej: "Revalorización por IA").
            registrado_por: Usuario que realizó el cambio (opcional).

        Returns:
            CambioPrecioResult con los detalles del cambio.
        """
        from ..models import HistorialPrecio

        valor_anterior = objeto.valor_estimado

        # Actualizar el valor en el objeto
        objeto.valor_estimado = valor_nuevo
        objeto.save(update_fields=["valor_estimado", "updated_at"])

        # Crear registro en el historial
        historial = HistorialPrecio.objects.create(
            objeto=objeto,
            valor_anterior=valor_anterior,
            valor_nuevo=valor_nuevo,
            motivo=motivo,
            registrado_por=registrado_por,
        )

        # Determinar tipo de cambio
        if valor_anterior is None:
            tipo = "primer_registro"
        elif valor_nuevo > valor_anterior:
            tipo = "plusvalia"
        elif valor_nuevo < valor_anterior:
            tipo = "depreciacion"
        else:
            tipo = "sin_cambio"

        logger.info(
            "Precio actualizado para '%s': %s → %s (%s)",
            objeto.nombre, valor_anterior, valor_nuevo, tipo
        )

        return CambioPrecioResult(
            objeto_id=str(objeto.id),
            objeto_nombre=objeto.nombre,
            valor_anterior=valor_anterior,
            valor_nuevo=valor_nuevo,
            diferencia=historial.diferencia or Decimal('0'),
            porcentaje_cambio=historial.porcentaje_cambio,
            tipo_cambio=tipo,
            historial_id=str(historial.id),
        )

    def obtener_historial_precios(self, objeto, limite: int = 20) -> List[Dict[str, Any]]:
        """
        Obtiene el historial de precios de un objeto.

        Args:
            objeto: Instancia del modelo Objeto.
            limite: Número máximo de registros a retornar.

        Returns:
            Lista de diccionarios con el historial de precios.
        """
        from ..models import HistorialPrecio

        historial = (
            HistorialPrecio.objects
            .filter(objeto=objeto)
            .select_related('registrado_por')
            .order_by('-fecha_cambio')[:limite]
        )

        return [
            {
                "id": str(h.id),
                "valor_anterior": float(h.valor_anterior) if h.valor_anterior else None,
                "valor_nuevo": float(h.valor_nuevo),
                "diferencia": float(h.diferencia) if h.diferencia else None,
                "porcentaje_cambio": float(h.porcentaje_cambio) if h.porcentaje_cambio else None,
                "motivo": h.motivo,
                "registrado_por": str(h.registrado_por) if h.registrado_por else None,
                "fecha_cambio": h.fecha_cambio.isoformat(),
            }
            for h in historial
        ]

    def calcular_plusvalia_total(self, objeto) -> Dict[str, Any]:
        """
        Calcula la plusvalía/depreciación total desde el primer registro.

        Args:
            objeto: Instancia del modelo Objeto.

        Returns:
            Dict con el resumen de valoración.
        """
        from ..models import HistorialPrecio

        primer_registro = (
            HistorialPrecio.objects
            .filter(objeto=objeto)
            .order_by('fecha_cambio')
            .first()
        )
        ultimo_registro = (
            HistorialPrecio.objects
            .filter(objeto=objeto)
            .order_by('-fecha_cambio')
            .first()
        )

        if not primer_registro or not ultimo_registro:
            return {
                "objeto": str(objeto),
                "valor_actual": float(objeto.valor_estimado) if objeto.valor_estimado else None,
                "mensaje": "No hay suficiente historial para calcular plusvalía"
            }

        valor_inicial = primer_registro.valor_anterior or primer_registro.valor_nuevo
        valor_actual = ultimo_registro.valor_nuevo
        diferencia = valor_actual - valor_inicial
        porcentaje = ((valor_actual - valor_inicial) / valor_inicial * 100) if valor_inicial != 0 else 0

        return {
            "objeto": str(objeto),
            "valor_inicial": float(valor_inicial),
            "valor_actual": float(valor_actual),
            "diferencia_total": float(diferencia),
            "porcentaje_total": float(porcentaje),
            "tipo": "plusvalia" if diferencia > 0 else "depreciacion" if diferencia < 0 else "sin_cambio",
            "total_cambios": HistorialPrecio.objects.filter(objeto=objeto).count(),
        }

    # =========================================================================
    # ALERTAS DE STOCK
    # =========================================================================
    @transaction.atomic
    def crear_alerta_stock(
        self,
        objeto,
        nivel_minimo: int = 1,
        cantidad_actual: int = 1,
        creada_por=None
    ) -> AlertaStockResult:
        """
        Crea una alerta de stock para un objeto.

        Args:
            objeto: Instancia del modelo Objeto.
            nivel_minimo: Cantidad mínima antes de alertar.
            cantidad_actual: Cantidad actual en inventario.
            creada_por: Usuario que crea la alerta.

        Returns:
            AlertaStockResult con los detalles de la alerta.
        """
        from ..models import AlertaStock

        alerta, created = AlertaStock.objects.update_or_create(
            objeto=objeto,
            defaults={
                "nivel_minimo": nivel_minimo,
                "cantidad_actual": cantidad_actual,
                "activa": True,
                "creada_por": creada_por,
            }
        )

        logger.info(
            "Alerta de stock %s para '%s': %d/%d",
            "creada" if created else "actualizada",
            objeto.nombre,
            cantidad_actual,
            nivel_minimo,
        )

        return AlertaStockResult(
            objeto_id=str(objeto.id),
            objeto_nombre=objeto.nombre,
            cantidad_actual=alerta.cantidad_actual,
            nivel_minimo=alerta.nivel_minimo,
            necesita_reposicion=alerta.necesita_reposicion,
            alerta_id=str(alerta.id),
        )

    def actualizar_cantidad_stock(self, objeto, nueva_cantidad: int) -> AlertaStockResult:
        """
        Actualiza la cantidad actual de un objeto en su alerta de stock.

        Args:
            objeto: Instancia del modelo Objeto.
            nueva_cantidad: Nueva cantidad en inventario.

        Returns:
            AlertaStockResult actualizado.
        """
        from ..models import AlertaStock

        alerta, created = AlertaStock.objects.get_or_create(
            objeto=objeto,
            defaults={
                "nivel_minimo": 1,
                "cantidad_actual": nueva_cantidad,
                "activa": True,
            }
        )

        if not created:
            alerta.cantidad_actual = nueva_cantidad
            alerta.save(update_fields=["cantidad_actual", "ultima_verificacion"])

        return AlertaStockResult(
            objeto_id=str(objeto.id),
            objeto_nombre=objeto.nombre,
            cantidad_actual=alerta.cantidad_actual,
            nivel_minimo=alerta.nivel_minimo,
            necesita_reposicion=alerta.necesita_reposicion,
            alerta_id=str(alerta.id),
        )

    def obtener_alertas_activas(self) -> List[Dict[str, Any]]:
        """
        Obtiene todas las alertas de stock activas.

        Returns:
            Lista de alertas activas con su estado.
        """
        from ..models import AlertaStock

        alertas = AlertaStock.objects.filter(activa=True).select_related('objeto')

        return [
            {
                "id": str(a.id),
                "objeto_id": str(a.objeto.id),
                "objeto_nombre": a.objeto.nombre,
                "cantidad_actual": a.cantidad_actual,
                "nivel_minimo": a.nivel_minimo,
                "necesita_reposicion": a.necesita_reposicion,
                "ultima_verificacion": a.ultima_verificacion.isoformat(),
            }
            for a in alertas
        ]

    def obtener_objetos_a_reponer(self) -> List[Dict[str, Any]]:
        """
        Obtiene todos los objetos que necesitan reposición.

        Returns:
            Lista de objetos que están por debajo del nivel mínimo.
        """
        from ..models import AlertaStock

        alertas = AlertaStock.objects.filter(
            activa=True,
            cantidad_actual__lte=F('nivel_minimo')
        ).select_related('objeto')

        return [
            {
                "id": str(a.id),
                "objeto_id": str(a.objeto.id),
                "objeto_nombre": a.objeto.nombre,
                "cantidad_actual": a.cantidad_actual,
                "nivel_minimo": a.nivel_minimo,
                "faltantes": a.nivel_minimo - a.cantidad_actual,
                "ultima_verificacion": a.ultima_verificacion.isoformat(),
            }
            for a in alertas
        ]

    def desactivar_alerta(self, objeto) -> bool:
        """
        Desactiva la alerta de stock para un objeto.

        Args:
            objeto: Instancia del modelo Objeto.

        Returns:
            True si se desactivó, False si no existía.
        """
        from ..models import AlertaStock

        try:
            alerta = AlertaStock.objects.get(objeto=objeto)
            alerta.activa = False
            alerta.save(update_fields=["activa"])
            logger.info("Alerta de stock desactivada para '%s'", objeto.nombre)
            return True
        except AlertaStock.DoesNotExist:
            return False
