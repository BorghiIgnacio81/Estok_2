# Migración: planes «Familiar» y «Empresas».
#
# Sólo cambia los `choices` (no hay cambio de columna en la base): los valores
# nuevos son cadenas dentro del mismo `max_length=20`.
#   - CustomUser.plan_suscripcion: free / pro / familiar / empresas / personalizado
#   - BotonPermiso.plan:           mismos planes como regla base (+ personalizado)
#
# La lógica (qué planes son premium, cómo se aplica el plan y cómo heredan las
# reglas por botón) vive en inventario/services/{suscripcion,permisos_botones}.py.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventario', '0037_permisos_botones_y_plan_personalizado'),
    ]

    operations = [
        migrations.AlterField(
            model_name='customuser',
            name='plan_suscripcion',
            field=models.CharField(
                choices=[
                    ('free', 'Gratuito (con publicidad)'),
                    ('pro', 'Pro Individual (sin publicidad)'),
                    ('familiar', 'Plan Familiar (varios miembros del hogar)'),
                    ('empresas', 'Plan Empresas (gestión comercial/multisector)'),
                    ('personalizado', 'Personalizado (permisos por botón)'),
                ],
                default='free',
                help_text=(
                    '«Familiar» y «Empresas» son planes premium (sin publicidad '
                    'y sin tope de objetos). «Personalizado» = el usuario tiene '
                    'permisos y cuotas propias por botón (Admin Global → pestaña '
                    'Permisos por Botón).'
                ),
                max_length=20,
                verbose_name='Plan de suscripción',
            ),
        ),
        migrations.AlterField(
            model_name='botonpermiso',
            name='plan',
            field=models.CharField(
                choices=[
                    ('free', 'Plan Gratuito (Free)'),
                    ('pro', 'Plan Pro Individual'),
                    ('familiar', 'Plan Familiar'),
                    ('empresas', 'Plan Empresas'),
                    ('personalizado', 'Personalizado (usuario)'),
                ],
                default='free',
                help_text=(
                    'Plan base (Free/Pro/Familiar/Empresas) al que aplica la '
                    'regla. Si la regla es de un usuario puntual queda en '
                    '«Personalizado».'
                ),
                max_length=20,
                verbose_name='Plan de la regla',
            ),
        ),
    ]
