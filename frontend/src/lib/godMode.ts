// =============================================================================
// ADMIN GLOBAL - Lógica del Panel de Control global (exclusivo ygumy44)
//
// El panel se integra EN el Dashboard principal (index.astro): el HTML vive en
// index.astro y esta función solo lo inicializa cuando el usuario cacheado es
// estrictamente 'ygumy44'. Consume los endpoints globales de auditoría:
//   - /api/admin/usuarios/  (CRUD global de CustomUser)
//   - /api/admin/estoks/    (CRUD global de Estok con contadores)
//   - /api/usuarios/{id}/asignar-estok/ y /remover-estok/ (vinculación)
//
// Regla de negocio: el botón "Admin Global" del navbar (BaseLayout) SOLO se
// muestra si el usuario es 'ygumy44', y este panel se abre/cierra con él.
// El backend además devuelve 403 para cualquier otra persona.
// =============================================================================

import { getCachedUser } from '../services/auth';
import { apiPost, apiPut, apiDelete, fetchAllPages } from './api';

// =============================================================================
// Estado global del módulo
// =============================================================================

let godPanel: HTMLElement | null = null;
let godLoading: HTMLElement | null = null;
let godError: HTMLElement | null = null;
let godSuccess: HTMLElement | null = null;
let godUsuariosTbody: HTMLElement | null = null;
let godEstoksTbody: HTMLElement | null = null;
let godModalUsuario: HTMLElement | null = null;
let godModalEstok: HTMLElement | null = null;
let godModalUsuarioEditar: HTMLElement | null = null;
let godModalEstokEditar: HTMLElement | null = null;
let godEditandoUserId: string | null = null;
let godEditandoEstokId: string | null = null;

let godUsuarios: any[] = [];
let godEstoks: any[] = [];

// =============================================================================
// Helpers de UI
// =============================================================================

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function godMostrarLoading(activo: boolean): void {
  if (!godLoading) return;
  if (activo) godLoading.classList.remove('hidden');
  else godLoading.classList.add('hidden');
}

function godMostrarError(msg: string): void {
  if (!godError) return;
  godError.textContent = msg;
  godError.classList.remove('hidden');
  window.setTimeout(() => godError?.classList.add('hidden'), 5000);
}

function godMostrarExito(msg: string): void {
  if (!godSuccess) return;
  godSuccess.textContent = msg;
  godSuccess.classList.remove('hidden');
  window.setTimeout(() => godSuccess?.classList.add('hidden'), 5000);
}

// =============================================================================
// Carga global: usuarios + estoks (con fallbacks [] para BD virgen)
// =============================================================================

async function godCargarTodo(): Promise<void> {
  godMostrarLoading(true);
  try {
    const [usuarios, estoks] = await Promise.all([
      fetchAllPages<any>('/admin/usuarios/'),
      fetchAllPages<any>('/admin/estoks/'),
    ]);
    godUsuarios = usuarios || [];
    godEstoks = estoks || [];
    godRenderUsuarios();
    godRenderEstoks();
    godMostrarLoading(false);
  } catch (err: any) {
    godMostrarLoading(false);
    godMostrarError(
      err?.status === 403
        ? '⛔ 403 Forbidden: solo ygumy44 puede usar este panel.'
        : (err?.error || 'Error al cargar los datos globales.')
    );
  }
}

// =============================================================================
// Render: tabla de usuarios (Usuario | Email | Estoks Conectados | Acciones)
// =============================================================================

function godRenderUsuarios(): void {
  if (!godUsuariosTbody) return;

  if (godUsuarios.length === 0) {
    godUsuariosTbody.innerHTML =
      '<tr><td colspan="4" class="px-3 py-6 text-center text-sm text-gray-400">No hay usuarios registrados.</td></tr>';
    return;
  }

  godUsuariosTbody.innerHTML = godUsuarios.map((u: any) => {
    const displayName = u.display_name || u.username || '?';
    const esYgumy = u.username === 'ygumy44';
    const membresias: any[] = Array.isArray(u.membresias) ? u.membresias : [];

    // Badges de Estoks conectados (con botón × para desvincular)
    const badgesHtml = membresias.length > 0
      ? `<div class="flex flex-wrap gap-1">
          ${membresias.map((m: any) => `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-full text-[11px]">
              ${esc(m.estok_nombre || '?')}
              ${m.role_nombre ? `<span class="text-blue-400">(${esc(m.role_nombre)})</span>` : ''}
              ${esYgumy ? '' : `<button data-god-unlink data-uid="${u.id}" data-estok-id="${m.estok_id}" data-estok-nombre="${esc(m.estok_nombre || '')}" class="godUnlinkBtn text-red-400 hover:text-red-600 ml-0.5 font-bold" title="Quitar de este Estok">×</button>`}
            </span>`).join('')}
        </div>`
      : '<span class="text-xs text-gray-400">Sin Estok asignado</span>';

    // Selector de Estok para vincular (solo los que aún no tiene)
    const disponibles = godEstoks.filter(
      (e: any) => !membresias.some((m: any) => m.estok_id === e.id)
    );
    const asignarHtml = (!esYgumy && disponibles.length > 0)
      ? `<div class="flex items-center gap-1">
          <select data-god-asignar-select data-uid="${u.id}" class="text-[11px] px-1.5 py-1 border border-gray-300 rounded-md bg-white text-gray-700 max-w-[130px]">
            ${disponibles.map((e: any) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}
          </select>
          <button data-god-asignar data-uid="${u.id}" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium rounded-md transition-base shadow-sm" title="Vincular usuario a este Estok">Asociar</button>
        </div>`
      : '';

    // Botón Editar
    const editBtn = `<button data-god-edit-user data-uid="${u.id}" data-username="${esc(u.username)}" class="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-medium rounded-md hover:bg-amber-200 transition-base" title="Editar usuario">✏️ Editar</button>`;

    // Botón Eliminar (desactivación lógica)
    const deleteBtn = esYgumy
      ? '<span class="text-[11px] text-gray-400 italic">Tú</span>'
      : `<button data-god-delete-user data-uid="${u.id}" data-user="${esc(displayName)}" data-username="${esc(u.username)}" class="px-2.5 py-1 bg-red-100 text-red-700 text-[11px] font-medium rounded-md hover:bg-red-200 transition-base" title="Desactivar usuario">❌ Eliminar</button>`;

    return `
      <tr>
        <td class="px-3 py-3">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-700 flex-shrink-0">${esc((displayName.charAt(0) || '?').toUpperCase())}</div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-900 truncate">${esc(displayName)}</p>
              <p class="text-xs text-gray-500">@${esc(u.username)}</p>
            </div>
          </div>
        </td>
        <td class="px-3 py-3 text-xs text-gray-600">${esc(u.email || '—')}</td>
        <td class="px-3 py-3">${badgesHtml}</td>
        <td class="px-3 py-3">
          <div class="flex items-center justify-end gap-1.5 flex-wrap">${editBtn}${asignarHtml}${deleteBtn}</div>
        </td>
      </tr>`;
  }).join('');
}

// =============================================================================
// Render: tabla de Estoks (Nombre | Usuarios | Objetos | Ubicaciones | Contenedores | Acciones)
// =============================================================================

function godRenderEstoks(): void {
  if (!godEstoksTbody) return;

  if (godEstoks.length === 0) {
    godEstoksTbody.innerHTML =
      '<tr><td colspan="6" class="px-3 py-6 text-center text-sm text-gray-400">No hay Estoks creados.</td></tr>';
    return;
  }

  godEstoksTbody.innerHTML = godEstoks.map((e: any) => {
    const miembros: any[] = Array.isArray(e.miembros) ? e.miembros : [];

    // Selector de usuarios para añadir (solo los que aún no son miembros)
    const noMiembros = godUsuarios.filter(
      (u: any) => !miembros.some((m: any) => m.usuario_id === u.id)
    );
    const addUserHtml = noMiembros.length > 0
      ? `<div class="flex items-center gap-1">
          <select data-god-adduser-select data-estok="${e.id}" class="text-[11px] px-1.5 py-1 border border-gray-300 rounded-md bg-white text-gray-700 max-w-[130px]">
            ${noMiembros.map((u: any) => `<option value="${u.id}">@${esc(u.username)}</option>`).join('')}
          </select>
          <button data-god-adduser data-estok="${e.id}" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium rounded-md transition-base shadow-sm" title="Añadir usuario a este Estok">Añadir</button>
        </div>`
      : '<span class="text-[11px] text-gray-400">—</span>';

    return `
      <tr>
        <td class="px-3 py-3">
          <p class="text-sm font-medium text-gray-900 truncate">${esc(e.nombre)}</p>
          ${e.descripcion ? `<p class="text-xs text-gray-400 truncate max-w-[180px]">${esc(e.descripcion)}</p>` : ''}
        </td>
        <td class="px-3 py-3 text-center text-sm text-gray-700">${e.miembros_count ?? 0}</td>
        <td class="px-3 py-3 text-center text-sm text-gray-700">${e.objetos_count ?? 0}</td>
        <td class="px-3 py-3 text-center text-sm text-gray-700">${e.ubicaciones_count ?? 0}</td>
        <td class="px-3 py-3 text-center text-sm text-gray-700">${e.contenedores_count ?? 0}</td>
        <td class="px-3 py-3">
          <div class="flex items-center justify-end gap-1.5 flex-wrap">
            ${addUserHtml}
            <button data-god-edit-estok data-id="${e.id}" data-nombre="${esc(e.nombre)}" class="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-medium rounded-md hover:bg-amber-200 transition-base" title="Editar Estok">✏️ Editar</button>
            <button data-god-delete-estok data-id="${e.id}" data-nombre="${esc(e.nombre)}" class="px-2.5 py-1 bg-red-100 text-red-700 text-[11px] font-medium rounded-md hover:bg-red-200 transition-base" title="Borrar Estok en cascada">❌ Eliminar</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// =============================================================================
// Acciones CRUD
// =============================================================================

async function godVincular(uid: string, estokId: string): Promise<void> {
  try {
    await apiPost(`/usuarios/${uid}/asignar-estok/`, { estok_id: estokId, role_id: null });
    godMostrarExito('✅ Usuario vinculado al Estok');
    await godCargarTodo();
  } catch (err: any) {
    godMostrarError(err?.error || 'Error al vincular el usuario al Estok.');
  }
}

async function godDesvincular(uid: string, estokId: string, estokNombre: string): Promise<void> {
  if (!confirm(`¿Quitar al usuario del Estok "${estokNombre}"?`)) return;
  try {
    const ok = await apiDelete(`/usuarios/${uid}/remover-estok/?estok_id=${estokId}`);
    if (!ok) throw new Error('El servidor rechazó la operación.');
    godMostrarExito('✅ Membresía removida');
    await godCargarTodo();
  } catch (err: any) {
    godMostrarError(err?.error || 'Error al remover la membresía.');
  }
}

async function godDesactivarUsuario(uid: string, display: string, username: string): Promise<void> {
  if (!confirm(`⚠️ ¿Desactivar al usuario "${display}" (@${username})?\n\nPerderá el acceso a la plataforma.`)) return;
  try {
    const ok = await apiDelete(`/admin/usuarios/${uid}/`);
    if (!ok) throw new Error('El servidor rechazó la operación.');
    godMostrarExito(`🚫 Usuario "${display}" desactivado`);
    await godCargarTodo();
  } catch (err: any) {
    godMostrarError(err?.error || 'Error al desactivar el usuario.');
  }
}

async function godEliminarEstok(id: string, nombre: string): Promise<void> {
  if (!confirm(`⚠️ ¿Estás SEGURO de borrar el Estok "${nombre}"?\n\nEsta acción eliminará FÍSICAMENTE el Estok y TODOS sus datos asociados (objetos, ubicaciones, contenedores, membresías).\n\nNO SE PUEDE DESHACER.`)) return;
  if (!confirm(`CONFIRMACIÓN FINAL:\n¿Borrar permanentemente "${nombre}" en cascada?`)) return;
  try {
    const ok = await apiDelete(`/admin/estoks/${id}/`);
    if (!ok) throw new Error('El servidor rechazó la operación.');
    godMostrarExito(`🗑️ Estok "${nombre}" borrado`);
    await godCargarTodo();
  } catch (err: any) {
    godMostrarError(err?.error || 'Error al borrar el Estok.');
  }
}

// =============================================================================
// Modales: crear usuario y crear Estok
// =============================================================================

function godAbrirModalUsuario(): void {
  godModalUsuario?.classList.remove('hidden');
}

function godCerrarModalUsuario(): void {
  godModalUsuario?.classList.add('hidden');
  const f = document.getElementById('godFormUsuario') as HTMLFormElement | null;
  f?.reset();
  document.getElementById('godFormUsuarioError')?.classList.add('hidden');
}

function godAbrirModalEstok(): void {
  godModalEstok?.classList.remove('hidden');
}

function godCerrarModalEstok(): void {
  godModalEstok?.classList.add('hidden');
  const f = document.getElementById('godFormEstok') as HTMLFormElement | null;
  f?.reset();
  document.getElementById('godFormEstokError')?.classList.add('hidden');
}

async function godCrearUsuarioSubmit(e: Event): Promise<void> {
  e.preventDefault();
  const formErr = document.getElementById('godFormUsuarioError') as HTMLElement;
  formErr.classList.add('hidden');

  const body: Record<string, unknown> = {
    username: (document.getElementById('gUUsername') as HTMLInputElement).value.trim(),
    email: (document.getElementById('gUEmail') as HTMLInputElement).value.trim(),
    password: (document.getElementById('gUPassword') as HTMLInputElement).value,
    first_name: (document.getElementById('gUFirst') as HTMLInputElement).value.trim(),
    last_name: (document.getElementById('gULast') as HTMLInputElement).value.trim(),
    phone: (document.getElementById('gUPhone') as HTMLInputElement).value.trim(),
    description: (document.getElementById('gUDescription') as HTMLTextAreaElement).value.trim(),
    is_active: (document.getElementById('gUIsActive') as HTMLInputElement).checked,
    is_superuser: (document.getElementById('gUIsSuperuser') as HTMLInputElement).checked,
  };

  const btn = document.getElementById('godGuardarUsuarioBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Creando...';
  try {
    await apiPost('/admin/usuarios/', body);
    godMostrarExito('✅ Usuario creado correctamente');
    godCerrarModalUsuario();
    await godCargarTodo();
  } catch (err: any) {
    formErr.textContent = err?.error || 'Error al crear el usuario.';
    formErr.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear Usuario';
  }
}

async function godCrearEstokSubmit(e: Event): Promise<void> {
  e.preventDefault();
  const formErr = document.getElementById('godFormEstokError') as HTMLElement;
  formErr.classList.add('hidden');

  const body = {
    nombre: (document.getElementById('gENombre') as HTMLInputElement).value.trim(),
    descripcion: (document.getElementById('gEDescripcion') as HTMLTextAreaElement).value.trim(),
  };

  const btn = document.getElementById('godGuardarEstokBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Creando...';
  try {
    await apiPost('/admin/estoks/', body);
    godMostrarExito('✅ Estok creado correctamente');
    godCerrarModalEstok();
    await godCargarTodo();
  } catch (err: any) {
    formErr.textContent = err?.error || 'Error al crear el Estok.';
    formErr.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear Estok';
  }
}

// =============================================================================
// Modales: editar usuario y editar Estok (PUT)
// =============================================================================

function godAbrirModalEditarUsuario(id: string): void {
  const u = godUsuarios.find((x: any) => x.id === id);
  if (!u) {
    godMostrarError('No se encontró el usuario en la caché.');
    return;
  }
  godEditandoUserId = id;
  (document.getElementById('gUUsernameEditar') as HTMLInputElement).value = u.username || '';
  (document.getElementById('gUEmailEditar') as HTMLInputElement).value = u.email || '';
  (document.getElementById('gUPasswordEditar') as HTMLInputElement).value = '';
  (document.getElementById('gUIsActiveEditar') as HTMLInputElement).checked = !!u.is_active;
  (document.getElementById('gUIsSuperuserEditar') as HTMLInputElement).checked = !!u.is_superuser;
  document.getElementById('godFormUsuarioEditarError')?.classList.add('hidden');
  godModalUsuarioEditar?.classList.remove('hidden');
}

function godCerrarModalEditarUsuario(): void {
  godModalUsuarioEditar?.classList.add('hidden');
  godEditandoUserId = null;
  const f = document.getElementById('godFormUsuarioEditar') as HTMLFormElement | null;
  f?.reset();
  document.getElementById('godFormUsuarioEditarError')?.classList.add('hidden');
}

function godAbrirModalEditarEstok(id: string): void {
  const e = godEstoks.find((x: any) => x.id === id);
  if (!e) {
    godMostrarError('No se encontró el Estok en la caché.');
    return;
  }
  godEditandoEstokId = id;
  (document.getElementById('gENombreEditar') as HTMLInputElement).value = e.nombre || '';
  document.getElementById('godFormEstokEditarError')?.classList.add('hidden');
  godModalEstokEditar?.classList.remove('hidden');
}

function godCerrarModalEditarEstok(): void {
  godModalEstokEditar?.classList.add('hidden');
  godEditandoEstokId = null;
  const f = document.getElementById('godFormEstokEditar') as HTMLFormElement | null;
  f?.reset();
  document.getElementById('godFormEstokEditarError')?.classList.add('hidden');
}

async function godEditarUsuarioSubmit(e: Event): Promise<void> {
  e.preventDefault();
  if (!godEditandoUserId) return;
  const formErr = document.getElementById('godFormUsuarioEditarError') as HTMLElement;
  formErr.classList.add('hidden');

  const body: Record<string, unknown> = {
    username: (document.getElementById('gUUsernameEditar') as HTMLInputElement).value.trim(),
    email: (document.getElementById('gUEmailEditar') as HTMLInputElement).value.trim(),
    is_active: (document.getElementById('gUIsActiveEditar') as HTMLInputElement).checked,
    is_superuser: (document.getElementById('gUIsSuperuserEditar') as HTMLInputElement).checked,
  };
  const password = (document.getElementById('gUPasswordEditar') as HTMLInputElement).value;
  if (password) body.password = password;

  const btn = document.getElementById('godGuardarUsuarioEditarBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    await apiPut(`/admin/usuarios/${godEditandoUserId}/`, body);
    godMostrarExito('✅ Usuario actualizado correctamente');
    godCerrarModalEditarUsuario();
    await godCargarTodo();
  } catch (err: any) {
    formErr.textContent = err?.error || 'Error al actualizar el usuario.';
    formErr.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar Cambios';
  }
}

async function godEditarEstokSubmit(e: Event): Promise<void> {
  e.preventDefault();
  if (!godEditandoEstokId) return;
  const formErr = document.getElementById('godFormEstokEditarError') as HTMLElement;
  formErr.classList.add('hidden');

  const body = {
    nombre: (document.getElementById('gENombreEditar') as HTMLInputElement).value.trim(),
  };

  const btn = document.getElementById('godGuardarEstokEditarBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    await apiPut(`/admin/estoks/${godEditandoEstokId}/`, body);
    godMostrarExito('✅ Estok actualizado correctamente');
    godCerrarModalEditarEstok();
    await godCargarTodo();
  } catch (err: any) {
    formErr.textContent = err?.error || 'Error al actualizar el Estok.';
    formErr.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar Cambios';
  }
}

// =============================================================================
// Delegación de eventos (robusto tras re-render de innerHTML)
// =============================================================================

function bindGodEventos(): void {
  godUsuariosTbody?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const unlinkBtn = target.closest('[data-god-unlink]') as HTMLElement | null;
    if (unlinkBtn) {
      const uid = unlinkBtn.dataset.uid!;
      const estokId = unlinkBtn.dataset.estokId!;
      const estokNombre = unlinkBtn.dataset.estokNombre || '';
      void godDesvincular(uid, estokId, estokNombre);
      return;
    }

    const asignarBtn = target.closest('[data-god-asignar]') as HTMLElement | null;
    if (asignarBtn) {
      const uid = asignarBtn.dataset.uid!;
      const row = asignarBtn.closest('tr') as HTMLTableRowElement | null;
      const select = row?.querySelector<HTMLSelectElement>('[data-god-asignar-select]');
      const estokId = select?.value;
      if (!estokId) {
        godMostrarError('Debes seleccionar un Estok.');
        return;
      }
      void godVincular(uid, estokId);
      return;
    }

    const editUserBtn = target.closest('[data-god-edit-user]') as HTMLElement | null;
    if (editUserBtn) {
      godAbrirModalEditarUsuario(editUserBtn.dataset.uid!);
      return;
    }

    const deleteUserBtn = target.closest('[data-god-delete-user]') as HTMLElement | null;
    if (deleteUserBtn) {
      void godDesactivarUsuario(
        deleteUserBtn.dataset.uid!,
        deleteUserBtn.dataset.user || '',
        deleteUserBtn.dataset.username || ''
      );
    }
  });

  godEstoksTbody?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const addUserBtn = target.closest('[data-god-adduser]') as HTMLElement | null;
    if (addUserBtn) {
      const estokId = addUserBtn.dataset.estok!;
      const row = addUserBtn.closest('tr') as HTMLTableRowElement | null;
      const select = row?.querySelector<HTMLSelectElement>('[data-god-adduser-select]');
      const uid = select?.value;
      if (!uid) {
        godMostrarError('No hay usuarios disponibles para añadir.');
        return;
      }
      void godVincular(uid, estokId);
      return;
    }

    const editEstokBtn = target.closest('[data-god-edit-estok]') as HTMLElement | null;
    if (editEstokBtn) {
      godAbrirModalEditarEstok(editEstokBtn.dataset.id!);
      return;
    }

    const deleteEstokBtn = target.closest('[data-god-delete-estok]') as HTMLElement | null;
    if (deleteEstokBtn) {
      void godEliminarEstok(deleteEstokBtn.dataset.id!, deleteEstokBtn.dataset.nombre || '');
    }
  });
}

// =============================================================================
// INIT - Wiring del Panel de Control (SOLO para ygumy44)
// El toggle lo dispara el botón "Admin Global" del navbar (BaseLayout.astro).
// =============================================================================

function godAbrirPanel(): void {
  if (!godPanel) return;
  godPanel.classList.remove('hidden');
  document.getElementById('godModeBtn')?.classList.add('is-open');
  document.getElementById('godModeBtnMobile')?.classList.add('is-open');
  void godCargarTodo();
}

export function initGodMode(): void {
  const cachedUser = getCachedUser();
  // Render estricto: solo si el username es EXACTAMENTE 'ygumy44'
  if (!cachedUser || cachedUser.username !== 'ygumy44') return;

  godPanel = document.getElementById('godPanel');
  if (!godPanel) return;

  // Si el usuario llegó al Dashboard tras pulsar "Admin Global" desde otra
  // página, abrimos el panel automáticamente y refrescamos los datos.
  if (sessionStorage.getItem('estok_admin_panel') === '1') {
    sessionStorage.removeItem('estok_admin_panel');
    godAbrirPanel();
  }

  // El botón "Admin Global" del navbar dispara este evento al expandir el panel.
  window.addEventListener('estok:admin-open', () => void godCargarTodo());

  godLoading = document.getElementById('godLoading');
  godError = document.getElementById('godError');
  godSuccess = document.getElementById('godSuccess');
  godUsuariosTbody = document.getElementById('godUsuariosTbody');
  godEstoksTbody = document.getElementById('godEstoksTbody');
  godModalUsuario = document.getElementById('godModalUsuario');
  godModalEstok = document.getElementById('godModalEstok');
  godModalUsuarioEditar = document.getElementById('godModalUsuarioEditar');
  godModalEstokEditar = document.getElementById('godModalEstokEditar');

  // Botones de acción del panel
  document.getElementById('godCrearUsuarioBtn')?.addEventListener('click', godAbrirModalUsuario);
  document.getElementById('godCrearEstokBtn')?.addEventListener('click', godAbrirModalEstok);
  document.getElementById('godRefreshBtn')?.addEventListener('click', () => void godCargarTodo());

  // Cierre de modales
  document.getElementById('godCerrarModalUsuario')?.addEventListener('click', godCerrarModalUsuario);
  document.getElementById('godCancelarUsuarioBtn')?.addEventListener('click', godCerrarModalUsuario);
  document.getElementById('godCerrarModalEstok')?.addEventListener('click', godCerrarModalEstok);
  document.getElementById('godCancelarEstokBtn')?.addEventListener('click', godCerrarModalEstok);
  godModalUsuario?.addEventListener('click', (e) => { if (e.target === godModalUsuario) godCerrarModalUsuario(); });
  godModalEstok?.addEventListener('click', (e) => { if (e.target === godModalEstok) godCerrarModalEstok(); });

  // Cierre de modales de edición
  document.getElementById('godCerrarModalUsuarioEditar')?.addEventListener('click', godCerrarModalEditarUsuario);
  document.getElementById('godCancelarUsuarioEditarBtn')?.addEventListener('click', godCerrarModalEditarUsuario);
  document.getElementById('godCerrarModalEstokEditar')?.addEventListener('click', godCerrarModalEditarEstok);
  document.getElementById('godCancelarEstokEditarBtn')?.addEventListener('click', godCerrarModalEditarEstok);
  godModalUsuarioEditar?.addEventListener('click', (e) => { if (e.target === godModalUsuarioEditar) godCerrarModalEditarUsuario(); });
  godModalEstokEditar?.addEventListener('click', (e) => { if (e.target === godModalEstokEditar) godCerrarModalEditarEstok(); });

  // Formularios de creación
  document.getElementById('godFormUsuario')?.addEventListener('submit', (e) => void godCrearUsuarioSubmit(e));
  document.getElementById('godFormEstok')?.addEventListener('submit', (e) => void godCrearEstokSubmit(e));

  // Formularios de edición (PUT)
  document.getElementById('godFormUsuarioEditar')?.addEventListener('submit', (e) => void godEditarUsuarioSubmit(e));
  document.getElementById('godFormEstokEditar')?.addEventListener('submit', (e) => void godEditarEstokSubmit(e));

  // Delegación de eventos para las tablas
  bindGodEventos();
}





