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
  · persistir sus propiedades editables desde el panel del espacio:
    Dueño / Propietario, Categoría, Estado de conservación y Valor estimado,
  · serializarlas para que el panel las precargue al abrir la pieza.

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

from ..models import Objeto

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

# Campos que el panel del espacio puede persistir sobre el Objeto espejo.
CAMPOS_PROPIEDADES = (
    'dueno_original',
    'categoria',
    'estado_conservacion',
    'valor_estimado',
)


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
    Persiste las propiedades de objeto del espacio en su Objeto espejo.

    `datos` es el `validated_data` del serializer homónimo: sólo se escriben
    las claves presentes en el payload (PUT/PATCH parcial), de modo que guardar
    un campo no borra los demás. Si la pieza no tenía espejo, se crea en el
    acto: declarar un espacio como objeto es justamente lo que lo materializa.
    """
    objeto = obtener_objeto_espejo(
        contenedor, datos.get('objeto_id'), incluir_categoria_nula=False,
    )
    if objeto is None:
        objeto = crear_objeto_espejo(contenedor)

    for campo in CAMPOS_PROPIEDADES:
        if campo in datos:
            setattr(objeto, campo, datos[campo])

    # El espejo representa al espacio: su rótulo sigue al del Contenedor para
    # que la dualidad siga siendo reconocible en la pestaña de Objetos.
    objeto.nombre = contenedor.nombre
    if contenedor.descripcion and not objeto.descripcion:
        objeto.descripcion = contenedor.descripcion
    # Los espejos HISTÓRICOS no traían la marca: se los marca al declararlos,
    # así la dualidad sobrevive a futuros renombres del Contenedor.
    especificaciones = dict(objeto.especificaciones or {})
    especificaciones[MARCA_ESPEJO] = True
    objeto.especificaciones = especificaciones
    objeto.estado_carga = 'completo'
    objeto.campos_pendientes = []
    objeto.save(update_fields=[
        'nombre', 'descripcion', 'dueno_original', 'categoria',
        'estado_conservacion', 'valor_estimado', 'especificaciones',
        'estado_carga', 'campos_pendientes', 'updated_at',
    ])
    return objeto


def datos_propiedades_objeto(contenedor, objeto=None):
    """
    Payload de lectura del panel del espacio (GET /propiedades_objeto/).

    Con `existe=False` devuelve los valores por defecto del formulario para que
    el frontend pinte los campos sin ramas especiales.
    """
    if objeto is None:
        return {
            'existe': False,
            'objeto_id': None,
            'nombre': contenedor.nombre,
            'dueno_original': None,
            'dueno_original_nombre': None,
            'categoria': None,
            'categoria_nombre': None,
            'estado_conservacion': 'bueno',
            'valor_estimado': None,
        }

    return {
        'existe': True,
        'objeto_id': str(objeto.pk),
        'nombre': objeto.nombre,
        'dueno_original': (
            str(objeto.dueno_original_id) if objeto.dueno_original_id else None
        ),
        'dueno_original_nombre': (
            str(objeto.dueno_original) if objeto.dueno_original_id else None
        ),
        'categoria': str(objeto.categoria_id) if objeto.categoria_id else None,
        'categoria_nombre': (
            objeto.categoria.nombre if objeto.categoria_id else None
        ),
        'estado_conservacion': objeto.estado_conservacion or 'bueno',
        'valor_estimado': (
            str(objeto.valor_estimado) if objeto.valor_estimado is not None else None
        ),
    }
