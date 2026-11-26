"""
ETIQUETA QR IMPRESA EN LAS CAJAS REGISTRADAS COMO OBJETO.

MOTIVO
    El modal «🖨️ Imprimir QRs» ahora imprime también las cajas que el operador
    registró como Objeto (`Objeto.es_contenedor=True`, p. ej. «Caja de
    adaptadores y cables» o «Caja Colección de revistas ¡HOLA! Argentina»).
    `Contenedor` ya tenía `qr_impreso` (migración 0044); sin el mismo campo en
    `Objeto`, esas etiquetas se verían SIEMPRE como «Nuevas» y el filtro
    «nuevas» volvería a incluirlas en cada impresión.

REGLA
    Idempotente y no destructiva: columna booleana con default False. El
    backend la pone en True únicamente cuando el PDF se generó sin errores
    (`services/qr_etiquetas_universo.marcar_impresas`).
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0044_contenedor_qr_impreso'),
    ]

    operations = [
        migrations.AddField(
            model_name='objeto',
            name='qr_impreso',
            field=models.BooleanField(
                default=False,
                help_text=(
                    'True cuando la etiqueta QR de esta caja-Objeto ya se generó '
                    'e imprimió desde «Imprimir QRs» (PDF A4). Alimenta el badge '
                    '«Impreso» y el filtro «nuevas» del modal de etiquetas.'
                ),
                verbose_name='QR impreso',
            ),
        ),
    ]
