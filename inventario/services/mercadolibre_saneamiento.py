"""
Saneamiento de los valores que viajan a la API de Mercado Libre.

Mercado Libre responde HTTP 400 "body.invalid_fields" cuando el body de
POST /items trae campos con tipos o valores que no pertenecen a la
especificación (título con HTML o fuera del rango de 15 a 60 caracteres, precio
en texto o 0, category_id sin formato MLAxxxxx, atributos con IDs inventados,
elementos nulos en "pictures", claves raíz ajenas al recurso como
"family_name" o "description", etc.).

Este módulo centraliza las funciones PURAS de normalización que usa
`mercadolibre_payload.construir_payload_item()` y la vista de publicación:

    limpiar_texto                   → texto plano (sin HTML ni entidades)
    descripcion_publicable          → descripción del endpoint secundario
    normalizar_family_name          → familia raíz del ítem (≤ 60 caracteres)
    family_name_publicable          → familia raíz publicable (nombre o marca)
    recortar_titulo                 → título con corte limpio en 60 caracteres
    tipo_vehiculo_desde_texto       → "Auto" / "Camioneta" / "Moto" ...
    formatear_titulo                → título publicable de 15 a 60 caracteres
    validar_titulo                  → motivo exacto si el título no sirve
    normalizar_precio               → float > 0 con 2 decimales
    normalizar_category_id          → "MLA" + dígitos o "" si no es válido
    normalizar_attributes           → [{"id": ..., "value_name"/"value_id": ...}]
    normalizar_sale_terms           → solo WARRANTY_TYPE / WARRANTY_TIME

No hacen peticiones de red ni tocan la base de datos: son funciones puras y
por eso son fáciles de testear de forma aislada.
"""

import re
import unicodedata

# Límites y valores por defecto de la especificación de POST /items.
TITULO_MIN_ML = 15          # mínimo que exigen las categorías de MLA
TITULO_MAX_ML = 60          # límite duro de la API para el título
FAMILY_NAME_MAX_ML = 60     # límite de ML para family_name (raíz del ítem)
PRECIO_MIN_ML = 0.01        # ML no acepta precio 0 ni negativo
SALE_TERMS_PERMITIDOS = ("WARRANTY_TYPE", "WARRANTY_TIME")

# IDs de atributo que Mercado Libre exige como propiedad de la RAÍZ del body y
# NO dentro de "attributes". En categorías como MLA49337 (GPS) el POST /items
# responde 400 "body.required_fields" pidiendo [family_name] si falta en la raíz;
# enviarlo además como atributo es redundante (y ML puede rechazarlo).
ATRIBUTOS_EN_RAIZ_ML = ("FAMILY_NAME",)

# Condición nativa de ML → palabras que se agregan a un título demasiado corto
# (se contemplan ambas variantes de género para no duplicar "Usado"/"Usada").
CONDICION_TEXTO_ML = {"new": ("Nuevo", "Nueva"), "used": ("Usado", "Usada")}

# Último recurso para llegar al mínimo de 15 caracteres cuando el objeto no
# aporta ningún dato descriptivo (título de 3 letras sin marca, modelo,
# categoría ni condición).
RELLENO_TITULO = ("En venta", "Producto")

# Tipo de vehículo deducible del título o de la categoría del objeto. Se
# comparan PALABRAS completas (singular y plural) para no confundir
# "auto" con "automático".
TIPOS_VEHICULO = (
    ("auto", "Auto"), ("autos", "Auto"),
    ("automovil", "Automóvil"), ("automoviles", "Automóvil"),
    ("camioneta", "Camioneta"), ("camionetas", "Camioneta"),
    ("moto", "Moto"), ("motos", "Moto"),
    ("bicicleta", "Bicicleta"), ("bicicletas", "Bicicleta"),
    ("camion", "Camión"), ("camiones", "Camión"),
    ("utilitario", "Utilitario"), ("utilitarios", "Utilitario"),
)

# Saneamiento de textos e IDs.
_RE_HTML = re.compile(r"<[^>]+>")
_RE_ESPACIOS = re.compile(r"\s+")
_RE_CATEGORIA_ML = re.compile(r"^MLA\d+$")
_RE_ID_ATRIBUTO = re.compile(r"^[A-Z][A-Z0-9_]{1,40}$")
_ENTIDADES_HTML = (
    ("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
    ("&quot;", '"'), ("&#39;", "'"),
)


def limpiar_texto(valor, maximo: int = 0) -> str:
    """
    Texto limpio para la API: sin HTML, sin entidades, sin espacios repetidos.

    Recorta a `maximo` caracteres si se indica (ML rechaza títulos > 60). Es la
    base del saneamiento de `title` y `description`: un título con "<b>" hace
    que la API responda "body.invalid_fields".
    """
    texto = _RE_HTML.sub(" ", str(valor or ""))
    for entidad, reemplazo in _ENTIDADES_HTML:
        texto = texto.replace(entidad, reemplazo)
    texto = texto.strip(" -_·|")
    texto = _RE_ESPACIOS.sub(" ", texto).strip()
    if maximo and len(texto) > maximo:
        texto = texto[:maximo].rstrip()
    return texto


def descripcion_publicable(item_data, title: str = "") -> str:
    """
    Texto plano de la descripción para POST /items/{item_id}/description.

    La API actual de Mercado Libre PROHÍBE enviar la descripción dentro del
    body de POST /items (HTTP 400 "body.invalid_fields"): se crea con una
    segunda llamada, después del 201. Si el objeto no tiene descripción se usa
    el título, porque ML rechaza una descripción vacía.
    """
    origen = item_data if isinstance(item_data, dict) else {}
    return limpiar_texto(origen.get("description")) or limpiar_texto(title)


def normalizar_family_name(valor) -> str:
    """
    `family_name` de la RAÍZ del body: texto plano y truncado a 60 caracteres.

    Mercado Libre lo exige como propiedad DIRECTA del recurso en categorías
    como MLA49337 (GPS): un valor con HTML o de más de 60 caracteres provoca
    HTTP 400 "body.invalid_fields".
    """
    return limpiar_texto(valor, FAMILY_NAME_MAX_ML)


def family_name_publicable(item_data, title: str = "") -> str:
    """
    Valor de `family_name` para la RAÍZ del body de POST /items.

    Mercado Libre lo pide en la raíz ("The body does not contains some or none
    of the following properties [family_name]") y NO como atributo FAMILY_NAME
    dentro de `attributes`. Se usa el dato de identidad REAL del objeto en este
    orden de preferencia:

        family_name → familia → nombre → marca → título

    Para un objeto llamado "GPS Garmin" la familia publicada es "GPS Garmin".
    Siempre texto plano y truncado a 60 caracteres.
    """
    origen = item_data if isinstance(item_data, dict) else {}
    for clave in ("family_name", "familia", "nombre", "marca"):
        valor = normalizar_family_name(origen.get(clave))
        if valor:
            return valor
    return normalizar_family_name(title)


def ampliar_family_name(valor, item_data=None) -> str:
    """
    Amplía `family_name` cuando ML avisa que el título construido es muy corto.

    En categorías de catálogo el título sale de `family_name`: si ML responde
    `item.title.minimum_length` ("Incluí características importantes del
    producto como marca, modelo o categoría") se agregan datos REALES del
    objeto (nombre, marca, modelo, categoría) sin repetir palabras y sin
    superar los 60 caracteres.
    """
    origen = item_data if isinstance(item_data, dict) else {}
    familia = normalizar_family_name(valor)
    if not familia:
        return ""
    for clave in ("nombre", "marca", "modelo", "categoria_nombre"):
        extra = normalizar_family_name(origen.get(clave))
        if not extra or _mencionado(familia, extra):
            continue
        candidato = normalizar_family_name(f"{familia} {extra}")
        if candidato and candidato != familia:
            familia = candidato
        if len(familia) >= TITULO_MIN_ML:
            break
    return familia


# =============================================================================
# TÍTULO PUBLICABLE (15 a 60 caracteres)
# =============================================================================
_RE_NO_ALFANUM = re.compile(r"[^a-z0-9]+")


def _clave(valor) -> str:
    """Texto comparable: minúsculas, sin acentos y sin signos."""
    texto = unicodedata.normalize("NFKD", str(valor or ""))
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return _RE_NO_ALFANUM.sub(" ", texto.lower()).strip()


def _mencionado(texto: str, fragmento: str) -> bool:
    """True si TODAS las palabras del fragmento ya aparecen en el texto."""
    palabras = _clave(fragmento).split()
    if not palabras:
        return True
    presentes = set(_clave(texto).split())
    return all(palabra in presentes for palabra in palabras)


def recortar_titulo(valor) -> str:
    """
    Título en texto plano truncado LIMPIAMENTE en el límite de 60 caracteres.

    Se corta en el último espacio cuando el resultado sigue respetando el
    mínimo de 15; si no, se corta en el límite exacto. Nunca deja espacios
    colgando al final.
    """
    titulo = limpiar_texto(valor)
    if len(titulo) <= TITULO_MAX_ML:
        return titulo
    corte = titulo[:TITULO_MAX_ML]
    if " " in corte:
        candidato = corte.rsplit(" ", 1)[0].rstrip()
        if len(candidato) >= TITULO_MIN_ML:
            return candidato
    return corte.rstrip()


def validar_titulo(valor) -> str:
    """
    Motivo por el que el título NO es publicable, o "" si está dentro del rango.

    Mercado Libre rechaza POST /items con HTTP 400 "body.invalid_fields"
    ("The fields [title] are invalid for requested call") cuando el título no
    tiene entre 15 y 60 caracteres.
    """
    titulo = limpiar_texto(valor)
    if not titulo:
        return "El título es obligatorio para publicar en Mercado Libre."
    if len(titulo) < TITULO_MIN_ML:
        return (
            f"El título debe tener al menos {TITULO_MIN_ML} caracteres "
            f"(tiene {len(titulo)})."
        )
    if len(titulo) > TITULO_MAX_ML:
        return (
            f"El título no puede superar los {TITULO_MAX_ML} caracteres "
            f"(tiene {len(titulo)})."
        )
    return ""


def tipo_vehiculo_desde_texto(*textos) -> str:
    """
    Tipo de vehículo mencionado en los textos ("Auto", "Camioneta", "Moto"...).

    Se usa para completar un título demasiado corto con información REAL del
    objeto o de su categoría ("Accesorios para Autos y Camionetas" → "Auto/
    Camioneta"). Devuelve "" si ninguno de los textos menciona un vehículo.
    """
    palabras = set(_clave(" ".join(str(texto or "") for texto in textos)).split())
    encontrados: list = []
    for aguja, etiqueta in TIPOS_VEHICULO:
        if aguja in palabras and etiqueta not in encontrados:
            encontrados.append(etiqueta)
    return "/".join(encontrados[:2])


def formatear_titulo(
    valor,
    condition: str = "",
    marca: str = "",
    modelo: str = "",
    categoria: str = "",
    tipo_vehiculo: str = "",
) -> str:
    """
    Título publicable de Mercado Libre: entre 15 y 60 caracteres.

    Si el título original ya tiene 15 caracteres o más se devuelve saneado y
    recortado a 60. Si es más corto se completa con información REAL del
    objeto, en este orden: marca, modelo, tipo de vehículo ("Para Auto") y
    nombre de la categoría. La condición ("Usado"/"Nuevo") SIEMPRE se agrega
    en los títulos cortos: es el dato que distingue una publicación usada de
    una nueva.

    - Nunca repite un dato que ya esté en el título ("GPS Garmin" no vuelve a
      agregar "Garmin").
    - El resultado se recorta limpiamente en el límite de 60 caracteres, sin
      cortar palabras a la mitad.
    """
    titulo = recortar_titulo(valor)
    if not titulo or len(titulo) >= TITULO_MIN_ML:
        return titulo

    condiciones = CONDICION_TEXTO_ML.get(str(condition or "").strip().lower(), ())
    vehiculo = limpiar_texto(tipo_vehiculo) or tipo_vehiculo_desde_texto(
        titulo, categoria
    )

    descriptivos = [limpiar_texto(marca), limpiar_texto(modelo)]
    if vehiculo:
        descriptivos.append(f"Para {vehiculo}")
    descriptivos.append(limpiar_texto(categoria))

    for fragmento in descriptivos:
        if len(titulo) >= TITULO_MIN_ML:
            break
        if not fragmento or _mencionado(titulo, fragmento):
            continue
        candidato = f"{titulo} {fragmento}"
        if len(candidato) <= TITULO_MAX_ML:
            titulo = candidato

    if condiciones and not any(_mencionado(titulo, c) for c in condiciones):
        candidato = f"{titulo} {condiciones[0]}"
        if len(candidato) <= TITULO_MAX_ML:
            titulo = candidato

    for relleno in RELLENO_TITULO:
        if len(titulo) >= TITULO_MIN_ML:
            break
        candidato = f"{titulo} {relleno}"
        if len(candidato) <= TITULO_MAX_ML:
            titulo = candidato

    return recortar_titulo(titulo)


def normalizar_precio(valor) -> float:
    """
    `price` como float positivo con 2 decimales.

    Acepta "1.234,56" / "1234.56". Lanza ValueError si no es numérico o si es
    <= 0: Mercado Libre no acepta precio 0 y no se inventa un precio.
    """
    if isinstance(valor, str):
        crudo = valor.strip().replace(" ", "")
        if "," in crudo and "." in crudo:
            crudo = crudo.replace(".", "").replace(",", ".")
        else:
            crudo = crudo.replace(",", ".")
        valor = crudo
    try:
        precio = float(valor)
    except (TypeError, ValueError):
        raise ValueError("El precio debe ser un número válido.")
    if precio < PRECIO_MIN_ML:
        raise ValueError("El precio debe ser mayor a 0 para publicar en Mercado Libre.")
    return round(precio, 2)


def normalizar_category_id(valor) -> str:
    """
    ID de categoría MLA en formato oficial (MLA + dígitos) o "" si no sirve.

    Un ID con otro formato (o vacío) hace que ML responda "body.invalid_fields".
    """
    limpio = str(valor or "").strip().upper()
    return limpio if _RE_CATEGORIA_ML.match(limpio) else ""


def normalizar_attributes(attributes) -> list:
    """
    Atributos en el formato exacto de ML: [{"id": "BRAND", "value_name": "..."}].

    Descarta entradas sin id válido, sin valor o con IDs inventados: los IDs del
    catálogo de Mercado Libre vienen SIEMPRE en MAYÚSCULAS, así que una clave en
    minúsculas (ej: "family_name" escrita a mano) no es un atributo del catálogo
    y se descarta en vez de "legitimarla" convirtiéndola. Nunca envía
    value_name junto a value_id (ML rechaza combinaciones inválidas).

    Los IDs de ATRIBUTOS_EN_RAIZ_ML (FAMILY_NAME) tampoco se envían acá: ML los
    exige como propiedad de la RAÍZ del body, no dentro de "attributes".
    """
    normalizados: list = []
    vistos: set = set()
    for atributo in attributes or []:
        if not isinstance(atributo, dict):
            continue
        crudo = str(atributo.get("id") or "").strip()
        aid = crudo.upper()
        if (
            not crudo
            or crudo != aid
            or aid in vistos
            or aid in ATRIBUTOS_EN_RAIZ_ML
            or not _RE_ID_ATRIBUTO.match(aid)
        ):
            continue
        value_id = str(atributo.get("value_id") or "").strip()
        value_name = str(atributo.get("value_name") or "").strip()
        entrada = {"id": aid}
        if value_id:
            entrada["value_id"] = value_id
        elif value_name:
            entrada["value_name"] = value_name
        else:
            continue
        vistos.add(aid)
        normalizados.append(entrada)
    return normalizados


def normalizar_sale_terms(sale_terms) -> list:
    """
    Términos de venta válidos (WARRANTY_TYPE / WARRANTY_TIME).

    Si no vienen o no son válidos se devuelve [] y la clave `sale_terms` no se
    envía: Mercado Libre rechaza términos fuera de catálogo.
    """
    terminos: list = []
    for termino in sale_terms or []:
        if not isinstance(termino, dict):
            continue
        tid = str(termino.get("id") or "").strip().upper()
        value_name = str(termino.get("value_name") or "").strip()
        if tid in SALE_TERMS_PERMITIDOS and value_name:
            terminos.append({"id": tid, "value_name": value_name[:60]})
    return terminos
