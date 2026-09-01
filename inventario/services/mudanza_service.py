"""
Servicio de Mudanza Inter-Estok (transferencia hermética entre inquilinatos).

LÓGICA DE CASCADA:
  - Al transferir un CONTENEDOR (mueble grande), se re-apunta su `ubicacion`
    (la FK real de tenant del modelo Contenedor) al Estok destino y se
    propagan en cascada:
      1. Todos los sub-contenedores (recursivo).
      2. Todos los objetos alojados en el interior de cada contenedor
         (su FK `estok` se actualiza al destino).
    Las coordenadas de grilla (parent_grid_row/col) se resetean porque son
    relativas al nodo padre de origen.
  - Al transferir un OBJETO, se actualiza su `estok` + ubicación/contenedor
    destino y también sus objetos contenidos (objeto_padre).

Todo el proceso corre en UNA sola transacción: si algo falla a mitad de
camino, PostgreSQL revierte el bloque completo (integridad multi-tenant).
"""

from django.db import transaction
from rest_framework.exceptions import ValidationError

from ..models import Contenedor, Objeto


def _rechazar_ciclo(contenedor, nuevo_padre):
    """Evita que un contenedor quede dentro de su propia descendencia."""
    cursor = nuevo_padre.parent_contenedor
    visitados = set()
    while cursor is not None:
        if str(cursor.id) == str(contenedor.id):
            raise ValidationError("No se puede crear un ciclo jerárquico entre contenedores.")
        if cursor.id in visitados:
            break
        visitados.add(cursor.id)
        cursor = cursor.parent_contenedor


def _mover_contenedor_recursivo(contenedor, estok_destino, ubicacion_destino, nuevo_padre):
    """Mueve un contenedor + toda su descendencia. Devuelve contadores."""
    contenedor.ubicacion = ubicacion_destino
    contenedor.parent_contenedor = nuevo_padre
    contenedor.parent_grid_row = None
    contenedor.parent_grid_col = None
    contenedor.save(update_fields=[
        'ubicacion', 'parent_contenedor', 'parent_grid_row', 'parent_grid_col', 'updated_at',
    ])

    # Objetos directos del contenedor → Estok destino (misma ubicación destino).
    objetos_movidos = contenedor.objetos.filter(deleted_at__isnull=True).update(
        estok=estok_destino,
        ubicacion=ubicacion_destino,
        parent_grid_row=None,
        parent_grid_col=None,
    )

    sub_movidos = 0
    objetos_sub = 0
    for sub in contenedor.subcontenedores.all():
        sub_movidos += 1
        objetos_sub += _mover_contenedor_recursivo(sub, estok_destino, ubicacion_destino, None)

    return objetos_movidos + objetos_sub


def _mover_objeto_recursivo(objeto, estok_destino, ubicacion_destino, contenedor_destino):
    """Mueve un objeto y sus objetos contenidos (objeto_padre). Devuelve cantidad."""
    objeto.estok = estok_destino
    objeto.ubicacion = ubicacion_destino
    objeto.contenedor = contenedor_destino
    objeto.parent_grid_row = None
    objeto.parent_grid_col = None
    objeto.save(update_fields=[
        'estok', 'ubicacion', 'contenedor', 'parent_grid_row', 'parent_grid_col', 'updated_at',
    ])

    total = 1
    for hijo in objeto.objetos_contenidos.filter(deleted_at__isnull=True):
        total += _mover_objeto_recursivo(hijo, estok_destino, ubicacion_destino, None)
    return total

class MudanzaService:
    """API pública del servicio de mudanza (las validaciones de membresía
    y pertenencia de los destinos al Estok destino corren en la vista)."""

    @staticmethod
    @transaction.atomic
    def transferir_contenedor(contenedor, estok_destino, ubicacion_destino, contenedor_destino=None):
        """
        Transfiere un contenedor raíz (o sub-contenedor) al Estok destino
        propagando en cascada sub-contenedores y objetos internos.
        """
        estok_origen = contenedor.ubicacion.estok
        if str(estok_origen.id) == str(estok_destino.id):
            raise ValidationError("El contenedor ya pertenece al Estok destino.")

        if contenedor_destino is not None:
            if str(contenedor_destino.id) == str(contenedor.id):
                raise ValidationError("Un contenedor no puede ser su propio contenedor padre.")
            _rechazar_ciclo(contenedor, contenedor_destino)

        objetos_movidos = _mover_contenedor_recursivo(
            contenedor, estok_destino, ubicacion_destino, contenedor_destino,
        )

        return {
            'mensaje': f'«{contenedor.nombre}» y su contenido migraron a «{estok_destino.nombre}».',
            'tipo': 'contenedor',
            'contenedor_id': str(contenedor.id),
            'contenedor_nombre': contenedor.nombre,
            'estok_origen_id': str(estok_origen.id),
            'estok_destino_id': str(estok_destino.id),
            'estok_destino_nombre': estok_destino.nombre,
            'objetos_movidos': objetos_movidos,
        }

    @staticmethod
    @transaction.atomic
    def transferir_objeto(objeto, estok_destino, ubicacion_destino, contenedor_destino=None):
        """
        Transfiere un objeto al Estok destino (junto a sus objetos contenidos).
        """
        if objeto.estok_id and str(objeto.estok_id) == str(estok_destino.id):
            raise ValidationError("El objeto ya pertenece al Estok destino.")

        total_movidos = _mover_objeto_recursivo(
            objeto, estok_destino, ubicacion_destino, contenedor_destino,
        )

        return {
            'mensaje': f'«{objeto.nombre}» migró a «{estok_destino.nombre}».',
            'tipo': 'objeto',
            'objeto_id': str(objeto.id),
            'objeto_nombre': objeto.nombre,
            'estok_destino_id': str(estok_destino.id),
            'estok_destino_nombre': estok_destino.nombre,
            'objetos_movidos': total_movidos,
        }

