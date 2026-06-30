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
    Role, CustomUser, Estok, Membresia, CodigoInvitacion,
    Ubicacion, Contenedor,
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
    class Meta:
        model = CustomUser
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'description', 'phone',
            'is_active', 'date_joined',
        ]
        read_only_fields = ['id', 'date_joined']


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={'input_type': 'password'})

    class Meta:
        model = CustomUser
        fields = [
            'username', 'email', 'password', 'first_name', 'last_name',
            'description', 'phone',
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
    contenedores_count = serializers.SerializerMethodField()

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


class ContenedorSerializer(serializers.ModelSerializer):
    ubicacion_nombre = serializers.CharField(source='ubicacion.nombre', read_only=True)
    qr_code_url = serializers.SerializerMethodField()
    objetos_count = serializers.SerializerMethodField()
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

    def get_objetos_count(self, obj):
        """Retorna la cantidad de objetos NO eliminados dentro del contenedor."""
        return obj.objetos.filter(deleted_at__isnull=True).count()


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
    # Tipo de objeto (write_only para crear, read_only para respuesta)
    tipo = serializers.ChoiceField(
        choices=['libro', 'tecnologia', 'mueble', 'ropa', 'objeto'],
        default='objeto',
        write_only=True
    )

    # Campos específicos (opcionales según el tipo) - write_only
    autor = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    edicion = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    anio = serializers.IntegerField(required=False, allow_null=True, default=None, write_only=True)
    isbn_issn = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    nombre_serie = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    titulo_tomo = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    numero_tomo = serializers.IntegerField(required=False, allow_null=True, default=None, write_only=True)
    editorial = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    idioma = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    marca = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    modelo = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    numero_serie = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    peso = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None, write_only=True)
    especificaciones = serializers.JSONField(required=False, default=dict, write_only=True)
    material = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    largo = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None, write_only=True)
    ancho = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None, write_only=True)
    alto = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None, write_only=True)
    artista_fabricante = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)
    tamano = serializers.CharField(required=False, allow_blank=True, default='', write_only=True)

    class Meta:
        model = Objeto
        fields = [
            'id', 'nombre', 'descripcion',
            'ubicacion', 'contenedor',
            'estado_conservacion', 'valor_estimado', 'color',
            'dueno_original', 'beneficiario',
            'tipo',
            'autor', 'edicion', 'anio', 'isbn_issn',
            'nombre_serie', 'titulo_tomo', 'numero_tomo', 'editorial', 'idioma',
            'marca', 'modelo', 'numero_serie', 'peso', 'especificaciones',
            'material', 'largo', 'ancho', 'alto', 'artista_fabricante',
            'tamano',
        ]
        read_only_fields = ['id']

    def create(self, validated_data):
        tipo = validated_data.pop('tipo', 'objeto')

        # Asignar estok desde el header X-Estok-Id del request
        request = self.context.get('request')
        if request:
            estok_id = request.headers.get('X-Estok-Id')
            if estok_id:
                validated_data['estok_id'] = estok_id

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
        # Usamos objeto_ptr_id en lugar de objeto_ptr para evitar que Django
        # intente crear OTRA fila en inventario_objeto (multi-table inheritance bug)
        if tipo == 'libro':
            LibroRevista.objects.create(
                objeto_ptr_id=objeto.id,
                **{k: campos_especificos.get(k, '') for k in campos_libro}
            )
        elif tipo == 'tecnologia':
            Tecnologia.objects.create(
                objeto_ptr_id=objeto.id,
                **{k: campos_especificos.get(k, '' if k != 'especificaciones' else dict)
                   for k in campos_tecno}
            )
        elif tipo == 'mueble':
            MuebleArte.objects.create(
                objeto_ptr_id=objeto.id,
                **{k: campos_especificos.get(k, '') for k in campos_mueble}
            )
        elif tipo == 'ropa':
            Ropa.objects.create(
                objeto_ptr_id=objeto.id,
                **{k: campos_especificos.get(k, '') for k in campos_ropa}
            )

        return objeto

    def _get_tipo_actual(self, instance):
        """Determina el tipo actual del objeto según qué subtipo existe en DB."""
        # Usamos consulta directa a DB para evitar el cache de hasattr
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM inventario_librorevista WHERE objeto_ptr_id = %s", [instance.id])
            if cursor.fetchone()[0] > 0:
                return 'libro'
            cursor.execute("SELECT COUNT(*) FROM inventario_tecnologia WHERE objeto_ptr_id = %s", [instance.id])
            if cursor.fetchone()[0] > 0:
                return 'tecnologia'
            cursor.execute("SELECT COUNT(*) FROM inventario_mueblearte WHERE objeto_ptr_id = %s", [instance.id])
            if cursor.fetchone()[0] > 0:
                return 'mueble'
            cursor.execute("SELECT COUNT(*) FROM inventario_ropa WHERE objeto_ptr_id = %s", [instance.id])
            if cursor.fetchone()[0] > 0:
                return 'ropa'
        return None

    def _eliminar_hijo_actual(self, instance, tipo_actual):
        """Elimina la fila del subtipo actual si existe (SQL directo)."""
        from django.db import connection
        tablas = {
            'libro': 'inventario_librorevista',
            'tecnologia': 'inventario_tecnologia',
            'mueble': 'inventario_mueblearte',
            'ropa': 'inventario_ropa',
        }
        tabla = tablas.get(tipo_actual)
        if tabla:
            with connection.cursor() as cursor:
                cursor.execute(f"DELETE FROM {tabla} WHERE objeto_ptr_id = %s", [instance.id])

    def _crear_o_actualizar_hijo(self, instance, tipo, campos_especificos, campos_libro, campos_tecno, campos_mueble, campos_ropa):
        """
        Crea o actualiza la fila del subtipo usando SQL directo.
        
        Django multi-table inheritance SIEMPRE intenta hacer INSERT en la tabla
        padre al crear un hijo, incluso si el padre ya existe. Por eso usamos
        SQL directo para INSERT/UPDATE en las tablas hijas.
        """
        from django.db import connection
        
        if tipo == 'libro':
            columnas = campos_libro  # ['autor', 'edicion', 'anio', 'isbn_issn', 'nombre_serie', 'titulo_tomo', 'numero_tomo', 'editorial', 'idioma']
            tabla = 'inventario_librorevista'
        elif tipo == 'tecnologia':
            columnas = campos_tecno  # ['marca', 'modelo', 'numero_serie', 'peso', 'especificaciones']
            tabla = 'inventario_tecnologia'
        elif tipo == 'mueble':
            columnas = campos_mueble  # ['material', 'largo', 'ancho', 'alto', 'artista_fabricante']
            tabla = 'inventario_mueblearte'
        elif tipo == 'ropa':
            columnas = campos_ropa  # ['tamano']
            tabla = 'inventario_ropa'
        else:
            return
        
        # Verificar si ya existe la fila
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {tabla} WHERE objeto_ptr_id = %s", [instance.id])
            existe = cursor.fetchone()[0] > 0
        
        if existe:
            # UPDATE: solo las columnas que vienen en campos_especificos
            sets = []
            valores = []
            for col in columnas:
                if col in campos_especificos:
                    sets.append(f"{col} = %s")
                    valores.append(campos_especificos[col])
            if sets:
                valores.append(instance.id)
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"UPDATE {tabla} SET {', '.join(sets)} WHERE objeto_ptr_id = %s",
                        valores
                    )
        else:
            # INSERT: todas las columnas con defaults
            cols = ['objeto_ptr_id'] + columnas
            placeholders = ['%s'] * len(cols)
            valores = [instance.id]
            for col in columnas:
                if col in campos_especificos:
                    valores.append(campos_especificos[col])
                else:
                    # Default values según el tipo de columna
                    valores.append('' if col != 'especificaciones' else '{}')
            with connection.cursor() as cursor:
                cursor.execute(
                    f"INSERT INTO {tabla} ({', '.join(cols)}) VALUES ({', '.join(placeholders)})",
                    valores
                )

    def update(self, instance, validated_data):
        tipo = validated_data.pop('tipo', None)

        # Extraer campos específicos
        campos_especificos = {}
        campos_libro = ['autor', 'edicion', 'anio', 'isbn_issn', 'nombre_serie', 'titulo_tomo', 'numero_tomo', 'editorial', 'idioma']
        campos_tecno = ['marca', 'modelo', 'numero_serie', 'peso', 'especificaciones']
        campos_mueble = ['material', 'largo', 'ancho', 'alto', 'artista_fabricante']
        campos_ropa = ['tamano']

        for campo in campos_libro + campos_tecno + campos_mueble + campos_ropa:
            if campo in validated_data:
                campos_especificos[campo] = validated_data.pop(campo)

        # Actualizar campos base del objeto
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Determinar tipo actual (desde DB, no desde hasattr que puede fallar)
        tipo_actual = self._get_tipo_actual(instance)

        if tipo is None:
            # No se envió tipo en el payload → mantener el subtipo actual
            tipo = tipo_actual

        if tipo is not None:
            # Si el tipo cambió, eliminar el hijo anterior antes de crear el nuevo
            if tipo_actual is not None and tipo_actual != tipo:
                self._eliminar_hijo_actual(instance, tipo_actual)

            # Crear o actualizar el hijo del nuevo tipo
            self._crear_o_actualizar_hijo(
                instance, tipo, campos_especificos,
                campos_libro, campos_tecno, campos_mueble, campos_ropa
            )

        return instance

# =============================================================================
# SERIALIZERS DE ESTOK / MEMBRESIA / CODIGO INVITACION
# =============================================================================
class MembresiaSerializer(serializers.ModelSerializer):
    usuario_username = serializers.CharField(source='usuario.username', read_only=True)
    usuario_email = serializers.CharField(source='usuario.email', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True, allow_null=True)

    class Meta:
        model = Membresia
        fields = [
            'id', 'usuario', 'usuario_username', 'usuario_email',
            'estok', 'role', 'role_name', 'joined_at',
        ]
        read_only_fields = ['id', 'joined_at']


class EstokSerializer(serializers.ModelSerializer):
    miembros = MembresiaSerializer(many=True, read_only=True)
    miembros_count = serializers.SerializerMethodField()
    objetos_count = serializers.SerializerMethodField()

    class Meta:
        model = Estok
        fields = [
            'id', 'nombre', 'descripcion',
            'miembros', 'miembros_count', 'objetos_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_miembros_count(self, obj):
        return obj.miembros.count()

    def get_objetos_count(self, obj):
        return obj.objetos.count()


class EstokCreateSerializer(serializers.ModelSerializer):
    """
    Serializer para crear un Estok.
    Auto-asigna al usuario autenticado como Admin del Estok.
    """

    class Meta:
        model = Estok
        fields = ['nombre', 'descripcion']

    def create(self, validated_data):
        user = self.context['request'].user
        role_admin = Role.objects.get(name='Admin')

        estok = Estok.objects.create(**validated_data)

        Membresia.objects.create(
            usuario=user,
            estok=estok,
            role=role_admin,
        )

        return estok


class CodigoInvitacionSerializer(serializers.ModelSerializer):
    estok_nombre = serializers.CharField(source='estok.nombre', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True, allow_null=True)
    es_valido = serializers.BooleanField(read_only=True)
    creado_por_username = serializers.CharField(source='creado_por.username', read_only=True, allow_null=True)

    class Meta:
        model = CodigoInvitacion
        fields = [
            'id', 'estok', 'estok_nombre', 'role', 'role_name',
            'codigo', 'creado_por', 'creado_por_username',
            'activo', 'usos_maximos', 'usos_actuales',
            'fecha_expiracion', 'es_valido', 'created_at',
        ]
        read_only_fields = ['id', 'codigo', 'usos_actuales', 'created_at', 'estok']


class UnirseConCodigoSerializer(serializers.Serializer):
    codigo = serializers.CharField(max_length=20)

    def validate_codigo(self, value):
        try:
            invitacion = CodigoInvitacion.objects.get(codigo=value)
        except CodigoInvitacion.DoesNotExist:
            raise serializers.ValidationError("El código de invitación no existe.")

        if not invitacion.es_valido:
            raise serializers.ValidationError("El código de invitación ya no es válido (expirado, desactivado o sin usos disponibles).")

        return value


class CambiarEstokActivoSerializer(serializers.Serializer):
    estok_id = serializers.UUIDField()

    def validate_estok_id(self, value):
        user = self.context['request'].user
        if not Membresia.objects.filter(usuario=user, estok_id=value).exists():
            raise serializers.ValidationError("No eres miembro de este Estok.")
        return value


# =============================================================================
# SERIALIZERS DE HISTORIAL DE PRECIOS Y ALERTAS
# =============================================================================
class HistorialPrecioSerializer(serializers.ModelSerializer):
    class Meta:
        model = HistorialPrecio
        fields = '__all__'
        read_only_fields = ['id', 'fecha_cambio']


class AlertaStockSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertaStock
        fields = '__all__'
        read_only_fields = ['id', 'created_at']


# =============================================================================
# SERIALIZERS DE FOTOS DE OBJETOS
# =============================================================================
class FotoObjetoSerializer(serializers.ModelSerializer):
    """Serializer general para fotos de objetos."""

    class Meta:
        model = FotoObjeto
        fields = '__all__'
        read_only_fields = ['id', 'fecha_subida']


class FotoObjetoUploadSerializer(serializers.ModelSerializer):
    """Serializer para subir fotos a un objeto existente."""

    class Meta:
        model = FotoObjeto
        fields = ['id', 'objeto', 'imagen', 'descripcion', 'es_principal', 'fecha_subida']
        read_only_fields = ['id', 'fecha_subida']

    def validate_imagen(self, value):
        """Valida que el archivo sea una imagen."""
        if value.size > 10 * 1024 * 1024:  # 10MB
            raise serializers.ValidationError("La imagen no puede superar los 10MB.")
        return value
