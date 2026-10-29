"""
PRESERVACIÓN DEL CONTENEDOR DE ORIGEN EN LA MUDANZA INTER-ESTOK («Caja 01»).

CONTEXTO
  Cuando un OBJETO que vive dentro de un contenedor del Estok de origen se muda
  a otro Estok, la mudanza re-ancla su ubicación al espacio elegido en el
  destino (y su `contenedor` al mueble receptor cuando se suelta dentro de uno).
  Sin esta regla la referencia a la caja de origen se perdía EN SILENCIO: el
  objeto llegaba «suelto» y ya nadie podía saber de qué caja salió.

REGLA ÚNICA
  1. El contenedor de origen es un elemento MÓVIL (CAJA / OBJETO /
     MUEBLE_MOVIL) y el objeto aterriza en un espacio físico real: se busca una
     pieza homónima ya existente en el Estok destino —primero entre los hijos
     del contenedor receptor, después en la habitación elegida y por último en
     cualquier punto del inquilinato— y, si no existe, se RECREA en el espacio
     seleccionado copiando su identidad física (nombre, grilla interna,
     material y medidas). El objeto mudado queda DENTRO de esa caja, así la
     trazabilidad sobrevive a la mudanza.
  2. El contenedor de origen es ARQUITECTURA del espacio (CONJUNTO /
     MUEBLE_INMUEBLE: una división interna o un mueble fijo que NO viaja) o el
     objeto viaja «EN TRÁNSITO» (sin espacio físico donde recrearlo): no se
     recrea nada y el nombre de la caja de origen se ANOTA en la descripción del
     objeto, para que la referencia no se pierda sin aviso.

El módulo no conoce vistas ni tableros: devuelve un descriptor
(`accion` / `contenedor_nombre` / `contenedor_id`) que el servicio de mudanza
usa para enriquecer el resultado y el mensaje que ve el operador.
"""

from django.utils import timezone

from ..models import Contenedor, Objeto
from .objeto_espacio import crear_objeto_espejo, obtener_objeto_espejo
from .taxonomia_contenedor import TIPO_CAJA, TIPOS_MOVILES, es_movible

# Marca estable de la nota de trazabilidad escrita en `Objeto.descripcion`.
MARCA_NOTA_ORIGEN = '📍 Mudanza inter-Estok'

# Identidad física de la pieza que se copia al recrearla en el Estok destino.
# La geometría del lienzo (`ui_*`) NO se copia: era relativa al plano de origen.
CAMPOS_IDENTIDAD = (
    'descripcion',
    'material',
    'largo',
    'ancho',
    'alto',
    'foto',
    'grid_filas',
    'grid_columnas',
    'grid_filas_config',
    'declarado_movible',
    'espacio_unico',
)


def _buscar_en_destino(nombre, estok_destino, ubicacion_destino, contenedor_destino):
    """
    Pieza homónima ya existente en el Estok destino, en orden de cercanía al
    espacio elegido: mismo padre → misma habitación → cualquier punto del Estok.
    """
    candidatos = Contenedor.objects.filter(ubicacion__estok=estok_destino)
    if nombre:
        candidatos = candidatos.filter(nombre__iexact=nombre)
    else:
        return None

    if contenedor_destino is not None:
        encontrado = candidatos.filter(parent_contenedor=contenedor_destino).first()
        if encontrado is not None:
            return encontrado

    encontrado = candidatos.filter(ubicacion=ubicacion_destino).first()
    if encontrado is not None:
        return encontrado

    return (
        candidatos.filter(parent_contenedor__isnull=True).first()
        or candidatos.order_by('created_at').first()
    )


def _recrear(contenedor_origen, estok_destino, ubicacion_destino, contenedor_destino):
    """
    Recrea la pieza en el espacio elegido del Estok destino respetando su
    identidad física. Conserva el `tipo` de origen cuando es MÓVIL (una caja
    sigue siendo caja, un mueble mudable sigue siendo mueble) y cae a CAJA en
    cualquier otro caso: jamás se recrea arquitectura anclada.
    """
    tipo = contenedor_origen.tipo if contenedor_origen.tipo in TIPOS_MOVILES else TIPO_CAJA
    nuevo = Contenedor(
        nombre=contenedor_origen.nombre,
        ubicacion=ubicacion_destino,
        parent_contenedor=contenedor_destino,
        es_inmueble=False,
        tipo=tipo,
    )
    for campo in CAMPOS_IDENTIDAD:
        valor = getattr(contenedor_origen, campo, None)
        if valor is not None:
            setattr(nuevo, campo, valor)
    # Bandera de taxonomía explícita: el modelo NO re-infierne el tipo por el
    # rótulo ni por la jerarquía (una «Caja 01» hija de un mueble sigue siendo
    # CAJA, no un CONJUNTO estructural).
    nuevo._tipo_explicito = True
    nuevo.save()

    # REGLA DE DUALIDAD: una pieza RAÍZ recreada materializa su Objeto espejo,
    # igual que cualquier mueble/caja raíz creado desde el tablero.
    if contenedor_destino is None and obtener_objeto_espejo(
        nuevo, incluir_categoria_nula=False,
    ) is None:
        crear_objeto_espejo(nuevo, estok_id=estok_destino.id)
    return nuevo


def _anclar_objeto(objeto, contenedor):
    """
    Deja el objeto DENTRO del contenedor preservado, con la ubicación del
    contenedor (puede ser otra habitación si la caja homónima ya vivía ahí).
    """
    cambios = {'contenedor_id': contenedor.id, 'updated_at': timezone.now()}
    if contenedor.ubicacion_id and str(objeto.ubicacion_id or '') != str(contenedor.ubicacion_id):
        cambios['ubicacion_id'] = contenedor.ubicacion_id
    Objeto.objects.filter(pk=objeto.pk).update(**cambios)
    objeto.contenedor_id = contenedor.id
    if 'ubicacion_id' in cambios:
        objeto.ubicacion_id = contenedor.ubicacion_id


def nota_de_origen(contenedor_origen, estok_origen_nombre):
    """
    Línea de trazabilidad para `Objeto.descripcion` cuando el contenedor de
    origen NO puede recrearse. Mantiene el nombre de la caja y el Estok de
    procedencia a la vista del operador, con fecha de la mudanza.
    """
    nombre = (contenedor_origen.nombre or '').strip() or 'sin nombre'
    origen = (estok_origen_nombre or '').strip()
    procedencia = f' del Estok «{origen}»' if origen else ''
    fecha = timezone.localdate().isoformat()
    return (
        f'[{MARCA_NOTA_ORIGEN} {fecha}] Provenía del contenedor «{nombre}»'
        f'{procedencia}; el contenedor no viajó en la mudanza.'
    )


def anotar_origen_en_descripcion(objeto, contenedor_origen, estok_origen_nombre=''):
    """
    Agrega la línea de trazabilidad a la descripción del objeto (idempotente:
    no duplica la nota si esa caja ya estaba anotada). Devuelve la línea escrita
    o None cuando no hubo cambios.
    """
    if contenedor_origen is None:
        return None
    nombre = (contenedor_origen.nombre or '').strip()
    marca = f'[{MARCA_NOTA_ORIGEN}'
    descripcion = objeto.descripcion or ''
    if nombre and marca in descripcion and f'«{nombre}»' in descripcion:
        return None

    linea = nota_de_origen(contenedor_origen, estok_origen_nombre)
    nueva = f'{descripcion.rstrip()}\n{linea}' if descripcion.strip() else linea
    Objeto.objects.filter(pk=objeto.pk).update(
        descripcion=nueva, updated_at=timezone.now(),
    )
    objeto.descripcion = nueva
    return linea


def preservar_contenedor_de_origen(
    objeto, contenedor_origen, estok_destino, ubicacion_destino,
    contenedor_destino=None, *, en_transito=False, estok_origen_nombre='',
):
    """
    Cierra la mudanza de un OBJETO conservando la referencia a su caja de origen.

    Devuelve un descriptor `{'accion', 'contenedor_nombre', 'contenedor_id'}`
    (`accion` ∈ {'recreado', 'reutilizado', 'anotado'}) o None cuando el objeto
    no venía de ningún contenedor.

    · `en_transito=True` → el objeto queda SIN ubicación física (contrato del
      limbo del Estok destino): no se recrea la caja, se anota el origen.
    · Contenedor de origen ANCLADO (CONJUNTO / MUEBLE_INMUEBLE) → es
      arquitectura del cuarto de origen y NO viaja: se anota el origen.
    · Contenedor de origen MÓVIL → se busca o se recrea en el espacio elegido y
      el objeto queda dentro de él.
    """
    if contenedor_origen is None:
        return None

    nombre = contenedor_origen.nombre

    if en_transito or not es_movible(contenedor_origen):
        anotar_origen_en_descripcion(
            objeto, contenedor_origen, estok_origen_nombre,
        )
        return {
            'accion': 'anotado',
            'contenedor_nombre': nombre,
            'contenedor_id': None,
        }

    contenedor = _buscar_en_destino(
        (nombre or '').strip(), estok_destino, ubicacion_destino, contenedor_destino,
    )
    recreado = contenedor is None
    if recreado:
        contenedor = _recrear(
            contenedor_origen, estok_destino, ubicacion_destino, contenedor_destino,
        )
    _anclar_objeto(objeto, contenedor)
    return {
        'accion': 'recreado' if recreado else 'reutilizado',
        'contenedor_nombre': contenedor.nombre,
        'contenedor_id': str(contenedor.id),
    }


def aviso_preservacion(descriptor):
    """
    Texto humano del resultado de la preservación ('' cuando no aplica).
    """
    if not descriptor:
        return ''
    nombre = descriptor.get('contenedor_nombre') or 'sin nombre'
    accion = descriptor.get('accion')
    if accion == 'recreado':
        return (
            f' Se recreó el contenedor «{nombre}» en el Estok destino: el objeto '
            'quedó dentro de él.'
        )
    if accion == 'reutilizado':
        return (
            f' El objeto quedó dentro de «{nombre}», que ya existía en el Estok '
            'destino.'
        )
    return (
        f' Se anotó en su descripción que provenía de «{nombre}» (el contenedor '
        'no viajó).'
    )
