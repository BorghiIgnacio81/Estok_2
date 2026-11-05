"""
Migración de DATOS del módulo de monetización.

Hace dos cosas, ambas idempotentes y sin tocar datos que el Admin ya configuró:

1. BACKFILL de `Estok.creador`
   El campo es nuevo y la regla de herencia («si el creador es premium, todos
   los miembros heredan ocultar_publicidad») necesita saber quién creó cada
   hogar. Se toma la Membresía con rol 'Admin' más antigua (es exactamente lo
   que crea `EstokCreateSerializer.create`: el creador queda como Admin) y, si
   el hogar no tiene Admin, la Membresía más antigua a secas.

2. SIEMBRA de los Feature Flags estándar
   Crea las filas con `activo_global=True` + `modo_promocional=True` (todas las
   funciones quedan liberadas para todos) para que el Admin Global tenga los
   switches en el panel desde el primer arranque. NO modifica filas existentes:
   si el flag ya está cargado, se respeta su estado.

`sembrar_flags_estandar` (management command seed_data) vuelve a correr esto en
cada deploy; esta migración garantiza que existan incluso si el seed falla.
"""

from django.db import migrations

# Catálogo congelado (las migraciones NO deben depender del código vivo).
FLAGS_ESTANDAR = (
    {
        'clave': 'ia_ilimitada',
        'nombre': 'IA ilimitada',
        'descripcion': (
            'Análisis de objetos con IA (Gemini): autocompletar y alta por foto.'
        ),
        'activo_global': True,
        'modo_promocional': True,
    },
    {
        'clave': 'sync_mercadolibre',
        'nombre': 'Sincronización Mercado Libre',
        'descripcion': (
            'Publicar, pausar/reactivar y sincronizar publicaciones en Mercado Libre.'
        ),
        'activo_global': True,
        'modo_promocional': True,
    },
    {
        'clave': 'exportacion_pdf',
        'nombre': 'Exportación PDF',
        'descripcion': 'Informe PDF del inventario (con mapas y precios).',
        'activo_global': True,
        'modo_promocional': True,
    },
    {
        'clave': 'exportacion_csv',
        'nombre': 'Exportación CSV',
        'descripcion': 'Exportación de objetos y contenedores a CSV (Excel).',
        'activo_global': True,
        'modo_promocional': True,
    },
)


def sembrar_flags_y_creadores(apps, schema_editor):
    Estok = apps.get_model('inventario', 'Estok')
    Membresia = apps.get_model('inventario', 'Membresia')
    FeatureFlag = apps.get_model('inventario', 'FeatureFlag')

    # 1. Backfill del creador de cada hogar.
    for estok in Estok.objects.filter(creador__isnull=True).iterator():
        membresia = (
            Membresia.objects
            .filter(estok=estok, role__name='Admin')
            .order_by('joined_at')
            .first()
            or Membresia.objects
            .filter(estok=estok)
            .order_by('joined_at')
            .first()
        )
        if membresia is None:
            continue
        estok.creador_id = membresia.usuario_id
        estok.save(update_fields=['creador'])

    # 2. Siembra del catálogo de funcionalidades.
    for definicion in FLAGS_ESTANDAR:
        FeatureFlag.objects.get_or_create(
            clave=definicion['clave'],
            defaults=definicion,
        )


def revertir(apps, schema_editor):
    """
    No se revierte nada a propósito: borrar los flags o desvincular creadores
    podría dejar la plataforma sin interruptores (y los hogares sin dueño).
    """
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0034_planes_monetizacion_y_feature_flags'),
    ]

    operations = [
        migrations.RunPython(sembrar_flags_y_creadores, revertir),
    ]
