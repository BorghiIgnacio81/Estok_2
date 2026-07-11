"""
Serializers de Objetos (listado, detalle, creación con herencia multi-tabla).
"""

import json
import logging
from decimal import Decimal
from typing import Dict, Any, Optional

from rest_framework import serializers
from django.db import connection

from ...models import (
    Objeto, LibroRevista, Tecnologia, MuebleArte, Ropa,
)

logger = logging.getLogger(__name__)


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
            request = self.context.get('request')
            # REGLA DE PRIVACIDAD ABSOLUTA: ygumy44 siempre es "Yamza" para los demás
            if request and request.user.username != 'ygumy44' and obj.dueno_original.username == 'ygumy44':
                return 'Yamza'
            return str(obj.dueno_original)
        return None

    def get_beneficiario_nombre(self, obj):
        if obj.beneficiario:
            request = self.context.get('request')
            # REGLA DE PRIVACIDAD ABSOLUTA: ygumy44 siempre es "Yamza" para los demás
            if request and request.user.username != 'ygumy44' and obj.beneficiario.username == 'ygumy44':
                return 'Yamza'
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

    def _serializar_valor(self, valor):
        """Serializa valores para SQL directo: JSONField necesita json.dumps."""
        if isinstance(valor, dict):
            return json.dumps(valor)
        return valor

    def _crear_o_actualizar_hijo(self, instance, tipo, campos_especificos, campos_libro, campos_tecno, campos_mueble, campos_ropa):
        """
        Crea o actualiza la fila del subtipo usando SQL directo.
        
        Django multi-table inheritance SIEMPRE intenta hacer INSERT en la tabla
        padre al crear un hijo, incluso si el padre ya existe. Por eso usamos
        SQL directo para INSERT/UPDATE en las tablas hijas.
        """
        if tipo == 'libro':
            columnas = campos_libro
            tabla = 'inventario_librorevista'
        elif tipo == 'tecnologia':
            columnas = campos_tecno
            tabla = 'inventario_tecnologia'
        elif tipo == 'mueble':
            columnas = campos_mueble
            tabla = 'inventario_mueblearte'
        elif tipo == 'ropa':
            columnas = campos_ropa
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
                    valores.append(self._serializar_valor(campos_especificos[col]))
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
                    valores.append(self._serializar_valor(campos_especificos[col]))
                else:
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
