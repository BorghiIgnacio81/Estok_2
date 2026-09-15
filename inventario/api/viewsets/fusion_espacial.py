"""
Motor GENÉRICO de fusión de espacios en "L" (fusion_grupo).

Centraliza la lógica relacional que comparten Ubicación (Nivel 1/2) y
Contenedor (Nivel 3/4): unificar varios espacios bajo un mismo `fusion_grupo`
UUID, disolver el grupo y editar de forma consolidada (nombre + geometría
elástica ui_left/ui_top/ui_width/ui_height) en UNA sola transacción atómica.

Los ViewSets pasan el modelo concreto (`Ubicacion` o `Contenedor`) y una
función `estok_id_de(obj)` que resuelve su Estok, de modo que el aislamiento
multi-tenant se valida sin duplicar código.
"""
from uuid import uuid4

from django.db import transaction
from rest_framework.exceptions import ValidationError

# Campos de geometría elástica editables de forma consolidada por el motor 2D.
CAMPOS_GEOMETRIA = ('ui_left', 'ui_top', 'ui_width', 'ui_height')


def _mismo_estok(base, objetivo, estok_id_de):
    estok_base = estok_id_de(base)
    for espacio in objetivo:
        if estok_id_de(espacio) != estok_base:
            raise ValidationError(
                {'error': 'Todos los espacios a fusionar deben pertenecer al mismo Estok.'}
            )


def fusionar_espacios(modelo, base, ids, estok_id_de):
    """
    Une `base` + los espacios de `ids` bajo un MISMO `fusion_grupo` UUID.

    Si `base` ya pertenecía a un grupo, se REUTILIZA su ID (fusión encadenada
    sin romper grupos existentes). Valida el aislamiento multi-tenant estricto.
    """
    if not isinstance(ids, (list, tuple)):
        raise ValidationError({'error': 'ubicacion_ids debe ser una lista de IDs.'})

    ids_limpios = [str(i) for i in ids if str(i) != str(base.id)]
    if not ids_limpios:
        raise ValidationError(
            {'error': 'Seleccioná al menos otro espacio para fusionar.'}
        )

    objetivo = list(modelo.objects.filter(id__in=ids_limpios).exclude(id=base.id))
    if not objetivo:
        raise ValidationError(
            {'error': 'No se encontraron espacios válidos para fusionar.'}
        )
    _mismo_estok(base, objetivo, estok_id_de)

    grupo = base.fusion_grupo or uuid4()
    with transaction.atomic():
        if base.fusion_grupo != grupo:
            base.fusion_grupo = grupo
            base.save(update_fields=['fusion_grupo'])
        modelo.objects.filter(id__in=[u.id for u in objetivo]).update(
            fusion_grupo=grupo
        )

    return {
        'fusion_grupo': str(grupo),
        'ubicacion_ids': [str(base.id)] + [str(u.id) for u in objetivo],
    }


def ids_del_grupo(modelo, base):
    """
    Espacios que forman el MACRO-BLOQUE al que pertenece `base`: TODAS las partes
    con su mismo `fusion_grupo` (o solo `base` si no está fusionado).

    El bloque fusionado es INDESTRUCTIBLE como unidad: eliminarlo implica borrar
    físicamente TODAS sus sub-celdas en PostgreSQL (no solo la del path), para no
    dejar partes huérfanas renderizadas como rectángulos fantasma.
    """
    if not base.fusion_grupo:
        return [base]
    return list(modelo.objects.filter(fusion_grupo=base.fusion_grupo))


def separar_espacios(modelo, base):
    """Disuelve la fusión: libera a TODOS los miembros del grupo (fusion_grupo=None)."""
    liberadas = 0
    if base.fusion_grupo:
        liberadas = modelo.objects.filter(fusion_grupo=base.fusion_grupo).update(
            fusion_grupo=None
        )
        base.fusion_grupo = None
    return {'ok': True, 'liberadas': liberadas}


def editar_grupo(modelo, base, nombre, partes):
    """
    Edición CONSOLIDADA de un espacio fusionado en UNA sola transacción:

      - "nombre":  se aplica simultáneamente a todos los miembros del grupo.
      - "partes":  [{id, ui_left, ui_top, ui_width, ui_height}] con la geometría
                   relativa recalculada al mover/redimensionar el bloque completo.
    """
    if not base.fusion_grupo:
        raise ValidationError(
            {'error': 'El espacio no pertenece a ningún grupo de fusión. Fusioná primero.'}
        )

    miembros = modelo.objects.filter(fusion_grupo=base.fusion_grupo)
    ids_grupo = {str(m.id) for m in miembros}

    if nombre is None and partes is None:
        raise ValidationError(
            {'error': 'Enviá "nombre" y/o "partes" para actualizar el grupo.'}
        )
    if nombre is not None and not str(nombre).strip():
        raise ValidationError(
            {'error': 'El nombre del espacio fusionado no puede estar vacío.'}
        )

    with transaction.atomic():
        if nombre is not None:
            miembros.update(nombre=str(nombre).strip())
        if isinstance(partes, list):
            for parte in partes:
                if not isinstance(parte, dict):
                    continue
                parte_id = str(parte.get('id') or '')
                if parte_id not in ids_grupo:
                    raise ValidationError(
                        {'error': f'La parte {parte_id or "?"} no pertenece a este grupo de fusión.'}
                    )
                cambios = {c: parte[c] for c in CAMPOS_GEOMETRIA if c in parte}
                if cambios:
                    modelo.objects.filter(id=parte_id).update(**cambios)

    return {
        'fusion_grupo': str(base.fusion_grupo),
        'ubicacion_ids': sorted(ids_grupo),
        'nombre': str(nombre).strip() if nombre is not None else None,
    }
