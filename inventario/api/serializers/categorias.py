"""
Serializers de Categorías.

La UNICIDAD (nombre, estok) se valida ACÁ de forma explícita: el campo `estok`
es read_only (llega por el header X-Estok-Id / multi-tenant), por lo que DRF no
puede generar su UniqueTogetherValidator automático. Sin esta validación, un
nombre repetido llegaba hasta PostgreSQL y el IntegrityError se traducía en un
HTTP 500. Ahora la API responde 400 estructurado con el campo `nombre`.
"""

import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from ...models import Categoria, Estok
from ...services.categorias_subtipo import normalizar_subtipo


def uuid_valido(valor):
    """Devuelve el UUID normalizado o None si el token no es un UUID real."""
    try:
        return uuid.UUID(str(valor))
    except (TypeError, ValueError, AttributeError, DjangoValidationError):
        return None


class CategoriaSerializer(serializers.ModelSerializer):
    estok = serializers.PrimaryKeyRelatedField(read_only=True)
    objetos_count = serializers.SerializerMethodField()

    class Meta:
        model = Categoria
        fields = '__all__'
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'estok', 'es_sistema',
        ]
        # La unicidad se resuelve en validate() (ver encabezado del módulo).
        validators = []

    def get_objetos_count(self, obj):
        """Cuenta solo objetos NO eliminados (excluye soft-delete)."""
        return obj.objetos.filter(deleted_at__isnull=True).count()

    # -------------------------------------------------------------------------
    # TENANT: resolución del Estok activo
    # -------------------------------------------------------------------------

    def _estok_del_request(self):
        """
        Estok solicitado por el cliente, en el mismo orden que el ViewSet:
        header X-Estok-Id → query param → body. Devuelve (crudo, uuid|None).
        """
        request = self.context.get('request')
        if request is None:
            return None, None
        datos = getattr(request, 'data', None) or {}
        # `query_params` es de DRF; `GET` es el fallback de un HttpRequest puro
        # (shell/tests), así el serializer nunca revienta por un atributo ausente.
        query = getattr(request, 'query_params', None)
        if query is None:
            query = getattr(request, 'GET', {})
        crudo = (
            request.headers.get('X-Estok-Id')
            or query.get('estok_id')
            or datos.get('estok_id')
            or datos.get('estok')
        )
        if not crudo:
            return None, None
        return crudo, uuid_valido(crudo)

    # -------------------------------------------------------------------------
    # VALIDACIÓN DE CAMPOS
    # -------------------------------------------------------------------------

    def validate_nombre(self, value):
        """Normaliza espacios y rechaza nombres vacíos o demasiado largos."""
        nombre = ' '.join(str(value or '').split())
        if not nombre:
            raise serializers.ValidationError('El nombre de la categoría es obligatorio.')
        if len(nombre) > 200:
            raise serializers.ValidationError('El nombre no puede superar los 200 caracteres.')
        return nombre

    def validate_icono(self, value):
        """El ícono es opcional: sin valor se usa el emoji por defecto del modelo."""
        icono = str(value or '').strip()
        return icono[:10] or '🏷️'

    def validate_subtipo(self, value):
        """
        El subtipo debe ser una familia técnica válida.

        El ViewSet lo infiere del nombre cuando no viaja; acá se rechaza
        explícitamente cualquier valor inventado (choices del modelo).
        """
        subtipo = normalizar_subtipo(value)
        if not subtipo and str(value or '').strip():
            raise serializers.ValidationError(
                'Subtipo inválido. Valores permitidos: libro, tecnologia, '
                'mueble_arte, ropa.'
            )
        return subtipo

    def validate(self, attrs):
        """
        Resuelve e inyecta el Estok del tenant y valida la unicidad del nombre
        ANTES de tocar la base (evita el IntegrityError → 500).

        Devuelve un 400 estructurado:
          {"estok": ["..."]}   si falta / es inválido / no existe
          {"nombre": ["..."]}  si la categoría ya existe en ese Estok
          {"parent": ["..."]}  si la padre pertenece a otro Estok
        """
        crudo, estok_uuid = self._estok_del_request()
        if self.instance is not None and not crudo:
            # EDICIÓN sin header (p. ej. un superadmin desde la API): se conserva
            # el Estok del propio recurso. El alta SIEMPRE exige tenant explícito.
            estok = self.instance.estok
        else:
            if not crudo:
                raise serializers.ValidationError(
                    {'estok': 'Falta el Estok activo: enviá el header X-Estok-Id.'}
                )
            if estok_uuid is None:
                raise serializers.ValidationError(
                    {'estok': 'El Estok indicado no es un UUID válido.'}
                )
            estok = Estok.objects.filter(pk=estok_uuid).first()
            if estok is None:
                raise serializers.ValidationError({'estok': 'El Estok indicado no existe.'})

        # En EDICIÓN la categoría no puede mudarse de Estok.
        if self.instance is not None and self.instance.estok_id != estok.pk:
            raise serializers.ValidationError(
                {'estok': 'La categoría pertenece a otro Estok.'}
            )

        nombre = attrs.get('nombre') or ''
        # Sólo se valida unicidad cuando el nombre viaja en la petición: un PATCH
        # parcial (p. ej. cambiar sólo el ícono) no debe colisionar con "".
        if nombre:
            repetidas = Categoria.objects.filter(estok=estok, nombre__iexact=nombre)
            if self.instance is not None:
                repetidas = repetidas.exclude(pk=self.instance.pk)
            if repetidas.exists():
                raise serializers.ValidationError(
                    {'nombre': ['Ya existe una categoría con ese nombre en este Estok.']}
                )

        parent = attrs.get('parent')
        if parent is not None and parent.estok_id != estok.pk:
            raise serializers.ValidationError(
                {'parent': 'La categoría padre pertenece a otro Estok.'}
            )

        # El ViewSet consume este valor para el `save()` (multi-tenant).
        attrs['estok'] = self.instance.estok if self.instance is not None else estok
        return attrs

