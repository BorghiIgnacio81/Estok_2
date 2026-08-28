"""
ViewSets para Categorias.
"""

import logging

from rest_framework import viewsets, permissions

from ...models import Categoria, Membresia
from ..serializers import CategoriaSerializer
from .base import HasRolePermission
from ...services.mercadolibre_api import (
    CATEGORIA_MELI_DEFAULT,
    predict_category,
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

        Además inyecta la PREDICCIÓN DE CATEGORÍA DE MERCADO LIBRE antes de
        guardar: consulta la API pública de predicción de MLA y persiste el
        category_id sugerido (ej: MLA412445 para Libros) en meli_category_id.
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
        Predice el código oficial de Mercado Libre (MLAxxxxx) para la nueva
        categoría y lo guarda de forma OBLIGATORIA en `meli_category_id`.

        Flujo:
        1. Si el cliente ya envió `meli_category_id`, se respeta.
        2. Si no, se llama a predict_category(nombre) contra la API pública
           https://api.mercadolibre.com/sites/MLA/domain_discovery/search
           (endpoint oficial de predicción de Mercado Libre Argentina).
        3. Si la API no responde o no encuentra coincidencia, se asigna el ID
           general por defecto CATEGORIA_MELI_DEFAULT y NO se aborta la
           operación.

        Además fuerza es_sistema=False: las categorías creadas por el usuario
        quedan blindadas contra la limpieza destructiva del seeding
        (`cargar_categorias_meli`), que solo toca las 11 macro del sistema.
        """
        nombre = (self.request.data.get("nombre") or "").strip()

        meli_id = (self.request.data.get("meli_category_id") or "").strip().upper()
        if not meli_id and nombre:
            try:
                meli_id = (predict_category(nombre, timeout=5) or "").strip().upper()
                if meli_id:
                    logger.info(
                        "Categoría '%s' → predicción ML %s", nombre, meli_id
                    )
            except Exception as exc:  # nunca abortar el alta por culpa de ML
                logger.warning("Predictor ML indisponible para '%s': %s", nombre, exc)
                meli_id = ""

        if not meli_id:
            meli_id = CATEGORIA_MELI_DEFAULT
            logger.info(
                "Categoría '%s' sin coincidencia en ML; usando default %s",
                nombre, CATEGORIA_MELI_DEFAULT,
            )

        save_kwargs = {"meli_category_id": meli_id, "es_sistema": False}
        if estok_id:
            save_kwargs["estok_id"] = estok_id
        serializer.save(**save_kwargs)