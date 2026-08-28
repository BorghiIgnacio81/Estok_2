"""
Carga oficial de las 11 categorías atómicas de Mercado Libre Argentina.

Reglas de este comando:
1. SOLO existen las 11 categorías oficiales (hardcodeadas con su ID de ML),
   marcadas con es_sistema=True.
2. La "limpieza destructiva" SOLO aplica sobre las categorías del SISTEMA
   (es_sistema=True) que queden fuera de la lista oficial (residuos legados,
   ej: categorías combinadas tipo "Muebles y Arte").
   Queda ESTRICTAMENTE PROHIBIDO eliminar categorías creadas dinámicamente por
   usuarios (es_sistema=False) dentro de sus Estoks privados: se preservan
   SIEMPRE, aunque no tengan meli_category_id.
3. Aislamiento multi-tenant: las 11 oficiales se aplican a TODOS los Estok.
4. Objeto.categoria usa on_delete=SET_NULL, por lo que los objetos cuyas
   categorías se eliminen quedan con categoria=NULL (no se pierden objetos).
5. Autocuración anti unique_together(nombre, estok): si un usuario creó una
   categoría con el MISMO nombre de una oficial y sin meli_category_id, el
   comando la adopta asignándole el ID oficial en vez de duplicar o borrar.

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
        'los Estok. La limpieza destructiva SOLO aplica sobre categorías del '
        'sistema (es_sistema=True); las categorías de usuario jamás se eliminan.'
    )

    def handle(self, *args, **options):
        estoks = list(Estok.objects.all())
        if not estoks:
            # Con la BD virgen (primer deploy) puede no haber Estok todavía.
            # En vez de abortar, tomamos (o creamos) el tenant global
            # "Estok Principal" para poder asociar las 11 categorías oficiales.
            from inventario.services.tenant import get_or_create_estok_principal
            estok_base, created = get_or_create_estok_principal()
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

        # Verificación final de integridad SOLO sobre categorías de SISTEMA.
        # Las categorías de usuario (es_sistema=False) quedan fuera del chequeo
        # porque su preservación es intencional (bug de pérdida de datos).
        sobrantes = Categoria.objects.filter(
            es_sistema=True
        ).exclude(meli_category_id__in=IDS_OFICIALES).count()
        if sobrantes:
            self.stdout.write(self.style.ERROR(
                f'⚠️  Quedaron {sobrantes} categorías de SISTEMA fuera de la '
                'lista oficial. Revisar manualmente.'
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                '✅ Verificación: no quedan categorías de sistema fuera de la '
                'lista oficial.'
            ))

        preservadas = Categoria.objects.filter(es_sistema=False).count()
        if preservadas:
            self.stdout.write(self.style.NOTICE(
                f'🛡️  {preservadas} categoría(s) de usuario preservadas '
                '(la limpieza destructiva no las toca).'
            ))

    def _aplicar_categorias_oficiales(self, estok):
        """Crea o actualiza las 11 categorías oficiales para un Estok."""
        creadas = 0
        actualizadas = 0
        for cat in CATEGORIAS_OFICIALES:
            if self._adoptar_categoria_de_usuario(estok, cat):
                # Autocuración: la categoría del usuario pasó a ser la oficial.
                actualizadas += 1
                continue
            _, created = Categoria.objects.update_or_create(
                meli_category_id=cat["meli_category_id"],
                estok=estok,
                defaults={
                    "nombre": cat["nombre"],
                    "icono": cat["icono"],
                    "es_contenedor": True,
                    "es_sistema": True,
                },
            )
            if created:
                creadas += 1
            else:
                actualizadas += 1
        return creadas, actualizadas

    def _adoptar_categoria_de_usuario(self, estok, cat):
        """
        Autocuración anti unique_together(nombre, estok):
        si existe una categoría de usuario (es_sistema=False) con el MISMO
        nombre de una oficial y aún sin meli_category_id oficial, se la adopta
        asignándole el ID oficial. Así el seeding no intenta crear un duplicado
        (IntegrityError) ni borra la categoría del usuario.
        """
        fila = (
            Categoria.objects.filter(
                estok=estok,
                nombre__iexact=cat["nombre"],
                es_sistema=False,
            )
            .exclude(meli_category_id__in=IDS_OFICIALES)
            .first()
        )
        if fila is None:
            return False
        fila.meli_category_id = cat["meli_category_id"]
        fila.nombre = cat["nombre"]
        fila.icono = cat["icono"]
        fila.es_contenedor = True
        fila.es_sistema = True
        fila.save(update_fields=[
            "meli_category_id", "nombre", "icono", "es_contenedor", "es_sistema",
        ])
        self.stdout.write(self.style.WARNING(
            f'🔄 Categoría de usuario "{cat["nombre"]}" adoptada como oficial '
            f'({cat["meli_category_id"]}) en Estok {estok.id}.'
        ))
        return True

    def _eliminar_categorias_residuales(self, estok):
        """
        Limpieza destructiva SOLO sobre categorías del SISTEMA (es_sistema=True)
        que no estén en la lista oficial (residuos legados de versiones
        anteriores). Las categorías creadas por usuarios (es_sistema=False)
        quedan BLINDADAS: el seeding jamás las elimina.
        Objeto.categoria es SET_NULL, así los objetos no se pierden.
        """
        residuales = Categoria.objects.filter(
            estok=estok,
            es_sistema=True,
        ).exclude(meli_category_id__in=IDS_OFICIALES)
        cantidad = residuales.count()
        if cantidad:
            nombres = list(residuales.values_list('nombre', flat=True))
            self.stdout.write(
                self.style.WARNING(
                    f'🗑️  Eliminando {cantidad} categoría(s) residual(es) de '
                    f'SISTEMA: {nombres}'
                )
            )
            residuales.delete()
        return cantidad
