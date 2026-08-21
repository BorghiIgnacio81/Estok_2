"""
Carga oficial de las 11 categorías atómicas de Mercado Libre Argentina.

Reglas de este comando:
1. SOLO existen las 11 categorías oficiales (hardcodeadas con su ID de ML).
2. Es DESTRUCTIVO: elimina cualquier categoría que NO esté en la lista oficial
   (incluye categorías custom sin meli_category_id y categorías combinadas
   tipo "Muebles y Arte").
3. Aislamiento multi-tenant: se aplica a TODOS los Estok. Cada Estok queda
   con exactamente las 11 categorías oficiales.
4. Objeto.categoria usa on_delete=SET_NULL, por lo que los objetos cuyas
   categorías se eliminen quedan con categoria=NULL (no se pierden objetos).

Para evitar reintroducir el bug de "categorías combinadas", este comando NO
consulta la API de Mercado Libre: la lista oficial vive hardcodeada aquí.
"""
from django.core.management.base import BaseCommand
from inventario.models.clasificacion import Categoria
from inventario.models.nucleo import Estok

# ---------------------------------------------------------------------------
# LISTA OFICIAL DE LAS 11 CATEGORÍAS ATÓMICAS (no tocar sin aprobación)
# ---------------------------------------------------------------------------
CATEGORIAS_OFICIALES = [
    {"nombre": "Muebles", "meli_category_id": "MLA1574", "icono": "🪑"},
    {"nombre": "Arte", "meli_category_id": "MLA1798", "icono": "🎨"},
    {"nombre": "Coleccionables", "meli_category_id": "MLA1367", "icono": "🏆"},
    {"nombre": "Antigüedades", "meli_category_id": "MLA1368", "icono": "⏳"},
    {"nombre": "Jardín", "meli_category_id": "MLA1592", "icono": "🌿"},
    {"nombre": "Computación", "meli_category_id": "MLA1648", "icono": "💻"},
    {"nombre": "Electrónica", "meli_category_id": "MLA1051", "icono": "🔌"},
    {"nombre": "Cocina", "meli_category_id": "MLA1403", "icono": "🍳"},
    {"nombre": "Hogar", "meli_category_id": "MLA1577", "icono": "🏠"},
    {"nombre": "Herramientas", "meli_category_id": "MLA1500", "icono": "🔧"},
    {"nombre": "Materiales", "meli_category_id": "MLA1506", "icono": "🧱"},
]

IDS_OFICIALES = {c["meli_category_id"] for c in CATEGORIAS_OFICIALES}


class Command(BaseCommand):
    help = (
        'Inyecta las 11 categorías oficiales de Mercado Libre Argentina en TODOS '
        'los Estok y ELIMINA cualquier categoría que no esté en la lista oficial.'
    )

    def handle(self, *args, **options):
        estoks = list(Estok.objects.all())
        if not estoks:
            # Con la BD virgen (primer deploy) puede no haber Estok todavía.
            # En vez de abortar, creamos un Estok base para poder asociar
            # las 11 categorías oficiales (el usuario podrá renombrarlo luego).
            estok_base, created = Estok.objects.get_or_create(
                nombre='Estok Base',
                defaults={
                    'descripcion': 'Estok inicial creado automáticamente en el primer deploy',
                }
            )
            estoks = [estok_base]
            if created:
                self.stdout.write(self.style.SUCCESS(
                    f'✅ No existía ningún Estok; se creó "{estok_base.nombre}" (ID: {estok_base.id}).'
                ))
            else:
                self.stdout.write(
                    f'  - Usando Estok existente: {estok_base.nombre}'
                )


        total_creadas = 0
        total_eliminadas = 0
        total_actualizadas = 0

        for estok in estoks:
            creadas, actualizadas = self._aplicar_categorias_oficiales(estok)
            eliminadas = self._eliminar_categorias_residuales(estok)
            total_creadas += creadas
            total_actualizadas += actualizadas
            total_eliminadas += eliminadas

            self.stdout.write(
                f'   Estok "{estok.nombre}" ({estok.id}): '
                f'creadas={creadas} actualizadas={actualizadas} eliminadas={eliminadas}'
            )

        self.stdout.write(self.style.SUCCESS(
            f'✅ Listo. Categorías creadas={total_creadas} '
            f'actualizadas={total_actualizadas} eliminadas={total_eliminadas} '
            f'en {len(estoks)} Estok(s).'
        ))

        # Verificación final de integridad
        sobrantes = Categoria.objects.exclude(meli_category_id__in=IDS_OFICIALES).count()
        if sobrantes:
            self.stdout.write(self.style.ERROR(
                f'⚠️  Quedaron {sobrantes} categorías fuera de la lista oficial. '
                'Revisar manualmente.'
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                '✅ Verificación: NO quedan categorías fuera de la lista oficial.'
            ))

    def _aplicar_categorias_oficiales(self, estok):
        """Crea o actualiza las 11 categorías oficiales para un Estok."""
        creadas = 0
        actualizadas = 0
        for cat in CATEGORIAS_OFICIALES:
            _, created = Categoria.objects.update_or_create(
                meli_category_id=cat["meli_category_id"],
                estok=estok,
                defaults={
                    "nombre": cat["nombre"],
                    "icono": cat["icono"],
                    "es_contenedor": True,
                },
            )
            if created:
                creadas += 1
            else:
                actualizadas += 1
        return creadas, actualizadas

    def _eliminar_categorias_residuales(self, estok):
        """
        Elimina TODAS las categorías del Estok que no estén en la lista oficial:
        - categorías combinadas (ej: 'Muebles y Arte')
        - categorías custom sin meli_category_id
        Objeto.categoria es SET_NULL, así los objetos no se pierden.
        """
        residuales = Categoria.objects.filter(estok=estok).exclude(
            meli_category_id__in=IDS_OFICIALES
        )
        cantidad = residuales.count()
        if cantidad:
            nombres = list(residuales.values_list('nombre', flat=True))
            self.stdout.write(
                self.style.WARNING(
                    f'🗑️  Eliminando {cantidad} categoría(s) residual(es): {nombres}'
                )
            )
            residuales.delete()
        return cantidad
