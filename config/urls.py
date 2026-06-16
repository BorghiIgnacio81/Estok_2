"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.utils.safestring import mark_safe
from django.http import FileResponse
from django.views.static import serve
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)

# Personalización del Admin de Django
admin.site.site_header = mark_safe('<span style="color: white; font-weight: bold;">Administración de Estok</span>')
admin.site.site_title = 'Estok'
admin.site.index_title = 'Panel de Administración'

# Ruta al favicon en el sistema de archivos
import os
FAVICON_PATH = os.path.join(settings.BASE_DIR, 'archivador.png')

# Ruta al frontend estático de Astro
FRONTEND_DIR = settings.STATIC_ROOT / 'frontend'

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('inventario.api.urls')),
    # JWT Authentication endpoints
    path('api/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    # Favicon: servir directamente desde Django
    re_path(r'^favicon\.ico$', lambda request: FileResponse(open(FAVICON_PATH, 'rb'), content_type='image/x-icon')),
    re_path(r'^favicon\.png$', lambda request: FileResponse(open(FAVICON_PATH, 'rb'), content_type='image/png')),
    # Frontend Astro Static: servir index.html para todas las rutas que no son API/admin/media/static
    # Esto permite que el frontend SPA maneje el routing del lado del cliente
    re_path(r'^(?!api/|admin/|static/|media/|assets/|icons/|favicon|manifest\.json|sw\.js).*$',
        lambda request: serve(request, 'index.html', document_root=FRONTEND_DIR),
        name='frontend_spa'),
]


# Servir archivos multimedia en desarrollo
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
