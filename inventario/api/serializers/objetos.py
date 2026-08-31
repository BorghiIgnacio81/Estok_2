"""
Serializers de Objetos — Taxonomía unificada.

Objeto es la ÚNICA entidad de inventario. La clasificación se hace
exclusivamente a través de la FK `categoria` (las 11 categorías oficiales
de Mercado Libre). Ya NO existen subclases multi-tabla (LibroRevista,
Tecnologia, MuebleArte, Ropa) ni el campo `tipo`.

Todos los campos que antes vivían en las subclases (isbn_issn, marca,
material, tamano, etc.) son ahora campos directos del modelo Objeto.
"""

import logging

from rest_framework import serializers

from ...models import Objeto


logger = logging.getLogger(__name__)


class ObjetoListSerializer(serializers.ModelSerializer):
    """
    Serializer ligero para listar objetos (sin carga pesada).
    """
    foto_principal = serializers.SerializerMethodField()
    ubicacion_nombre = serializers.CharField(source='ubicacion.nombre', read_only=True, default=None)
    contenedor_nombre = serializers.CharField(source='contenedor.nombre', read_only=True, default=None)
    categoria_nombre = serializers.CharField(source='categoria.nombre', read_only=True, default=None)
    objeto_padre_nombre = serializers.CharField(source='objeto_padre.nombre', read_only=True, default=None)

    class Meta:
        model = Objeto
        fields = [
            'id', 'nombre', 'estado_conservacion',
            'valor_estimado', 'color', 'foto_principal',
            'ubicacion_nombre', 'contenedor_nombre',
            'parent_grid_row', 'parent_grid_col',
            'categoria', 'categoria_nombre',
            'es_contenedor', 'objeto_padre', 'objeto_padre_nombre',
            'estado_carga', 'fecha_registro', 'deleted_at',
            'owner_action',
        ]

    def get_foto_principal(self, obj):
        """Obtiene la URL de la foto principal si existe."""
        foto = obj.fotos.filter(es_principal=True).first()
        if foto:
            return foto.imagen.url
        primera_foto = obj.fotos.first()
        if primera_foto:
            return primera_foto.imagen.url
        return None


class ObjetoDetailSerializer(serializers.ModelSerializer):
    """
    Serializer detallado de un Objeto.
    Incluye los campos específicos migrados (antes subclases) agrupados
    en `datos_especificos` para mantener la compatibilidad con el frontend.
    """
    ubicacion_nombre = serializers.CharField(source='ubicacion.nombre', read_only=True, default=None)
    contenedor_nombre = serializers.CharField(source='contenedor.nombre', read_only=True, default=None)
    categoria_nombre = serializers.CharField(source='categoria.nombre', read_only=True, default=None)
    objeto_padre_nombre = serializers.CharField(source='objeto_padre.nombre', read_only=True, default=None)
    dueno_original_nombre = serializers.SerializerMethodField()
    beneficiario_nombre = serializers.SerializerMethodField()
    fotos = serializers.SerializerMethodField()
    datos_especificos = serializers.SerializerMethodField()
    historial_precios = serializers.SerializerMethodField()
    total_objetos_contenidos = serializers.SerializerMethodField()
    distribucion_por_categorias = serializers.SerializerMethodField()

    class Meta:
        model = Objeto
        fields = '__all__'

    def _ocultar_nombre_si_borghi(self, request, user):
        """
        REGLA DE PRIVACIDAD (SOLO para SoledadMartinez):
        Si el usuario que CONSULTA es SoledadMartinez, y el usuario
        consultado tiene apellido "Borghi" o nombre "Ignacio",
        se oculta completamente mostrando "Yamza" en lugar del nombre real.
        Para cualquier otro usuario, se muestra el nombre real.
        """
        if request and request.user.username == 'SoledadMartinez':
            if user.username == 'ygumy44':
                return 'Yamza'
            if user.last_name and 'Borghi' in user.last_name:
                return 'Yamza'
            if user.first_name and 'Ignacio' in user.first_name:
                return 'Yamza'
        return None

    def get_dueno_original_nombre(self, obj):
        if obj.dueno_original:
            request = self.context.get('request')
            oculto = self._ocultar_nombre_si_borghi(request, obj.dueno_original)
            if oculto:
                return oculto
            return str(obj.dueno_original)
        return None

    def get_beneficiario_nombre(self, obj):
        if obj.beneficiario:
            request = self.context.get('request')
            oculto = self._ocultar_nombre_si_borghi(request, obj.beneficiario)
            if oculto:
                return oculto
            return str(obj.beneficiario)
        return None

    def get_fotos(self, obj):
        fotos = obj.fotos.all().order_by('-es_principal', 'fecha_subida')
        return [
            {
                "id": str(f.id),
                "imagen": f.imagen.url,
                "descripcion": f.descripcion,
                "es_principal": f.es_principal,
                "fecha_subida": f.fecha_subida.isoformat(),
            }
            for f in fotos
        ]

    def get_datos_especificos(self, obj):
        """
        Retorna los campos específicos que antes vivían en las subclases
        multi-tabla y ahora son campos directos de Objeto.
        Se agrupan aquí para no romper el contrato del frontend.
        """
        return {
            # Libro / Revista / Cómic
            "autor": obj.autor,
            "edicion": obj.edicion,
            "anio": obj.anio,
            "isbn_issn": obj.isbn_issn,
            "nombre_serie": obj.nombre_serie,
            "titulo_tomo": obj.titulo_tomo,
            "numero_tomo": obj.numero_tomo,
            "editorial": obj.editorial,
            "idioma": obj.idioma,
            # Tecnología / Electrónica
            "marca": obj.marca,
            "modelo": obj.modelo,
            "numero_serie": obj.numero_serie,
            "peso": float(obj.peso) if obj.peso else None,
            "especificaciones": obj.especificaciones,
            # Mueble / Arte / Antigüedad
            "material": obj.material,
            "largo": float(obj.largo) if obj.largo else None,
            "ancho": float(obj.ancho) if obj.ancho else None,
            "alto": float(obj.alto) if obj.alto else None,
            "artista_fabricante": obj.artista_fabricante,
            # Ropa / Accesorio
            "tamano": obj.tamano,
        }

    def get_historial_precios(self, obj):
        historial = obj.historial_precios.all().order_by('-fecha_cambio')[:5]
        return [
            {
                "valor_anterior": float(h.valor_anterior) if h.valor_anterior else None,
                "valor_nuevo": float(h.valor_nuevo),
                "diferencia": float(h.diferencia) if h.diferencia else None,
                "porcentaje_cambio": float(h.porcentaje_cambio) if h.porcentaje_cambio else None,
                "motivo": h.motivo,
                "fecha_cambio": h.fecha_cambio.isoformat(),
            }
            for h in historial
        ]

    def get_total_objetos_contenidos(self, obj):
        """Si el objeto es contenedor, cuenta cuántos objetos contiene (sin soft-delete)."""
        if obj.es_contenedor:
            return obj.objetos_contenidos.filter(deleted_at__isnull=True).count()
        return 0

    def get_distribucion_por_categorias(self, obj):
        """
        Si el objeto es contenedor, devuelve un dict con la distribución
        de categorías de los objetos contenidos.
        Ej: {"Electrónica": 3, "Ropa": 2, None: 1}
        """
        if not obj.es_contenedor:
            return {}
        contenidos = obj.objetos_contenidos.filter(deleted_at__isnull=True)
        distribucion = {}
        for o in contenidos:
            cat_nombre = o.categoria.nombre if o.categoria else "Sin categoría"
            distribucion[cat_nombre] = distribucion.get(cat_nombre, 0) + 1
        return distribucion


class ObjetoCreateSerializer(serializers.ModelSerializer):
    """
    Serializer para crear/actualizar un Objeto con la taxonomía unificada.

    Todos los campos que antes pertenecían a las subclases multi-tabla
    (autor, isbn_issn, marca, material, tamano, etc.) son ahora campos
    directos del modelo Objeto y se reciben sin intermediarios.

    El aislamiento multi-tenant se respeta: `estok` se toma del header
    `X-Estok-Id` del request (nunca se recibe del cliente).
    """
    class Meta:
        model = Objeto
        fields = [
            'id', 'nombre', 'descripcion',
            'ubicacion', 'contenedor',
            'parent_grid_row', 'parent_grid_col',
            'categoria', 'es_contenedor', 'objeto_padre',
            'estado_conservacion', 'valor_estimado', 'color',
            'dueno_original', 'beneficiario',
            'autor', 'edicion', 'anio', 'isbn_issn',
            'nombre_serie', 'titulo_tomo', 'numero_tomo', 'editorial', 'idioma',
            'marca', 'modelo', 'numero_serie', 'peso', 'especificaciones',
            'material', 'largo', 'ancho', 'alto', 'artista_fabricante',
            'tamano',
            'estado_carga', 'campos_pendientes',
            'owner_action', 'plataformas_publicadas',
        ]
        read_only_fields = ['id']

    def create(self, validated_data):
        # Aislamiento multi-tenant: el estok se asigna desde el header,
        # nunca desde el payload del cliente.
        request = self.context.get('request')
        if request:
            estok_id = request.headers.get('X-Estok-Id')
            if estok_id:
                validated_data['estok_id'] = estok_id

        return Objeto.objects.create(**validated_data)
