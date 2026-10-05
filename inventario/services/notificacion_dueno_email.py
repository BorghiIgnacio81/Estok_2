"""
Correo de notificación al DUEÑO de un objeto ajeno (puente del 403).

Fuente ÚNICA del correo que invita al propietario a decidir a distancia sobre un
objeto: Vender / Conservar / Tirar mediante 3 enlaces firmados de un solo uso.

El envío (y TODO el manejo de errores SMTP) se delega en la infraestructura de
correo del proyecto (`inventario/services/email_service.py`) para NO duplicar la
captura de errores de Gmail/SMTP.
"""

from django.utils.html import escape

from . import email_service

# Tipo contractual del correo (viaja en los logs y en el manejo de errores SMTP).
TIPO_NOTIFICACION_DUENO = 'notificacion_dueno'

ASUNTO = 'Tu decisión es necesaria en ESTOK'

# Foto de reemplazo cuando el objeto no tiene imágenes (asset público).
FOTO_PLACEHOLDER = 'https://eeestok.duckdns.org/mueble.png'

_SITIO = 'https://eeestok.duckdns.org'


def _texto_plano(objeto, urls, estok_nombre):
    """Versión TEXTO del correo (respaldo de los clientes sin HTML)."""
    return '\n'.join([
        '¡Hola!',
        f'Un miembro del Estok «{estok_nombre}» quiere invitar tu decisión sobre '
        f'«{objeto.nombre}», un objeto del que figuras como dueño.',
        '',
        'Elegí una opción (cada enlace es de un solo uso y válido 3 días):',
        f'💰 Vender:    {urls["vender"]}',
        f'📦 Conservar: {urls["conservar"]}',
        f'🗑️ Tirar:     {urls["tirar"]}',
        '',
        f'ESTOK · {_SITIO}',
    ])


def _cuerpo_html(objeto, urls, foto_url, estok_nombre, descripcion):
    """Cuerpo HTML refinado: ficha del objeto (foto + nombre + descripción) y
    los 3 botones interactivos (Vender / Conservar / Tirar)."""
    nombre = escape(objeto.nombre)
    desc = escape(descripcion)
    estok = escape(estok_nombre) or 'tu Estok'
    foto = escape(foto_url or FOTO_PLACEHOLDER)

    def boton(url, etiqueta, color):
        return f"""
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 10px;"><tr>
            <td style="border-radius:10px;background:{color};">
              <a href="{url}" target="_blank" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;">{etiqueta}</a>
            </td></tr></table>"""

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{escape(ASUNTO)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <span style="display:none;max-height:0;overflow:hidden;">
    Un miembro del Estok «{estok}» necesita tu decisión sobre «{nombre}».
  </span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">

        <tr><td style="background:#1e293b;padding:20px 24px;">
          <span style="font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:.5px;">📦 ESTOK</span>
        </td></tr>

        <tr><td style="padding:24px 24px 8px 24px;">
          <h1 style="margin:0 0 6px;font-size:20px;color:#111827;">Tu decisión es necesaria</h1>
          <p style="margin:0;font-size:14px;line-height:20px;color:#4b5563;">
            Un miembro del Estok <strong>«{estok}»</strong> quiere invitar tu decisión
            sobre un objeto del que figuras como dueño.
          </p>
        </td></tr>

        <tr><td style="padding:16px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td width="160" valign="top" style="background:#f9fafb;">
                <img src="{foto}" alt="{nombre}" width="160" style="display:block;width:160px;height:auto;border:0;object-fit:cover;">
              </td>
              <td valign="top" style="padding:14px 16px;">
                <p style="margin:0 0 6px;font-size:16px;font-weight:bold;color:#111827;">{nombre}</p>
                <p style="margin:0;font-size:13px;line-height:18px;color:#6b7280;">{desc}</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:8px 24px 4px 24px;">
          <p style="margin:0 0 14px;font-size:14px;color:#374151;font-weight:bold;">
            ¿Qué querés que hagamos con «{nombre}»?
          </p>{boton(urls['vender'], '💰 Vender', '#16a34a')}{boton(urls['conservar'], '📦 Conservar', '#2563eb')}{boton(urls['tirar'], '🗑️ Tirar', '#dc2626')}
          <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;">
            Cada botón es un enlace firmado de un solo uso y caduca en 3 días.
            Si no reconocés este objeto, podés ignorar este correo.
          </p>
        </td></tr>

        <tr><td style="padding:18px 24px 24px 24px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:11px;color:#9ca3af;">
            ESTOK · Gestión de inventario y sucesión de objetos · {_SITIO}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _descripcion_de(objeto):
    """Descripción del objeto o un texto neutro si está vacía."""
    texto = (getattr(objeto, 'descripcion', '') or '').strip()
    return texto if texto else 'Sin descripción.'


def enviar_notificacion_dueno(objeto, destinatario, urls, foto_url=None, estok_nombre=''):
    """
    Despacha el correo HTML (con respaldo de texto) al dueño del objeto.

    Devuelve True si el envío se efectuó y False si falló (nunca propaga
    excepciones SMTP: las maneja email_service._despachar).
    """
    estok_nombre = estok_nombre or (objeto.estok.nombre if objeto.estok else '')
    return email_service.enviar_correo_html(
        asunto=ASUNTO,
        texto=_texto_plano(objeto, urls, estok_nombre),
        html=_cuerpo_html(objeto, urls, foto_url, estok_nombre, _descripcion_de(objeto)),
        destinatario=destinatario,
        tipo=TIPO_NOTIFICACION_DUENO,
    )
