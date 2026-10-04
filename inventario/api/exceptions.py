"""
Excepciones HTTP compartidas de la capa API del inventario.

Centralizan los códigos no estándar para no duplicar `status` ni detalles en
serializers y viewsets (una sola fuente de verdad por caso de negocio).
"""

from rest_framework import status
from rest_framework.exceptions import APIException


class DecisionDerivadaAVotacion(APIException):
    """
    HTTP 202: la decisión directa (vender / conservar / tirar) fue DERIVADA a la
    votación obligatoria del Estok (período de herencia FOMO) porque el dueño
    original del objeto es EXTERNO o fallecido (no tiene cuenta en el sistema).

    El objeto NO muta su estado definitivo: la resolución queda en manos del
    inquilinato, que vota bajo el tenant activo (`X-Estok-Id`).
    """

    status_code = status.HTTP_202_ACCEPTED
    default_detail = (
        'La decisión fue derivada a la votación del inquilinato (período FOMO).'
    )
    default_code = 'decision_derivada_votacion'
