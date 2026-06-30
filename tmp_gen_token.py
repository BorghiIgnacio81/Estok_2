from django.contrib.auth.models import User
from inventario.models import Membresia
from rest_framework_simplejwt.tokens import AccessToken

# Buscar un usuario que sea miembro del Estok del objeto
user = User.objects.filter(is_superuser=True).first()
if not user:
    user = User.objects.first()

print(f"Usuario: {user.username}, ID: {user.id}")

# Generar token
token = AccessToken.for_user(user)
print(f"ACCESS_TOKEN={token}")
