"""
Servicio de Generación de Códigos QR para Contenedores.

Genera códigos QR únicos para cada contenedor del inventario.
El QR contiene una URL o ID que permite listar todos los objetos
vinculados a ese contenedor al ser escaneado.

Flujo:
  1. Al crear un Contenedor, se genera automáticamente un QR
  2. El QR se guarda como imagen en media/qrcodes/
  3. Al escanear el QR, se obtiene el ID del contenedor
  4. La API retorna todos los objetos dentro de ese contenedor
"""

import io
import os
import logging
from pathlib import Path
from typing import Optional

import qrcode
from qrcode.image.pil import PilImage
from django.conf import settings
from django.core.files.base import ContentFile

logger = logging.getLogger(__name__)


# =============================================================================
# CONFIGURACIÓN
# =============================================================================
QR_DIR = "qrcodes"  # subdirectorio dentro de MEDIA_ROOT
QR_FILL_COLOR = "#1a1a2e"  # color oscuro del QR
QR_BACK_COLOR = "#ffffff"  # fondo blanco
QR_VERSION = 2  # tamaño del QR (1-40, mayor = más datos)
QR_BOX_SIZE = 10  # tamaño de cada módulo del QR en píxeles
QR_BORDER = 2  # borde en módulos


# =============================================================================
# SERVICIO QR
# =============================================================================
class QRService:
    """
    Servicio para generar y gestionar códigos QR de contenedores.
    """

    def __init__(self):
        self.qr_dir = Path(settings.MEDIA_ROOT) / QR_DIR
        self._ensure_qr_directory()

    def _ensure_qr_directory(self):
        """Asegura que el directorio de QR exista."""
        os.makedirs(self.qr_dir, exist_ok=True)
        logger.debug("Directorio de QR asegurado: %s", self.qr_dir)

    def _get_qr_filename(self, contenedor_id: str) -> str:
        """
        Genera el nombre del archivo QR basado en el ID del contenedor.

        Args:
            contenedor_id: UUID del contenedor.

        Returns:
            Nombre del archivo (ej: "qr_contenedor_abc123.png").
        """
        return f"qr_contenedor_{contenedor_id}.png"

    def _get_qr_relative_path(self, contenedor_id: str) -> str:
        """
        Obtiene la ruta relativa para almacenar en el modelo.

        Args:
            contenedor_id: UUID del contenedor.

        Returns:
            Ruta relativa a MEDIA_ROOT (ej: "qrcodes/qr_contenedor_abc123.png").
        """
        return f"{QR_DIR}/{self._get_qr_filename(contenedor_id)}"

    def _build_contenedor_url(self, contenedor_id: str) -> str:
        """
        Construye la URL que se codificará en el QR.
        Al escanear, esta URL permite listar los objetos del contenedor.

        Args:
            contenedor_id: UUID del contenedor.

        Returns:
            URL completa para el QR.
        """
        # URL de la API para listar objetos por contenedor
        base_url = getattr(settings, 'SITE_URL', 'http://localhost:8000')
        return f"{base_url}/api/objetos/?contenedor={contenedor_id}"

    def generar_qr(self, contenedor_id: str, contenedor_nombre: str = "") -> Optional[str]:
        """
        Genera un código QR para un contenedor y lo guarda como archivo.

        Args:
            contenedor_id: UUID del contenedor.
            contenedor_nombre: Nombre del contenedor (para logging).

        Returns:
            Ruta relativa del archivo QR generado, o None si falla.
        """
        try:
            # Construir la URL/datos para el QR
            qr_data = self._build_contenedor_url(contenedor_id)

            # Configurar el QR
            qr = qrcode.QRCode(
                version=QR_VERSION,
                error_correction=qrcode.constants.ERROR_CORRECT_M,  # Medio: tolera ~15% de daño
                box_size=QR_BOX_SIZE,
                border=QR_BORDER,
            )
            qr.add_data(qr_data)
            qr.make(fit=True)

            # Generar la imagen
            img = qr.make_image(
                fill_color=QR_FILL_COLOR,
                back_color=QR_BACK_COLOR
            )

            # Guardar la imagen en el directorio de QR
            filename = self._get_qr_filename(contenedor_id)
            filepath = self.qr_dir / filename

            # Convertir PIL Image a bytes y guardar
            img_buffer = io.BytesIO()
            img.save(img_buffer, format='PNG')
            img_buffer.seek(0)

            with open(filepath, 'wb') as f:
                f.write(img_buffer.getvalue())

            relative_path = self._get_qr_relative_path(contenedor_id)
            logger.info(
                "QR generado para contenedor '%s' (ID: %s): %s",
                contenedor_nombre or contenedor_id,
                contenedor_id,
                relative_path
            )

            return relative_path

        except Exception as e:
            logger.error(
                "Error al generar QR para contenedor %s: %s",
                contenedor_id, e
            )
            return None

    def regenerar_qr(self, contenedor_id: str, contenedor_nombre: str = "") -> Optional[str]:
        """
        Regenera el QR de un contenedor (elimina el anterior y crea uno nuevo).

        Args:
            contenedor_id: UUID del contenedor.
            contenedor_nombre: Nombre del contenedor (para logging).

        Returns:
            Ruta relativa del nuevo archivo QR, o None si falla.
        """
        # Eliminar QR anterior si existe
        self.eliminar_qr(contenedor_id)
        # Generar nuevo QR
        return self.generar_qr(contenedor_id, contenedor_nombre)

    def eliminar_qr(self, contenedor_id: str) -> bool:
        """
        Elimina el archivo QR de un contenedor.

        Args:
            contenedor_id: UUID del contenedor.

        Returns:
            True si se eliminó, False si no existía.
        """
        filename = self._get_qr_filename(contenedor_id)
        filepath = self.qr_dir / filename

        if filepath.exists():
            os.remove(filepath)
            logger.info("QR eliminado para contenedor ID: %s", contenedor_id)
            return True

        return False

    def obtener_qr_url(self, contenedor) -> Optional[str]:
        """
        Obtiene la URL pública del QR de un contenedor.

        Args:
            contenedor: Instancia del modelo Contenedor.

        Returns:
            URL completa del QR, o None si no tiene QR.
        """
        if contenedor.qr_code_image:
            return f"{settings.MEDIA_URL}{contenedor.qr_code_image}"
        return None

    @staticmethod
    def decode_qr_data(qr_url: str) -> Optional[str]:
        """
        Extrae el ID del contenedor desde una URL de QR escaneada.

        Args:
            qr_url: URL completa escaneada del QR.

        Returns:
            UUID del contenedor, o None si no se pudo extraer.
        """
        import re
        # Buscar el parámetro contenedor= en la URL
        match = re.search(r'contenedor=([a-f0-9\-]+)', qr_url)
        if match:
            return match.group(1)
        return None
