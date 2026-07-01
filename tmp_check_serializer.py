from inventario.api.serializers import FotoObjetoUploadSerializer
s = FotoObjetoUploadSerializer()
print("read_only_fields:", s.Meta.read_only_fields)
print("fields:", s.Meta.fields)
