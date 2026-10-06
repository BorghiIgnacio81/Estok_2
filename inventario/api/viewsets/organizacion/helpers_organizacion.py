"""
Helpers compartidos del paquete `organizacion`.

Reúne los métodos auxiliares reutilizados por `UbicacionViewSet` y
`ContenedorViewSet`: validación de membresía multi-tenant, recorridos BFS del
sub-árbol de Ubicaciones y Contenedores, control de ciclos jerárquicos,
propagación de ubicación en cascada y el generador del «registro espejo»
omitible (dualidad Contenedor + Objeto vía `crear_espejo`).
"""

from rest_framework.exceptions import PermissionDenied, ValidationError

from ....models import Ubicacion, Contenedor, Objeto, Membresia
from ....services.taxonomia_contenedor import TIPO_CONJUNTO, TIPO_MUEBLE_INMUEBLE


def _validar_membresia(user, estok_id):
    """Valida que el usuario tenga membresía activa en el Estok destino."""
    if user.is_superuser:
        return
    if not Membresia.objects.filter(usuario=user, estok_id=estok_id).exists():
        raise PermissionDenied("No tienes membresia en el Estok destino.")


class OrganizacionHelpersMixin:
    @staticmethod
    def _ids_ubicaciones_descendientes(ubicacion_id):
        """UUIDs de TODAS las sub-ubicaciones (BFS por parent_ubicacion)."""
        encontrados = []
        cola = [ubicacion_id]
        while cola:
            padre = cola.pop()
            hijos = list(
                Ubicacion.objects.filter(parent_ubicacion_id=padre)
                .values_list('id', flat=True)
            )
            for hijo in hijos:
                encontrados.append(hijo)
                cola.append(hijo)
        return encontrados

    @staticmethod
    def _ids_subarbol(raiz):
        """
        IDs del contenedor raíz y de TODOS sus descendientes (BFS recursivo).

        Se usa para liberar de una sola pasada el inventario completo del
        subárbol eliminado, sin dejar objetos apuntando a estructuras removidas.
        """
        ids = [raiz.id]
        frontera = [raiz.id]
        while frontera:
            hijos = list(
                Contenedor.objects.filter(parent_contenedor_id__in=frontera)
                .values_list('id', flat=True)
            )
            if not hijos:
                break
            ids.extend(hijos)
            frontera = hijos
        return ids

    def _flag_crear_espejo(self):
        """True salvo que el cliente pida `crear_espejo=false`. El Onboarding del
        Paso 3 lo envía en falso para que sus elementos ESTRUCTURALES impacten
        SOLO en el Contenedor geométrico y nunca en el catálogo de Objetos."""
        valor = self.request.data.get('crear_espejo', True)
        if isinstance(valor, str):
            return valor.strip().lower() not in ('0', 'false', 'no', '')
        return bool(valor)

    def _crear_registro_espejo_mudable(self, contenedor, crear_espejo=True):
        """
        REGLA DE DUALIDAD (Contenedor + Objeto) al crear un mueble mudable.

        Si el operador crea el contenedor con el checkbox de "Mueble Inmueble"
        DESMARCADO (es_inmueble=False), el backend inserta de forma obligatoria:

          1. El registro principal en Contenedor (espacio de almacenamiento:
             conserva su grilla interna y su capacidad de contener estantes,
             cajones y objetos).
          2. Un registro ESPEJO en Objeto (ítem de stock / activo físico):
             vinculado por `contenedor` y SIN coordenadas de casillero para no
             duplicar presencia en los visores espaciales. De este modo el
             mueble queda 100% mudable en el módulo de Mudanza Inter-Estok.

        El espejo NO se crea para muebles inmuebles fijos (es_inmueble=True),
        que están adheridos permanentemente a la habitación, NI para
        sub-divisiones internas (estantes/cajones con parent_contenedor):
        son parte estructural del mueble, se mudan en cascada con él y no
        generan ítems de stock propios. Tampoco cuando el cliente pide
        EXPLÍCITAMENTE `crear_espejo=False` (el Onboarding del Paso 3 crea
        elementos ESTRUCTURALES que deben vivir SOLO en el Contenedor
        geométrico del mapa y jamás contaminar el catálogo de Objetos).
        """
        if not crear_espejo:
            return

        if getattr(contenedor, 'es_inmueble', False):
            return

        # Estructuras ANCLADAS: la estructura interna (CONJUNTO) y los muebles
        # fijos (MUEBLE_INMUEBLE) nunca son ítems de stock mudables.
        if getattr(contenedor, 'tipo', None) in (TIPO_CONJUNTO, TIPO_MUEBLE_INMUEBLE):
            return

        if contenedor.parent_contenedor_id is not None:
            return

        estok_id = self.request.headers.get('X-Estok-Id')
        if not estok_id and contenedor.ubicacion_id:
            estok_id = contenedor.ubicacion.estok_id

        # Idempotencia: si el espejo (mismo contenedor y sin coordenadas) ya
        # existe, no duplicar el ítem de stock (reintentos/retries seguros).
        espejo_existente = Objeto.objects.filter(
            contenedor_id=contenedor.id,
            parent_grid_row__isnull=True,
            parent_grid_col__isnull=True,
        ).exclude(deleted_at__isnull=False).exists()
        if espejo_existente:
            return

        Objeto.objects.create(
            nombre=contenedor.nombre,
            descripcion=contenedor.descripcion or '',
            estok_id=estok_id,
            ubicacion=contenedor.ubicacion if contenedor.ubicacion_id else None,
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
        )

    def _rechazar_ciclo(self, contenedor, nuevo_padre):
        """Evita que un contenedor quede dentro de su propia descendencia."""
        cursor = nuevo_padre.parent_contenedor
        visitados = set()
        while cursor is not None:
            if str(cursor.id) == str(contenedor.id):
                raise ValidationError("No se puede crear un ciclo jerárquico entre contenedores.")
            if cursor.id in visitados:
                break
            visitados.add(cursor.id)
            cursor = cursor.parent_contenedor

    def _propagar_ubicacion(self, contenedor):
        """Propaga en cascada la ubicacion actual a todos los sub-contenedores."""
        for sub in contenedor.subcontenedores.all():
            if sub.ubicacion_id != contenedor.ubicacion_id:
                sub.ubicacion_id = contenedor.ubicacion_id
                sub.save(update_fields=['ubicacion'])
            self._propagar_ubicacion(sub)
