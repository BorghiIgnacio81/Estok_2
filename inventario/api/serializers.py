"""
Serializers para la API REST del sistema de inventario.

Define cómo se serializan/deserializan los modelos a JSON,
incluyendo la lógica de creación de objetos con herencia multi-tabla.
"""

import logging
from decimal import Decimal
from typing import Dict, Any, Optional

from rest_framework import serializers
from django.contrib.auth import get_user_model

from ..models import (
    Role, CustomUser, Ubicacion, Contenedor,
    Objeto, LibroRevista, Tecnologia, MuebleArte, Ropa,
    FotoObjeto, HistorialPrecio, AlertaStock,
)

logger = logging.getLogger(__name__)
User = get_user_model()


# =============================================================================
# SERIALIZERS DE USUARIOS Y ROLES
# =============================================================================
class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class UserSerializer(serializers.ModelSerializer):
    role_name = serializers.CharField(source='role.name', read_only=True)

    class Meta:
        model = CustomUser
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'role_name', 'description', 'phone',
            'is_active', 'date_joined',
        ]
        read_only_fields = ['id', 'date_joined']


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={'input_type': 'password'})

    class Meta:
        model = CustomUser
        fields = [
            'username', 'email', 'password', 'first_name', 'last_name',
            'role', 'description', 'phone',
        ]

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = CustomUser(**validated_data)
        user.set_password(password)
        user.save()
        return user


# =============================================================================
# SERIALIZERS DE ORGANIZACIÓN ESPACIAL
# =============================================================================
class UbicacionSerializer(serializers.ModelSerializer):
    objetos_count = serializers.SerializerMethodField()

    class Meta:
        model = Ubicacion
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_objetos_count(self, obj):
        return obj.objetos.count()


class ContenedorSerializer(serializers.ModelSerializer):
    ubicacion_nombre = serializers.CharField(source='ubicacion.nombre', read_only=True)
    qr_code_url = serializers.SerializerMethodField()
    objetos_count = serializers.SerializerMethodField()

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

    def get_objetos_count(self, obj):
        """Retorna la cantidad de objetos dentro del contenedor."""
        return obj.objetos.count()


# =============================================================================
# SERIALIZER BASE PARA OBJETOS
# =============================================================================
class ObjetoListSerializer(serializers.ModelSerializer):
    """
    Serializer ligero para listar objetos (sin carga pesada).
    """
    tipo = serializers.SerializerMethodField()
    foto_principal = serializers.SerializerMethodField()
    ubicacion_nombre = serializers.CharField(source='ubicacion.nombre', read_only=True)
    contenedor_nombre = serializers.CharField(source='contenedor.nombre', read_only=True)

    class Meta:
        model = Objeto
        fields = [
            'id', 'nombre', 'tipo', 'estado_conservacion',
            'valor_estimado', 'color', 'foto_principal',
            'ubicacion_nombre', 'contenedor_nombre',
            'estado_carga', 'fecha_registro', 'deleted_at',
        ]

    def get_tipo(self, obj):
        """Determina el tipo concreto del objeto (herencia multi-tabla)."""
        if hasattr(obj, 'librorevista'):
            return 'libro'
        elif hasattr(obj, 'tecnologia'):
            return 'tecnologia'
        elif hasattr(obj, 'mueblearte'):
            return 'mueble'
        elif hasattr(obj, 'ropa'):
            return 'ropa'
        return 'objeto'

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
    Serializer detallado que incluye datos específicos según el tipo.
    """
    tipo = serializers.SerializerMethodField()
    ubicacion_nombre = serializers.CharField(source='ubicacion.nombre', read_only=True)
    contenedor_nombre = serializers.CharField(source='contenedor.nombre', read_only=True)
    dueno_original_nombre = serializers.SerializerMethodField()
    beneficiario_nombre = serializers.SerializerMethodField()
    fotos = serializers.SerializerMethodField()
    datos_especificos = serializers.SerializerMethodField()
    historial_precios = serializers.SerializerMethodField()

    class Meta:
        model = Objeto
        fields = '__all__'

    def get_tipo(self, obj):
        if hasattr(obj, 'librorevista'):
            return 'libro'
        elif hasattr(obj, 'tecnologia'):
            return 'tecnologia'
        elif hasattr(obj, 'mueblearte'):
            return 'mueble'
        elif hasattr(obj, 'ropa'):
            return 'ropa'
        return 'objeto'

    def get_dueno_original_nombre(self, obj):
        if obj.dueno_original:
            return str(obj.dueno_original)
        return None

    def get_beneficiario_nombre(self, obj):
        if obj.beneficiario:
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
        """Retorna los campos específicos según el tipo de objeto."""
        if hasattr(obj, 'librorevista'):
            lr = obj.librorevista
            return {
                "autor": lr.autor,
                "edicion": lr.edicion,
                "anio": lr.anio,
                "isbn_issn": lr.isbn_issn,
                "nombre_serie": lr.nombre_serie,
                "titulo_tomo": lr.titulo_tomo,
                "numero_tomo": lr.numero_tomo,
                "editorial": lr.editorial,
                "idioma": lr.idioma,
            }
        elif hasattr(obj, 'tecnologia'):
            t = obj.tecnologia
            return {
                "marca": t.marca,
                "modelo": t.modelo,
                "numero_serie": t.numero_serie,
                "peso": float(t.peso) if t.peso else None,
                "especificaciones": t.especificaciones,
            }
        elif hasattr(obj, 'mueblearte'):
            ma = obj.mueblearte
            return {
                "material": ma.material,
                "largo": float(ma.largo) if ma.largo else None,
                "ancho": float(ma.ancho) if ma.ancho else None,
                "alto": float(ma.alto) if ma.alto else None,
                "artista_fabricante": ma.artista_fabricante,
            }
        elif hasattr(obj, 'ropa'):
            r = obj.ropa
            return {
                "tamano": r.tamano,
            }
        return {}

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


# =============================================================================
# SERIALIZER PARA CREAR OBJETOS (CON HERENCIA)
# =============================================================================
class ObjetoCreateSerializer(serializers.ModelSerializer):
    """
    Serializer para crear objetos con herencia multi-tabla.
    Acepta un campo 'tipo' para determinar qué modelo hijo crear.
    Extiende ModelSerializer para que DRF maneje correctamente
    la serialización de la respuesta y los errores de validación.
    """
    # Tipo de objeto (campo virtual, no está en el modelo Objeto)
    tipo = serializers.ChoiceField(
        choices=['libro', 'tecnologia', 'mueble', 'ropa', 'objeto'],
        default='objeto'
    )

    # Campos específicos (opcionales según el tipo)
    # LibroRevista
    autor = serializers.CharField(required=False, allow_blank=True, default='')
    edicion = serializers.CharField(required=False, allow_blank=True, default='')
    anio = serializers.IntegerField(required=False, allow_null=True, default=None)
    isbn_issn = serializers.CharField(required=False, allow_blank=True, default='')
    nombre_serie = serializers.CharField(required=False, allow_blank=True, default='')
    titulo_tomo = serializers.CharField(required=False, allow_blank=True, default='')
    numero_tomo = serializers.IntegerField(required=False, allow_null=True, default=None)
    editorial = serializers.CharField(required=False, allow_blank=True, default='')
    idioma = serializers.CharField(required=False, allow_blank=True, default='')

    # Tecnologia
    marca = serializers.CharField(required=False, allow_blank=True, default='')
    modelo = serializers.CharField(required=False, allow_blank=True, default='')
    numero_serie = serializers.CharField(required=False, allow_blank=True, default='')
    peso = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None)
    especificaciones = serializers.JSONField(required=False, default=dict)

    # MuebleArte
    material = serializers.CharField(required=False, allow_blank=True, default='')
    largo = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None)
    ancho = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None)
    alto = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None)
    artista_fabricante = serializers.CharField(required=False, allow_blank=True, default='')

    # Ropa
    tamano = serializers.CharField(required=False, allow_blank=True, default='')

    class Meta:
        model = Objeto
        fields = [
            'id', 'nombre', 'descripcion', 'tipo',
            'ubicacion', 'contenedor',
            'estado_conservacion', 'valor_estimado', 'color',
            'dueno_original', 'beneficiario',
            'autor', 'edicion', 'anio', 'isbn_issn',
            'nombre_serie', 'titulo_tomo', 'numero_tomo', 'editorial', 'idioma',
            'marca', 'modelo', 'numero_serie', 'peso', 'especificaciones',
            'material', 'largo', 'ancho', 'alto', 'artista_fabricante',
            'tamano',
        ]
        read_only_fields = ['id']

    def create(self, validated_data):
        tipo = validated_data.pop('tipo', 'objeto')

        # Extraer campos específicos
        campos_especificos = {}
        campos_libro = ['autor', 'edicion', 'anio', 'isbn_issn', 'nombre_serie', 'titulo_tomo', 'numero_tomo', 'editorial', 'idioma']
        campos_tecno = ['marca', 'modelo', 'numero_serie', 'peso', 'especificaciones']
        campos_mueble = ['material', 'largo', 'ancho', 'alto', 'artista_fabricante']
        campos_ropa = ['tamano']

        for campo in campos_libro + campos_tecno + campos_mueble + campos_ropa:
            if campo in validated_data:
                campos_especificos[campo] = validated_data.pop(campo)

        # Crear el objeto base
        objeto = Objeto.objects.create(**validated_data)

        # Crear el modelo hijo según el tipo
        if tipo == 'libro':
            LibroRevista.objects.create(
                objeto_ptr=objeto,
                **{k: campos_especificos.get(k, '') for k in campos_libro}
            )
        elif tipo == 'tecnologia':
            Tecnologia.objects.create(
                objeto_ptr=objeto,
                **{k: campos_especificos.get(k, '' if k != 'especificaciones' else dict)
                   for k in campos_tecno}
            )
        elif tipo == 'mueble':
            MuebleArte.objects.create(
                objeto_ptr=objeto,
                **{k: campos_especificos.get(k, '') for k in campos_mueble}
            )
        elif tipo == 'ropa':
            Ropa.objects.create(
                objeto_ptr=objeto,
                **{k: campos_especificos.get(k, '') for k in campos_ropa}
            )

        return objeto


# =============================================================================
# SERIALIZERS DE MULTIMEDIA
# =============================================================================
class FotoObjetoSerializer(serializers.ModelSerializer):
    class Meta:
        model = FotoObjeto
        fields = '__all__'
        read_only_fields = ['id', 'fecha_subida']


class FotoObjetoUploadSerializer(serializers.Serializer):
    objeto_id = serializers.UUIDField()
    imagen = serializers.ImageField()
    descripcion = serializers.CharField(required=False, allow_blank=True)
    es_principal = serializers.BooleanField(default=False)


# =============================================================================
# SERIALIZERS DE HISTORIAL Y ALERTAS
# =============================================================================
class HistorialPrecioSerializer(serializers.ModelSerializer):
    objeto_nombre = serializers.CharField(source='objeto.nombre', read_only=True)
    registrado_por_nombre = serializers.CharField(source='registrado_por.username', read_only=True)

    class Meta:
        model = HistorialPrecio
        fields = '__all__'
        read_only_fields = ['id', 'diferencia', 'porcentaje_cambio', 'fecha_cambio']


class AlertaStockSerializer(serializers.ModelSerializer):
    objeto_nombre = serializers.CharField(source='objeto.nombre', read_only=True)
    necesita_reposicion = serializers.BooleanField(read_only=True)

    class Meta:
        model = AlertaStock
        fields = '__all__'
        read_only_fields = ['id', 'ultima_verificacion']
