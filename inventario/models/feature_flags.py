"""
Feature Flags: Control de Funcionalidades (toggles del Admin Global).

Permiten habilitar o deshabilitar funciones Premium EN CALIENTE desde el panel
de Django (un switch por funcionalidad), sin tocar código ni redeployar.

Semántica de los dos interruptores:
  - `activo_global`    → interruptor MAESTRO. Apagado = la función no existe
                         para nadie (ni siquiera para los usuarios Pro).
  - `modo_promocional` → si está encendido, la función se libera para TODOS los
                         usuarios, incluso los del plan gratuito (campaña).
  - Si el flag está activo y NO está en modo promocional, queda restringido al
    plan Pro (`CustomUser.es_premium` o el Estok premium del hogar).

La DECISIÓN de acceso no vive acá: `inventario/services/feature_flags.py` es la
única fuente de verdad (evalúa maestro → promocional → plan).
"""

from .base import models, uuid


# =============================================================================
# CATÁLOGO DE CLAVES ESTÁNDAR
# =============================================================================
# Cada definición describe la clave, su nombre legible, el texto que ve el
# Admin Global y el estado con el que nace la fila en el primer deploy.
#
# `requiere_premium` es METADATA DE CÓDIGO (no una columna): indica si la
# funcionalidad es exclusiva del plan Pro cuando el modo promocional está
# apagado. Un flag sin esta marca nunca exige plan (sólo obedece al maestro).
#
# IMPORTANTE (anti-regresión): todas las claves estándar nacen con
# `activo_global=True` y `modo_promocional=True`, de modo que ningún usuario
# actual pierda una función al desplegar. El Admin Global apaga el modo
# promocional cuando quiera empezar a cobrarla.
# =============================================================================
CLAVE_IA_ILIMITADA = 'ia_ilimitada'
CLAVE_SYNC_MERCADOLIBRE = 'sync_mercadolibre'
CLAVE_EXPORTACION_PDF = 'exportacion_pdf'
CLAVE_EXPORTACION_CSV = 'exportacion_csv'

# Campos reales del modelo: se usan para sembrar y para construir el objeto
# transitorio que devuelve `obtener()` cuando la fila todavía no existe.
CAMPOS_MODELO = ('clave', 'nombre', 'activo_global', 'descripcion', 'modo_promocional')

FLAGS_ESTANDAR = (
    {
        'clave': CLAVE_IA_ILIMITADA,
        'nombre': 'IA ilimitada',
        'descripcion': (
            'Análisis de objetos con IA (Gemini): autocompletar y alta por foto. '
            'Con el modo promocional apagado queda reservada al plan Pro.'
        ),
        'activo_global': True,
        'modo_promocional': True,
        'requiere_premium': True,
    },
    {
        'clave': CLAVE_SYNC_MERCADOLIBRE,
        'nombre': 'Sincronización Mercado Libre',
        'descripcion': (
            'Publicar, pausar/reactivar y sincronizar publicaciones en Mercado '
            'Libre. Con el modo promocional apagado queda reservada al plan Pro.'
        ),
        'activo_global': True,
        'modo_promocional': True,
        'requiere_premium': True,
    },
    {
        'clave': CLAVE_EXPORTACION_PDF,
        'nombre': 'Exportación PDF',
        'descripcion': (
            'Informe PDF del inventario (con mapas y precios). Con el modo '
            'promocional apagado queda reservado al plan Pro.'
        ),
        'activo_global': True,
        'modo_promocional': True,
        'requiere_premium': True,
    },
    {
        'clave': CLAVE_EXPORTACION_CSV,
        'nombre': 'Exportación CSV',
        'descripcion': (
            'Exportación de objetos y contenedores a CSV (Excel). Con el modo '
            'promocional apagado queda reservada al plan Pro.'
        ),
        'activo_global': True,
        'modo_promocional': True,
        'requiere_premium': True,
    },
)


def normalizar_clave(clave):
    """Normaliza una clave de funcionalidad: sin espacios y en minúsculas."""
    return (clave or '').strip().lower()


def definicion_estandar(clave):
    """Definición de catálogo de una clave estándar, o None si no es estándar."""
    normalizada = normalizar_clave(clave)
    for definicion in FLAGS_ESTANDAR:
        if definicion['clave'] == normalizada:
            return definicion
    return None


def clave_requiere_premium(clave):
    """
    True si la funcionalidad es exclusiva del plan Pro.

    Las claves que no están en el catálogo se consideran premium por seguridad
    (nunca se liberan por accidente a todo el mundo).
    """
    definicion = definicion_estandar(clave)
    if definicion is None:
        return True
    return bool(definicion.get('requiere_premium'))


class FeatureFlag(models.Model):
    """
    Funcionalidad controlable en caliente por el Admin Global.

    Se administra desde el Django Admin con `list_editable`, así que un solo
    click en la lista enciende/apaga la función para toda la plataforma.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    clave = models.CharField(
        max_length=100,
        unique=True,
        verbose_name="Clave",
        help_text=(
            "Identificador técnico de la funcionalidad (ej: ia_ilimitada, "
            "sync_mercadolibre, exportacion_pdf). No se debe renombrar sin "
            "actualizar el código que la evalúa."
        ),
    )
    nombre = models.CharField(
        max_length=150,
        verbose_name="Nombre",
        help_text="Nombre legible para el panel (ej: «IA ilimitada»).",
    )
    activo_global = models.BooleanField(
        default=False,
        verbose_name="Activo globalmente",
        help_text=(
            "Interruptor maestro. Apagado = la funcionalidad NO está disponible "
            "para nadie (ni para el plan Pro)."
        ),
    )
    descripcion = models.TextField(
        blank=True,
        verbose_name="Descripción",
        help_text="Qué hace la funcionalidad y a quién aplica.",
    )
    modo_promocional = models.BooleanField(
        default=False,
        verbose_name="Modo promocional",
        help_text=(
            "Encendido = la funcionalidad se libera para TODOS (incluido el plan "
            "gratuito). Apagado = sólo plan Pro."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de creación")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última actualización")

    class Meta:
        verbose_name = "Feature Flag (funcionalidad)"
        verbose_name_plural = "Feature Flags (control de funcionalidades)"
        ordering = ['nombre']

    def __str__(self):
        return f"{self.nombre} ({self.clave})"

    # ------------------------------------------------------------------
    # Resolución de flags
    # ------------------------------------------------------------------
    @classmethod
    def transitorio(cls, clave):
        """
        Objeto NO persistido con la definición estándar de `clave`.

        Las claves desconocidas se resuelven PERMISIVAS (activo + promocional):
        una clave mal escrita nunca debe apagar una función de producción.
        """
        normalizada = normalizar_clave(clave)
        if not normalizada:
            return None
        definicion = definicion_estandar(normalizada) or {
            'clave': normalizada,
            'nombre': normalizada,
            'descripcion': '',
            'activo_global': True,
            'modo_promocional': True,
        }
        return cls(**{
            campo: definicion[campo]
            for campo in CAMPOS_MODELO
            if campo in definicion
        })

    @classmethod
    def obtener(cls, clave):
        """
        Devuelve el flag PERSISTIDO de `clave`.

        Si la fila todavía no existe (primer deploy o clave recién agregada al
        catálogo) devuelve `transitorio(clave)`, sin tocar la base de datos.
        """
        normalizada = normalizar_clave(clave)
        if not normalizada:
            return None

        flag = cls.objects.filter(clave=normalizada).first()
        if flag is not None:
            return flag
        return cls.transitorio(normalizada)

    @classmethod
    def is_active(cls, clave):
        """
        True si la funcionalidad está HABILITADA GLOBALMENTE (interruptor maestro).

        Es el primer paso de la verificación que hacen los endpoints: si devuelve
        False, la funcionalidad está apagada para todos y no hay nada más que
        evaluar. La restricción por plan se resuelve después en
        `inventario/services/feature_flags.evaluar()`.
        """
        flag = cls.obtener(clave)
        if flag is None:
            return False
        return bool(flag.activo_global)

    @classmethod
    def en_modo_promocional(cls, clave):
        """True si la funcionalidad está liberada para todos (incluso plan free)."""
        flag = cls.obtener(clave)
        if flag is None:
            return False
        return bool(flag.modo_promocional)
