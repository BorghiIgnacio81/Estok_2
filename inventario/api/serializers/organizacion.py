"""
Serializers de Organización Espacial (Ubicaciones y Contenedores).
"""

from uuid import UUID

from rest_framework import serializers

from ...models import Ubicacion, Contenedor


class UbicacionSerializer(serializers.ModelSerializer):
    objetos_count = serializers.SerializerMethodField()
    contenedores_count = serializers.SerializerMethodField()
    # Jerarquía del Mapa Estok: división padre (sub-grilla de Nivel 1) → habitación
    parent_ubicacion = serializers.PrimaryKeyRelatedField(
        queryset=Ubicacion.objects.all(),
        required=False,
        allow_null=True,
    )
    parent_ubicacion_nombre = serializers.CharField(
        source='parent_ubicacion.nombre',
        read_only=True,
        default=None,
    )
    sububicaciones_count = serializers.SerializerMethodField()

    class Meta:
        model = Ubicacion
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_objetos_count(self, obj):
        """Cuenta solo objetos NO eliminados (excluye soft-delete)."""
        return obj.objetos.filter(deleted_at__isnull=True).count()

    def get_contenedores_count(self, obj):
        """Cuenta los contenedores dentro de esta ubicación."""
        return obj.contenedores.count()

    def get_sububicaciones_count(self, obj):
        """Cuenta las habitaciones encastradas dentro de esta división."""
        return obj.sububicaciones.count()

    def validate_parent_ubicacion(self, value):
        """Aislamiento multi-tenant estricto: la división padre debe pertenecer
        al mismo Estok que la habitación (o al Estok activo vía X-Estok-Id)."""
        if value is None:
            return value
        instance = self.instance
        if instance is not None and instance.estok_id and value.estok_id != instance.estok_id:
            raise serializers.ValidationError("La división padre no pertenece al mismo Estok.")
        headers = getattr(self.context.get('request'), 'headers', {})
        estok_activo = headers.get('X-Estok-Id')
        if estok_activo and value.estok_id:
            try:
                estok_activo_uuid = UUID(str(estok_activo))
            except (TypeError, ValueError):
                return value
            if value.estok_id != estok_activo_uuid:
                raise serializers.ValidationError("La división padre no pertenece al Estok activo.")
        return value

    def validate_grid_filas_config(self, value):
        """Grilla asimétrica: arreglo de enteros 1..12 (una entrada por fila interna)."""
        if value is None:
            return value
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("grid_filas_config debe ser un arreglo no vacío.")
        if not all(isinstance(x, int) and 1 <= x <= 12 for x in value):
            raise serializers.ValidationError("grid_filas_config debe contener enteros entre 1 y 12.")
        return value


class ContenedorSerializer(serializers.ModelSerializer):
    ubicacion_nombre = serializers.CharField(source='ubicacion.nombre', read_only=True)
    qr_code_url = serializers.SerializerMethodField()
    objetos_count = serializers.SerializerMethodField()
    # Jerarquía: sub-contenedores (padre auto-referencial)
    parent_contenedor = serializers.PrimaryKeyRelatedField(
        queryset=Contenedor.objects.all(),
        required=False,
        allow_null=True,
    )
    # HERENCIA DINÁMICA DE NOMBRES (sin caché): el nombre del padre jamás se
    # denormaliza ni se lee de un valor estático viejo. Se resuelve EN CALIENTE
    # contra PostgreSQL vía la FK auto-referencial (self.parent_contenedor).
    parent_contenedor_nombre = serializers.SerializerMethodField()
    # Procedencia/ubicación ACTUAL de la pieza: si la caja/estante vive dentro
    # de otro contenedor, devuelve el nombre del PADRE en vivo; si es raíz, la
    # ubicación (habitación). Así, al renombrar el estante ("F2-C3" →
    # "estantería arriba derecha"), las cajas hijas reflejan el nuevo nombre de
    # forma instantánea en todo el sistema.
    procedencia_nombre = serializers.SerializerMethodField()
    subcontenedores_count = serializers.SerializerMethodField()
    # Campos de dimensiones y material (editable desde el frontend)
    largo = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True)
    ancho = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True)
    alto = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True)
    foto = serializers.ImageField(required=False, allow_null=True)
    material = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    tipo_madera = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = Contenedor
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'qr_code_image']

    def get_qr_code_url(self, obj):
        """Retorna la URL completa del código QR."""
        if obj.qr_code_image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.qr_code_image.url)
            return obj.qr_code_image.url
        return None

    def get_parent_contenedor_nombre(self, obj):
        """
        Nombre del contenedor padre resuelto EN TIEMPO REAL.

        NUNCA lee un valor denormalizado/cacheado: consulta la FK
        `self.parent_contenedor` en PostgreSQL en cada serialización, de modo
        que un renombre del padre se refleja al instante en las cajas hijas.
        """
        return obj.parent_contenedor.nombre if obj.parent_contenedor_id else None

    def get_procedencia_nombre(self, obj):
        """
        Procedencia/ubicación actual de la pieza, resuelta en vivo.

        Regla de herencia dinámica: si el contenedor vive dentro de otro
        (caja dentro de un estante/mueble) devuelve el nombre del PADRE;
        si es raíz, devuelve la ubicación (habitación). Siempre consulta
        PostgreSQL, jamás un campo estático viejo.
        """
        if obj.parent_contenedor_id:
            return obj.parent_contenedor.nombre
        return obj.ubicacion.nombre if obj.ubicacion_id else None

    def get_objetos_count(self, obj):
        """
        Retorna la cantidad de objetos NO eliminados dentro del contenedor.

        Optimizado: en listados, el viewset anota `_objetos_activos_total` con
        un único COUNT agrupado (cero N+1). Fuera del listado, cae al conteo
        relacional clásico.
        """
        total = getattr(obj, '_objetos_activos_total', None)
        if total is not None:
            return total
        return obj.objetos.filter(deleted_at__isnull=True).count()

    def get_subcontenedores_count(self, obj):
        """
        Retorna la cantidad de sub-contenedores directos dentro de este contenedor.

        Optimizado: en listados usa la anotación `_subcontenedores_total`
        (COUNT agrupado, cero N+1). Fuera del listado, cae al conteo clásico.
        """
        total = getattr(obj, '_subcontenedores_total', None)
        if total is not None:
            return total
        return obj.subcontenedores.count()
