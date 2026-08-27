from django.apps import AppConfig


class InventarioConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'inventario'

    def ready(self):
        # Registra las señales de la app (incremento de login_count).
        from . import signals  # noqa: F401
