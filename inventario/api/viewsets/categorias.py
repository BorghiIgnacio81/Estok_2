"""
ViewSets para Categorias.
"""

import logging

from django.db import IntegrityError, transaction
from rest_framework import status, viewsets, permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from ...models import Categoria, Membresia
from ..serializers import CategoriaSerializer
from ..serializers.categorias import uuid_valido
from .base import HasRolePermission
from ...services.categorias_meli import (
    normalizar_id_ml,
    predecir_id_ml,
)

logger = logging.getLogger(__name__)


class CategoriaViewSet(viewsets.ModelViewSet):
    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer
    permission_classes = [permissions.IsAuthenticated, HasRolePermission]

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset().select_related('estok')
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if not estok_id:
            return qs
        # UUID inválido en el header (localStorage viejo/corrupto): un listado
        # NUNCA debe romper con 500 por un identificador malformado.
        if uuid_valido(estok_id) is None:
            return qs.none()
        return qs.filter(estok_id=estok_id)

    @staticmethod
    def _validar_membresia(user, estok):
        """403 explícito cuando el usuario no pertenece al Estok destino."""
        if getattr(user, 'is_superuser', False):
            return
        if not Membresia.objects.filter(usuario=user, estok=estok).exists():
            raise PermissionDenied("No tienes membresia en este Estok.")

    def perform_create(self, serializer):
        """
        Alta de categoría del USUARIO (multi-tenant y a prueba de 500).

        La resolución del Estok y la unicidad (nombre, estok) ya viajan
        validadas por `CategoriaSerializer.validate()` → `serializer.save()`
        recibe el `estok` REAL en `validated_data` (nunca un header crudo).

        Además inyecta el MAPEO DE MERCADO LIBRE antes de guardar: cualquier
        categoría creada por el usuario queda con su `mercadolibre_category_id`
        (ej: MLA412445 para "Libros y Revistas"), sin límite de cantidad.

        DEFENSA EN PROFUNDIDAD: si por una carrera entre dos altas simultáneas
        PostgreSQL igual rechaza el nombre duplicado, el IntegrityError se
        traduce a un 400 estructurado (jamás a un 500).
        """
        estok = serializer.validated_data.get('estok')
        if estok is None:
            raise ValidationError({'estok': 'Falta el Estok activo.'})
        self._validar_membresia(self.request.user, estok)

        nombre = serializer.validated_data.get('nombre', '')
        # `request.data` puede ser un QueryDict o (en un JSON malformado) una
        # lista: se normaliza a dict-lectura para no romper con AttributeError.
        datos = self.request.data if hasattr(self.request.data, 'get') else {}
        id_ml = normalizar_id_ml(datos.get("mercadolibre_category_id"))
        if not id_ml:
            id_ml = predecir_id_ml(nombre)
            logger.info("Categoría '%s' → mapeo ML %s", nombre, id_ml)

        try:
            with transaction.atomic():
                serializer.save(mercadolibre_category_id=id_ml, es_sistema=False)
        except IntegrityError:
            logger.warning(
                "Alta de categoría duplicada: '%s' en Estok %s", nombre, estok.pk,
            )
            raise ValidationError(
                {'nombre': ['Ya existe una categoría con ese nombre en este Estok.']}
            )
        except Exception:  # noqa: BLE001 - se reporta con traza y se re-lanza
            logger.exception("Error inesperado al crear la categoría '%s'", nombre)
            raise

    def perform_update(self, serializer):
        """Edición: la carrera de nombres también responde 400, nunca 500."""
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            raise ValidationError(
                {'nombre': ['Ya existe una categoría con ese nombre en este Estok.']}
            )

    def destroy(self, request, *args, **kwargs):
        """
        DELETE /api/categorias/{id}/ — baja de una categoría del usuario.

        INTEGRIDAD DE DATOS (el inventario jamás se pierde):
          1. Los OBJETOS vinculados NO se eliminan: `Objeto.categoria` es
             `on_delete=SET_NULL`, así que quedan con `categoria=None`
             («Sin categoría»). Se informa el conteo real desvinculado.
          2. Las SUBcategorías NO se borran en cascada (`Categoria.parent` es
             CASCADE a nivel modelo): se PROMUEVEN al padre de la categoría
             eliminada para no perder la taxonomía del usuario.
          3. Todo ocurre dentro de una única transacción atómica.

        PROTECCIÓN MULTI-TENANT:
          4. Sólo un miembro del MISMO Estok (o un superuser) puede borrar. Un
             `X-Estok-Id` ajeno ya corta antes en 404 (get_queryset filtra por
             tenant); la membresía se revalida acá como defensa en profundidad.
          5. Las categorías OFICIALES del sistema (`es_sistema=True`, las 11 de
             Mercado Libre) son INMUTABLES: `cargar_categorias_meli` las vuelve
             a sembrar en cada arranque, así que borrarlas daría una falsa
             sensación de limpieza. Se responde 403.
        """
        instancia = self.get_object()
        self._validar_membresia(request.user, instancia.estok)

        if instancia.es_sistema:
            raise PermissionDenied(
                f'«{instancia.nombre}» es una categoría oficial del sistema y no '
                'se puede eliminar.'
            )

        nombre = instancia.nombre
        categoria_id = str(instancia.pk)
        estok_id = instancia.estok_id

        with transaction.atomic():
            objetos_desvinculados = instancia.objetos.filter(
                deleted_at__isnull=True
            ).count()
            subcategorias_reasignadas = instancia.hijas.update(parent=instancia.parent)
            instancia.delete()

        logger.info(
            "Categoría '%s' eliminada del Estok %s (%s objetos a 'Sin categoría', "
            "%s subcategorías reasignadas)",
            nombre,
            estok_id,
            objetos_desvinculados,
            subcategorias_reasignadas,
        )
        return Response(
            {
                'detail': 'Categoría eliminada. Los objetos asociados pasaron a "Sin categoría".',
                'id': categoria_id,
                'nombre': nombre,
                'objetos_desvinculados': objetos_desvinculados,
                'subcategorias_reasignadas': subcategorias_reasignadas,
            },
            status=status.HTTP_200_OK,
        )

