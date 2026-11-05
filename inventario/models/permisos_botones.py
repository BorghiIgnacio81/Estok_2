"""
Permisos y cuotas GRANULARES por botón (Panel de Permisos del Admin Global).

Dos piezas, con responsabilidades separadas:

  - `BotonPermiso`      → CONFIGURACIÓN de la regla. Una fila por botón y
                          OBJETIVO: o un plan base (`free` / `pro`, con
                          `usuario` en NULL) o un usuario puntual
                          (`plan='personalizado'`).
  - `CuotaUsoUsuario`   → CONSUMO. Cuántas veces ejecutó ese usuario ese botón
                          dentro de la ventana vigente (diaria/mensual/total).

La DECISIÓN (¿puede usar el botón?, ¿cuántos usos le quedan?) NO vive acá:
`inventario/services/permisos_botones.py` es la única fuente de verdad; este
módulo sólo declara el catálogo de botones y el almacenamiento.

Semántica de `limite_usos`:
  - `-1` o `NULL` → ILIMITADO (no se cuenta para bloquear).
  - `0`           → bloqueado (0 ejecuciones permitidas).
  - `N > 0`       → N ejecuciones por `periodo`.
"""

from .base import models, uuid


# =============================================================================
# CATÁLOGO DE BOTONES / FUNCIONES CLAVE DEL SISTEMA
# =============================================================================
# `feature_flag` enlaza el botón con su Feature Flag (Control de
# Funcionalidades): la verificación de acceso evalúa PRIMERO el flag y después
# el permiso/cuota granular. Una cadena vacía = el botón no tiene flag propio.
#
# IMPORTANTE (anti-regresión): las reglas se siembran con `permitido=True` y
# `limite_usos=-1` (ilimitado). Ningún usuario pierde una función al desplegar;
# el Admin Global decide cuándo empezar a cobrar/cuotear desde el panel.
# =============================================================================
BOTON_IA_GEMINI = 'boton_ia_gemini'
BOTON_SYNC_MERCADOLIBRE = 'boton_sync_mercadolibre'
BOTON_EXPORTAR_PDF = 'boton_exportar_pdf'
BOTON_EXPORTAR_CSV = 'boton_exportar_csv'
BOTON_COMPARAR_PRECIO = 'boton_comparar_precio'

BOTONES_CATALOGO = (
    {
        'identificador': BOTON_IA_GEMINI,
        'nombre': 'Autocompletar con IA (Gemini)',
        'descripcion': (
            'Análisis de fotos con IA: alta por imagen y «Analizar con IA» de '
            'la ficha del objeto.'
        ),
        'feature_flag': 'ia_ilimitada',
    },
    {
        'identificador': BOTON_SYNC_MERCADOLIBRE,
        'nombre': 'Sincronización Mercado Libre',
        'descripcion': (
            'Publicar, actualizar stock y pausar/reactivar publicaciones en '
            'Mercado Libre.'
        ),
        'feature_flag': 'sync_mercadolibre',
    },
    {
        'identificador': BOTON_EXPORTAR_PDF,
        'nombre': 'Exportar informe PDF',
        'descripcion': 'Informe PDF del inventario (mapas y precios).',
        'feature_flag': 'exportacion_pdf',
    },
    {
        'identificador': BOTON_EXPORTAR_CSV,
        'nombre': 'Exportar datos CSV',
        'descripcion': 'Descarga del inventario en CSV (Excel).',
        'feature_flag': 'exportacion_csv',
    },
    {
        'identificador': BOTON_COMPARAR_PRECIO,
        'nombre': 'Comparar precio (Mercado Libre)',
        'descripcion': (
            'Cotización de precio de referencia: «Comparar precio en Mercado '
            'Libre» y «Buscar precio de referencia».'
        ),
        'feature_flag': '',
    },
)

IDENTIFICADORES_BOTONES = tuple(
    definicion['identificador'] for definicion in BOTONES_CATALOGO
)

CLAVES_FEATURE_FLAG = {
    definicion['identificador']: definicion['feature_flag']
    for definicion in BOTONES_CATALOGO
    if definicion['feature_flag']
}


# =============================================================================
# PERÍODOS DE LA CUOTA
# =============================================================================
PERIODO_DIARIO = 'diario'
PERIODO_MENSUAL = 'mensual'
PERIODO_TOTAL = 'total'

PERIODOS = (
    (PERIODO_DIARIO, 'Diario (se reinicia cada día)'),
    (PERIODO_MENSUAL, 'Mensual (se reinicia cada mes)'),
    (PERIODO_TOTAL, 'Total (no se reinicia nunca)'),
)

# Planes válidos de una regla. `free` / `pro` = plan base; `personalizado` =
# regla propia de un usuario concreto (`usuario` obligatorio).
PLAN_REGLA_FREE = 'free'
PLAN_REGLA_PRO = 'pro'
PLAN_REGLA_PERSONALIZADO = 'personalizado'

PLANES_REGLA = (
    (PLAN_REGLA_FREE, 'Plan Gratuito (Free)'),
    (PLAN_REGLA_PRO, 'Plan Pro'),
    (PLAN_REGLA_PERSONALIZADO, 'Personalizado (usuario)'),
)


class BotonPermiso(models.Model):
    """
    Regla de permiso/cuota de UN botón para UN objetivo (plan o usuario).

    Un usuario con plan `personalizado` toma sus reglas de las filas con
    `usuario=<ese usuario>`; si un botón no tiene fila propia, cae al plan base
    que le corresponda por su estado premium (comportamiento predecible).

    El panel del Admin Global (`/admin/inventario/botonpermiso/matriz/`) escribe
    estas filas; guardar para un usuario lo pasa automáticamente a
    «Personalizado» (ver services/suscripcion.aplicar_plan_usuario).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    identificador_boton = models.CharField(
        max_length=60,
        choices=[(i, i) for i in IDENTIFICADORES_BOTONES],
        verbose_name="Botón / función",
        help_text="Identificador técnico del botón (ej. boton_ia_gemini).",
    )
    plan = models.CharField(
        max_length=20,
        choices=PLANES_REGLA,
        default=PLAN_REGLA_FREE,
        verbose_name="Plan de la regla",
        help_text=(
            "Plan base (Free/Pro) al que aplica la regla. Si la regla es de un "
            "usuario puntual queda en «Personalizado»."
        ),
    )
    usuario = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='permisos_botones',
        verbose_name="Usuario",
        help_text="Vacío = la regla aplica al plan base. Con usuario = sólo a él.",
    )
    permitido = models.BooleanField(
        default=True,
        verbose_name="Permitido",
        help_text="Desactivado = el botón no se puede usar con esta regla.",
    )
    limite_usos = models.IntegerField(
        null=True,
        blank=True,
        default=-1,
        verbose_name="Límite de usos",
        help_text=(
            "Ejecuciones permitidas por período. -1 o vacío = ILIMITADO. "
            "0 = bloqueado."
        ),
    )
    periodo = models.CharField(
        max_length=10,
        choices=PERIODOS,
        default=PERIODO_MENSUAL,
        verbose_name="Período",
        help_text="Cuándo se reinicia el contador de usos.",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de creación")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    class Meta:
        verbose_name = "Permiso de botón"
        verbose_name_plural = "Permisos y cuotas por botón"
        ordering = ['identificador_boton', 'plan']
        constraints = [
            models.UniqueConstraint(
                fields=['identificador_boton', 'plan'],
                condition=models.Q(usuario__isnull=True),
                name='uniq_botonpermiso_por_plan',
            ),
            models.UniqueConstraint(
                fields=['identificador_boton', 'usuario'],
                condition=models.Q(usuario__isnull=False),
                name='uniq_botonpermiso_por_usuario',
            ),
        ]

    def __str__(self):
        objetivo = (
            f'usuario {self.usuario.username}' if self.usuario_id else f'plan {self.plan}'
        )
        return f'{self.identificador_boton} · {objetivo}'

    @property
    def es_ilimitado(self):
        """True si la regla no limita ejecuciones (-1 / NULL / sin valor)."""
        return self.limite_usos is None or self.limite_usos < 0

    def save(self, *args, **kwargs):
        """Normaliza la regla: una fila con usuario SIEMPRE es «Personalizado»."""
        if self.usuario_id:
            self.plan = PLAN_REGLA_PERSONALIZADO
        elif self.plan == PLAN_REGLA_PERSONALIZADO:
            # Sin usuario no hay regla personalizada posible: cae al plan Free.
            self.plan = PLAN_REGLA_FREE
        if self.limite_usos is not None and self.limite_usos < -1:
            self.limite_usos = -1
        super().save(*args, **kwargs)


class CuotaUsoUsuario(models.Model):
    """
    Consumo acumulado de un botón por un usuario (contador del período).

    Se crea sola la primera vez que el usuario ejecuta el botón. `usos` es el
    contador de la VENTANA vigente (se reinicia al cambiar de día/mes según el
    período de la regla) y `usos_totales` es el histórico acumulado (lo usa el
    período «total» y el panel de auditoría del Admin).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    usuario = models.ForeignKey(
        'inventario.CustomUser',
        on_delete=models.CASCADE,
        related_name='cuotas_uso_botones',
        verbose_name="Usuario",
    )
    identificador_boton = models.CharField(
        max_length=60,
        choices=[(i, i) for i in IDENTIFICADORES_BOTONES],
        verbose_name="Botón / función",
    )
    usos = models.PositiveIntegerField(
        default=0,
        verbose_name="Usos en el período",
        help_text="Ejecuciones dentro de la ventana vigente (diaria o mensual).",
    )
    usos_totales = models.PositiveIntegerField(
        default=0,
        verbose_name="Usos totales",
        help_text="Histórico acumulado (no se reinicia).",
    )
    periodo_inicio = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Inicio del período",
        help_text="Momento en que arrancó la ventana de conteo actual.",
    )
    ultimo_uso = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Último uso",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de creación")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    class Meta:
        verbose_name = "Cuota de uso por botón"
        verbose_name_plural = "Cuotas de uso por botón"
        ordering = ['-ultimo_uso', 'usuario']
        constraints = [
            models.UniqueConstraint(
                fields=['usuario', 'identificador_boton'],
                name='uniq_cuota_uso_usuario_boton',
            ),
        ]
        indexes = [
            models.Index(fields=['identificador_boton']),
        ]

    def __str__(self):
        return f'{self.usuario_id} · {self.identificador_boton}: {self.usos}'
