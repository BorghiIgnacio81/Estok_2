"""Apply ALL fixes needed:
1. Photo persistence: clear sessionStorage after restore so it survives F5 but not navigation
2. Add material + tipo_madera fields to Contenedor model
3. Update ContenedorSerializer
"""
import sys

# ===========================
# FIX 1: Photo persistence in nuevo.astro
# ===========================
path_astro = 'C:/Users/USER/Desktop/Estok_2/frontend/src/pages/objetos/nuevo.astro'
text = open(path_astro, 'r', encoding='utf-8').read()

# Change restaurarFoto: restore AND immediately clear from sessionStorage
old_restore = """  (function restaurarFoto() {
    const fotoGuardada = sessionStorage.getItem('nuevo_objeto_foto');
    if (fotoGuardada) {
      photoImage.src = fotoGuardada;
      photoImage.classList.remove('hidden');
      photoPlaceholder.classList.add('hidden');
      imagenBase64.value = fotoGuardada;
      editPhotoBtn.classList.remove('hidden');
      clearPhotoBtn.classList.remove('hidden');
      if (iaAvailable) {
        analizarIaBtn.disabled = false;
      }
    }
  })();"""

new_restore = """  (function restaurarFoto() {
    // Restaurar foto solo si viene de un F5 (sessionStorage aun existe)
    const fotoGuardada = sessionStorage.getItem('nuevo_objeto_foto');
    if (fotoGuardada) {
      photoImage.src = fotoGuardada;
      photoImage.classList.remove('hidden');
      photoPlaceholder.classList.add('hidden');
      imagenBase64.value = fotoGuardada;
      editPhotoBtn.classList.remove('hidden');
      clearPhotoBtn.classList.remove('hidden');
      if (iaAvailable) {
        analizarIaBtn.disabled = false;
      }
      // Limpiar sessionStorage inmediatamente para que NO sobreviva a navegacion
      // Solo F5 la mantiene porque el script se ejecuta antes de que se borre el storage
      try { sessionStorage.removeItem('nuevo_objeto_foto'); } catch (e) {}
    }
  })();"""

if old_restore in text:
    text = text.replace(old_restore, new_restore, 1)
    open(path_astro, 'w', encoding='utf-8').write(text)
    print("FIX 1: Photo persistence OK - sessionStorage cleared after restore")
else:
    print("FIX 1: Already applied or not needed (skipping)")

# ===========================
# FIX 2: Add material + tipo_madera to Contenedor model
# ===========================
path_models = 'C:/Users/USER/Desktop/Estok_2/inventario/models.py'
text2 = open(path_models, 'r', encoding='utf-8').read()

# Using LF newlines to match the file
nl = '\n'

old_foto = f'    foto = models.ImageField(upload_to=\'contenedores/\', blank=True, null=True, verbose_name="Foto"){nl}    qr_code_image = models.ImageField('

new_foto = f"""    foto = models.ImageField(upload_to='contenedores/', blank=True, null=True, verbose_name="Foto")
    material = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        choices=[
            ('madera', 'Madera'),
            ('metal', 'Metal'),
            ('plastico', 'Plastico'),
            ('vidrio', 'Vidrio'),
            ('tela', 'Tela'),
            ('otro', 'Otro'),
        ],
        verbose_name="Material"
    )
    tipo_madera = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        choices=[
            ('pino', 'Pino'),
            ('roble', 'Roble'),
            ('nogal', 'Nogal'),
            ('cerezo', 'Cerezo'),
            ('haya', 'Haya'),
            ('caoba', 'Caoba'),
            ('mdf', 'MDF'),
            ('aglomerado', 'Aglomerado'),
            ('terciado', 'Terciado (Multicapa)'),
            ('otro', 'Otro'),
        ],
        verbose_name="Tipo de Madera",
        help_text="Solo aplica si el material es 'Madera'"
    )
    qr_code_image = models.ImageField("""

if old_foto in text2:
    text2 = text2.replace(old_foto, new_foto, 1)
    open(path_models, 'w', encoding='utf-8').write(text2)
    print("FIX 2: Contenedor model updated with material + tipo_madera")
else:
    print("FIX 2 FAILED")
    sys.exit(1)

# ===========================
# FIX 3: Update ContenedorSerializer to include new fields
# ===========================
path_serializer = 'C:/Users/USER/Desktop/Estok_2/inventario/api/serializers.py'
text3 = open(path_serializer, 'r', encoding='utf-8').read()

old_serializer = """class ContenedorSerializer(serializers.ModelSerializer):
    ubicacion_nombre = serializers.CharField(source='ubicacion.nombre', read_only=True)
    qr_code_url = serializers.SerializerMethodField()
    objetos_count = serializers.SerializerMethodField()

    class Meta:
        model = Contenedor
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'qr_code_image']"""

new_serializer = """class ContenedorSerializer(serializers.ModelSerializer):
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
        read_only_fields = ['id', 'created_at', 'updated_at', 'qr_code_image']"""

if old_serializer in text3:
    text3 = text3.replace(old_serializer, new_serializer, 1)
    open(path_serializer, 'w', encoding='utf-8').write(text3)
    print("FIX 3: ContenedorSerializer updated")
else:
    print("FIX 3 FAILED")
    sys.exit(1)

print("\nAll fixes applied!")
