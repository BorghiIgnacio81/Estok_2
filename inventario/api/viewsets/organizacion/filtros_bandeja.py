"""
Filtro ORM de la canasta «🧺 ELEMENTOS POR UBICAR» (`?bandeja=true`).

Fuente ÚNICA de la regla de RECUPERABILIDAD del listado de `ContenedorViewSet`.
Se movió acá desde `contenedores.py` (Lote 28) para sostener el límite de 400
líneas por archivo —mismo criterio con el que `qe_geometria_de_plano` vive en
`services/taxonomia_contenedor.py`— y para que la regla y su documentación
tengan un único dueño.

REGLA (PostgreSQL = autoridad única; el cliente solo la re-verifica en
profundidad):

    WHITELIST FÍSICA → caja móvil (`tipo='CAJA'`, `es_inmueble=False`).

    CANAL 1 · RECUPERABILIDAD DECLARADA (`declarado_movible=True`):
      1. sueltas sin ubicación general;
      2. con `en_transito_interno=True` (guardadas sin estante fino);
      3. dentro de una ubicación o de un contenedor declarado «Espacio Único».
      A este canal SÍ se le aplica la PURGA DE ARQUITECTURA FIJA
      (`ui_left/ui_top/ui_height` propias del plano): una pieza clavada en el
      lienzo no es un bulto transportable.

    CANAL 2 · 🔓 RESCATE DE EMERGENCIA DEL LIMBO (Lotes 27/28): caja RAÍZ suelta
      en el limbo de mudanza (`parent_contenedor` nulo y ubicación nula o
      «En Tránsito» / «Zona de Mudanza»). Entra SIEMPRE, por dos motivos:
        · sin exigir `declarado_movible`: la mudanza valida la whitelist física
          `es_movible` y NO el disyuntor de arquitectura, así que una pieza no
          declarada igual puede viajar y quedaría ineditable en el limbo;
        · sin purga de geometría: las coordenadas que arrastra son basura del
          plano de ORIGEN (la mudanza resetea casilleros, no la geometría
          elástica) y no pueden vetar la visibilidad de una pieza que el
          operador todavía tiene que volver a ubicar.
"""

from django.db.models import Q

from ....services.mudanza_service import q_limbo_de_mudanza
from ....services.taxonomia_contenedor import TIPO_CAJA, qe_geometria_de_plano


def aplicar_filtro_bandeja(qs, estok_id):
    """
    Aplica la regla de la canasta «Elementos por ubicar» al queryset recibido.

    `estok_id` es el Estok activo (header `X-Estok-Id` o query param): acota el
    RESCATE del limbo para que el limbo de OTRO inquilinato jamás se filtre en
    la canasta (aislamiento multi-tenant intacto).
    """
    qs = qs.filter(es_inmueble=False, tipo=TIPO_CAJA)
    # CANAL 1 · recuperabilidad declarada + purga de arquitectura fija.
    declarada = (
        Q(declarado_movible=True)
        & ~qe_geometria_de_plano()
        & (
            Q(ubicacion__isnull=True)
            | Q(en_transito_interno=True)
            | Q(parent_contenedor__espacio_unico=True)
            | Q(ubicacion__espacio_unico=True)
        )
    )
    # CANAL 2 · 🔓 RESCATE: caja RAÍZ suelta en el limbo (entra siempre).
    rescate = q_limbo_de_mudanza(estok_id)
    return qs.filter(declarada | rescate)
