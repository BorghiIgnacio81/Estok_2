"""
Capa de servicios de la API.

Aloja la lógica de negocio reutilizable que NO debe vivir embebida en los
ViewSets (autenticación de usuarios, presencia, auditoría de acceso, etc.).

Este paquete NO re-exporta símbolos a propósito: cada ViewSet importa el
submódulo que necesita (`from ...services import usuario_auth_service`) para
evitar imports circulares con la app `inventario`.
"""
