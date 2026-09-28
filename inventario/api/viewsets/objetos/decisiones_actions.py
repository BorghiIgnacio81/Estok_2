"""
Mixin del módulo de DECISIONES dentro del viewset de Objetos.

Expone la grilla de objetos del Estok activo que todavía ESPERAN una decisión
del usuario:

    GET /api/objetos/pendientes_decision/

Vive en su propio mixin (igual que ia_actions / stock_actions /
marketing_actions) para que la pestaña "Decisiones" del frontend tenga su
endpoint aislado y utilities no siga creciendo.

Criterio (única fuente de verdad, sin duplicar la regla del service de
votaciones):
  - `owner_action` nulo: todavía no se decidió Vender / Conservar / Tirar.
  - sin baja lógica (`deleted_at` nulo).
  - SIN votación abierta: cuando el objeto tiene Dueño y el Beneficiario está
    vacío, decide el Estok en democracia
    (inventario/services/decisiones_service.py) y esos objetos se listan en
    /api/decisiones/pendientes/ ("Votaciones pendientes del Estok"), nunca
    duplicados acá.

Aislamiento multi-tenant: SIEMPRE por el header X-Estok-Id.
"""

from rest_framework.decorators import action
from rest_framework.response import Response

from ....models import DecisionVotacion, Objeto


class DecisionesActionsMixin:
    """Endpoints de decisión (dueño original / Estok) sobre el inventario."""

    @action(detail=False, methods=['get'])
    def pendientes_decision(self, request):
        """
        Lista los objetos del Estok activo que esperan una decisión.

        GET /api/objetos/pendientes_decision/
        """
        estok_id = (
            request.headers.get('X-Estok-Id')
            or request.query_params.get('estok_id')
        )

        qs = (
            Objeto.objects.select_related(
                'ubicacion', 'contenedor', 'dueno_original', 'beneficiario',
                'categoria',
            )
            .prefetch_related('fotos')
            .filter(deleted_at__isnull=True, owner_action__isnull=True)
            .order_by('-fecha_registro')
        )
        if estok_id:
            qs = qs.filter(estok_id=estok_id)

        # Los objetos que ya están en votación democrática no vuelven a la grilla
        # de decisión directa: se resuelven votando (1 usuario = 1 voto).
        en_votacion = DecisionVotacion.objects.filter(
            estado=DecisionVotacion.ESTADO_PENDIENTE
        ).values('objeto_id')
        qs = qs.exclude(id__in=en_votacion)

        resultados = [self._payload_pendiente(obj, request) for obj in qs]
        return Response({"count": len(resultados), "results": resultados})

    @staticmethod
    def _nombre_mostrable(usuario):
        """Nombre legible de un usuario (o None si no hay usuario)."""
        if not usuario:
            return None
        return usuario.get_full_name() or usuario.username

    def _payload_pendiente(self, obj, request):
        """
        Payload plano de un objeto sin decisión (lo consume la grilla de la
        pestaña Decisiones: foto, título, ubicación y botonera in-place).
        """
        fotos = list(obj.fotos.all())
        principal = next((f for f in fotos if f.es_principal), None)
        foto = principal or (fotos[0] if fotos else None)

        usuario_id = getattr(request.user, 'id', None)
        # El objeto "espera al usuario" cuando él es el dueño original o el
        # beneficiario designado: ese caso usa el endpoint dedicado
        # POST /api/objetos/{id}/owner_action/ (regla del dueño original).
        # El resto de la grilla fija la decisión por el CRUD (PUT del objeto).
        es_decision_propia = bool(usuario_id) and usuario_id in (
            obj.dueno_original_id, obj.beneficiario_id,
        )

        return {
            "id": str(obj.id),
            "nombre": obj.nombre,
            "foto_principal": foto.imagen.url if foto and foto.imagen else None,
            "estado_conservacion": obj.estado_conservacion,
            "valor_estimado": str(obj.valor_estimado) if obj.valor_estimado else None,
            "categoria_nombre": obj.categoria.nombre if obj.categoria else None,
            "plataformas_publicadas": list(obj.plataformas_publicadas or []),
            "dueno_original": (
                str(obj.dueno_original_id) if obj.dueno_original_id else None
            ),
            "dueno_original_nombre": self._nombre_mostrable(obj.dueno_original),
            "dueno_externo_nombre": (obj.dueno_externo_nombre or '').strip() or None,
            "beneficiario": (
                str(obj.beneficiario_id) if obj.beneficiario_id else None
            ),
            "beneficiario_nombre": self._nombre_mostrable(obj.beneficiario),
            "es_decision_propia": es_decision_propia,
            "ubicacion": str(obj.ubicacion_id) if obj.ubicacion_id else None,
            "ubicacion_nombre": obj.ubicacion.nombre if obj.ubicacion else None,
            "contenedor": str(obj.contenedor_id) if obj.contenedor_id else None,
            "contenedor_nombre": obj.contenedor.nombre if obj.contenedor else None,
        }
