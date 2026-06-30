import os, sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from django.contrib.auth.models import User
from rest_framework_simplejwt.tokens import AccessToken

user = User.objects.filter(is_superuser=True).first()
if not user:
    user = User.objects.first()

with open('/tmp/token_output.txt', 'w') as f:
    f.write(f"Usuario: {user.username}, ID: {user.id}\n")
    token = AccessToken.for_user(user)
    f.write(f"ACCESS_TOKEN={token}\n")
