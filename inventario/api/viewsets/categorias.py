"""
ViewSets para Categorias.
"""

import logging

from rest_framework import viewsets, permissions

from ...models import Categoria, Membresia
from ..serializers import CategoriaSerializer
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
        qs = super().get_queryset()
        estok_id = self.request.headers.get('X-Estok-Id') or self.request.query_params.get('estok_id')
        if estok_id:
            qs = qs.filter(estok_id=estok_id)
        return qs

    def perform_create(self, serializer):
        """
        Asigna automaticamente el estok_id al crear una categoria.
        El estok_id se obtiene del header X-Estok-Id, query param, o body.
        Valida que el usuario tenga membresia en el Estok destino.

        Además inyecta el MAPEO DE MERCADO LIBRE antes de guardar: cualquier
        categoría creada por el usuario queda con su `mercadolibre_category_id`
        (ej: MLA412445 para "Libros y Revistas"), sin límite de cantidad.
        """
        estok_id = (
            self.request.headers.get('X-Estok-Id')
            or self.request.query_params.get('estok_id')
            or self.request.data.get('estok_id')
        )
        if estok_id:
            # Validar membresia (seguridad sin depender de HasRolePermission)
            if not self.request.user.is_superuser:
                if not Membresia.objects.filter(
                    usuario=self.request.user,
                    estok_id=estok_id
                ).exists():
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("No tienes membresia en este Estok.")
        self._guardar_categoria_con_prediccion_ml(serializer, estok_id)

    def _guardar_categoria_con_prediccion_ml(self, serializer, estok_id):
        """
        Asigna el ID real de Mercado Libre (formato MLAxxxxx) a la categoría.

        Flujo:
        1. Si el cliente envía `mercadolibre_category_id` con formato válido,
           se respeta tal cual.
        2. Si no, se PREDICE con el nombre de la categoría (predictor oficial
           /sites/MLA/category_predictor/predict con fallback verificado a
           domain_discovery) y se persiste el resultado.
        3. Si la API no responde, se guarda CATEGORIA_MELI_DEFAULT: el alta de
           la categoría NUNCA se aborta por culpa de Mercado Libre.

        Además fuerza es_sistema=False: las categorías creadas por el usuario
        quedan blindadas contra la limpieza destructiva del seeding
        (`cargar_categorias_meli`), que solo toca las 11 macro del sistema.
        """
        nombre = (self.request.data.get("nombre") or "").strip()
        id_ml = normalizar_id_ml(self.request.data.get("mercadolibre_category_id"))
        if not id_ml:
            id_ml = predecir_id_ml(nombre)
            logger.info("Categoría '%s' → mapeo ML %s", nombre, id_ml)

        save_kwargs = {"mercadolibre_category_id": id_ml, "es_sistema": False}
        if estok_id:
            save_kwargs["estok_id"] = estok_id
        serializer.save(**save_kwargs)
