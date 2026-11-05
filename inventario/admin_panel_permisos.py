"""
Admin · PANEL DE PERMISOS Y CUOTAS GRANULARES POR BOTÓN.

Dos registros:

    - `BotonPermisoAdmin` con la MATRIZ (`/admin/inventario/botonpermiso/matriz/`):
      un combobox superior para elegir «Plan Free», «Plan Pro» o un USUARIO
      concreto y, debajo, la lista completa de botones del sistema con su
      checkbox (habilitar/deshabilitar) y su textbox (límite de usos) + período.
      Guardar para un usuario lo pasa automáticamente a plan «Personalizado».
    - `CuotaUsoUsuarioAdmin`: auditoría del consumo por usuario/botón, con acción
      para reiniciar el contador del período.

La lógica NO vive acá: `services/permisos_botones.py` (reglas) y
`services/cuotas_botones.py` (consumo) son la única fuente de verdad.
"""

import logging
import uuid

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html

from .models import BotonPermiso, CuotaUsoUsuario, CustomUser
from .models.permisos_botones import (
    BOTONES_CATALOGO,
    PERIODOS,
    PERIODO_MENSUAL,
)
from .services import permisos_botones, suscripcion

logger = logging.getLogger(__name__)

NOMBRE_URL_MATRIZ = 'inventario_botonpermiso_matriz'

# Tope de usuarios en el combobox: el admin no necesita listar 10.000 filas y el
# panel sigue cargando rápido (se busca por username con el buscador de arriba).
MAX_USUARIOS_SELECTOR = 500


# =============================================================================
# HELPERS DEL PANEL
# =============================================================================
def _parsear_limite(texto):
    """
    Textbox → `limite_usos`.

    Vacío o negativo → -1 (ILIMITADO). `0` → bloqueado. Entero positivo → tal
    cual. Cualquier basura cae a -1 para no bloquear un botón por error de tipeo.
    """
    crudo = str(texto if texto is not None else '').strip()
    if not crudo:
        return -1
    try:
        valor = int(crudo)
    except (TypeError, ValueError):
        return -1
    return valor if valor >= 0 else -1


def _objetivos():
    """
    Opciones del combobox: TODOS los planes base + todos los usuarios.

    Los planes se toman de `suscripcion.PLANES_ETIQUETAS` (fuente única) salvo
    «Personalizado», que no tiene reglas a nivel plan (sólo por usuario).
    """
    opciones = [
        (valor, f'Plan: {etiqueta}')
        for valor, etiqueta in suscripcion.PLANES_ETIQUETAS
        if valor != suscripcion.PLAN_PERSONALIZADO
    ]
    usuarios = CustomUser.objects.order_by('username')[:MAX_USUARIOS_SELECTOR]
    for usuario in usuarios:
        nombre = usuario.get_full_name() or usuario.username
        opciones.append((
            f'usuario:{usuario.pk}',
            f'Usuario: {nombre} ({usuario.username})',
        ))
    return opciones


def _resolver_objetivo(valor):
    """
    `'free'` / `'pro'` / `'familiar'` / `'empresas'` / `'usuario:<uuid>'`
    → `(plan, usuario)`.

    Cualquier valor inválido (o un usuario borrado) cae al plan Free: el panel
    nunca debe romperse por una query string vieja. «Personalizado» no tiene
    reglas a nivel plan (sólo por usuario), así que también cae a Free.
    """
    crudo = str(valor or '').strip()

    if crudo.startswith('usuario:'):
        crudo_id = crudo.split(':', 1)[1].strip()
        try:
            usuario = CustomUser.objects.filter(pk=uuid.UUID(crudo_id)).first()
        except (ValueError, AttributeError, TypeError, ValidationError):
            usuario = None
        if usuario is not None:
            return suscripcion.PLAN_PERSONALIZADO, usuario

    planes_con_regla = {
        valor for valor, _ in suscripcion.PLANES_ETIQUETAS
        if valor != suscripcion.PLAN_PERSONALIZADO
    }
    if crudo in planes_con_regla:
        return crudo, None
    return suscripcion.PLAN_FREE, None


def _valor_objetivo(plan, usuario):
    """Valor del combobox que representa al objetivo resuelto."""
    if usuario is not None:
        return f'usuario:{usuario.pk}'
    return plan


def _cuotas_por_boton(usuario):
    """Consumo actual del usuario, indexado por botón (una sola query)."""
    if usuario is None:
        return {}
    return {
        cuota.identificador_boton: cuota
        for cuota in CuotaUsoUsuario.objects.filter(usuario=usuario)
    }


# =============================================================================
# ADMIN: MATRIZ DE PERMISOS POR BOTÓN
# =============================================================================
@admin.register(BotonPermiso)
class BotonPermisoAdmin(admin.ModelAdmin):
    """
    Reglas de permiso/cuota por botón.

    La edición fina (matriz con combobox de plan/usuario) vive en la vista
    `matriz/`; el changelist sirve para ver y editar filas sueltas con
    `list_editable` (un click por celda).
    """

    change_list_template = 'admin/inventario/botonpermiso/change_list.html'
    list_display = ['identificador_boton', 'objetivo', 'permitido', 'limite_usos',
                    'periodo', 'updated_at']
    list_editable = ['permitido', 'limite_usos', 'periodo']
    list_filter = ['plan', 'periodo', 'permitido']
    search_fields = ['identificador_boton', 'usuario__username', 'usuario__email']
    readonly_fields = ['created_at', 'updated_at']
    ordering = ['identificador_boton', 'plan']
    actions = ['dejar_ilimitado', 'bloquear_botones']
    fields = [
        'identificador_boton', 'plan', 'usuario', 'permitido', 'limite_usos',
        'periodo', 'created_at', 'updated_at',
    ]

    @admin.display(description='Objetivo')
    def objetivo(self, obj):
        """A quién aplica la regla: un usuario puntual o un plan base."""
        if obj.usuario_id:
            return format_html('<strong>Usuario:</strong> {}', obj.usuario.username)
        return format_html('<strong>Plan:</strong> {}', obj.get_plan_display())

    @admin.action(description='Dejar los botones seleccionados en ILIMITADO (-1)')
    def dejar_ilimitado(self, request, queryset):
        actualizados = queryset.update(limite_usos=-1, permitido=True)
        self.message_user(
            request, f'{actualizados} regla(s) dejadas sin límite de usos.',
        )

    @admin.action(description='Bloquear los botones seleccionados (0 usos)')
    def bloquear_botones(self, request, queryset):
        actualizados = queryset.update(limite_usos=0, permitido=False)
        self.message_user(request, f'{actualizados} regla(s) bloqueadas.')

    # ------------------------------------------------------------------
    # URLs del panel
    # ------------------------------------------------------------------
    def get_urls(self):
        propias = [
            path(
                'matriz/',
                self.admin_site.admin_view(self.matriz_view),
                name=NOMBRE_URL_MATRIZ,
            ),
        ]
        return propias + super().get_urls()

    def changelist_view(self, request, extra_context=None):
        """Agrega el enlace al panel en la cabecera del changelist."""
        extra = dict(extra_context or {})
        extra.setdefault(
            'panel_permisos_url', reverse(f'admin:{NOMBRE_URL_MATRIZ}'),
        )
        return super().changelist_view(request, extra_context=extra)

    def matriz_view(self, request):
        """
        GET  → dibuja la matriz del objetivo elegido en el combobox.
        POST → guarda la matriz completa y vuelve al mismo objetivo.
        """
        if not self.has_change_permission(request):
            raise PermissionDenied(
                'No tenés permiso para configurar los permisos por botón.'
            )
        if request.method == 'POST':
            return self._guardar_matriz(request)
        return self._render_matriz(request, request.GET.get('objetivo'))

    # ------------------------------------------------------------------
    # Render
    # ------------------------------------------------------------------
    def _filas_matriz(self, plan, usuario):
        """Una fila por botón del catálogo con la regla efectiva del objetivo."""
        reglas = permisos_botones.reglas_del_objetivo(plan, usuario)
        cuotas = _cuotas_por_boton(usuario)

        filas = []
        for definicion in BOTONES_CATALOGO:
            identificador = definicion['identificador']
            regla = reglas[identificador]
            cuota = cuotas.get(identificador)
            filas.append({
                'identificador': identificador,
                'nombre': definicion['nombre'],
                'descripcion': definicion['descripcion'],
                'feature_flag': definicion.get('feature_flag') or '',
                'permitido': regla['permitido'],
                'limite_usos': (
                    regla['limite_usos'] if regla['limite_usos'] is not None else -1
                ),
                'periodo': regla['periodo'],
                'origen': regla['origen'],
                'usos': cuota.usos if cuota else 0,
                'usos_totales': cuota.usos_totales if cuota else 0,
            })
        return filas

    def _render_matriz(self, request, valor_objetivo):
        plan, usuario = _resolver_objetivo(valor_objetivo)

        contexto = {
            **self.admin_site.each_context(request),
            'title': 'Panel de permisos y cuotas por botón',
            'opts': self.model._meta,
            'objetivos': _objetivos(),
            'objetivo': _valor_objetivo(plan, usuario),
            'plan': plan,
            'usuario_objetivo': usuario,
            'filas': self._filas_matriz(plan, usuario),
            'periodos': PERIODOS,
            'mensaje_cuota': (
                'Has agotado tus N usos permitidos para este botón. '
                'Pásate a Pro o solicita más cuota.'
            ),
            'url_changelist': reverse('admin:inventario_botonpermiso_changelist'),
            'url_cuotas': reverse('admin:inventario_cuotausousuario_changelist'),
            'url_flags': reverse('admin:inventario_featureflag_changelist'),
        }
        return TemplateResponse(
            request, 'admin/inventario/matriz_permisos.html', contexto,
        )

    # ------------------------------------------------------------------
    # Guardado
    # ------------------------------------------------------------------
    def _guardar_matriz(self, request):
        """Escribe la matriz completa del objetivo y vuelve a dibujarla."""
        valor = request.POST.get('objetivo')
        plan, usuario = _resolver_objetivo(valor)

        guardados = 0
        for definicion in BOTONES_CATALOGO:
            identificador = definicion['identificador']
            periodo = request.POST.get(f'periodo_{identificador}', PERIODO_MENSUAL)
            if periodo not in dict(PERIODOS):
                periodo = PERIODO_MENSUAL

            BotonPermiso.objects.update_or_create(
                identificador_boton=identificador,
                plan=plan,
                usuario=usuario,
                defaults={
                    'permitido': (
                        request.POST.get(f'permitido_{identificador}') == 'on'
                    ),
                    'limite_usos': _parsear_limite(
                        request.POST.get(f'limite_{identificador}'),
                    ),
                    'periodo': periodo,
                },
            )
            guardados += 1

        if usuario is not None:
            # Pedido explícito del panel: tocar la matriz de un usuario lo pasa
            # a plan «Personalizado» (sus reglas propias mandan sobre el plan).
            suscripcion.aplicar_plan_usuario(usuario, suscripcion.PLAN_PERSONALIZADO)
            self.message_user(
                request,
                f'Permisos de {usuario.username} guardados ({guardados} botones). '
                'Su plan quedó en «Personalizado».',
            )
        else:
            self.message_user(
                request,
                f'Permisos del plan «{plan}» guardados ({guardados} botones).',
            )

        destino = reverse(f'admin:{NOMBRE_URL_MATRIZ}')
        return redirect(f'{destino}?objetivo={_valor_objetivo(plan, usuario)}')


# =============================================================================
# ADMIN: CUOTAS DE USO (AUDITORÍA DEL CONSUMO)
# =============================================================================
@admin.register(CuotaUsoUsuario)
class CuotaUsoUsuarioAdmin(admin.ModelAdmin):
    """
    Auditoría del consumo por usuario/botón.

    Se escribe sola desde los endpoints (`api/plan_acceso.exigir_boton`); el
    Admin sólo consulta y, si hace falta, reinicia el contador del período.
    """

    list_display = ['usuario', 'identificador_boton', 'usos', 'usos_totales',
                    'periodo_inicio', 'ultimo_uso']
    list_filter = ['identificador_boton']
    search_fields = ['usuario__username', 'usuario__email', 'identificador_boton']
    readonly_fields = ['created_at', 'updated_at']
    ordering = ['-ultimo_uso']
    actions = ['reiniciar_usos']

    @admin.action(description='Reiniciar el contador de usos del período')
    def reiniciar_usos(self, request, queryset):
        ahora = timezone.now()
        actualizados = queryset.update(usos=0, periodo_inicio=ahora)
        self.message_user(
            request,
            f'{actualizados} cuota(s) reiniciada(s) desde {ahora:%d/%m/%Y %H:%M}.',
        )
