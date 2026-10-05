"""
Endpoint PÚBLICO de captura de decisiones remotas (puente del 403).

Cuando un miembro intenta decidir sobre un objeto que pertenece a OTRO usuario
del sistema, el backend responde HTTP 403 ("No tienes permisos sobre este
objeto"). El frontend ofrece entonces enviar al dueño un correo con 3 botones
(Vender / Conservar / Tirar); cada botón apunta a ESTE endpoint con un token
firmado de un solo uso:

    GET /api/public/objeto-remoto-decision/?token=<TOKEN>&action=<accion>

Es una vista DESPROTEGIDA (AllowAny): la única credencial es el token firmado,
que codifica el objeto, el dueño y la acción, y caduca a los 3 días. Devuelve
una página HTML limpia (no JSON) porque la abre directamente el navegador del
dueño desde el correo.
"""

from django.http import HttpResponse
from django.utils.html import escape
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from ...models import Objeto
from ...services import token_decision_remota


def _pagina(titulo, mensaje, destacado=None, ok=True):
    """Página HTML autocontenida (éxito/error) para el navegador del dueño."""
    color = '#16a34a' if ok else '#dc2626'
    icono = '✅' if ok else '⚠️'
    bloque = (
        f'<p style="margin:0 0 8px;font-size:15px;font-weight:bold;color:{color};">'
        f'{escape(destacado)}</p>'
        if destacado else ''
    )
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{escape(titulo)} · ESTOK</title>
</head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:48px auto;padding:0 16px;">
    <div style="background:#ffffff;border-radius:16px;padding:32px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <div style="font-size:44px;line-height:1;">{icono}</div>
      <h1 style="margin:12px 0 8px;font-size:20px;color:{color};">{escape(titulo)}</h1>
      {bloque}
      <p style="margin:0;font-size:14px;line-height:21px;color:#4b5563;">{escape(mensaje)}</p>
    </div>
    <p style="text-align:center;margin:16px 0 0;font-size:11px;color:#9ca3af;">
      ESTOK · https://eeestok.duckdns.org
    </p>
  </div>
</body>
</html>"""


def _respuesta(titulo, mensaje, destacado=None, ok=True, codigo=200):
    return HttpResponse(
        _pagina(titulo, mensaje, destacado, ok),
        status=codigo,
        content_type='text/html; charset=utf-8',
    )


class ObjetoRemotoDecisionView(APIView):
    """GET público firmado: captura la decisión del dueño desde el correo."""

    permission_classes = [AllowAny]
    authentication_classes = []  # sin JWT/sesión: la credencial es el token

    def get(self, request):
        token = request.query_params.get('token', '')
        accion_url = (request.query_params.get('action', '') or '').strip().lower()

        # 1) Firma + vigencia (token firmado de un solo uso).
        try:
            payload = token_decision_remota.verificar_token_decision(token)
        except token_decision_remota.TokenInvalido as error:
            return _respuesta('Enlace inválido o vencido', str(error), ok=False, codigo=400)

        # 2) La acción del enlace debe coincidir con la acción FIRMADA en el token.
        if accion_url and accion_url != payload['action']:
            return _respuesta(
                'Acción no válida',
                'La acción del enlace no coincide con el permiso firmado.',
                ok=False, codigo=400,
            )
        accion = payload['action']

        # 3) Aislamiento multi-tenant: el objeto debe existir, no estar dado de
        #    baja lógica y seguir perteneciendo al dueño firmado.
        objeto = Objeto.objects.filter(
            id=payload['objeto_id'], deleted_at__isnull=True,
        ).first()
        if objeto is None:
            return _respuesta(
                'Objeto no disponible', 'El objeto ya no está disponible.',
                ok=False, codigo=404,
            )
        if str(objeto.dueno_original_id) != str(payload['user_id']):
            return _respuesta(
                'Permiso revocado', 'El objeto ya no te pertenece.',
                ok=False, codigo=403,
            )

        etiquetas = dict(Objeto.OWNER_ACTION_CHOICES)

        # 4) Idempotencia: si el objeto YA tiene una decisión, no se pisa.
        if objeto.owner_action:
            return _respuesta(
                '¡Gracias! Tu decisión ha sido guardada con éxito en ESTOK',
                f'Ya habíamos registrado tu decisión «'
                f'{etiquetas.get(objeto.owner_action, objeto.owner_action)}» '
                f'sobre «{objeto.nombre}».',
            )

        # 5) Impactar el estado en PostgreSQL.
        objeto.owner_action = accion
        objeto.save(update_fields=['owner_action', 'updated_at'])

        return _respuesta(
            '¡Gracias! Tu decisión ha sido guardada con éxito en ESTOK',
            f'Registramos tu decisión «{etiquetas.get(accion, accion)}» '
            f'sobre «{objeto.nombre}».',
        )
