"""
Servicio central de tenants (Estok).

Único punto de entrada para garantizar la existencia del tenant global
"Estok Principal". Todos los seeds, comandos y flujos de inicialización deben
usar get_or_create_estok_principal() en lugar de duplicar la lógica de
creación/búsqueda del Estok inicial.
"""
from inventario.models import Estok

NOMBRE_ESTOK_PRINCIPAL = 'Estok Principal'
DESCRIPCION_ESTOK_PRINCIPAL = (
    'Estok Principal de la plataforma (tenant global, creado en el primer deploy)'
)


def get_or_create_estok_principal():
    """
    Devuelve la tupla (estok, created) del tenant global "Estok Principal".

    - Si ya existe un Estok con ese nombre, lo reutiliza.
    - Si la tabla está vacía, lo crea automáticamente (primer deploy).
    """
    return Estok.objects.get_or_create(
        nombre=NOMBRE_ESTOK_PRINCIPAL,
        defaults={
            'descripcion': DESCRIPCION_ESTOK_PRINCIPAL,
        },
    )
