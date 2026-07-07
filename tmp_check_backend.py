# Verificar si el modelo Mensaje existe
try:
    from inventario.models import Mensaje
    print("OK: Modelo Mensaje existe")
except ImportError:
    print("ERROR: Modelo Mensaje NO existe")

# Verificar si el viewset chat existe
try:
    import inventario.api.viewsets.chat
    print("OK: ViewSet chat existe")
except ImportError:
    print("ERROR: ViewSet chat NO existe")

# Verificar la URL de mensajes
try:
    from django.urls import reverse
    from django.conf import settings
    import django
    django.setup()
    # Verificar si la ruta está registrada
    from config.urls import urlpatterns
    url_names = [p.name for p in urlpatterns if hasattr(p, 'name')]
    print(f"URL names: {url_names}")
except Exception as e:
    print(f"Error al verificar URLs: {e}")
