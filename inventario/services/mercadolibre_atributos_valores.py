"""
Resolución de VALORES para los atributos de Mercado Libre (100% dinámica).

Mercado Libre valida cada atributo según su `value_type` y su catálogo:

    value_type "list" / "list_of_values"  → exige un `value_id` del catálogo
                                            (enviar texto libre produce HTTP 400
                                            "body.invalid_fields").
    value_type "boolean"                  → acepta "Sí" / "No" (o su value_id).
    value_type "number" / "integer"       → exige un número.
    value_type "number_unit"              → exige número + unidad
                                            (`allowed_units` / `default_unit`).
    value_type "string"                   → acepta texto (`value_name`).

Enviar "Genérico" en un atributo de lista es lo que generaba el bucle
`body.required_fields` → `body.invalid_fields` → `body.required_fields`.

Este módulo NO hace peticiones de red: recibe la definición del atributo
(GET /categories/{id}/attributes) y los datos REALES del objeto Estok, y
devuelve el valor con la estructura exacta que acepta la API:

    {"id": "COLOR", "value_id": "52049", "value_name": "Negro"}
    {"id": "FAMILY_NAME", "value_name": "Samsung"}

Usado por:
- inventario/services/mercadolibre_atributos.py
"""

import re
import unicodedata
from typing import Any, Dict, List, Optional

# Valor genérico para atributos de texto libre sin dato cargado.
VALOR_GENERICO = "Genérico"
# Valor por defecto de marca: ML acepta texto libre y "Sin marca" es explícito.
VALOR_MARCA = "Sin marca"

# Atributo → (valor por defecto, campos REALES del objeto en orden de preferencia).
# Los IDs son los del catálogo de Mercado Libre (siempre en MAYÚSCULAS).
ATRIBUTOS_OBJETO = {
    "BRAND": (VALOR_MARCA, ("marca", "artista_fabricante")),
    "MANUFACTURER": (VALOR_MARCA, ("marca", "artista_fabricante")),
    "FAMILY_NAME": (VALOR_GENERICO, ("familia", "marca", "nombre", "categoria")),
    "MODEL": ("Sin especificar", ("modelo", "numero_serie")),
    "MODEL_NAME": ("Sin especificar", ("modelo",)),
    "LINE": ("Genérica", ("marca", "linea")),
    "PART_NUMBER": ("Sin especificar", ("modelo", "numero_serie")),
    "MPN": ("Sin especificar", ("modelo", "numero_serie")),
    "PRODUCT_NAME": ("Producto", ("nombre", "titulo")),
    "ITEM_NAME": ("Producto", ("nombre", "titulo")),
    "TITLE": ("Producto", ("titulo", "nombre")),
    "COLOR": (VALOR_GENERICO, ("color",)),
    "SIZE": ("Sin especificar", ("tamano",)),
    "MATERIAL": (VALOR_GENERICO, ("material",)),
    "LANGUAGE": ("Sin especificar", ("idioma",)),
    "EDITORIAL": ("Sin especificar", ("editorial",)),
    "WEIGHT": ("Sin especificar", ("peso",)),
}

# Opciones neutras aceptables en atributos de lista (value_type = "list").
OPCIONES_NEUTRAS = (
    "otro", "otra", "otros", "otras", "no aplica", "no corresponde",
    "sin marca", "generico", "genérico", "generica", "genérica",
    "universal", "estandar", "estándar", "sin especificar",
)

# Tipos de ML que SOLO aceptan valores del catálogo (value_id).
TIPOS_LISTA = ("list", "list_of_values")
# Tipos numéricos que no admiten texto.
TIPOS_NUMERICOS = ("number", "integer", "decimal")

# Palabras técnicas de los IDs de ML que no aportan a la comparación con las
# claves libres de `especificaciones` (IS_DUAL_SIM → dual_sim, WITH_FREEZER).
_PALABRAS_VACIAS = ("is", "with", "has", "tiene")

_RE_NO_ALFANUM = re.compile(r"[^a-z0-9]+")


def normalizar_id(valor) -> str:
    """ID de atributo normalizado (mayúsculas, sin espacios)."""
    return str(valor or "").strip().upper()


def _clave(valor) -> str:
    """Texto comparable: minúsculas, sin acentos ni signos."""
    texto = unicodedata.normalize("NFKD", str(valor or ""))
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return _RE_NO_ALFANUM.sub(" ", texto.lower()).strip()


def construir_datos_objeto(item_data: Optional[Dict[str, Any]] = None,
                           titulo: str = "") -> Dict[str, Any]:
    """
    Datos REALES del objeto listos para resolver atributos de ML.

    Une los campos planos del objeto (marca, modelo, material, tamano, idioma,
    editorial, numero_serie, artista_fabricante, peso) con `especificaciones`
    (JSON flexible) y deriva `nombre`, `titulo`, `categoria` y `familia`.
    """
    origen = dict(item_data or {})
    nombre = str(origen.get("nombre") or "").strip()
    titulo = str(
        titulo or origen.get("title") or origen.get("titulo") or nombre
    ).strip()
    categoria = str(
        origen.get("categoria_nombre") or origen.get("categoria") or ""
    ).strip()
    marca = str(origen.get("marca") or "").strip()
    especificaciones = origen.get("especificaciones")
    if not isinstance(especificaciones, dict):
        especificaciones = {}

    datos: Dict[str, Any] = {
        "marca": marca,
        "modelo": str(origen.get("modelo") or "").strip(),
        "nombre": nombre or titulo,
        "titulo": titulo,
        "categoria": categoria,
        "material": str(origen.get("material") or "").strip(),
        "tamano": str(origen.get("tamano") or "").strip(),
        "idioma": str(origen.get("idioma") or "").strip(),
        "editorial": str(origen.get("editorial") or "").strip(),
        "numero_serie": str(origen.get("numero_serie") or "").strip(),
        "artista_fabricante": str(origen.get("artista_fabricante") or "").strip(),
        "peso": str(origen.get("peso") or "").strip(),
        "especificaciones": especificaciones,
    }
    # Familia del producto: marca real; si no hay, nombre o categoría Estok.
    datos["familia"] = marca or datos["nombre"] or categoria
    return datos


def _variantes(clave: str) -> set:
    """
    Variantes comparables de una clave de atributo.

    Permite que `especificaciones` guardadas por la IA ("dual_sim", "freezer")
    alimenten atributos del catálogo con prefijos técnicos (IS_DUAL_SIM,
    WITH_FREEZER).
    """
    variantes = {clave}
    tokens = [t for t in clave.split() if t not in _PALABRAS_VACIAS]
    if tokens:
        variantes.add(" ".join(tokens))
    return variantes


def _dato_desde_especificaciones(atributo: dict, datos: dict) -> str:
    """
    Valor del atributo cargado en `especificaciones` (JSON del objeto).

    Acepta la clave por ID (`BRAND`), por nombre (`Marca`) o en minúsculas
    (`brand` / `marca`), que es como la IA suele guardar los datos técnicos.
    """
    especificaciones = datos.get("especificaciones")
    if not isinstance(especificaciones, dict) or not especificaciones:
        return ""
    buscadas: set = set()
    for referencia in (atributo.get("id"), atributo.get("name")):
        buscadas.update(_variantes(_clave(referencia)))
    buscadas.discard("")
    for clave, valor in especificaciones.items():
        if isinstance(valor, (dict, list)) or valor in (None, ""):
            continue
        if buscadas.intersection(_variantes(_clave(clave))):
            return str(valor).strip()
    return ""


def dato_para_atributo(atributo: dict, datos: Optional[dict] = None) -> str:
    """
    Dato REAL del objeto para un atributo del catálogo ("" si no hay).

    Primero busca en los campos mapeados (marca, modelo, color, talle...) y
    después en `especificaciones`, para no inventar valores cuando el objeto
    ya trae el dato cargado.
    """
    datos = datos or {}
    aid = normalizar_id(atributo.get("id"))

    for fuente in (ATRIBUTOS_OBJETO.get(aid) or (None, ()))[1]:
        valor = str(datos.get(fuente) or "").strip()
        if valor:
            return valor

    return _dato_desde_especificaciones(atributo, datos)


def _opciones(atributo: dict) -> List[dict]:
    """Opciones válidas del catálogo: [{"value_id": ..., "value_name": ...}]."""
    opciones: List[dict] = []
    for opcion in atributo.get("values") or []:
        if not isinstance(opcion, dict):
            continue
        valor_id = str(opcion.get("id") or "").strip()
        if not valor_id:
            continue
        opciones.append({
            "value_id": valor_id,
            "value_name": str(opcion.get("name") or valor_id).strip(),
        })
    return opciones


def _opcion_neutra(opciones: List[dict]) -> Optional[dict]:
    """Primera opción neutra del catálogo ("Otro", "No aplica"...), o None."""
    for opcion in opciones:
        if (
            _clave(opcion["value_name"]) in OPCIONES_NEUTRAS
            or _clave(opcion["value_id"]) in OPCIONES_NEUTRAS
        ):
            return opcion
    return None


def _coincidencia(opciones: List[dict], valor) -> Optional[dict]:
    """Opción del catálogo que coincide con el valor real del objeto."""
    buscada = _clave(valor)
    if not buscada:
        return None
    for opcion in opciones:
        if buscada in (_clave(opcion["value_name"]), _clave(opcion["value_id"])):
            return opcion
    return None


def _recortar(texto: str, atributo: dict) -> str:
    """Recorta al `value_max_length` que informa Mercado Libre."""
    try:
        maximo = int(atributo.get("value_max_length") or 0)
    except (TypeError, ValueError):
        maximo = 0
    if maximo and len(texto) > maximo:
        return texto[:maximo].rstrip()
    return texto


def valor_por_defecto(atributo_id: str, datos: Optional[dict] = None) -> str:
    """Valor por defecto de un atributo del mapa de identidad."""
    defecto, fuentes = ATRIBUTOS_OBJETO.get(
        normalizar_id(atributo_id), (VALOR_GENERICO, ())
    )
    datos = datos or {}
    for fuente in fuentes:
        valor = str(datos.get(fuente) or "").strip()
        if valor:
            return valor
    return defecto


def valor_para_atributo(
    atributo: dict,
    datos: Optional[dict] = None,
    preferir_catalogo: bool = False,
) -> Optional[dict]:
    """
    Construye el valor de UN atributo con la estructura exacta de ML.

    - Catálogo con opciones → `value_id` + `value_name` de la opción elegida
      (se prefiere el dato real del objeto; si no coincide, una opción neutra;
      si no existe, la PRIMERA opción del catálogo).
    - Booleano sin opciones → "No".
    - Numérico sin opciones → "1".
    - Número + unidad → "1 <default_unit>" (o la primera unidad permitida).
    - Texto → dato real del objeto o el valor por defecto (`Sin marca`,
      `Genérico`, `Sin especificar`, ...).

    `preferir_catalogo=True` se usa al CORREGIR un atributo que ML ya rechazó:
    en atributos de texto libre ignora el dato real y usa el valor por defecto
    del catálogo/identidad. En atributos con opciones siempre se intenta el dato
    real dentro del catálogo, luego una opción neutra y por último la primera.

    Devuelve None si no existe un valor seguro (ej: lista sin opciones).
    """
    aid = normalizar_id((atributo or {}).get("id"))
    if not aid:
        return None

    datos = datos or {}
    tipo = str(atributo.get("value_type") or "").strip().lower()
    opciones = _opciones(atributo)

    if opciones:
        # Siempre se intenta el dato REAL del objeto dentro del catálogo; si no
        # coincide se usa una opción neutra y, como último recurso, la primera.
        elegida = _coincidencia(opciones, dato_para_atributo(atributo, datos))
        elegida = elegida or _opcion_neutra(opciones) or opciones[0]
        return {"id": aid, **elegida}

    if tipo in TIPOS_LISTA:
        # Lista sin opciones publicadas: no hay valor válido que enviar.
        return None

    if tipo == "boolean":
        return {"id": aid, "value_name": "No"}

    if tipo in TIPOS_NUMERICOS:
        return {"id": aid, "value_name": "1"}

    if tipo == "number_unit":
        unidad = str(atributo.get("default_unit") or "").strip()
        if not unidad:
            unidades = atributo.get("allowed_units") or []
            if unidades and isinstance(unidades[0], dict):
                unidad = str(
                    unidades[0].get("id") or unidades[0].get("name") or ""
                ).strip()
        return {"id": aid, "value_name": f"1 {unidad}".strip()}

    texto = ""
    if not preferir_catalogo:
        texto = dato_para_atributo(atributo, datos)
    texto = _recortar(texto or valor_por_defecto(aid, datos), atributo)
    if not texto:
        return None
    return {"id": aid, "value_name": texto}


