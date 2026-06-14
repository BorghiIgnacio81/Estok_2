"""
Servicio de Marketing y Publicación en Marketplaces.

Genera automáticamente copys publicitarios para diferentes plataformas
(Facebook Marketplace, Instagram, Mercado Libre) basados en los datos
del objeto, incluyendo campos detectados por IA.

Mantiene registro de las plataformas donde se ha publicado cada activo.
"""

import json
import logging
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field, asdict

from django.utils import timezone

logger = logging.getLogger(__name__)


# =============================================================================
# ESTRUCTURAS DE DATOS
# =============================================================================
@dataclass
class AdCopy:
    """Anuncio publicitario generado para una plataforma específica."""
    plataforma: str  # facebook, instagram, mercadolibre
    titulo: str
    descripcion: str
    precio: str
    hashtags: List[str] = field(default_factory=list)
    recomendaciones_imagen: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AdPackage:
    """Paquete completo de anuncios para todas las plataformas."""
    facebook: Optional[AdCopy] = None
    instagram: Optional[AdCopy] = None
    mercadolibre: Optional[AdCopy] = None
    fecha_generacion: str = ""

    def to_dict(self) -> Dict[str, Any]:
        result = {"fecha_generacion": self.fecha_generacion}
        if self.facebook:
            result["facebook"] = self.facebook.to_dict()
        if self.instagram:
            result["instagram"] = self.instagram.to_dict()
        if self.mercadolibre:
            result["mercadolibre"] = self.mercadolibre.to_dict()
        return result


# =============================================================================
# SERVICIO DE MARKETING
# =============================================================================
class MarketingService:
    """
    Servicio para generar copys publicitarios y gestionar
    la publicación en marketplaces.
    """

    # Emojis por categoría para darle vida a los anuncios
    CATEGORY_EMOJIS = {
        "libro": "📚",
        "tecnologia": "💻",
        "mueble": "🪑",
        "ropa": "👗",
        "otro": "📦",
    }

    # Hashtags por categoría para Instagram
    CATEGORY_HASHTAGS = {
        "libro": [
            "#libros", "#lectura", "#booklover", "#librosusados",
            "#coleccionista", "#biblioteca", "#librosdeocasion"
        ],
        "tecnologia": [
            "#tecnologia", "#electronica", "#gadgets", "#ofertastech",
            "#seminuevo", "#tecnologiausada", "#smartgadgets"
        ],
        "mueble": [
            "#muebles", "#decoracion", "#hogar", "#mueblesusados",
            "#vintage", "#restauracion", "#decohogar"
        ],
        "ropa": [
            "#moda", "#ropa", "#fashion", "#ropausada",
            "#vintageclothing", "#tendencia", "#outfit"
        ],
        "otro": [
            "#venta", "#ofertas", "#segundamano", "#oportunidad",
            "#coleccionables", "#articulosusados", "#ganga"
        ],
    }

    def __init__(self):
        pass

    def _get_emoji(self, categoria: str) -> str:
        return self.CATEGORY_EMOJIS.get(categoria, "📦")

    def _get_hashtags(self, categoria: str) -> List[str]:
        return self.CATEGORY_HASHTAGS.get(categoria, self.CATEGORY_HASHTAGS["otro"])

    def _formatear_precio(self, valor) -> str:
        """Formatea el precio para mostrarlo en los anuncios."""
        if valor is None:
            return "Consultar precio"
        try:
            return f"${float(valor):,.2f}"
        except (ValueError, TypeError):
            return "Consultar precio"

    def _estado_a_texto(self, estado: str) -> str:
        """Convierte el estado de conservación a texto amigable."""
        estados = {
            "excelente": "Excelente estado, como nuevo ✨",
            "bueno": "Buen estado, pocas señales de uso 👍",
            "regular": "Estado regular, funcional con detalles visibles",
            "malo": "Estado usado, requiere mantenimiento",
            "muy_malo": "Para restauración o piezas",
        }
        return estados.get(estado, estado)

    def generar_anuncio_facebook(self, objeto_data: Dict[str, Any]) -> AdCopy:
        """
        Genera un anuncio optimizado para Facebook Marketplace.
        Formato: Título llamativo + descripción detallada + precio.
        """
        nombre = objeto_data.get("nombre", "Artículo en venta")
        descripcion = objeto_data.get("descripcion", "")
        categoria = objeto_data.get("categoria", "otro")
        estado = objeto_data.get("estado_conservacion", "")
        precio = self._formatear_precio(objeto_data.get("valor_estimado"))
        marca = objeto_data.get("marca", "")
        autor = objeto_data.get("autor", "")
        anio = objeto_data.get("anio", "")
        color = objeto_data.get("color", "")
        emoji = self._get_emoji(categoria)

        # Construir título
        titulo = f"{emoji} {nombre}"
        if marca:
            titulo = f"{emoji} {marca} - {nombre}"
        if len(titulo) > 100:
            titulo = titulo[:97] + "..."

        # Construir descripción detallada
        partes_desc = [f"📌 {descripcion}" if descripcion else ""]

        if marca:
            partes_desc.append(f"🏷️ Marca: {marca}")
        if autor:
            partes_desc.append(f"✍️ {autor}")
        if anio:
            partes_desc.append(f"📅 Año: {anio}")
        if color:
            partes_desc.append(f"🎨 Color: {color}")
        if estado:
            partes_desc.append(f"📋 Estado: {self._estado_a_texto(estado)}")

        partes_desc.append("")
        partes_desc.append(f"💰 Precio: {precio}")
        partes_desc.append("")
        partes_desc.append("📞 ¡Contáctame para más información o para coordinar la entrega!")
        partes_desc.append("🚚 Envío disponible / Se retira en persona.")

        descripcion_final = "\n".join(p for p in partes_desc if p)

        return AdCopy(
            plataforma="facebook",
            titulo=titulo,
            descripcion=descripcion_final,
            precio=precio,
            recomendaciones_imagen=(
                "Usar foto principal del objeto con buena iluminación. "
                "Incluir una foto de detalles si es posible."
            )
        )

    def generar_anuncio_instagram(self, objeto_data: Dict[str, Any]) -> AdCopy:
        """
        Genera un anuncio optimizado para Instagram.
        Formato: Descripción corta + emojis + hashtags.
        """
        nombre = objeto_data.get("nombre", "Artículo en venta")
        descripcion = objeto_data.get("descripcion", "")
        categoria = objeto_data.get("categoria", "otro")
        estado = objeto_data.get("estado_conservacion", "")
        precio = self._formatear_precio(objeto_data.get("valor_estimado"))
        marca = objeto_data.get("marca", "")
        emoji = self._get_emoji(categoria)

        # Título corto para Instagram
        titulo = f"{emoji} {nombre}"
        if marca:
            titulo = f"{emoji} {marca} {nombre}"

        # Descripción estilo Instagram (más corta, con emojis)
        partes = [f"{descripcion}" if descripcion else f"{nombre} en venta"]

        detalles = []
        if marca:
            detalles.append(f"🏷️ {marca}")
        if estado:
            detalles.append(f"📋 {self._estado_a_texto(estado)}")
        if detalles:
            partes.append(" | ".join(detalles))

        partes.append("")
        partes.append(f"💰 {precio}")
        partes.append("")
        partes.append("👇 DM para más info o coordinar entrega")
        partes.append("🛵 Envío disponible")

        # Hashtags
        hashtags = self._get_hashtags(categoria)
        partes.append("")
        partes.append(" ".join(hashtags))

        descripcion_final = "\n".join(partes)

        return AdCopy(
            plataforma="instagram",
            titulo=titulo,
            descripcion=descripcion_final,
            precio=precio,
            hashtags=hashtags,
            recomendaciones_imagen=(
                "Foto cuadrada (1:1) idealmente. Usar buena iluminación natural. "
                "Fondo limpio y minimalista para destacar el objeto."
            )
        )

    def generar_anuncio_mercadolibre(self, objeto_data: Dict[str, Any]) -> AdCopy:
        """
        Genera un anuncio optimizado para Mercado Libre.
        Formato: Título SEO + descripción técnica + especificaciones.
        """
        nombre = objeto_data.get("nombre", "Artículo en venta")
        descripcion = objeto_data.get("descripcion", "")
        categoria = objeto_data.get("categoria", "otro")
        estado = objeto_data.get("estado_conservacion", "")
        precio = self._formatear_precio(objeto_data.get("valor_estimado"))
        marca = objeto_data.get("marca", "")
        modelo = objeto_data.get("modelo", "")
        autor = objeto_data.get("autor", "")
        anio = objeto_data.get("anio", "")
        color = objeto_data.get("color", "")

        # Título SEO optimizado para búsqueda en ML
        partes_titulo = [nombre]
        if marca:
            partes_titulo.append(marca)
        if modelo:
            partes_titulo.append(modelo)
        if anio:
            partes_titulo.append(str(anio))
        titulo = " | ".join(partes_titulo)
        if len(titulo) > 60:
            titulo = titulo[:57] + "..."

        # Descripción técnica detallada
        partes_desc = [
            "🔹 DESCRIPCIÓN",
            "=" * 40,
            descripcion or nombre,
            "",
            "🔹 CARACTERÍSTICAS",
            "=" * 40,
        ]

        if marca:
            partes_desc.append(f"• Marca: {marca}")
        if modelo:
            partes_desc.append(f"• Modelo: {modelo}")
        if autor:
            partes_desc.append(f"• Autor/Artista: {autor}")
        if anio:
            partes_desc.append(f"• Año: {anio}")
        if color:
            partes_desc.append(f"• Color: {color}")
        if estado:
            partes_desc.append(f"• Estado: {self._estado_a_texto(estado)}")

        partes_desc.append("")
        partes_desc.append("🔹 CONDICIONES DE VENTA")
        partes_desc.append("=" * 40)
        partes_desc.append(f"💰 Precio: {precio}")
        partes_desc.append("📦 Producto en stock")
        partes_desc.append("🚚 Consultar costos de envío")
        partes_desc.append("✅ Acepto Mercado Pago")
        partes_desc.append("")
        partes_desc.append("🔹 SOBRE EL PRODUCTO")
        partes_desc.append("=" * 40)
        partes_desc.append(
            "Este artículo ha sido verificado y está listo para su venta. "
            "Cualquier consulta adicional, no dudes en preguntar. "
            "¡Gracias por tu interés!"
        )

        descripcion_final = "\n".join(partes_desc)

        return AdCopy(
            plataforma="mercadolibre",
            titulo=titulo,
            descripcion=descripcion_final,
            precio=precio,
            recomendaciones_imagen=(
                "Múltiples fotos: frontal, trasera, laterales, detalles. "
                "Fondo blanco o neutro. Resolución mínima 500x500px."
            )
        )

    def generar_paquete_anuncios(self, objeto_data: Dict[str, Any]) -> AdPackage:
        """
        Genera un paquete completo de anuncios para todas las plataformas.

        Args:
            objeto_data: Diccionario con los datos del objeto.
                Debe contener al menos: nombre, descripcion, categoria,
                estado_conservacion, valor_estimado.

        Returns:
            AdPackage con los anuncios generados.
        """
        return AdPackage(
            facebook=self.generar_anuncio_facebook(objeto_data),
            instagram=self.generar_anuncio_instagram(objeto_data),
            mercadolibre=self.generar_anuncio_mercadolibre(objeto_data),
            fecha_generacion=timezone.now().isoformat()
        )

    def registrar_publicacion(self, objeto, plataforma: str) -> Dict[str, Any]:
        """
        Registra que un objeto ha sido publicado en una plataforma.

        Args:
            objeto: Instancia del modelo Objeto.
            plataforma: Nombre de la plataforma (facebook, instagram, mercadolibre).

        Returns:
            Dict con el resultado de la operación.
        """
        if plataforma not in ["facebook", "instagram", "mercadolibre"]:
            return {
                "success": False,
                "error": f"Plataforma '{plataforma}' no soportada. "
                         f"Usa: facebook, instagram, mercadolibre"
            }

        # Obtener lista actual de plataformas
        plataformas = list(objeto.plataformas_publicadas or [])

        if plataforma not in plataformas:
            plataformas.append(plataforma)
            objeto.plataformas_publicadas = plataformas
            objeto.save(update_fields=["plataformas_publicadas"])
            logger.info("Objeto '%s' marcado como publicado en %s", objeto.nombre, plataforma)
            return {
                "success": True,
                "message": f"Publicado en {plataforma} correctamente",
                "plataformas": plataformas
            }
        else:
            return {
                "success": True,
                "message": f"Ya estaba publicado en {plataforma}",
                "plataformas": plataformas
            }

    def obtener_estado_publicacion(self, objeto) -> Dict[str, Any]:
        """
        Obtiene el estado de publicación de un objeto.

        Args:
            objeto: Instancia del modelo Objeto.

        Returns:
            Dict con las plataformas y su estado.
        """
        plataformas = list(objeto.plataformas_publicadas or [])
        todas = ["facebook", "instagram", "mercadolibre"]

        return {
            "publicadas": plataformas,
            "pendientes": [p for p in todas if p not in plataformas],
            "completo": len(plataformas) == len(todas)
        }
