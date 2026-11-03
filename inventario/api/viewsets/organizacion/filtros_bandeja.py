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

    Y ADEMÁS la pieza es una CAJA RECONOCIBLE cuando cumple CUALQUIERA de:
      1. `declarado_movible=True` (checkbox del modal / alta de caja);
      2. `en_transito_interno=True` (guardada sin estante fino);
      3. su rótulo EMPIEZA por «Caja» («Caja 01», «Caja 02(Piezas yeso
         pesebre)»…): el nombre es la ÚNICA señal que persiste el alta rápida;
      4. está en el limbo de mudanza (`q_limbo_de_mudanza`).

    La arquitectura fija del plano —habitaciones «Espacio N» (tipo=CAJA con
    `ui_*`), muebles y zonas geográficas— NO está declarada movible ni se rotula
    «Caja…», así que la whitelist la deja fuera por sí sola. La purga explícita
    por geometría se retiró: también descartaba cajas REALES dibujadas en el
    minimapa de su mueble (ver `aplicar_filtro_bandeja`).

POR QUÉ AHORA DEVUELVE **TODAS** LAS CAJAS
    La canasta tiene CUATRO pestañas con filtros EXACTOS y las dos de cajas son
    complementarias:

      · Pestaña 2 · Cajas sueltas     → sin espacio físico (limbo / tránsito).
      · Pestaña 4 · Cajas a reubicar  → CON espacio físico asignado.

    Antes el endpoint devolvía únicamente las cajas que entraban por los canales
    estrechos de recuperabilidad (`Espacio Único`, tránsito interno, limbo) y,
    tras la purga por geometría, ninguna caja dibujada en el plano; la pestaña 4
    quedaba vacía. Con esta regla el cliente recibe el universo completo de
    cajas móviles del Estok y la partición 2 ⇄ 4 la hace `bandejaSinUbicar.ts`
    sin consultas extra.
"""

from django.db.models import Q

from ....services.mudanza_service import q_limbo_de_mudanza
from ....services.taxonomia_contenedor import (
    TIPO_CAJA,
    qe_nombre_de_caja,
)


def aplicar_filtro_bandeja(qs, estok_id):
    """
    Aplica la regla de la canasta «Elementos por ubicar» al queryset recibido.

    `estok_id` es el Estok activo (header `X-Estok-Id` o query param): acota el
    canal del limbo para que el limbo de OTRO inquilinato jamás se filtre en la
    canasta (aislamiento multi-tenant intacto).

    ORDEN DE LA REGLA (corregido: la purga de arquitectura ya NO borra cajas
    reales dibujadas en el plano)
        La whitelist física (`tipo=CAJA`, `es_inmueble=False`) es la puerta de
        entrada; dentro de ella la pieza entra en la canasta SÓLO si algún canal
        la reconoce como CAJA:

          1. `declarado_movible=True` (checkbox del modal / alta de caja);
          2. `en_transito_interno=True` (guardada sin estante fino);
          3. rótulo que EMPIEZA por «Caja» («Caja 01», «Caja 02(Piezas yeso
             pesebre)»…): el nombre es la única señal que persistió el alta
             rápida;
          4. limbo de mudanza (`q_limbo_de_mudanza`): rescate de cajas mudadas.

        BUG QUE ESTO CORRIGE
            Antes la purga de arquitectura fija (`qe_geometria_de_plano`) se
            aplicaba con `.exclude(...)` ANTES de los canales de reconocimiento,
            de modo que toda caja DIBUJADA en el plano quedaba fuera: el
            minimapa interno de un mueble posiciona sus cajas con
            `ui_left/ui_top/ui_height`, así que «Caja 01…05» (hijas de «Estante
            1», con objetos reales dentro) nunca llegaban a la canasta. La
            whitelist de reconocimiento ya excluye por sí sola la arquitectura
            —habitaciones «Espacio N», muebles y zonas geográficas no están
            declaradas movibles ni se rotulan «Caja…»—, por lo que la purga por
            geometría deja de ser un requisito extra.
    """
    qs = qs.filter(es_inmueble=False, tipo=TIPO_CAJA)
    reconocida = (
        Q(declarado_movible=True)       # 1 · declaración explícita del operador
        | Q(en_transito_interno=True)   # 2 · guardada sin estante fino
        | qe_nombre_de_caja()           # 3 · rótulo «Caja 01»…«Cajas 05»
        | q_limbo_de_mudanza(estok_id)  # 4 · 🔓 rescate del limbo de mudanza
    )
    return qs.filter(reconocida)
