"""
Paginación compartida de la API de inventario.

REGLA ÚNICA: `?page_size=N` (tope 1000). Sin el parámetro se conserva el
PAGE_SIZE global de `config.settings` (25), así que ningún consumidor existente
cambia de comportamiento.

IMPORTANTE (bug de inventario truncado): la clase de paginación global de DRF
(`PageNumberPagination`) NO declara `page_size_query_param`, por lo que ignora
`?page_size=1000` y devuelve apenas 25 filas. Los listados que necesitan el
inventario COMPLETO del Estok (Mudanza Inter-Estok, bandejas de organización,
visores) DEBEN usar esta clase; de lo contrario los elementos de las páginas 2+
nunca llegan al frontend.
"""

from rest_framework.pagination import PageNumberPagination


class EstokPaginacion(PageNumberPagination):
    """
    Paginación que respeta ?page_size=N (máx 1000).
    Sin el parámetro, conserva el PAGE_SIZE global (25).
    """

    page_size_query_param = 'page_size'
    max_page_size = 1000
