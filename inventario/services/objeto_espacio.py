"""
Servicio ÚNICO de las PROPIEDADES DE OBJETO de un ESPACIO (mueble/objeto).

CONTEXTO FUNCIONAL
==================
El disyuntor «🎒 Declarar como Mueble / Objeto» del editor de espacios
(`Contenedor.declarado_movible = True`) convierte a la pieza en un ítem del
inventario. Ese ítem NO es un registro aparte: es el ESPEJO de dualidad
Contenedor ⇄ Objeto que el backend ya crea al materializar muebles raíz
(`_crear_registro_espejo_mudable`).

Este módulo es la AUTORIDAD ÚNICA para:
  · resolver el Objeto espejo de un Contenedor (por marca, por id o por la
    regla legada de nombre/categoría nula),
  · crearlo cuando la pieza todavía no lo tenía (p. ej. una sub-división creada
    con `crear_espejo=false`),
  · persistir TODAS sus propiedades editables desde los formularios del
    espacio: Dueño/Propietario, Categoría, Estado de conservación, Valor
    estimado, Notas/Descripción, campos patrimoniales y FOTOS (galería o
    cámara),
  · serializarlas para que el panel y el modal de edición precarguen la pieza.

El modal técnico envía el bloque del objeto PREFIJADO (`objeto_*`) dentro del
MISMO PUT del Contenedor; `propiedades_desde_payload()` es la frontera entre
las dos capas y `ContenedorViewSet.update()` las persiste en una transacción.

MARCA DE ESPEJO
===============
Los espejos nuevos llevan `especificaciones.es_espejo_contenedor = True`. Esa
marca sobrevive a los renombres del Contenedor y a la asignación de una
Categoría (que deja de ser nula), por lo que la dualidad nunca se rompe. Los
espejos históricos (sin marca) se siguen resolviendo con la regla legada:
mismo nombre que el Contenedor o categoría nula, siempre SIN coordenadas de
casillero (no duplican presencia en los visores espaciales).

Los `verbose_name` y la validación de entrada viven en
`api.serializers.objeto_espacio`; acá sólo hay reglas de dominio y ORM.
"""

from ..models import FotoObjeto, Objeto

# Clave de la marca de dualidad dentro de `Objeto.especificaciones` (JSON libre).
MARCA_ESPEJO = 'es_espejo_contenedor'

# Choices canónicos de Objeto.estado_conservacion (fuente única para validar).
ESTADOS_CONSERVACION_OBJETO = (
    'excelente',
    'bueno',
    'regular',
    'malo',
    'muy_malo',
)

# Campos que los formularios del espacio pueden persistir sobre el Objeto espejo.
# Incluye los cuatro datos de inventario y los campos patrimoniales/notas que el
# operador completa al editar un mueble declarado como objeto.
CAMPOS_PROPIEDADES = (
    'descripcion',
    'dueno_original',
    'dueno_externo_nombre',
    'beneficiario',
    'categoria',
    'estado_conservacion',
    'valor_estimado',
    'color',
    'material',
    'marca',
    'modelo',
    'numero_serie',
    'autor',
    'anio',
    'artista_fabricante',
    'tamano',
)

# Claves de entrada que no son campos del modelo (id del espejo y archivos).
CAMPOS_ENTRADA = CAMPOS_PROPIEDADES + ('objeto_id', 'fotos')

# Valores vacíos que deben viajar como NULL al ORM (FK y numéricos). Un string
# vacío en un PrimaryKeyRelatedField es inválido para DRF, no "sin valor".
CAMPOS_VACIOS_A_NULO = frozenset({
    'objeto_id', 'dueno_original', 'beneficiario', 'categoria',
    'valor_estimado', 'anio',
})


def espejo_de_contenedor(contenedor):
    """
    Queryset base de candidatos a ESPEJO de un Contenedor.

    Un espejo nunca ocupa un casillero fino (`parent_grid_*` nulos): de lo
    contrario se duplicaría como ítem dentro de su propio espacio.
    """
    return Objeto.objects.filter(
        contenedor_id=contenedor.pk,
        deleted_at__isnull=True,
        parent_grid_row__isnull=True,
        parent_grid_col__isnull=True,
    )


def obtener_objeto_espejo(contenedor, objeto_id=None, incluir_categoria_nula=True):
    """
    Devuelve el Objeto espejo del Contenedor o None si todavía no existe.

    Orden de resolución:
      1. `objeto_id` explícito (lo devuelve el GET del panel y lo reenvía el
         PUT: evita cualquier ambigüedad si el espacio aloja objetos reales).
      2. Marca `especificaciones.es_espejo_contenedor = True`.
      3. Mismo nombre que el Contenedor (creación histórica del espejo).
      4. `incluir_categoria_nula`: fallback legado para piezas RAÍZ mudables. Se
         desactiva en el panel de propiedades para NO confundir un objeto real
         incompleto (sin categoría y sin casillero) con el espejo del espacio.
    """
    candidatos = espejo_de_contenedor(contenedor).select_related(
        'dueno_original', 'categoria',
    )

    if objeto_id:
        encontrado = candidatos.filter(pk=objeto_id).first()
        if encontrado is not None:
            return encontrado

    marcado = (
        candidatos
        .filter(especificaciones__es_espejo_contenedor=True)
        .order_by('fecha_registro')
        .first()
    )
    if marcado is not None:
        return marcado

    por_nombre = (
        candidatos
        .filter(nombre__iexact=contenedor.nombre)
        .order_by('fecha_registro')
        .first()
    )
    if por_nombre is not None:
        return por_nombre

    if incluir_categoria_nula and (
        not contenedor.parent_contenedor_id and not contenedor.es_inmueble
    ):
        return (
            candidatos
            .filter(categoria__isnull=True)
            .order_by('fecha_registro')
            .first()
        )
    return None



def crear_objeto_espejo(contenedor, estok_id=None):
    """
    Materializa el Objeto espejo de un Contenedor con los datos físicos de la
    pieza. Se usa tanto en la creación automática de muebles raíz como cuando
    el operador declara un espacio existente que no tenía dualidad.
    """
    estok_id = estok_id or (
        contenedor.ubicacion.estok_id if contenedor.ubicacion_id else None
    )
    return Objeto.objects.create(
        nombre=contenedor.nombre,
        descripcion=contenedor.descripcion or '',
        estok_id=estok_id,
        ubicacion_id=contenedor.ubicacion_id or None,
        contenedor=contenedor,
        parent_grid_row=None,
        parent_grid_col=None,
        estado_conservacion='bueno',
        estado_carga='completo',
        campos_pendientes=[],
        material=contenedor.material or '',
        largo=contenedor.largo,
        ancho=contenedor.ancho,
        alto=contenedor.alto,
        # MARCA de dualidad: inmune a renombres y a la asignación de categoría.
        especificaciones={MARCA_ESPEJO: True},
    )


def guardar_propiedades_objeto(contenedor, datos):
    """
    Persiste TODAS las propiedades de objeto del espacio en su Objeto espejo.

    `datos` es el `validated_data` del serializer homónimo: sólo se escriben
    las claves presentes en el payload (PUT/PATCH parcial), de modo que guardar
    un campo no borra los demás. Si la pieza no tenía espejo, se crea en el
    acto: declarar un espacio como objeto es justamente lo que lo materializa.

    Las FOTOS viajan en `datos['fotos']` (lista de archivos validados) y se
    persisten como FotoObjeto del espejo, sin tocar los demás campos.
    """
    archivos = list(datos.get('fotos') or [])

    objeto = obtener_objeto_espejo(
        contenedor, datos.get('objeto_id'), incluir_categoria_nula=False,
    )
    if objeto is None:
        objeto = crear_objeto_espejo(contenedor)

    campos_actualizados = set()
    for campo in CAMPOS_PROPIEDADES:
        if campo in datos:
            setattr(objeto, campo, datos[campo])
            campos_actualizados.add(campo)

    # El espejo representa al espacio: su rótulo sigue al del Contenedor para
    # que la dualidad siga siendo reconocible en la pestaña de Objetos.
    objeto.nombre = contenedor.nombre
    # La descripción del Contenedor es sólo un fallback histórico: si el
    # formulario envía Notas/Descripción, ese valor MANDA y no se pisa.
    if (
        'descripcion' not in datos
        and contenedor.descripcion
        and not objeto.descripcion
    ):
        objeto.descripcion = contenedor.descripcion
        campos_actualizados.add('descripcion')
    # Los espejos HISTÓRICOS no traían la marca: se los marca al declararlos,
    # así la dualidad sobrevive a futuros renombres del Contenedor.
    especificaciones = dict(objeto.especificaciones or {})
    especificaciones[MARCA_ESPEJO] = True
    objeto.especificaciones = especificaciones
    objeto.estado_carga = 'completo'
    objeto.campos_pendientes = []

    objeto.save(update_fields=[
        'nombre', 'especificaciones', 'estado_carga', 'campos_pendientes',
        *sorted(campos_actualizados), 'updated_at',
    ])

    if archivos:
        agregar_fotos_objeto(objeto, archivos)
    return objeto


def agregar_fotos_objeto(objeto, archivos, descripcion=''):
    """
    Crea las FotoObjeto del Objeto espejo respetando la foto principal.

    La PRIMERA foto del espacio pasa a ser principal sólo si el objeto todavía
    no tenía una: nunca se degrada la portada elegida por el operador.
    """
    total_previo = objeto.fotos.count()
    tiene_principal = objeto.fotos.filter(es_principal=True).exists()
    creadas = []
    for indice, archivo in enumerate(archivos):
        foto = FotoObjeto.objects.create(
            objeto=objeto,
            imagen=archivo,
            descripcion=descripcion or f'Foto {total_previo + indice + 1}',
            es_principal=(not tiene_principal and indice == 0),
        )
        creadas.append(foto)
    return creadas


def propiedades_desde_payload(datos, prefijo='objeto_'):
    """
    Extrae las propiedades del Objeto desde el payload de un PUT del espacio.

    El modal técnico envía un ÚNICO `PUT /contenedores/{id}/` con los campos de
    la ubicación/espacio y los del objeto asociado, distinguidos por prefijo
    (`objeto_dueno_original`, `objeto_categoria`, `objeto_fotos`, ...). Esta
    función es la frontera entre ambos mundos: devuelve sólo las claves del
    objeto, ya sin prefijo y con los vacíos normalizados a None.
    """
    if not hasattr(datos, 'keys'):
        return {}

    propiedades = {}
    for clave in list(datos.keys()):
        if not clave.startswith(prefijo):
            continue
        destino = clave[len(prefijo):]
        if destino not in CAMPOS_ENTRADA:
            continue
        if destino == 'fotos':
            if hasattr(datos, 'getlist'):
                propiedades['fotos'] = list(datos.getlist(clave))
            else:
                valor_fotos = datos.get(clave)
                propiedades['fotos'] = (
                    list(valor_fotos) if isinstance(valor_fotos, (list, tuple))
                    else [valor_fotos]
                )
            continue
        valor = datos.get(clave)
        if destino in CAMPOS_VACIOS_A_NULO and (
            valor is None or str(valor).strip() == ''
        ):
            valor = None
        propiedades[destino] = valor
    return propiedades


def _foto_payload(foto):
    """Contrato de lectura de una foto del objeto para los formularios."""
    return {
        'id': str(foto.pk),
        'imagen': foto.imagen.url if foto.imagen else None,
        'descripcion': foto.descripcion,
        'es_principal': bool(foto.es_principal),
    }


def datos_propiedades_objeto(contenedor, objeto=None):
    """
    Payload de lectura de los formularios del espacio (GET /propiedades_objeto/).

    Con `objeto=None` devuelve los valores por defecto del formulario para que
    el frontend pinte TODOS los campos sin ramas especiales.
    """
    if objeto is None:
        return {
            'existe': False,
            'objeto_id': None,
            'nombre': contenedor.nombre,
            'descripcion': contenedor.descripcion or '',
            'dueno_original': None,
            'dueno_original_nombre': None,
            'dueno_externo_nombre': '',
            'beneficiario': None,
            'beneficiario_nombre': None,
            'categoria': None,
            'categoria_nombre': None,
            'estado_conservacion': 'bueno',
            'valor_estimado': None,
            'color': '',
            'material': contenedor.material or '',
            'marca': '',
            'modelo': '',
            'numero_serie': '',
            'autor': '',
            'anio': None,
            'artista_fabricante': '',
            'tamano': '',
            'fotos': [],
        }

    return {
        'existe': True,
        'objeto_id': str(objeto.pk),
        'nombre': objeto.nombre,
        'descripcion': objeto.descripcion or '',
        'dueno_original': (
            str(objeto.dueno_original_id) if objeto.dueno_original_id else None
        ),
        'dueno_original_nombre': (
            str(objeto.dueno_original) if objeto.dueno_original_id else None
        ),
        'dueno_externo_nombre': objeto.dueno_externo_nombre or '',
        'beneficiario': (
            str(objeto.beneficiario_id) if objeto.beneficiario_id else None
        ),
        'beneficiario_nombre': (
            str(objeto.beneficiario) if objeto.beneficiario_id else None
        ),
        'categoria': str(objeto.categoria_id) if objeto.categoria_id else None,
        'categoria_nombre': (
            objeto.categoria.nombre if objeto.categoria_id else None
        ),
        'estado_conservacion': objeto.estado_conservacion or 'bueno',
        'valor_estimado': (
            str(objeto.valor_estimado) if objeto.valor_estimado is not None else None
        ),
        'color': objeto.color or '',
        'material': objeto.material or '',
        'marca': objeto.marca or '',
        'modelo': objeto.modelo or '',
        'numero_serie': objeto.numero_serie or '',
        'autor': objeto.autor or '',
        'anio': objeto.anio,
        'artista_fabricante': objeto.artista_fabricante or '',
        'tamano': objeto.tamano or '',
        'fotos': [_foto_payload(foto) for foto in objeto.fotos.all()],
    }
