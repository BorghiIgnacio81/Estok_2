"""
Filtro ORM de la canasta «🧺 ELEMENTOS POR UBICAR» (`?bandeja=true`).

Fuente ÚNICA de la regla de RECUPERABILIDAD del listado de `ContenedorViewSet`.
Se movió acá desde `contenedores.py` (Lote 28) para sostener el límite de 400
líneas por archivo —mismo criterio con el que `qe_geometria_de_plano` vive en
`services/taxonomia_contenedor.py`— y para que la regla y su documentación
tengan un único dueño.

REGLA VIGENTE (PostgreSQL = autoridad única; el cliente sólo la re-verifica y
la reparte entre las CUATRO pestañas de la canasta):

    WHITELIST FÍSICA → caja móvil (`tipo='CAJA'`, `es_inmueble=False`).

    PURGA INVENCIBLE → toda pieza con geometría propia de plano
    (`ui_left`/`ui_top`/`ui_height` fuera del origen) es ARQUITECTURA: los
    «Espacios» de las habitaciones nacen `tipo=CAJA` y nunca son bultos.

    Y ADEMÁS la pieza es una CAJA RECONOCIBLE cuando cumple CUALQUIERA de:
      1. `declarado_movible=True` (checkbox del modal / alta de caja);
      2. `en_transito_interno=True` (guardada sin estante fino);
      3. su rótulo es el de una caja numerada («Caja 02»…«Cajas 05»): el
         nombre es la ÚNICA señal que persiste el alta rápida, y sin esta vía
         las Cajas 02–05 quedaban fuera de la API aunque existieran;
      4. está en el limbo de mudanza (`q_limbo_de_mudanza`).

POR QUÉ AHORA DEVUELVE **TODAS** LAS CAJAS
    La canasta tiene CUATRO pestañas con filtros EXACTOS y las dos de cajas son
    complementarias:

      · Pestaña 2 · Cajas sueltas     → sin espacio físico (limbo / tránsito).
      · Pestaña 4 · Cajas a reubicar  → CON espacio físico asignado.

    Antes el endpoint devolvía únicamente las cajas que entraban por los canales
    estrechos de recuperabilidad (`Espacio Único`, tránsito interno, limbo), de
    modo que una caja guardada en una habitación normal NUNCA llegaba al
    cliente y la pestaña 4 quedaba vacía. Con esta regla el cliente recibe el
    universo completo de cajas móviles del Estok y la partición 2 ⇄ 4 la hace
    `bandejaSinUbicar.ts` sin consultas extra.
"""

from django.db.models import Q

from ....services.mudanza_service import q_limbo_de_mudanza
from ....services.taxonomia_contenedor import (
    TIPO_CAJA,
    qe_geometria_de_plano,
    qe_nombre_de_caja,
)


def aplicar_filtro_bandeja(qs, estok_id):
    """
    Aplica la regla de la canasta «Elementos por ubicar» al queryset recibido.

    `estok_id` es el Estok activo (header `X-Estok-Id` o query param): acota el
    canal del limbo para que el limbo de OTRO inquilinato jamás se filtre en la
    canasta (aislamiento multi-tenant intacto).
    """
    qs = qs.filter(es_inmueble=False, tipo=TIPO_CAJA)
    # PURGA INVENCIBLE DE ARQUITECTURA FIJA: fuera «Espacios» y piezas modeladas.
    qs = qs.exclude(qe_geometria_de_plano())
    return qs.filter(
        Q(declarado_movible=True)      # 1 · declaración explícita del operador
        | Q(en_transito_interno=True)  # 2 · guardada sin estante fino
        | qe_nombre_de_caja()          # 3 · rótulo «Caja 02»…«Cajas 05»
        | q_limbo_de_mudanza(estok_id)  # 4 · 🔓 rescate del limbo de mudanza
    )
