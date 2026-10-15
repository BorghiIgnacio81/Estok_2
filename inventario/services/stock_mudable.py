"""
PREDICADOS ORM DEL STOCK MUDABLE (fuente ÚNICA · Lote 30).

Concentra en UN solo lugar la frontera matemática entre lo que la mudanza
general TRANSPORTA y lo que el disyuntor ESTRICTO deja intacto en el origen.
La consumen la migración masiva (`mudanza_masiva_service.mudar_todo`) y el
Catálogo de Objetos (`arbol_inventario_datos.cajas_del_estok`), de modo que
ambas pantallas no puedan divergir.

DISYUNTOR ESTRICTO (regla vigente)
  Una pieza queda FRENADA en el origen —estructura, no stock— cuando:
    · actúa como ESTRUCTURA/MOBILIARIO FIJO: aloja sub-divisiones propias
      (estantería, ropero con estantes, «Espacio 1» que contiene cajas), o
    · es una RAÍZ NO declarada movible (`declarado_movible=False`): el espacio
      base de la habitación.
  El freno alcanza a la ESTRUCTURA (el nodo), NUNCA al stock que vive adentro.

STOCK QUE VIAJA POR SÍ MISMO
  · CAJAS TERMINALES: `tipo='CAJA'`, `es_inmueble=False`, sin sub-divisiones
    propias y que no sean la arquitectura del espacio. Viajan DECLARADAS o NO:
    es la LIBERACIÓN del stock interno que el disyuntor rígido del Lote 27
    escondía dentro de los espacios fijados.
  · ESTRUCTURAS DECLARADAS: `declarado_movible=True` sobre un MUEBLE_MOVIL o
    sobre una pieza que aloja sub-divisiones propias (REGLA B del Catálogo).
    Viaja con TODO su subárbol en cascada.

Los OBJETOS no se deciden acá: viajan todos, anclados a su contenedor cuando
este viaja y liberados a la bandeja de «sin ubicar» cuando el contenedor se
queda en el origen.
"""

from django.db.models import Exists, OuterRef, Q

from ..models import Contenedor
from .taxonomia_contenedor import TIPO_CAJA, TIPO_MUEBLE_MOVIL


def qe_tiene_subdivisiones():
    """`Exists` ORM: la pieza aloja sub-divisiones propias (hijos directos)."""
    return Exists(Contenedor.objects.filter(parent_contenedor=OuterRef('pk')))


def qe_estructura_del_espacio():
    """
    Q ORM de «la pieza es la ARQUITECTURA del espacio» (raíz, no declarada).

    El espacio base de una habitación —«Espacio 1», la zona organizadora del
    cuarto— es un contenedor RAÍZ que el operador NO declaró movible. Su
    ESTRUCTURA se queda en el origen; su stock interno viaja igual (Lote 30).
    """
    return Q(parent_contenedor__isnull=True) & Q(declarado_movible=False)


def qe_stock_mudable():
    """
    Q ORM de «bulto de stock que la mudanza general transporta POR SÍ MISMO».

    Espejo EXACTO de las dos secciones mudables del Catálogo de Objetos:

      SECCIÓN 1 · CAJAS TERMINALES (`tipo='CAJA'`, `es_inmueble=False`, sin
      sub-divisiones propias) que no sean la arquitectura del espacio. Viajan
      declaradas O no: es la liberación del stock interno (Lote 30).

      SECCIÓN 3 · ESTRUCTURAS DECLARADAS: el operador declaró movible la pieza
      (`declarado_movible=True`) y es un MUEBLE_MOVIL o aloja sub-divisiones
      propias. Viaja con TODO su subárbol en cascada.

    El resultado NUNCA incluye mobiliario anclado (`es_inmueble=True`): su
    contenido se libera por separado, no la pieza.
    """
    cajas_terminales = (
        Q(tipo=TIPO_CAJA, es_inmueble=False)
        & ~Q(qe_tiene_subdivisiones())
        & ~qe_estructura_del_espacio()
    )
    estructuras_declaradas = (
        Q(declarado_movible=True, es_inmueble=False)
        & (Q(tipo=TIPO_MUEBLE_MOVIL) | Q(qe_tiene_subdivisiones()))
    )
    return cajas_terminales | estructuras_declaradas
