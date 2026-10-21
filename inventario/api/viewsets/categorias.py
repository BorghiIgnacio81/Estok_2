"""
ViewSets para Categorias.
"""

import logging

from django.db import IntegrityError, transaction
from rest_framework import viewsets, permissions
from rest_framework.exceptions import PermissionDenied, ValidationError

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

