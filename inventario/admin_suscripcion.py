"""
Admin · Suscripción del usuario EN CALIENTE desde la lista de usuarios.

Aporta al `CustomUserAdmin`:

    - Columna «Suscripción» con un combobox (`<select>`) por fila para cambiar
      el plan entre Gratuito (Free) / Pro / Personalizado sin abrir el detalle.
    - Vista `cambiar-plan/<uuid>/` (POST + CSRF del propio admin) que aplica el
      cambio con `services/suscripcion.aplicar_plan_usuario()` (única fuente de
      verdad del plan: alinea `es_premium`, `limite_objetos` y
      `ocultar_publicidad`).

¿Por qué un POST a una vista del admin y no `list_editable`?
`list_editable` sólo sirve para columnas atómicas de un único campo y no permite
mostrar etiquetas legibles ni reaccionar al cambio al instante. El combobox
dispara el POST con el token CSRF que el propio admin ya renderiza en la página,
sin JS externo (los estáticos del admin no se recolectan en este despliegue).
"""

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseNotAllowed
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, redirect
from django.template.loader import render_to_string
from django.urls import path, reverse

from .models import CustomUser
from .services import suscripcion

# Opciones del combobox (valor estable → etiqueta visible del Admin Global).
PLANES_SELECCION = (
    (suscripcion.PLAN_FREE, 'Gratuito (Free)'),
    (suscripcion.PLAN_PRO, 'Pro'),
    (suscripcion.PLAN_PERSONALIZADO, 'Personalizado'),
)
ETIQUETAS_PLAN = dict(PLANES_SELECCION)

NOMBRE_URL_CAMBIAR_PLAN = 'inventario_customuser_cambiar_plan'


class SuscripcionUsuarioAdminMixin:
    """
    Mixin del `CustomUserAdmin`: columna interactiva de plan + su endpoint.

    Se declara `'selector_plan'` en `list_display`; `get_list_display()` lo
    reemplaza en tiempo de request por una columna con el token CSRF correcto
    (los callables de `list_display` no reciben `request`).
    """

    def get_urls(self):
        propias = [
            path(
                'cambiar-plan/<uuid:user_id>/',
                self.admin_site.admin_view(self.cambiar_plan_view),
                name=NOMBRE_URL_CAMBIAR_PLAN,
            ),
        ]
        return propias + super().get_urls()

    @admin.display(description='Suscripción')
    def selector_plan(self, usuario):
        """
        Versión SIN interacción de la columna.

        Los checks del admin (admin.E108) exigen que `list_display` apunte a un
        atributo real del ModelAdmin, así que este método debe existir. En cada
        request `get_list_display()` lo sustituye por la versión con combobox
        (la que lleva el token CSRF); ésta sólo se usa si algo externo consulta
        la columna directamente.
        """
        plan_actual = str(usuario.plan_suscripcion or suscripcion.PLAN_FREE)
        return ETIQUETAS_PLAN.get(plan_actual, plan_actual)

    def get_list_display(self, request):
        columnas = []
        for campo in super().get_list_display(request):
            if campo == 'selector_plan':
                columnas.append(self._columna_selector_plan(request))
            else:
                columnas.append(campo)
        return columnas

    def _columna_selector_plan(self, request):
        """Cierra la columna con el request actual para poder firmar el POST."""
        csrf_token = get_token(request)
        planes = PLANES_SELECCION

        @admin.display(description='Suscripción')
        def selector_plan(usuario):
            plan_actual = str(usuario.plan_suscripcion or suscripcion.PLAN_FREE)
            return render_to_string(
                'admin/inventario/selector_plan_cell.html',
                {
                    'url': reverse(
                        f'admin:{NOMBRE_URL_CAMBIAR_PLAN}', args=[usuario.pk],
                    ),
                    'csrf': csrf_token,
                    'planes': planes,
                    'plan_actual': plan_actual,
                    'etiqueta': ETIQUETAS_PLAN.get(plan_actual, plan_actual),
                },
                request=request,
            )

        return selector_plan

    def cambiar_plan_view(self, request, user_id):
        """
        Aplica el plan enviado por el combobox y vuelve a la lista de usuarios.

        Sólo POST (con CSRF) y con permiso de cambio: es una operación de
        escritura sobre la monetización de la cuenta.
        """
        if not self.has_change_permission(request):
            raise PermissionDenied(
                'No tenés permiso para cambiar el plan de un usuario.'
            )
        if request.method != 'POST':
            return HttpResponseNotAllowed(['POST'])

        usuario = get_object_or_404(CustomUser, pk=user_id)
        plan = str(request.POST.get('plan') or '').strip().lower()

        try:
            suscripcion.aplicar_plan_usuario(usuario, plan)
        except ValueError as exc:
            self.message_user(
                request,
                f'No se pudo cambiar el plan de {usuario.username}: {exc}',
                level=messages.ERROR,
            )
        else:
            self.message_user(
                request,
                'Plan de {} actualizado a «{}».'.format(
                    usuario.username,
                    ETIQUETAS_PLAN.get(plan, plan),
                ),
            )

        return redirect(reverse('admin:inventario_customuser_changelist'))
