import sys
sys.path.insert(0, '/app')
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from inventario.models import CustomUser
from rest_framework_simplejwt.tokens import AccessToken

user = CustomUser.objects.filter(is_superuser=True).first()
if not user:
    user = CustomUser.objects.first()

with open('/tmp/token_output.txt', 'w') as f:
    f.write(f"Usuario: {user.username}, ID: {user.id}\n")
    token = AccessToken.for_user(user)
    f.write(f"ACCESS_TOKEN={token}\n")
