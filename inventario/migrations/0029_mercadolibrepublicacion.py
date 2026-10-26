# PUBLICACIONES DE MERCADO LIBRE
# ---------------------------------------------------------------------------
# Crea la tabla que persiste el `item_id` devuelto por POST /items.
#
# POR QUÉ: para pausar (objeto vendido o sin stock) o cerrar (objeto eliminado)
# una publicación con PUT /items/{item_id} hace falta conocer ese id. Antes se
# descartaba y solo se marcaba 'mercadolibre' en `plataformas_publicadas`, por
# lo que la sincronización de estado con Mercado Libre era imposible.
#
# Es una tabla NUEVA: no altera ni toca ninguna columna existente de Objeto
# (el campo legacy `meli_id`, presente solo en algunos despliegues, se sigue
# leyendo de forma defensiva desde services/mercadolibre_publicacion.py).

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0028_etiquetas_objeto_espacio'),
    ]

    operations = [
        migrations.CreateModel(
            name='MercadoLibrePublicacion',
            fields=[
                (
                    'id',
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name='ID',
                    ),
                ),
                (
                    'item_id',
                    models.CharField(
                        max_length=40,
                        unique=True,
                        verbose_name='ID del ítem en Mercado Libre',
                    ),
                ),
                (
                    'status',
                    models.CharField(
                        choices=[
                            ('active', 'Activa'),
                            ('paused', 'Pausada'),
                            ('closed', 'Cerrada'),
                        ],
                        default='active',
                        max_length=20,
                        verbose_name='Estado en Mercado Libre',
                    ),
                ),
                (
                    'permalink',
                    models.URLField(
                        blank=True,
                        max_length=300,
                        verbose_name='Enlace a la publicación',
                    ),
                ),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'objeto',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='publicacion_ml',
                        to='inventario.objeto',
                        verbose_name='Objeto',
                    ),
                ),
                (
                    'usuario',
                    models.ForeignKey(
                        blank=True,
                        help_text=(
                            'Dueño del token OAuth con el que se creó el ítem '
                            'en Mercado Libre.'
                        ),
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='publicaciones_ml',
                        to='inventario.customuser',
                        verbose_name='Usuario que publicó',
                    ),
                ),
            ],
            options={
                'verbose_name': 'Publicación de Mercado Libre',
                'verbose_name_plural': 'Publicaciones de Mercado Libre',
            },
        ),
    ]
