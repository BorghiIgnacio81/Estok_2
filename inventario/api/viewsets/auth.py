"""
Vista JWT de login con conteo de inicios de sesión.

SimpleJWT (TokenObtainPairView) NO emite la señal nativa `user_logged_in`
de Django Auth (esa señal solo la dispara django.contrib.auth.login()).
Sin esta subclase, el contador de adopción `login_count` jamás se
incrementaría en el login real de la app (POST /api/token/).

Esta vista re-emite la señal estándar tras una autenticación exitosa;
el receptor que incrementa el contador vive ÚNICO en inventario/signals.py
(sin lógica de incremento duplicada aquí).
"""

from django.contrib.auth.signals import user_logged_in

from rest_framework import status
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.views import TokenObtainPairView


class TokenObtainPairViewConLoginCount(TokenObtainPairView):
    """
    POST /api/token/ idéntico al estándar, pero emite user_logged_in.

    TokenObtainSerializer.validate() deja el usuario autenticado en
    `serializer.user` tras validar las credenciales; con eso se re-emite
    la señal y el receptor incrementa login_count de forma atómica.
    """

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)

        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as exc:
            raise InvalidToken(exc.args[0])

        user = getattr(serializer, 'user', None)
        if user is not None:
            user_logged_in.send(sender=type(user), request=request, user=user)

        return Response(serializer.validated_data, status=status.HTTP_200_OK)
