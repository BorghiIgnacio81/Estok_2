"""
RE-VINCULACIÓN AUTOMÁTICA DE DUEÑOS Y BENEFICIARIOS EN LA MUDANZA INTER-ESTOK.

CONTEXTO
  El alta y la edición de objetos exigen que `dueno_original` y `beneficiario`
  sean MIEMBROS del Estok del espacio (ver `api/serializers/objeto_espacio.py`,
  `_validar_miembro`). Cuando un objeto se muda a otro Estok, esas FK quedan
  apuntando a cuentas que NO pertenecen al inquilinato destino: la trazabilidad
  patrimonial se rompe y el operador tiene que reasignar a mano.

REGLA ÚNICA
  Al cerrar la mudanza se revisa cada objeto transferido y se enlaza su
  dueño/beneficiario con la cuenta equivalente del Estok destino:

    1. DUEÑO EXTERNO SIN CUENTA (`dueno_externo_nombre`, texto plano): si el
       nombre coincide con el email, el usuario, el alias del Estok o el nombre
       completo de UN miembro del destino, se completa la FK `dueno_original`.
       (Es una mejora puramente aditiva: el campo estaba vacío.)
    2. FK APUNTANDO A UNA CUENTA AJENA AL DESTINO: si en el Estok destino hay
       una cuenta con la misma identidad (email / usuario / nombre completo), la
       FK `dueno_original` o `beneficiario` se re-ancla a esa cuenta.

  La comparación es NORMALIZADA (minúsculas, sin acentos, sin espacios dobles) y
  NUNCA adivina cuando dos miembros comparten la misma clave: esas claves se
  descartan del índice y el objeto conserva su valor anterior. El nombre plano
  de `dueno_externo_nombre` NO se borra: queda como rastro documental.

Este módulo no conoce vistas ni tableros. `revincular_propietarios()` corre
dentro de la misma transacción atómica de la mudanza y devuelve un resumen que
el servicio usa para informar el resultado al operador.
"""

import unicodedata

from ..models import CustomUser, Membresia, Objeto


def normalizar_identidad(texto):
    """
    Clave comparable de un nombre/email: minúsculas, sin acentos ni espacios
    repetidos. Devuelve '' cuando no hay texto útil.
    """
    crudo = str(texto or '').strip()
    if not crudo:
        return ''
    descompuesto = unicodedata.normalize('NFKD', crudo)
    sin_acentos = ''.join(c for c in descompuesto if not unicodedata.combining(c))
    return ' '.join(sin_acentos.casefold().split())


def _claves_de_usuario(usuario, estok_id=None):
    """
    Identidades comparables de un usuario: email, usuario, nombre completo y el
    alias que ese miembro usa dentro del Estok destino (si lo definió).
    """
    claves = set()
    valores = (
        usuario.email,
        usuario.username,
        usuario.get_full_name(),
        f'{usuario.first_name} {usuario.last_name}',
    )
    for valor in valores:
        clave = normalizar_identidad(valor)
        if clave:
            claves.add(clave)
    if estok_id is not None:
        alias = normalizar_identidad(
            (usuario.alias_por_estok or {}).get(str(estok_id))
        )
        if alias:
            claves.add(alias)
    return claves


def _indice_de_miembros(estok_destino):
    """
    Devuelve `(indice, ids_miembros)` del Estok destino.

    `indice` mapea clave normalizada → id de usuario. Las claves AMBIGUAS (dos
    miembros distintos con el mismo nombre) se eliminan: ante la duda no se
    re-vincula nada. `ids_miembros` es el conjunto de usuarios ya presentes en
    el inquilinato, que no necesitan ninguna corrección.
    """
    indice = {}
    ambiguas = set()
    ids_miembros = set()
    membresias = Membresia.objects.filter(estok=estok_destino).select_related('usuario')
    for membresia in membresias:
        usuario = membresia.usuario
        ids_miembros.add(usuario.id)
        for clave in _claves_de_usuario(usuario, estok_destino.id):
            if clave in indice and indice[clave] != usuario.id:
                ambiguas.add(clave)
            indice.setdefault(clave, usuario.id)
    for clave in ambiguas:
        indice.pop(clave, None)
    return indice, ids_miembros


def _sustitutos_por_identidad(ids_usuarios, indice):
    """
    `{usuario_actual_id: usuario_destino_id}` para las cuentas que ya no
    pertenecen al Estok destino pero tienen una cuenta homónima adentro.
    """
    sustitutos = {}
    if not ids_usuarios:
        return sustitutos
    for usuario in CustomUser.objects.filter(id__in=ids_usuarios):
        for clave in _claves_de_usuario(usuario):
            destino = indice.get(clave)
            if destino and str(destino) != str(usuario.id):
                sustitutos[usuario.id] = destino
                break
    return sustitutos


def revincular_propietarios(estok_destino, objetos):
    """
    Re-vincula dueños y beneficiarios de los objetos YA mudados al Estok destino.

    `objetos` es un QuerySet (o cualquier iterable) de `Objeto`: sólo se leen
    `id`, `dueno_original_id`, `dueno_externo_nombre` y `beneficiario_id`, y las
    escrituras se agrupan por cuenta para no hacer un UPDATE por objeto.

    Devuelve `{'duenos': n, 'beneficiarios': n, 'objetos': n}`.
    """
    resumen = {'duenos': 0, 'beneficiarios': 0, 'objetos': 0}
    indice, ids_miembros = _indice_de_miembros(estok_destino)
    if not indice:
        return resumen

    if hasattr(objetos, 'values'):
        filas = list(objetos.values(
            'id', 'dueno_original_id', 'dueno_externo_nombre', 'beneficiario_id',
        ))
    else:
        filas = [{
            'id': obj.id,
            'dueno_original_id': obj.dueno_original_id,
            'dueno_externo_nombre': obj.dueno_externo_nombre,
            'beneficiario_id': obj.beneficiario_id,
        } for obj in objetos]
    if not filas:
        return resumen

    # Cuentas referenciadas que NO son miembros del destino: son las únicas que
    # pueden necesitar un reemplazo por una cuenta homónima del inquilinato.
    ids_fk = {f['dueno_original_id'] for f in filas if f['dueno_original_id']}
    ids_fk |= {f['beneficiario_id'] for f in filas if f['beneficiario_id']}
    sustitutos = _sustitutos_por_identidad(ids_fk - ids_miembros, indice)

    por_dueno = {}
    por_beneficiario = {}
    tocados = set()
    for fila in filas:
        if fila['dueno_original_id']:
            nuevo_dueno = sustitutos.get(fila['dueno_original_id'])
        else:
            # Dueño externo (texto plano) que coincide con un miembro del
            # destino: se materializa la FK que antes no existía.
            nuevo_dueno = indice.get(
                normalizar_identidad(fila['dueno_externo_nombre'])
            )
        if nuevo_dueno and str(nuevo_dueno) != str(fila['dueno_original_id'] or ''):
            por_dueno.setdefault(nuevo_dueno, []).append(fila['id'])
            tocados.add(fila['id'])

        nuevo_beneficiario = (
            sustitutos.get(fila['beneficiario_id'])
            if fila['beneficiario_id'] else None
        )
        if nuevo_beneficiario and str(nuevo_beneficiario) != str(fila['beneficiario_id']):
            por_beneficiario.setdefault(nuevo_beneficiario, []).append(fila['id'])
            tocados.add(fila['id'])

    for usuario_id, ids in por_dueno.items():
        resumen['duenos'] += Objeto.objects.filter(id__in=ids).update(
            dueno_original_id=usuario_id,
        )
    for usuario_id, ids in por_beneficiario.items():
        resumen['beneficiarios'] += Objeto.objects.filter(id__in=ids).update(
            beneficiario_id=usuario_id,
        )
    resumen['objetos'] = len(tocados)
    return resumen


def aviso_revinculacion(resumen):
    """
    Texto humano del resultado de la re-vinculación ('' cuando no hubo cambios).
    El tablero lo muestra dentro del aviso de mudanza completada.
    """
    if not resumen:
        return ''
    partes = []
    if resumen.get('duenos'):
        partes.append(f"{resumen['duenos']} dueño(s)")
    if resumen.get('beneficiarios'):
        partes.append(f"{resumen['beneficiarios']} beneficiario(s)")
    if not partes:
        return ''
    return (
        f" Se re-vincularon {resumen.get('objetos', 0)} objeto(s) a cuentas del "
        f"Estok destino ({' y '.join(partes)})."
    )
