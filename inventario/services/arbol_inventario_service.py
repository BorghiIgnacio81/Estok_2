"""
Servicio de construcción del ÁRBOL JERÁRQUICO DE INVENTARIO (Objetos).

Reúne en UNA sola respuesta la TAXONOMÍA VÁLIDA del Estok activo:

  - SECCIÓN 1 (`cajas`): TODAS las cajas físicas del Estok —`tipo='CAJA'`,
    `es_inmueble=False`, terminales— a cualquier nivel (raíz, dentro de un mueble
    o EN TRÁNSITO en el limbo), cada una con sus Objetos físicos DIRECTOS. Filtro
    ORM ÚNICO Y EXCLUSIVO por `tipo='CAJA'` (`arbol_inventario_datos
    .cajas_del_estok`). Incluye además los OBJETOS declarados contenedor
    (`Objeto.es_contenedor=True`) o categorizados como «Cajas y Contenedores»,
    garantizados por ORM (`objetos_contenedor_del_estok`) para que nunca se
    degraden a «Objetos Sueltos o sin Caja» (nodos con `origen='objeto'`).
  - SECCIÓN 3 (`estructuras`): Muebles (`tipo='MUEBLE_MOVIL'`) RAÍZ mudables
    (`es_inmueble=False`), agrupados por Ubicación, cada uno con los Objetos
    físicos que aloja (incluidos los que cuelgan de sus CONJUNTOS internos).
  - SECCIÓN 2 (`sueltos`): Objetos sueltos o sin contenedor. Incluye TODOS los
    objetos con `contenedor_id IS NULL`, tengan o no un espacio/ubicación
    asignada, más los objetos apoyados en un ESPACIO/arquitectura del cuarto
    (p. ej. «Setup PC»), que la tarjeta dibuja con su ruta jerárquica completa.
  - SECCIÓN 3bis (`muebles_objetos`): OBJETOS de categoría «Muebles» (o
    «Muebles y Estructuras Móviles») que NO son cajas (`es_contenedor=False`).
    Un sillón, una mesa o una silla registrada como Objeto es mobiliario del
    Estok: se lista junto a los muebles y NUNCA en «Objetos Sueltos o sin Caja»
    (`arbol_inventario_muebles_objetos`).
  - SECCIÓN «📦 Objetos en Contenedor» (`objetos_en_contenedor`): LISTA PLANA de
    los objetos que viven dentro de una caja, mueble o espacio lógico, cada uno
    con la etiqueta del contenedor que lo aloja. Garantiza que ningún ítem
    quede oculto al quitar los filtros o al filtrar por categoría.

REGLA TAXONÓMICA ESTRICTA (pestaña de Objetos):
  Los `tipo='CONJUNTO'` (conjuntos/estructuras internas: estanterías o
  cajoneras de un mueble) y los `tipo='MUEBLE_INMUEBLE'` (muebles fijos del
  cuarto) quedan TERMINANTEMENTE EXCLUIDOS de TODA consulta y renderizado: el
  filtro se aplica en el ORM (`tipo`), nunca en memoria.

Optimización SQL/ORM en PostgreSQL:
  - 1 query para los MUEBLES raíz del Estok (select_related('ubicacion')).
  - 1 query para las CAJAS del Estok (select_related('ubicacion')).
  - 1 query liviana para el mapa de ancestros (id → parent_contenedor_id),
    usada para reasignar el inventario de una estantería a su mueble raíz.
  - 1 query para objetos del Estok (select_related + prefetch_related('fotos')).
  - Cero consultas N+1: los conteos y agrupaciones se resuelven en memoria.

REGLA DE DUALIDAD (Contenedor + Objeto): al crear un mueble/caja raíz mudable,
el backend inserta un registro ESPEJO en Objeto (mismo nombre, sin coordenadas
de casillero) para que el mueble sea 100% mudable en la Mudanza Inter-Estok.
Ese espejo se EXCLUYE del desglose interior para no autoduplicar la caja/armario
como objeto contenido en sí mismo.
"""

from ..api.serializers import ObjetoListSerializer
from .taxonomia_contenedor import TIPO_CAJA, TIPO_MUEBLE_MOVIL
# Regla ÚNICA de los OBJETOS CONTENEDOR (marca `es_contenedor` o categoría
# «Cajas y Contenedores»): clasificación y nodo de la SECCIÓN 1.
from .arbol_inventario_objetos_contenedor import (
    es_caja_declarada_por_naturaleza,
    es_objeto_contenedor,
    nodo_objeto_contenedor as _nodo_objeto_contenedor,
)
# SECCIÓN «📦 Objetos en Contenedor»: lista PLANA de los objetos que viven
# dentro de una caja/mueble/espacio, con la insignia de su ubicación. Ningún
# ítem queda oculto al quitar filtros o al filtrar por categoría.
from .arbol_inventario_objetos_en_contenedor import (
    objetos_en_contenedor as _objetos_en_contenedor,
)
# SECCIÓN «🗄 Muebles y Estructuras Móviles»: los OBJETOS de categoría
# «Muebles» que NO son cajas (`es_contenedor=False`) se listan con los muebles,
# nunca en la bandeja de huérfanos.
from .arbol_inventario_muebles_objetos import separar_muebles_objetos

# Capa de DATOS del árbol de inventario (consultas ORM con la taxonomía estricta
# y utilidades puras de serialización). Se importa con los nombres PRIVADOS del
# servicio para preservar los sitios de llamada ya existentes.
from .arbol_inventario_datos import (
    cajas_del_estok,
    clave_orden_natural as _clave_orden_natural,
    decimal_a_float as _decimal_a_float,
    es_registro_espejo as _es_registro_espejo,
    foto_url as _foto_url,
    mapa_padres_del_estok,
    muebles_raiz_del_estok,
    objetos_del_estok as _objetos_del_estok,
)
# Completa la SECCIÓN 1 con las cajas declaradas por Objeto que el listado base
# no trajo (registros históricos o en tránsito). Módulo propio para no engordar
# este orquestador (disciplina de modularidad del proyecto).
from .arbol_inventario_cajas_declaradas import cajas_declaradas_faltantes

# ---------------------------------------------------------------------------
# Construcción del payload jerárquico
# ---------------------------------------------------------------------------

def construir_arbol_estok(
    estok_id,
    request=None,
    categoria=None,
    decision=None,
    publicado_ml=None,
    search=None,
):
    """
    Retorna el payload del árbol jerárquico del Estok activo:

    {
      "estructuras": [ { ubicacion_id, ubicacion_nombre, contenedores: [Nodo] } ],
      "sueltos": [ ObjetoListSerializer ... ],
      "objetos_en_contenedor": [ ObjetoListSerializer + contenedor_etiqueta ... ],
      "muebles_objetos": [ ObjetoListSerializer de categoría «Muebles» ... ],
      "filtros_activos": bool,
      "resumen": { "contenedores": N, "objetos_ubicados": N, "objetos_sueltos": N }
    }

    Cada Nodo de contenedor (Mueble Mayor / Caja raíz) incluye "contenido":
    el desglose de sus Objetos físicos individuales. Las sub-divisiones
    internas/estanterías NO se incluyen nunca (filtro ORM estricto).
    """
    # ------------------------------------------------------------------
    # 1) MUEBLES (SECCIÓN 3) y 1bis) CAJAS (SECCIÓN 1): el acceso a datos vive
    #    en arbol_inventario_datos.py, donde se aplica la taxonomía ORM estricta
    #    (tipo + es_inmueble) y la DECLARACIÓN EXPLÍCITA `declarado_movible=True`
    #    que expulsa de raíz la arquitectura fija del espacio (Lote 22).
    # ------------------------------------------------------------------
    muebles = list(muebles_raiz_del_estok(estok_id))
    contenedores_por_id = {str(c.id): c for c in muebles}

    cajas = list(cajas_del_estok(estok_id))
    cajas_por_id = {str(c.id): c for c in cajas}
    cajas.sort(
        key=lambda c: (
            c.ubicacion.nombre.lower() if c.ubicacion_id else '',
            _clave_orden_natural(c.nombre),
        )
    )

    # Mapa liviano de la jerarquía completa (id → parent_contenedor_id) del Estok.
    padres_por_id = mapa_padres_del_estok(estok_id)

    # Cantidad REAL de sub-divisiones internas por Mueble Mayor (metadato de
    # ficha: NO se listan, sólo alimentan el conteo de la tarjeta del mueble).
    subcontenedores_por_padre = {}
    for cid, pid in padres_por_id.items():
        if pid is not None:
            clave_padre = str(pid)
            subcontenedores_por_padre[clave_padre] = (
                subcontenedores_por_padre.get(clave_padre, 0) + 1
            )

    def _tiene_ubicacion_alternativa(od):
        """
        True si el objeto conserva una ubicación/espacio propio, aunque el
        contenedor al que apunta sea fantasma (borrado o de otro Estok).

        JERARQUÍA DE FALLBACK (fix «Contenedor ausente»): la tarjeta del objeto
        debe mostrar el espacio o la planta que TIENE asignada; el aviso
        «contenedor ausente» queda reservado para el objeto sin NINGUNA
        referencia espacial.
        """
        return bool(od.get('ubicacion') or od.get('objeto_padre'))

    def _raiz_de(contenedor_id):
        """
        Sube por la cadena de contenedores padre hasta el RAÍZ del Estok.

        Devuelve el id (str) del Mueble Mayor/Caja raíz, o None si el id no
        pertenece a ningún contenedor del Estok (registro fantasma/borrado).
        Se apoya en `padres_por_id` (una sola query) → cero N+1.
        """
        cursor = str(contenedor_id)
        visitados = set()
        while cursor is not None and cursor not in visitados:
            visitados.add(cursor)
            if cursor not in padres_por_id:
                return None
            padre = padres_por_id.get(cursor)
            if padre is None:
                return cursor
            cursor = str(padre)
        return None

    # ------------------------------------------------------------------
    # 2) Objetos del Estok (1 query con select_related + prefetch fotos)
    # ------------------------------------------------------------------
    objetos_qs = _objetos_del_estok(
        estok_id,
        categoria=categoria, decision=decision,
        publicado_ml=publicado_ml, search=search,
    )
    objetos_serializados = list(ObjetoListSerializer(
        objetos_qs, many=True, context={'request': request},
    ).data)

    # ------------------------------------------------------------------
    # 2bis) GARANTÍA ORM DE «📦 CAJAS E INVENTARIO INTERNO»
    # ------------------------------------------------------------------
    # Las cajas declaradas por el operador (`es_contenedor=True` o categoría
    # «Cajas y Contenedores») pertenecen SIEMPRE a la SECCIÓN 1, sin importar
    # dónde estén: adentro de un espacio, colgadas de otro contenedor, sueltas en
    # la habitación o EN TRÁNSITO (sin ubicación ni contenedor). El listado base
    # las trae casi siempre; esto cubre los registros históricos sin tenant, que
    # el ORM recupera por su habitación o por el contenedor que los aloja.
    # Con FILTROS activos no se inyecta nada: la selección del operador manda.
    if not (categoria or decision or publicado_ml or search):
        objetos_serializados.extend(
            cajas_declaradas_faltantes(estok_id, objetos_serializados, request)
        )

    # ------------------------------------------------------------------
    # 3) Agrupación en memoria (cero N+1)
    # ------------------------------------------------------------------
    objetos_por_contenedor = {}          # mueble raíz → objetos (SECCIÓN 3)
    objetos_directos_por_caja = {}       # caja → objetos directos (SECCIÓN 1)
    objetos_sueltos = []
    # Bultos declarados contenedor (marca `es_contenedor`, categoría «Cajas y
    # Contenedores» o rótulo «Caja 0N»): viajan SIEMPRE a la SECCIÓN 1 como
    # tarjetas propias, cuelguen o no de un mueble, y NUNCA a «Objetos Sueltos o
    # sin Caja» ni al contenido plegado de otro contenedor (única excepción: la
    # de VISIBILIDAD documentada abajo, para objetos apoyados en un espacio).
    objetos_contenedor = []

    # Piezas que ALOJAN otros objetos (por contenedor físico o por espacio
    # lógico `objeto_padre`): un bulto declarado contenedor que YA contiene
    # ítems es una tarjeta de la SECCIÓN 1, jamás un objeto suelto.
    ids_que_alojan = {
        str(padre)
        for od in objetos_serializados
        for padre in (od.get('objeto_padre'), od.get('contenedor'))
        if padre
    }

    def _es_bulto_listado(contenedor_id):
        """
        True si el objeto vive DENTRO de un bulto que la pantalla lista.

        Bulto listado = caja de la SECCIÓN 1 (`cajas_por_id`) o mueble raíz de
        la SECCIÓN 3 (`contenedores_por_id`), sea su contenedor directo o
        cualquiera de sus ancestros. Cuando NO lo es, el contenedor es
        ARQUITECTURA/ESPACIO del cuarto (p. ej. «Setup PC» con «Declarar como
        Mueble / Objeto» destildado, `declarado_movible=False`): el objeto está
        simplemente apoyado en ese espacio y debe listarse como OBJETO SUELTO
        con su ruta jerárquica completa (Planta > Habitación > Espacio).
        """
        clave = str(contenedor_id or '')
        if not clave or clave not in padres_por_id:
            return False
        if clave in cajas_por_id:
            return True
        raiz = _raiz_de(clave)
        return raiz is not None and (
            raiz in contenedores_por_id or raiz in cajas_por_id
        )

    for od in objetos_serializados:
        contenedor_id = od.get('contenedor')
        # SECCIÓN 1 · OBJETO CONTENEDOR (caja declarada por marca, categoría o
        # rótulo «Caja 0N»): se lista SIEMPRE como tarjeta propia, esté en la
        # raíz, dentro de un mueble o dentro de otra caja. Antes, una caja
        # arrastrada al lienzo desaparecía de «📦 Cajas e Inventario Interno»
        # degradándose a viñeta del contenedor que la alojaba.
        #
        # EXCEPCIÓN DE VISIBILIDAD (objetos asignados a ESPACIOS): un bulto
        # declarado contenedor que NO aloja nada y está apoyado en un espacio/
        # arquitectura del cuarto NO es una caja del inventario, es un objeto
        # más de ese espacio. Viaja a «🧸 Objetos Sueltos o sin Caja» con su
        # ruta completa en vez de dibujarse como una caja vacía en la SECCIÓN 1.
        if es_objeto_contenedor(od):
            if (
                not contenedor_id
                or _es_bulto_listado(contenedor_id)
                or str(od.get('id')) in ids_que_alojan
                or es_caja_declarada_por_naturaleza(od)
            ):
                objetos_contenedor.append(od)
                continue
            # Objeto común con el flag `es_contenedor` tildado, sin contenido y
            # apoyado en un espacio → cae a «sueltos» más abajo.

        # REGLA ÚNICA DE «🧸 OBJETOS SUELTOS O SIN CAJA»: todo objeto que NO
        # pertenezca a un contenedor (`contenedor_id IS NULL`) se lista acá,
        # TENGA O NO un espacio/ubicación asignada (`espacio_id`). Estar
        # asignado a «Habitación Atras», «Galeria trasera» o «En Tránsito» no
        # lo esconde: la tarjeta muestra la ruta jerárquica de su ubicación.
        if not contenedor_id:
            objetos_sueltos.append(od)
            continue

        clave = str(contenedor_id)
        if clave not in padres_por_id:
            # Contenedor fantasma (borrado/migrado): el inventario jamás se pierde.
            # Sólo se declara «contenedor ausente» si el objeto NO tiene otra
            # ubicación/espacio propio (fallback contenedor → espacio → ubicación).
            od['contenedor_ausente'] = not _tiene_ubicacion_alternativa(od)
            objetos_sueltos.append(od)
            continue

        # SECCIÓN 1: contenido DIRECTO de cada caja del Estok.
        if clave in cajas_por_id:
            objetos_directos_por_caja.setdefault(clave, []).append(od)

        # SECCIÓN 3: los objetos que cuelgan de una sub-división interna
        # (estantería) se reasignan a su Mueble Mayor raíz. La pantalla sólo
        # estructura Muebles, Cajas y Objetos, jamás la estantería intermedia.
        raiz_id = _raiz_de(clave)
        if raiz_id is not None and raiz_id in contenedores_por_id:
            objetos_por_contenedor.setdefault(raiz_id, []).append(od)
        elif raiz_id is not None and raiz_id in cajas_por_id:
            # El objeto pertenece a una caja raíz: su hogar es la SECCIÓN 1.
            # No se duplica como contenido de mueble.
            continue
        elif clave in cajas_por_id:
            # 🔓 LOTE 30 · La CAJA ya es un bulto listado (SECCIÓN 1): su
            # inventario viaja con ella. Aunque su ancestro sea la ARQUITECTURA
            # del espacio (que no se lista ni se estructura), el objeto NO se
            # degrada a «suelto» ni se marca `contenedor_ausente`.
            continue
        else:
            # Pieza NO listada por ser ARQUITECTURA/ESPACIO del cuarto (el
            # contenedor EXISTE, sólo que no es un bulto del inventario): el
            # objeto se lista como suelto conservando su hogar real y NO se
            # marca «contenedor ausente» (ese aviso queda reservado para el
            # contenedor fantasma: borrado o de otro Estok). Así la tarjeta
            # dibuja la ruta jerárquica completa Planta > Habitación > Espacio
            # («Planta Alta > Habitación Atras > Setup PC»).
            objetos_sueltos.append(od)

    for lista in objetos_por_contenedor.values():
        lista.sort(key=lambda o: _clave_orden_natural(o.get('nombre') or ''))

    filtros_activos = bool(categoria or decision or publicado_ml or search)

    # ------------------------------------------------------------------
    # 4) Poda por filtros: solo contenedores con contenido que coincida
    #    (y sus ancestros). Sin filtros → se incluyen todos.
    # ------------------------------------------------------------------
    contenedores_incluidos = set()
    if filtros_activos:
        for cid, objetos in objetos_por_contenedor.items():
            contenedor = contenedores_por_id.get(cid)
            if contenedor is None:
                continue
            # Con el filtro ORM estricto TODA fila incluida es RAÍZ, por lo que
            # no hace falta subir por ancestros: basta con que tenga contenido.
            tiene_contenido_real = any(
                not _es_registro_espejo(o, contenedor) for o in objetos
            )
            if tiene_contenido_real:
                contenedores_incluidos.add(cid)
    else:
        contenedores_incluidos = set(contenedores_por_id.keys())

    # Poda equivalente para la SECCIÓN 1 (cajas): con filtros activos sólo se
    # devuelven las cajas con objetos directos REALES que coincidan.
    cajas_incluidas = set()
    if filtros_activos:
        for cid, objetos in objetos_directos_por_caja.items():
            caja = cajas_por_id.get(cid)
            if caja is None:
                continue
            if any(not _es_registro_espejo(o, caja) for o in objetos):
                cajas_incluidas.add(cid)
    else:
        cajas_incluidas = set(cajas_por_id.keys())

    # ------------------------------------------------------------------
    # 5) Nodo de contenedor RAÍZ (con su desglose "contenido")
    # ------------------------------------------------------------------
    def _nodo_contenedor(contenedor):
        objetos_directos = [
            od for od in objetos_por_contenedor.get(str(contenedor.id), [])
            if not _es_registro_espejo(od, contenedor)
        ]

        # La pantalla NO anida sub-contenedores: el "contenido" de un Mueble
        # Mayor/Caja raíz son exclusivamente sus Objetos físicos individuales.
        contenido = [{**od, 'tipo': 'objeto'} for od in objetos_directos]
        clave = str(contenedor.id)

        return {
            'tipo': 'contenedor',
            'tipo_contenedor': TIPO_MUEBLE_MOVIL,
            'id': clave,
            'nombre': contenedor.nombre,
            'descripcion': contenedor.descripcion or '',
            'ubicacion': (
                str(contenedor.ubicacion_id) if contenedor.ubicacion_id else None
            ),
            'ubicacion_nombre': (
                contenedor.ubicacion.nombre if contenedor.ubicacion_id else None
            ),
            'es_inmueble': bool(contenedor.es_inmueble),
            # Flag del Lote 22: el cliente re-verifica en caliente que la pieza
            # no sea arquitectura fija (defensa en profundidad sobre el ORM).
            'declarado_movible': bool(contenedor.declarado_movible),
            'material': contenedor.material or None,
            'largo': _decimal_a_float(contenedor.largo),
            'ancho': _decimal_a_float(contenedor.ancho),
            'alto': _decimal_a_float(contenedor.alto),
            'foto': _foto_url(contenedor, request),
            'grid_filas': contenedor.grid_filas,
            'grid_columnas': contenedor.grid_columnas,
            'grid_filas_config': contenedor.grid_filas_config,
            'parent_contenedor': None,
            # Metadato real de ficha: cuántas sub-divisiones internas tiene el
            # mueble (NO se listan: sólo caracterizan la tarjeta).
            'subcontenedores_count': subcontenedores_por_padre.get(clave, 0),
            'objetos_count': len(objetos_directos),
            'contenido': contenido,
        }

    def _nodo_caja(caja):
        """
        Nodo de CAJA para la SECCIÓN 1 (Cajas e Inventario Interno).

        Conserva los metadatos geográficos (ubicación, mueble padre y
        coordenadas de casillero) que el cliente necesita para dibujar la ruta
        de minimapas Piso → Habitación → Mueble, y expone SOLO sus Objetos
        físicos directos como contenido.
        """
        clave = str(caja.id)
        objetos_directos = [
            od for od in objetos_directos_por_caja.get(clave, [])
            if not _es_registro_espejo(od, caja)
        ]
        return {
            'tipo': 'contenedor',
            'tipo_contenedor': TIPO_CAJA,
            'id': clave,
            'nombre': caja.nombre,
            'descripcion': caja.descripcion or '',
            'ubicacion': str(caja.ubicacion_id) if caja.ubicacion_id else None,
            'ubicacion_nombre': (
                caja.ubicacion.nombre if caja.ubicacion_id else None
            ),
            'es_inmueble': bool(caja.es_inmueble),
            # Flag del Lote 22: el cliente re-verifica en caliente que la pieza
            # no sea arquitectura fija (defensa en profundidad sobre el ORM).
            'declarado_movible': bool(caja.declarado_movible),
            'material': caja.material or None,
            'largo': _decimal_a_float(caja.largo),
            'ancho': _decimal_a_float(caja.ancho),
            'alto': _decimal_a_float(caja.alto),
            'foto': _foto_url(caja, request),
            'grid_filas': caja.grid_filas,
            'grid_columnas': caja.grid_columnas,
            'grid_filas_config': caja.grid_filas_config,
            'parent_contenedor': (
                str(caja.parent_contenedor_id) if caja.parent_contenedor_id else None
            ),
            'parent_grid_row': caja.parent_grid_row,
            'parent_grid_col': caja.parent_grid_col,
            'subcontenedores_count': subcontenedores_por_padre.get(clave, 0),
            'objetos_count': len(objetos_directos),
            'contenido': [{**od, 'tipo': 'objeto'} for od in objetos_directos],
        }

    # ------------------------------------------------------------------
    # 6) Raíces (contenedores sin padre o con padre fuera del Estok),
    #    agrupadas por Ubicación para el encabezado de cada espacio.
    # ------------------------------------------------------------------
    grupos = {}
    raices = [
        c for c in muebles
        if str(c.id) in contenedores_incluidos
    ]
    raices.sort(
        key=lambda c: (
            c.ubicacion.nombre.lower() if c.ubicacion_id else '',
            _clave_orden_natural(c.nombre),
        )
    )

    for c in raices:
        clave = str(c.ubicacion_id) if c.ubicacion_id else '__sin_ubicacion'
        grupo = grupos.get(clave)
        if grupo is None:
            grupo = grupos[clave] = {
                'ubicacion_id': (
                    str(c.ubicacion_id) if c.ubicacion_id else None
                ),
                'ubicacion_nombre': (
                    c.ubicacion.nombre if c.ubicacion_id else 'Sin ubicación'
                ),
                'contenedores': [],
            }
        grupo['contenedores'].append(_nodo_contenedor(c))

    # ------------------------------------------------------------------
    # 6bis) Nodos de CAJA (SECCIÓN 1 · Cajas e Inventario Interno)
    # ------------------------------------------------------------------
    cajas_nodos = [
        _nodo_caja(c) for c in cajas if str(c.id) in cajas_incluidas
    ]

    # ------------------------------------------------------------------
    # 6ter) OBJETOS CONTENEDOR (SECCIÓN 1)
    # Clasificación y nodo en `arbol_inventario_objetos_contenedor`: los Objetos
    # marcados como contenedor o categorizados «Cajas y Contenedores» se listan
    # como tarjetas de caja/contenedor con enlace a /objetos/{id}.
    # ------------------------------------------------------------------
    cajas_nodos.extend(
        _nodo_objeto_contenedor(od, objetos_serializados)
        for od in objetos_contenedor
    )
    ids_objetos_contenedor = {str(od.get('id')) for od in objetos_contenedor}

    # ------------------------------------------------------------------
    # 6quater) OBJETOS EN CONTENEDOR (lista plana con insignia de ubicación)
    # Los ítems guardados DENTRO de una caja/mueble/espacio se devuelven
    # también en una LISTA PLANA para que ninguna tarjeta quede oculta al
    # quitar los filtros o al filtrar por categoría («Coleccionables»,
    # «Artesanías»). La etiqueta del contenedor viaja resuelta en memoria.
    # ------------------------------------------------------------------
    objetos_en_contenedor_nodos = _objetos_en_contenedor(
        objetos_serializados,
        cajas_por_id=cajas_por_id,
        contenedores_por_id=contenedores_por_id,
        ids_objeto_contenedor=ids_objetos_contenedor,
        es_espejo=_es_registro_espejo,
    )

    # ------------------------------------------------------------------
    # 7) Objetos sueltos (sección inferior, consistencia de inventario)
    # ------------------------------------------------------------------
    sueltos = sorted(
        (
            o for o in objetos_sueltos
            # Los hijos de un Objeto contenedor ya se muestran dentro de su
            # tarjeta en la SECCIÓN 1: no se duplican en la bandeja de sueltos.
            if str(o.get('objeto_padre') or '') not in ids_objetos_contenedor
        ),
        key=lambda o: (o.get('fecha_registro') or ''), reverse=True,
    )

    # ------------------------------------------------------------------
    # 7bis) SECCIÓN 3bis · 🗄 MUEBLES Y ESTRUCTURAS MÓVILES (OBJETOS)
    # Los Objetos de categoría «Muebles» que NO son cajas (`es_contenedor =
    # False`) son mobiliario del Estok y se listan en la sección de muebles,
    # NUNCA en la bandeja de huérfanos. La partición se hace sobre la bandeja
    # YA depurada: un ítem guardado dentro de una caja/mueble/objeto
    # contenedor listado sigue viviendo en el contenido de ese contenedor y no
    # se duplica acá.
    # ------------------------------------------------------------------
    muebles_objetos, sueltos = separar_muebles_objetos(sueltos)
    muebles_objetos.sort(
        key=lambda o: (
            str(o.get('ubicacion_nombre') or ''),
            _clave_orden_natural(o.get('nombre') or ''),
        )
    )

    # Objetos realmente ubicados (containers existentes del Estok), sin contar
    # dos veces los que viven en una caja anidada dentro de un mueble.
    total_objetos_ubicados = sum(
        1 for od in objetos_serializados
        if od.get('contenedor') and str(od['contenedor']) in padres_por_id
    )

    return {
        'estructuras': list(grupos.values()),
        'cajas': cajas_nodos,
        'sueltos': sueltos,
        # SECCIÓN «📦 Objetos en Contenedor»: lista plana con `contenedor_tipo`
        # y `contenedor_etiqueta` («Caja 02», «Mueble Escritorio»…).
        'objetos_en_contenedor': objetos_en_contenedor_nodos,
        # SECCIÓN «🗄 Muebles y Estructuras Móviles»: OBJETOS de categoría
        # «Muebles» que no son cajas (mobiliario registrado como Objeto).
        'muebles_objetos': muebles_objetos,
        'filtros_activos': filtros_activos,
        'resumen': {
            'contenedores': (
                len(contenedores_incluidos)
                + len(cajas_incluidas)
                + len(objetos_contenedor)
            ),
            'objetos_ubicados': total_objetos_ubicados,
            'objetos_sueltos': len(sueltos),
        },
    }

