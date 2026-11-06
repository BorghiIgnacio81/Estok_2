"""
Resolución del ESTOK ACTIVO (tenant) de un request — helper ÚNICO de la API.

Todos los ViewSets, mixins y serializers multi-tenant resuelven el inquilinato
activo con la MISMA precedencia. Antes cada archivo repetía la expresión
`request.headers.get('X-Estok-Id') or request.query_params.get('estok_id')`;
ahora vive acá (misma expresión, un solo lugar que mantener).

Hay DOS variantes a propósito, y NO son intercambiables:

    estok_id_de_request(request)
        SÓLO lo que manda el cliente: header X-Estok-Id → query param
        `estok_id`. Devuelve el valor crudo (sin normalizar) o None.
        Es la que usan los querysets y las acciones: si el cliente no pidió un
        Estok, la acción debe fallar o quedar vacía, nunca «adivinar» otro.

    estok_id_de(request)
        Igual que la anterior, pero con el respaldo de la SESIÓN del backend
        (`user.ultimo_estok_activo_id`) y SIEMPRE normalizada a `str`.
        Es la que usa el control de planes/flags (`api/plan_acceso.py`), donde
        el frontend puede llamar sin header y la respuesta debe seguir siendo
        coherente con el último Estok usado.

Este módulo no importa modelos ni vistas: sólo lee el request.
"""

__all__ = [
    'estok_id_de_request',
    'estok_id_de',
]


def estok_id_de_request(request):
    """
    Estok pedido por el CLIENTE: header X-Estok-Id → query param `estok_id`.

    Devuelve el valor crudo (tal como llegó) o `None`. No consulta la sesión ni
    valida el formato: eso lo decide cada vista (UUID, membresía, 400/403).
    """
    if request is None:
        return None

    query_params = getattr(request, 'query_params', None) or {}
    encabezados = getattr(request, 'headers', None) or {}
    return (
        encabezados.get('X-Estok-Id')
        or query_params.get('estok_id')
    )


def estok_id_de(request):
    """
    Estok activo del request, en el orden que documenta la API:
      1. header X-Estok-Id (lo envía getAuthHeaders)
      2. query param `estok_id`
      3. `user.ultimo_estok_activo_id` (sesión del backend)

    Siempre devuelve `str` (o `None` si no hay ningún Estok resoluble).
    """
    crudo = estok_id_de_request(request)
    if crudo:
        return str(crudo)

    usuario = getattr(request, 'user', None)
    ultimo = getattr(usuario, 'ultimo_estok_activo_id', None)
    return str(ultimo) if ultimo else None
