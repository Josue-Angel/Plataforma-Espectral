(() => {
const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const viewPermissions = {
  inicio: ["admin", "desarrollador", "voluntario"],
  equipo: ["admin", "desarrollador", "voluntario"],
  "base-datos": ["admin", "desarrollador"],
  formularios: ["admin", "desarrollador", "voluntario"],
  "modelo-ia": ["admin", "desarrollador"],
  archivos: ["admin", "desarrollador", "voluntario"],
  dashboard: ["admin", "desarrollador"],
};

let voluntariosCache = [];
let currentRole = null;
let isLoggedIn = false;
let currentUserName = null;
let currentUserId = null;
let currentUserEmail = null;
let currentProfile = null;
const TRASH_RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
const VOLUNTEER_TRASH_STORAGE_KEY = "voluntarios-papelera";
const DEV_SETTINGS_STORAGE_KEY = "dev-settings";
const DEV_CONTENT_EDITS_STORAGE_KEY = "dev-content-edits";
const GLOBAL_CONFIG_TABLE = "configuracion_global";
const GLOBAL_SETTINGS_KEY = "ui_settings";
const GLOBAL_CONTENT_KEY = "content_edits";
let currentViewId = "inicio";
let isEditModeEnabled = false;
let managedArticlesCache = [];

const views = document.querySelectorAll(".view");
const navLinks = document.querySelectorAll("#nav-links a");
const userLabel = document.getElementById("user-label");
const logoutBtn = document.getElementById("logout-btn");
const headerEl = document.querySelector(".header");

const GUEST_LANDING_VIEW = "inicio";
const AUTH_LANDING_VIEW = "equipo";
const ADMIN_EMAILS = ["admin@ejemplo.com"];
const DEVELOPER_EMAILS = ["dev@ejemplo.com"];
const ADMIN_NOTIFICATION_EMAIL = "admin@ejemplo.com";
const ADMIN_NOTIFICATIONS_STORAGE_KEY = "admin-notificaciones-local";
const FROM_EMAIL = window.GMAIL_USER || "";

function canManageAsAdmin() {
  return currentRole === "admin" || currentRole === "desarrollador";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveRoleFromProfile(perfil, userEmail, authUser = null) {
  const roleFromProfile = perfil?.role ? String(perfil.role).trim().toLowerCase() : "";
  if (roleFromProfile === "admin" || roleFromProfile === "voluntario" || roleFromProfile === "desarrollador") return roleFromProfile;

  const roleFromMetadata = String(
    authUser?.app_metadata?.role || authUser?.user_metadata?.role || ""
  ).trim().toLowerCase();
  if (roleFromMetadata === "admin" || roleFromMetadata === "voluntario" || roleFromMetadata === "desarrollador") {
    return roleFromMetadata;
  }

  const normalizedEmail = String(userEmail || "").trim().toLowerCase();
  if (ADMIN_EMAILS.includes(normalizedEmail)) return "admin";
  if (DEVELOPER_EMAILS.includes(normalizedEmail)) return "desarrollador";

  return "voluntario";
}

function getFototipoDetails(tipo) {
  const info = {
    I: { descripcion: "Piel muy clara, se quema con mucha facilidad.", recomendacion: "Procura usar bloqueador FPS 50+, gorra y buscar sombra cuando el sol esté fuerte." },
    II: { descripcion: "Piel clara con alta sensibilidad al sol.", recomendacion: "Aplica protector antes de salir y reaplica cada 2-3 horas si estás al aire libre." },
    III: { descripcion: "Piel intermedia, puede quemarse y broncearse gradualmente.", recomendacion: "Aunque te broncees, usa FPS 30+ diario y evita exponerte por periodos largos." },
    IV: { descripcion: "Piel morena clara, menor riesgo de quemadura severa.", recomendacion: "Mantén una rutina simple: limpieza suave, hidratante y protector todos los días." },
    "V y VI": { descripcion: "Piel morena oscura/oscura, alta tolerancia al sol.", recomendacion: "Tu piel también necesita cuidado solar: protector, hidratación y revisar manchas nuevas." },
  };

  return info[tipo] || {
    descripcion: "Fototipo no disponible.",
    recomendacion: "Usa protector solar, hidrata tu piel y evita exposición prolongada sin protección.",
  };
}

function isMissingColumnError(error, columnName) {
  if (!error) return false;
  if (error.code !== "PGRST204") return false;
  return String(error.message || "").includes(`'${columnName}'`);
}

function isMissingRelationError(error, tableName) {
  if (!error) return false;
  if (error.code !== "PGRST205") return false;
  return String(error.message || "").includes(`'public.${tableName}'`);
}

function isInvalidInputError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  return code === "22P02" || code === "22023" || code === "PGRST100";
}

function shouldFallbackOnSchemaError(error, columnName = "") {
  return isMissingColumnError(error, columnName) || isInvalidInputError(error);
}

function readLocalAdminNotifications() {
  try {
    const raw = localStorage.getItem(ADMIN_NOTIFICATIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("No se pudo leer el respaldo local de notificaciones:", error);
    return [];
  }
}

function saveLocalAdminNotification(message, tipo = "general") {
  const current = readLocalAdminNotifications();
  const item = {
    id: `local-${Date.now()}`,
    message,
    tipo,
    created_at: new Date().toISOString(),
  };

  const next = [item, ...current].slice(0, 20);
  localStorage.setItem(ADMIN_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(next));
}

function renderAdminNotificationsList(lista, items, sourceLabel = "") {
  if (!items?.length) {
    lista.innerHTML = "<li class=\"muted small\">Sin notificaciones por ahora.</li>";
    return;
  }

  const prefix = sourceLabel ? `<span class=\"muted small\">${sourceLabel}</span>` : "";
  lista.innerHTML = items
    .map((item) => {
      const fecha = item.created_at ? new Date(item.created_at).toLocaleString("es-MX") : "Sin fecha";
      return `<li><strong>${item.message}</strong><span class=\"muted small\">${fecha}</span>${prefix}</li>`;
    })
    .join("");
}

async function updateProfileCompletionState(userId, nombreConsentimiento) {
  const payload = {
    nombre_completo: nombreConsentimiento,
    consentimiento: true,
    test_fototipo_completado: true,
  };

  const { error } = await supabaseClient.from("perfiles").update(payload).eq("id", userId);
  if (!error) return;

  if (shouldFallbackOnSchemaError(error, "nombre_completo") || shouldFallbackOnSchemaError(error, "consentimiento")) {
    const fallback = await supabaseClient
      .from("perfiles")
      .update({ test_fototipo_completado: true })
      .eq("id", userId);

    if (!fallback.error) return;

    if (shouldFallbackOnSchemaError(fallback.error, "test_fototipo_completado")) {
      console.warn("La tabla perfiles no contiene columnas de estado del formulario. Se continúa sin bloqueo por perfil.");
      return;
    }

    console.error("No se pudo actualizar el perfil del voluntario:", fallback.error);
    return;
  }

  if (shouldFallbackOnSchemaError(error, "test_fototipo_completado")) {
    console.warn("La columna test_fototipo_completado no existe en perfiles.");
    return;
  }

  console.error("No se pudo actualizar el perfil del voluntario:", error);
}

async function hasVolunteerCompletedForm() {
  const perfilResp = await supabaseClient
    .from("perfiles")
    .select("test_fototipo_completado")
    .eq("id", currentUserId)
    .maybeSingle();

  if (!perfilResp.error && perfilResp.data?.test_fototipo_completado) return true;

  if (perfilResp.error && !shouldFallbackOnSchemaError(perfilResp.error, "test_fototipo_completado")) {
    console.error("Error al consultar el estado del formulario en perfiles:", perfilResp.error);
  }

  const porUsuario = await supabaseClient
    .from("voluntarios")
    .select("id")
    .eq("user_id", currentUserId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!porUsuario.error && porUsuario.data?.id) return true;

  if (porUsuario.error && !shouldFallbackOnSchemaError(porUsuario.error, "user_id")) {
    console.error("Error al validar formulario completado por user_id:", porUsuario.error);
  }

  const correoBusqueda = String(currentUserEmail || "").trim().toLowerCase();
  if (!correoBusqueda) return false;

  const { data: ultimo, error } = await supabaseClient
    .from("voluntarios")
    .select("id")
    .eq("correo", correoBusqueda)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error al validar formulario completado en voluntarios por correo:", error);
    return false;
  }

  return Boolean(ultimo?.id);
}

async function sendEmailNotification({ to, subject, html, fototipo, recomendacion, nombre }) {
  const normalizedTo = String(to || "").trim();
  const fnName = window.SUPABASE_EMAIL_FUNCTION || "send-email";

  try {
    const { data, error } = await supabaseClient.functions.invoke(fnName, {
      body: {
        to: normalizedTo,
        subject,
        html,
        from: FROM_EMAIL,
        nombre,
        fototipo,
        recomendacion,
        tipoFototipo: fototipo,
        fototipo_de_piel: fototipo,
        recommendation: recomendacion,
      },
    });

    if (error) throw error;
    return { skipped: false, payload: data, provider: "supabase-function-gmail" };
  } catch (error) {
    console.warn("No se pudo enviar correo usando la función de Supabase (Gmail App Password).", error);
    return { skipped: true, reason: "gmail_supabase_function_not_configured", error };
  }
}

async function createAdminNotificationLog(message, tipo = "nuevo_registro") {
  let { error } = await supabaseClient.from("admin_notificaciones").insert({
    message,
    tipo,
  });

  if (isMissingColumnError(error, "tipo")) {
    const fallback = await supabaseClient.from("admin_notificaciones").insert({ message });
    error = fallback.error;
  }

  if (isMissingRelationError(error, "admin_notificaciones")) {
    saveLocalAdminNotification(message, tipo);
    return;
  }

  if (error) {
    console.error("No se pudo registrar la notificación para administrador:", error);
    saveLocalAdminNotification(message, tipo);
  }
}

async function notifyAdminNewVolunteer(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;

  const message = `Nuevo usuario registrado con el correo: ${normalizedEmail}`;

  await createAdminNotificationLog(message);

  const sent = await sendEmailNotification({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: "Nuevo voluntario registrado",
    html: `<p>${message}</p>`,
    nombre: "Administrador",
    fototipo: "No aplica",
    recomendacion: "Revisión informativa de nuevo registro.",
  });

  if (sent?.error) {
    showToast("Voluntario registrado, pero falló el aviso por correo al administrador.", "info");
  } else if (sent?.skipped) {
    showToast("Voluntario registrado. Configura la función de correo de Supabase con Gmail App Password para enviar correos.", "info");
  }
}

async function notifyAdminVolunteerCompletedForm({ email, fototipo }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;

  const message = `El voluntario con el correo "${normalizedEmail}" ha realizado el formulario, su fototipo de acuerdo al formulario es: "${fototipo || "No disponible"}".`;

  await createAdminNotificationLog(message, "formulario_completado");
}

async function notifyVolunteerFototipo({ email, nombre, fototipo }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !fototipo) return;

  const details = getFototipoDetails(fototipo);
  const safeName = nombre || "Voluntario";

  const sent = await sendEmailNotification({
    to: normalizedEmail,
    subject: "🔬 Resultado de tu Fototipo de Piel",
    fototipo,
    recomendacion: details.recomendacion,
    nombre: safeName,
  });

  if (sent?.error) {
    showToast("Formulario guardado, pero no se pudo enviar el correo del fototipo.", "info");
  } else if (sent?.skipped) {
    showToast("Formulario guardado. Configura la función de correo de Supabase con Gmail App Password para enviar el correo al voluntario.", "info");
  }
}

async function cargarAlertasAdmin() {
  const lista = document.getElementById("lista-alertas-admin");
  if (!lista) return;

  if (!isLoggedIn || !canManageAsAdmin()) {
    lista.innerHTML = "";
    return;
  }

  const { data, error } = await supabaseClient
    .from("admin_notificaciones")
    .select("id, message, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    if (isMissingRelationError(error, "admin_notificaciones")) {
      const localItems = readLocalAdminNotifications();
      renderAdminNotificationsList(lista, localItems, "(respaldo local)");
      return;
    }

    console.error("Error al cargar notificaciones de administrador:", error);
    const localItems = readLocalAdminNotifications();
    if (localItems.length) {
      renderAdminNotificationsList(lista, localItems, "(respaldo local)");
      return;
    }

    lista.innerHTML = "<li class=\"muted small\">No se pudieron cargar las notificaciones.</li>";
    return;
  }

  renderAdminNotificationsList(lista, data);
}

function showToast(message, type = "error") {
  const container = document.getElementById("toast-container");
  if (!container) {
    console.warn(message);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 260);
  }, 5200);
}

function showView(viewId) {
  if (!isLoggedIn && viewId !== GUEST_LANDING_VIEW) viewId = GUEST_LANDING_VIEW;

  if (isLoggedIn) {
    const allowed = viewPermissions[viewId] || [];
    if (!allowed.includes(currentRole)) {
      showToast("No tienes permiso para acceder a esta sección.");
      return;
    }
  }

  document.body.classList.toggle("logged-in", isLoggedIn && viewId !== GUEST_LANDING_VIEW);
  if (headerEl) headerEl.classList.toggle("header-auth", isLoggedIn && viewId !== GUEST_LANDING_VIEW);

  views.forEach((v) => v.classList.remove("active"));
  const target = document.getElementById(viewId);
  if (target) target.classList.add("active");
  currentViewId = viewId;
  applyContentEditsForView(viewId);
  if (isEditModeEnabled) toggleEditMode(true);
  refreshDeveloperDock();

  navLinks.forEach((link) => {
    link.classList.toggle("active-link", link.dataset.view === viewId);
  });
}

function updateNavForRole(role) {
  const navContainer = document.getElementById("nav-links");

  if (!role) {
    navContainer.classList.add("nav-active");
    navLinks.forEach((link) => {
      const isLoginLink = link.dataset.view === GUEST_LANDING_VIEW;
      link.classList.toggle("hidden", !isLoginLink);
    });
    return;
  }

  navContainer.classList.add("nav-active");
  navLinks.forEach((link) => {
    const viewId = link.dataset.view;
    if (viewId === GUEST_LANDING_VIEW) {
      link.classList.add("hidden");
      return;
    }

    const roles = (link.dataset.roles || "").split(",").map((r) => r.trim());
    link.classList.toggle("hidden", roles.length > 0 && !roles.includes(role));
  });
}

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    showView(link.dataset.view);
  });
});

const THEME_MAP = {
  azul: { primary: "#1f4f9d", accent: "#3b82f6", dark: "#173b75", bg: "#ecf4ff", surface: "#ffffff", text: "#0b1d3b", muted: "#3f5f86", line: "#c9daf4", soft: "#dcecff" },
  verde: { primary: "#1f7a54", accent: "#22c55e", dark: "#16583c", bg: "#eefcf5", surface: "#ffffff", text: "#0d2c20", muted: "#416b5a", line: "#bfe8d4", soft: "#daf7ea" },
  morado: { primary: "#5b3aa8", accent: "#8b5cf6", dark: "#432b7b", bg: "#f4efff", surface: "#ffffff", text: "#24124d", muted: "#5f5290", line: "#d9c8fb", soft: "#e9defd" },
  vino: { primary: "#8a2d4f", accent: "#be4b7b", dark: "#6b213d", bg: "#fff0f5", surface: "#ffffff", text: "#3f1024", muted: "#7f445e", line: "#f1c2d4", soft: "#f9dceb" },
  rojo: { primary: "#a11d2d", accent: "#ef4444", dark: "#7b1521", bg: "#fff1f1", surface: "#ffffff", text: "#3a0d13", muted: "#7b3a43", line: "#f2c8cd", soft: "#fce1e4" },
};

const DEFAULT_DEV_SETTINGS = {
  color: "azul",
  uiVariant: "moderno",
  fontFamily: "inter",
};

function readDevSettings() {
  try {
    return { ...DEFAULT_DEV_SETTINGS, ...(JSON.parse(localStorage.getItem(DEV_SETTINGS_STORAGE_KEY) || "{}")) };
  } catch (error) {
    return { ...DEFAULT_DEV_SETTINGS };
  }
}

async function requestGlobalChangeConfirmation(message) {
  return new Promise((resolve) => {
    const panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.right = "1rem";
    panel.style.bottom = "1rem";
    panel.style.zIndex = "2000";
    panel.style.width = "min(420px, calc(100vw - 2rem))";
    panel.style.background = "var(--surface)";
    panel.style.border = "1px solid var(--line)";
    panel.style.borderRadius = "14px";
    panel.style.boxShadow = "0 18px 40px rgba(2,6,23,.26)";
    panel.style.padding = "1rem";
    panel.innerHTML = `<p style="margin:0 0 .7rem 0;font-weight:600;">${message}</p>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;">
        <button type="button" class="btn btn-outline btn-small" data-confirm-action="cancelar">Cancelar</button>
        <button type="button" class="btn btn-primary btn-small" data-confirm-action="confirmar">Confirmar</button>
      </div>`;
    document.body.appendChild(panel);
    panel.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-confirm-action]");
      if (!btn) return;
      const ok = btn.dataset.confirmAction === "confirmar";
      panel.remove();
      resolve(ok);
    });
  });
}

async function loadGlobalDeveloperConfig() {
  const settingsResp = await supabaseClient.from(GLOBAL_CONFIG_TABLE).select("valor").eq("clave", GLOBAL_SETTINGS_KEY).maybeSingle();
  if (!settingsResp.error && settingsResp.data?.valor) {
    localStorage.setItem(DEV_SETTINGS_STORAGE_KEY, JSON.stringify(settingsResp.data.valor));
  }

  const contentResp = await supabaseClient.from(GLOBAL_CONFIG_TABLE).select("valor").eq("clave", GLOBAL_CONTENT_KEY).maybeSingle();
  if (!contentResp.error && contentResp.data?.valor) {
    localStorage.setItem(DEV_CONTENT_EDITS_STORAGE_KEY, JSON.stringify(contentResp.data.valor));
  }

  applyDevSettings();
  const currentSettings = readDevSettings();
  if (devColorTheme) devColorTheme.value = currentSettings.color;
  if (devUiVariant) devUiVariant.value = currentSettings.uiVariant;
  if (devFontFamily) devFontFamily.value = currentSettings.fontFamily;
  views.forEach((view) => applyContentEditsForView(view.id));
}

async function saveGlobalDeveloperConfig(key, value) {
  const payload = {
    clave: key,
    valor: value,
    updated_by: currentUserId || null,
    updated_at: new Date().toISOString(),
  };

  const result = await supabaseClient.from(GLOBAL_CONFIG_TABLE).upsert(payload, { onConflict: "clave" });
  if (!result.error) return true;
  if (!isMissingRelationError(result.error, GLOBAL_CONFIG_TABLE)) {
    console.warn("No se pudo guardar configuración global:", result.error);
  }
  return false;
}

function applyDevSettings() {
  const settings = readDevSettings();
  const theme = THEME_MAP[settings.color] || THEME_MAP.azul;
  document.documentElement.style.setProperty("--primary", theme.primary);
  document.documentElement.style.setProperty("--primary-2", theme.accent);
  document.documentElement.style.setProperty("--primary-dark", theme.dark || theme.primary);
  document.documentElement.style.setProperty("--bg", theme.bg);
  document.documentElement.style.setProperty("--surface", theme.surface);
  document.documentElement.style.setProperty("--text", theme.text);
  document.documentElement.style.setProperty("--muted", theme.muted);
  document.documentElement.style.setProperty("--line", theme.line);
  document.documentElement.style.setProperty("--surface-soft", theme.soft);
  document.body.dataset.uiVariant = settings.uiVariant || "moderno";
  document.body.dataset.fontFamily = settings.fontFamily || "inter";
}

function getEditableElements(viewId) {
  const view = document.getElementById(viewId);
  if (!view) return [];
  const blocked = ".table-wrapper, #form-voluntario, #form-articulo, .modal-content, .doc-link, .doi-link, .reference-links, .stat-value, .title-icon, .logo-icon";
  return Array.from(view.querySelectorAll("h1,h2,h3,h4,p,legend,[data-heading],[data-section-label]"))
    .filter((el) => !el.closest(blocked) && el.textContent.trim().length > 0);
}

function readDevContentEdits() {
  try {
    return JSON.parse(localStorage.getItem(DEV_CONTENT_EDITS_STORAGE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function applyContentEditsForView(viewId) {
  const edits = readDevContentEdits();
  const viewEdits = edits[viewId] || {};
  getEditableElements(viewId).forEach((el, index) => {
    if (Object.prototype.hasOwnProperty.call(viewEdits, index)) {
      el.textContent = viewEdits[index];
    }
  });
}

function toggleEditMode(enabled) {
  isEditModeEnabled = enabled;
  document.body.classList.toggle("dev-editing", enabled);
  getEditableElements(currentViewId).forEach((el) => {
    el.contentEditable = enabled ? "plaintext-only" : "false";
    el.classList.toggle("dev-editable", enabled);
  });
}

document.addEventListener("beforeinput", (event) => {
  const target = event.target;
  if (!isEditModeEnabled || !(target instanceof HTMLElement) || !target.classList.contains("dev-editable")) return;
  if (event.inputType && event.inputType.startsWith("format")) event.preventDefault();
});

function saveCurrentViewEdits() {
  const allEdits = readDevContentEdits();
  allEdits[currentViewId] = {};
  getEditableElements(currentViewId).forEach((el, index) => {
    allEdits[currentViewId][index] = el.textContent;
  });
  localStorage.setItem(DEV_CONTENT_EDITS_STORAGE_KEY, JSON.stringify(allEdits));
}

function refreshDeveloperDock() {
  const dock = document.getElementById("dev-edit-dock");
  const paletteDock = document.getElementById("dev-palette-dock");
  if (!dock || !paletteDock) return;
  const canShow = isLoggedIn && currentRole === "desarrollador" && currentViewId !== GUEST_LANDING_VIEW;
  dock.classList.toggle("hidden", !canShow);
  paletteDock.classList.toggle("hidden", !canShow);
  if (!canShow && isEditModeEnabled) toggleEditMode(false);
}

function renderManagedArticles() {
  const ownList = document.getElementById("lista-aportes-propios");
  const refList = document.getElementById("lista-aportes-referencias");
  if (!ownList || !refList) return;
  const items = managedArticlesCache;
  const propios = items.filter((i) => i.tipo === "propio");
  const refs = items.filter((i) => i.tipo === "referencia");
  const manageActions = (item) => canManageAsAdmin()
    ? `<div class="actions-inline article-actions"><button class="btn btn-small btn-outline" data-action="editar-articulo" data-id="${item.id}">Editar</button><button class="btn btn-small btn-danger" data-action="eliminar-articulo" data-id="${item.id}">Eliminar</button></div>`
    : "";

  ownList.innerHTML = propios.length
    ? propios.map((item) => `<li class="doc-item"><strong class="doc-label">${escapeHtml(item.anio)} · Artículo:</strong> <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="doc-link">${escapeHtml(item.titulo)}</a><div class="muted small">${escapeHtml(item.autores)} · ${escapeHtml(item.fuente)}</div>${manageActions(item)}</li>`).join("")
    : "<li class='muted small'>Sin aportes propios registrados.</li>";
  refList.innerHTML = refs.length
    ? refs.map((item) => `<li class="reference-item"><p class="reference-apa"><strong>${escapeHtml(item.autores)}</strong> (${escapeHtml(item.anio)}). <em>${escapeHtml(item.titulo)}</em> <span>${escapeHtml(item.fuente)}</span><br><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="doi-link">${escapeHtml(item.url)}</a></p>${item.url2 ? `<div class="reference-links"><a href="${escapeHtml(item.url2)}" target="_blank" rel="noopener noreferrer" class="ref-btn">Enlace adicional</a></div>` : ""}${manageActions(item)}</li>`).join("")
    : "<li class='muted small'>Sin referencias registradas.</li>";
}

async function loadManagedArticles() {
  const { data, error } = await supabaseClient
    .from("articulos_publicados")
    .select("id, tipo, anio, titulo, autores, fuente, url, url2, created_at")
    .order("created_at", { ascending: true });

  if (!error && Array.isArray(data)) {
    managedArticlesCache = data;
    renderManagedArticles();
    return;
  }
  managedArticlesCache = [];
  renderManagedArticles();
}

const tabButtons = document.querySelectorAll(".tab-auth");
const loginPanel = document.getElementById("login-panel");
const registerPanel = document.getElementById("register-panel");

function setAuthTab(targetPanelId = "login-panel") {
  tabButtons.forEach((btn) => {
    const isTarget = btn.dataset.target === targetPanelId;
    btn.classList.toggle("active", isTarget);
  });

  const showLogin = targetPanelId === "login-panel";
  loginPanel.classList.toggle("hidden", !showLogin);
  registerPanel.classList.toggle("hidden", showLogin);
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setAuthTab(btn.dataset.target);
  });
});;

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value.trim();

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    loginError.textContent = error.message || "Error al iniciar sesión.";
    loginError.classList.remove("hidden");
    return;
  }

  if (data.user) await initSession(data.user);
});

const registerForm = document.getElementById("register-form");
const regError = document.getElementById("register-error");
const regSuccess = document.getElementById("register-success");
registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  regError.classList.add("hidden");
  regSuccess.classList.add("hidden");

  const nombre = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const pass1 = document.getElementById("reg-password").value;
  const pass2 = document.getElementById("reg-password2").value;

  if (pass1 !== pass2) {
    regError.textContent = "Las contraseñas no coinciden.";
    regError.classList.remove("hidden");
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({ email, password: pass1 });
  if (error) {
    regError.textContent = error.message || "Error al crear la cuenta.";
    regError.classList.remove("hidden");
    return;
  }

  if (data.user) {
    await supabaseClient.from("perfiles").upsert({
      id: data.user.id,
      email,
      nombre,
      role: "voluntario",
    });

    await notifyAdminNewVolunteer(email);
  }

  registerForm.reset();
  regSuccess.classList.remove("hidden");
});

const formArticulo = document.getElementById("form-articulo");
const inputArticuloIdEditando = document.getElementById("art-id-editando");
const tituloModalArticulo = document.getElementById("titulo-modal-articulo");

function resetArticleModalState() {
  if (inputArticuloIdEditando) inputArticuloIdEditando.value = "";
  if (tituloModalArticulo) tituloModalArticulo.textContent = "Agregar artículo / tesis / dataset";
}

function openEditManagedArticle(itemId) {
  const target = managedArticlesCache.find((item) => String(item.id) === String(itemId));
  if (!target || !formArticulo) return;
  if (inputArticuloIdEditando) inputArticuloIdEditando.value = target.id;
  document.getElementById("art-tipo").value = target.tipo || "";
  document.getElementById("art-anio").value = target.anio || "";
  document.getElementById("art-titulo").value = target.titulo || "";
  document.getElementById("art-autores").value = target.autores || "";
  document.getElementById("art-fuente").value = target.fuente || "";
  document.getElementById("art-url").value = target.url || "";
  document.getElementById("art-url-secundaria").value = target.url2 || "";
  if (tituloModalArticulo) tituloModalArticulo.textContent = "Editar artículo / tesis / dataset";
  openModal("modal-articulo");
}

if (formArticulo) {
  formArticulo.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canManageAsAdmin()) {
      showToast("No tienes permisos para agregar artículos.");
      return;
    }
    const payload = {
      tipo: document.getElementById("art-tipo").value,
      anio: Number(document.getElementById("art-anio").value),
      titulo: document.getElementById("art-titulo").value.trim(),
      autores: document.getElementById("art-autores").value.trim(),
      fuente: document.getElementById("art-fuente").value.trim(),
      url: document.getElementById("art-url").value.trim(),
      url2: document.getElementById("art-url-secundaria").value.trim(),
    };
    if (!payload.tipo || !payload.titulo || !payload.autores || !payload.fuente || !payload.url || !payload.anio) {
      showToast("Completa todos los campos obligatorios del artículo.");
      return;
    }
    const editingId = inputArticuloIdEditando?.value;
    if (editingId) {
      const { error } = await supabaseClient.from("articulos_publicados").update(payload).eq("id", editingId);
      if (error) {
        showToast("No se pudo actualizar globalmente el artículo.", "error");
        return;
      }
      await loadManagedArticles();
      showToast("Artículo/Tesis actualizado correctamente.", "success");
    } else {
      const { error } = await supabaseClient.from("articulos_publicados").insert(payload);
      if (error) {
        showToast("No se pudo guardar globalmente el artículo.", "error");
        return;
      }
      await loadManagedArticles();
      showToast("Artículo/Tesis agregado correctamente.", "success");
    }
    formArticulo.reset();
    resetArticleModalState();
    closeModal("modal-articulo");
    renderManagedArticles();
  });
}

const btnAbrirModalArticulo = document.getElementById("btn-abrir-modal-articulo");
if (btnAbrirModalArticulo) {
  btnAbrirModalArticulo.addEventListener("click", () => {
    if (!canManageAsAdmin()) return;
    resetArticleModalState();
    formArticulo?.reset();
    openModal("modal-articulo");
  });
}

async function deleteManagedArticle(itemId) {
  const { error } = await supabaseClient.from("articulos_publicados").delete().eq("id", itemId);
  if (error) {
    showToast("No se pudo eliminar globalmente el artículo.", "error");
    return;
  } else {
    await loadManagedArticles();
  }
  renderManagedArticles();
}

const listaAportesPropios = document.getElementById("lista-aportes-propios");
const listaAportesReferencias = document.getElementById("lista-aportes-referencias");
[listaAportesPropios, listaAportesReferencias].forEach((lista) => {
  if (!lista) return;
  lista.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action='eliminar-articulo']");
    const editBtn = e.target.closest("button[data-action='editar-articulo']");
    if (editBtn) {
      if (!canManageAsAdmin()) {
        showToast("No tienes permiso para editar aportes.");
        return;
      }
      openEditManagedArticle(editBtn.dataset.id);
      return;
    }
    if (btn) {
      if (!canManageAsAdmin()) {
        showToast("No tienes permiso para eliminar aportes.");
        return;
      }
      deleteManagedArticle(btn.dataset.id);
      showToast("Aporte eliminado correctamente.", "success");
    }
  });
});

const btnToggleEdit = document.getElementById("btn-dev-toggle-edit");
const btnSaveView = document.getElementById("btn-dev-save-theme");
const devEditControls = document.getElementById("dev-edit-controls");
const devColorTheme = document.getElementById("dev-color-theme");
const devUiVariant = document.getElementById("dev-ui-variant");
const devFontFamily = document.getElementById("dev-font-family");
const btnTogglePalette = document.getElementById("btn-dev-toggle-palette");
const btnRestoreDefaults = document.getElementById("btn-dev-restore-defaults");

if (btnToggleEdit) {
  btnToggleEdit.addEventListener("click", () => {
    if (currentRole !== "desarrollador") return;
    const enabled = !isEditModeEnabled;
    toggleEditMode(enabled);
    devEditControls?.classList.toggle("hidden", !enabled);
    btnToggleEdit.textContent = enabled ? "✅ Salir de edición" : "✏️ Editar interfaz";
  });
}

if (btnTogglePalette) {
  btnTogglePalette.addEventListener("click", () => {
    if (currentRole !== "desarrollador") return;
    devEditControls?.classList.toggle("hidden");
  });
}

if (btnSaveView) {
  btnSaveView.addEventListener("click", async () => {
    if (currentRole !== "desarrollador") return;
    const confirmed = await requestGlobalChangeConfirmation("¿Confirmas aplicar este tema de forma global para todos los usuarios?");
    if (!confirmed) {
      showToast("Cambio de tema cancelado.");
      return;
    }
    const settings = readDevSettings();
    settings.color = devColorTheme?.value || settings.color;
    settings.uiVariant = devUiVariant?.value || settings.uiVariant;
    settings.fontFamily = devFontFamily?.value || settings.fontFamily;
    const savedGlobal = await saveGlobalDeveloperConfig(GLOBAL_SETTINGS_KEY, settings);
    if (!savedGlobal) {
      showToast("No se pudo aplicar el tema globalmente.", "error");
      return;
    }
    localStorage.setItem(DEV_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    applyDevSettings();
    showToast("Tema global actualizado.", "success");
  });
}

if (btnRestoreDefaults) {
  btnRestoreDefaults.addEventListener("click", async () => {
    if (currentRole !== "desarrollador") return;
    const confirmed = await requestGlobalChangeConfirmation("¿Confirmas restaurar la apariencia y textos originales de forma global?");
    if (!confirmed) {
      showToast("Restauración cancelada.");
      return;
    }
    localStorage.removeItem(DEV_SETTINGS_STORAGE_KEY);
    localStorage.removeItem(DEV_CONTENT_EDITS_STORAGE_KEY);
    const settings = readDevSettings();
    const savedTheme = await saveGlobalDeveloperConfig(GLOBAL_SETTINGS_KEY, settings);
    const savedContent = await saveGlobalDeveloperConfig(GLOBAL_CONTENT_KEY, {});
    if (!savedTheme || !savedContent) {
      showToast("No se pudo restaurar globalmente.", "error");
      return;
    }
    if (devColorTheme) devColorTheme.value = settings.color;
    if (devUiVariant) devUiVariant.value = settings.uiVariant;
    if (devFontFamily) devFontFamily.value = settings.fontFamily;
    applyDevSettings();
    window.location.reload();
  });
}

const btnDevSaveViewText = document.getElementById("btn-dev-save-view");
if (btnDevSaveViewText) {
  btnDevSaveViewText.addEventListener("click", async () => {
    if (currentRole !== "desarrollador") return;
    const confirmed = await requestGlobalChangeConfirmation("¿Confirmas guardar estos cambios de texto de forma global?");
    if (!confirmed) {
      showToast("Guardado de texto cancelado.");
      return;
    }
    saveCurrentViewEdits();
    const currentEdits = readDevContentEdits();
    const savedGlobal = await saveGlobalDeveloperConfig(GLOBAL_CONTENT_KEY, currentEdits);
    if (!savedGlobal) {
      showToast("No se pudo guardar el texto globalmente.", "error");
      return;
    }
    showToast("Texto de la vista guardado globalmente.", "success");
  });
}

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  isLoggedIn = false;
  currentRole = null;
  currentUserName = null;
  currentUserId = null;
  currentUserEmail = null;
  currentProfile = null;
  userLabel.textContent = "Laboratorio de Óptica Biomédica UPT";
  logoutBtn.classList.add("hidden");
  const listaAlertasAdmin = document.getElementById("lista-alertas-admin");
  if (listaAlertasAdmin) listaAlertasAdmin.innerHTML = "";
  updateNavForRole(null);
  setAuthTab("login-panel");
  showView(GUEST_LANDING_VIEW);
  closeModal("modal-edicion");
  resetSkinFormForCurrentSession();
});

function renderReadOnlyFormResult(fototipo) {
  const statusCard = document.getElementById("formEstadoCuenta");
  if (!statusCard) return;

  statusCard.innerHTML = `
    <h3>Formulario ya completado</h3>
    <p>Ya has realizado este formulario en tu cuenta.</p>
    <p><strong>Tu Fototipo de Piel es:</strong> ${fototipo || "No disponible"}</p>
    <p id="resumenRecomendacionCuenta" class="muted"></p>
  `;

  const recomendaciones = {
    I: "Protección SPF 50+, evita exposición directa y usa barreras físicas.",
    II: "Protección alta diaria con reaplicación frecuente.",
    III: "SPF 30-50 y protección especial en horas de mayor radiación.",
    IV: "SPF 30 y seguimiento preventivo continuo.",
    "V y VI": "SPF 15-30 para prevenir daño acumulado y fotoenvejecimiento.",
  };

  const recEl = document.getElementById("resumenRecomendacionCuenta");
  if (recEl) recEl.textContent = recomendaciones[fototipo] || "Mantén hábitos de protección solar adecuados.";

  statusCard.classList.remove("hidden");
  statusCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetSkinFormForCurrentSession() {
  const skinForm = document.querySelector(".skin-form");
  const statusCard = document.getElementById("formEstadoCuenta");
  const resultadoDiv = document.getElementById("resultadoFototipo");

  if (skinForm) {
    skinForm.reset();
    skinForm.classList.remove("form-locked");
  }

  if (statusCard) {
    statusCard.classList.add("hidden");
    statusCard.innerHTML = "";
  }

  if (resultadoDiv) resultadoDiv.classList.add("hidden");
}

async function syncFormAccessForCurrentAccount() {
  const statusCard = document.getElementById("formEstadoCuenta");
  const skinForm = document.querySelector(".skin-form");
  const correoInput = document.getElementById("correo");
  if (!statusCard || !skinForm || !currentUserId) return;

  if (currentUserEmail && correoInput && !correoInput.value) {
    correoInput.value = currentUserEmail;
  }

  statusCard.classList.add("hidden");
  statusCard.innerHTML = "";
  skinForm.classList.remove("form-locked");

  let perfil = null;
  const perfilResp = await supabaseClient
    .from("perfiles")
    .select("test_fototipo_completado")
    .eq("id", currentUserId)
    .maybeSingle();

  if (!perfilResp.error) {
    perfil = perfilResp.data;
  } else if (!shouldFallbackOnSchemaError(perfilResp.error, "test_fototipo_completado")) {
    console.error("Error al consultar perfiles:", perfilResp.error);
  }

  currentProfile = { ...(currentProfile || {}), ...(perfil || {}) };

  if (canManageAsAdmin()) {
    clearSavedFormStepProgress();
    setActiveFormStepById(FORM_INITIAL_STEP);
    return;
  }

  const completedFromProfile = Boolean(perfil?.test_fototipo_completado);
  const porUsuario = await supabaseClient
    .from("voluntarios")
    .select("fototipo_de_piel")
    .eq("user_id", currentUserId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  let ultimoRegistro = porUsuario.data;

  if (!ultimoRegistro?.fototipo_de_piel) {
    const correoBusqueda = String(currentUserEmail || "").trim().toLowerCase();
    if (correoBusqueda) {
      const porCorreo = await supabaseClient
        .from("voluntarios")
        .select("fototipo_de_piel")
        .eq("correo", correoBusqueda)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!porCorreo.error) {
        ultimoRegistro = porCorreo.data;
      }
    }
  }

  if (completedFromProfile || ultimoRegistro?.fototipo_de_piel) {
    renderReadOnlyFormResult(ultimoRegistro?.fototipo_de_piel || "No disponible");
    skinForm.classList.add("form-locked");
    const resultadoDiv = document.getElementById("resultadoFototipo");
    if (resultadoDiv) resultadoDiv.classList.add("hidden");
    return;
  }

  setActiveFormStepById(readSavedFormStepProgress() || FORM_INITIAL_STEP);
}

async function initSession(user) {
  isLoggedIn = true;
  resetSkinFormForCurrentSession();
  const { data: perfil } = await supabaseClient
    .from("perfiles")
    .select("nombre, role, test_fototipo_completado")
    .eq("id", user.id)
    .maybeSingle();

  currentRole = resolveRoleFromProfile(perfil, user.email, user);
  currentUserName = perfil?.nombre || user.email;
  currentUserId = user.id;
  currentUserEmail = user.email || null;
  currentProfile = perfil || null;

  const roleLabel = currentRole === "admin"
    ? "Doctora/Administrador"
    : currentRole === "desarrollador"
      ? "Desarrollador"
      : "Voluntario";
  userLabel.textContent = `${currentUserName} (${roleLabel})`;
  logoutBtn.classList.remove("hidden");
  updateNavForRole(currentRole);
  const adminArchivoManager = document.getElementById("admin-archivo-manager");
  if (adminArchivoManager) adminArchivoManager.classList.toggle("hidden", !canManageAsAdmin());
  renderManagedArticles();

  // Redirección automática tras login a la sección Equipo y proyecto.
  showView(AUTH_LANDING_VIEW);

  if (currentRole === "admin" || currentRole === "desarrollador") {
    await cargarVoluntarios();
    await cargarAlertasAdmin();
  }

  const settings = readDevSettings();
  if (devColorTheme) devColorTheme.value = settings.color;
  if (devUiVariant) devUiVariant.value = settings.uiVariant;
  if (devFontFamily) devFontFamily.value = settings.fontFamily;
  refreshDeveloperDock();
  await loadGlobalDeveloperConfig();

  await syncFormAccessForCurrentAccount();
}


async function restoreSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session?.user) {
    await initSession(data.session.user);
  } else {
    await loadGlobalDeveloperConfig();
    updateNavForRole(null);
    renderManagedArticles();
    setAuthTab("login-panel");
    showView(GUEST_LANDING_VIEW);
    toggleEditMode(false);
    refreshDeveloperDock();
  }
}

// Vista inicial para invitados mientras se restaura sesión.
showView(GUEST_LANDING_VIEW);

const tablaVoluntarios = document.getElementById("tabla-voluntarios");
const formVoluntario = document.getElementById("form-voluntario");
const inputId = document.getElementById("vol-id");
const inputIdentificador = document.getElementById("vol-identificador");
const inputSexo = document.getElementById("vol-sexo");
const inputEdad = document.getElementById("vol-edad");
const inputCarrera = document.getElementById("vol-carrera");
const inputCorreo = document.getElementById("vol-correo");
const inputFototipo = document.getElementById("vol-fototipo");
const inputFecha = document.getElementById("vol-fecha");
const inputEspectros = document.getElementById("vol-espectros");
const inputImagenes = document.getElementById("vol-imagenes");
const btnGuardarVol = document.getElementById("btn-guardar-vol");
const btnCancelarEdicion = document.getElementById("btn-cancelar-edicion");
const contadorVoluntarios = document.getElementById("contador-voluntarios");
const inputBusquedaVoluntario = document.getElementById("busqueda-voluntario");
const btnNuevoVoluntario = document.getElementById("btn-nuevo-voluntario");
const btnPapeleraVoluntarios = document.getElementById("btn-papelera-voluntarios");
const tablaPapeleraVoluntarios = document.getElementById("tabla-papelera-voluntarios");
const btnConfirmarEliminarVol = document.getElementById("btn-confirmar-eliminar-vol");
const textoEliminarVoluntario = document.getElementById("texto-eliminar-voluntario");

const modalDetalles = document.getElementById("modal-detalles");
const modalArchivos = document.getElementById("modal-archivos");
const modalEdicion = document.getElementById("modal-edicion");
const detalleVoluntario = document.getElementById("detalle-voluntario");
const detalleArchivos = document.getElementById("detalle-archivos");

let idEnEdicion = null;
let voluntariosFiltrados = [];
let idPendienteEliminar = null;

function normalizeFototipoForSelect(value) {
  if (!value) return "";
  const clean = String(value).toUpperCase().replace("FOTOTIPO", "").trim();
  const mapping = { I: "I", II: "II", III: "III", IV: "IV", V: "V y VI", VI: "V y VI", "V Y VI": "V y VI" };
  return mapping[clean] || "";
}

function readTrashVolunteers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOLUNTEER_TRASH_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveTrashVolunteers(items) {
  localStorage.setItem(VOLUNTEER_TRASH_STORAGE_KEY, JSON.stringify(items));
}

async function hardDeleteVolunteer(voluntarioId) {
  await supabaseClient.from("espectros").delete().eq("voluntario_id", voluntarioId);
  await supabaseClient.from("imagenes").delete().eq("voluntario_id", voluntarioId);
  const { error } = await supabaseClient.from("voluntarios").delete().eq("id", voluntarioId);
  return !error;
}

async function purgeExpiredTrash() {
  const now = Date.now();
  const items = readTrashVolunteers();
  const keep = [];
  for (const item of items) {
    if (now - Number(item.deletedAt || 0) >= TRASH_RETENTION_MS) {
      await hardDeleteVolunteer(item.id);
    } else {
      keep.push(item);
    }
  }
  saveTrashVolunteers(keep);
}

function getActiveTrashIds() {
  const now = Date.now();
  return new Set(readTrashVolunteers().filter((item) => now - Number(item.deletedAt || 0) < TRASH_RETENTION_MS).map((item) => item.id));
}

async function cargarVoluntarios() {
  await purgeExpiredTrash();
  const { data, error } = await supabaseClient
    .from("voluntarios")
    .select(`
      id,
      identificador,
      sexo,
      edad,
      carrera,
      correo,
      fototipo_de_piel,
      fecha,
      espectros(id, espectro_path),
      imagenes(id, imagen_path)
    `)
    .order("id", { ascending: true });

  if (error) {
    console.error("Error al cargar voluntarios:", error);
    return;
  }

  const trashIds = getActiveTrashIds();
  voluntariosCache = (data || []).filter((item) => !trashIds.has(item.id));
  aplicarFiltroVoluntarios();
  actualizarDashboard();
}

function applyVoluntariosCount() {
  if (!contadorVoluntarios) return;
  contadorVoluntarios.textContent = `Total: ${voluntariosFiltrados.length} voluntarios`;
}

function aplicarFiltroVoluntarios() {
  const query = String(inputBusquedaVoluntario?.value || "").trim().toLowerCase();
  voluntariosFiltrados = voluntariosCache.filter((v) => {
    if (!query) return true;
    const matricula = String(v.identificador || "").toLowerCase();
    const correo = String(v.correo || "").toLowerCase();
    return matricula.includes(query) || correo.includes(query);
  });

  renderVoluntarios();
  applyVoluntariosCount();
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("hidden");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("hidden");
}

function renderVoluntarios() {
  tablaVoluntarios.innerHTML = "";

  voluntariosFiltrados.forEach((v, index) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><strong>${index + 1}</strong><br><span class="muted small">ID real: ${v.id}</span></td>
      <td>${v.identificador || ""}</td>
      <td>${v.correo || ""}</td>
      <td>
        <div class="actions-inline">
          <button class="btn btn-small btn-action-detail" data-action="ver-detalles" data-id="${v.id}">ℹ️ Ver detalles</button>
          <button class="btn btn-small btn-action-files" data-action="ver-archivos" data-id="${v.id}">🖼️ Ver imágenes</button>
          <button class="btn btn-small btn-outline" data-action="editar" data-id="${v.id}">✏️ Editar</button>
          <button class="btn btn-small btn-danger" data-action="eliminar" data-id="${v.id}">🗑️ Eliminar</button>
        </div>
      </td>
    `;

    tablaVoluntarios.appendChild(tr);
  });
}

function mostrarDetalles(vol) {
  if (!vol || !detalleVoluntario) return;

  detalleVoluntario.innerHTML = `
    <p><strong>Matrícula:</strong><br>${vol.identificador || "-"}</p>
    <p><strong>Sexo:</strong><br>${vol.sexo || "-"}</p>
    <p><strong>Edad:</strong><br>${vol.edad ? `${vol.edad} años` : "-"}</p>
    <p><strong>Carrera:</strong><br>${vol.carrera || "-"}</p>
    <p><strong>Fototipo:</strong><br>${vol.fototipo_de_piel || "-"}</p>
    <p><strong>Fecha de registro:</strong><br>${vol.fecha || "-"}</p>
    <p class="full"><strong>Correo electrónico:</strong><br>${vol.correo || "-"}</p>
  `;

  openModal("modal-detalles");
}

function renderFileBlock({ title, badgeText, desc, buttonText, items, bucket, pathKey, tone = "" }) {
  const links = items
    .map((item) => {
      const path = item[pathKey];
      const url = supabaseClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${path}</a></li>`;
    })
    .join("");

  return `
    <section class="file-block ${tone}">
      <div class="file-block-header">
        <h4>${title}</h4>
        <span class="file-badge">${badgeText}</span>
      </div>
      <p class="muted">${desc}</p>
      <div class="file-links-wrap">
        <button type="button" class="btn btn-outline btn-small" disabled>${buttonText}</button>
        <ul class="link-list">${links || "<li class='muted small'>Sin archivos disponibles.</li>"}</ul>
      </div>
    </section>
  `;
}

function mostrarArchivos(vol) {
  if (!vol || !detalleArchivos) return;

  const espectros = vol.espectros || [];
  const imagenes = vol.imagenes || [];

  detalleArchivos.innerHTML = `
    <p class="muted">Espectros e imágenes del voluntario ${vol.identificador || ""}</p>
    ${renderFileBlock({
      title: "Archivos de espectros (.txt)",
      badgeText: `${espectros.length} archivos`,
      desc: "Los archivos de espectros están almacenados en Supabase y pueden descargarse desde aquí.",
      buttonText: `Ver archivos (${espectros.length})`,
      items: espectros,
      bucket: "espectros",
      pathKey: "espectro_path",
    })}
    ${renderFileBlock({
      title: "Imágenes (.png)",
      badgeText: `${imagenes.length} imágenes`,
      desc: "Las imágenes capturadas están disponibles para visualización y descarga.",
      buttonText: `Ver imágenes (${imagenes.length})`,
      items: imagenes,
      bucket: "imagenes",
      pathKey: "imagen_path",
      tone: "tone-cyan",
    })}
  `;

  openModal("modal-archivos");
}

tablaVoluntarios.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const id = Number(btn.dataset.id);
  const vol = voluntariosCache.find((v) => v.id === id);
  const action = btn.dataset.action;

  if (action === "ver-detalles") mostrarDetalles(vol);
  if (action === "ver-archivos") mostrarArchivos(vol);

  if (action === "editar") {
    if (!isLoggedIn || !canManageAsAdmin()) {
      showToast("Solo la Doctora/Administrador puede editar voluntarios.");
      return;
    }
    cargarEnFormulario(vol);
    openModal("modal-edicion");
  }

  if (action === "eliminar") {
    if (!isLoggedIn || !canManageAsAdmin()) {
      showToast("No tienes permiso para eliminar voluntarios.");
      return;
    }
    idPendienteEliminar = id;
    if (textoEliminarVoluntario) {
      textoEliminarVoluntario.textContent = `¿Deseas enviar a papelera al voluntario ${vol?.identificador || id}? Podrá recuperarse durante 5 días.`;
    }
    openModal("modal-confirmar-eliminacion");
  }
});

if (btnNuevoVoluntario) {
  btnNuevoVoluntario.addEventListener("click", () => {
    resetFormulario();
    openModal("modal-edicion");
  });
}

if (btnConfirmarEliminarVol) {
  btnConfirmarEliminarVol.addEventListener("click", async () => {
    if (!idPendienteEliminar) return;
    const currentTrash = readTrashVolunteers();
    if (!currentTrash.some((item) => item.id === idPendienteEliminar)) {
      currentTrash.push({ id: idPendienteEliminar, deletedAt: Date.now() });
      saveTrashVolunteers(currentTrash);
    }
    closeModal("modal-confirmar-eliminacion");
    idPendienteEliminar = null;
    await cargarVoluntarios();
    showToast("Voluntario enviado a papelera. Se eliminará definitivamente en 5 días.", "success");
  });
}

function renderTrashTable() {
  if (!tablaPapeleraVoluntarios) return;
  const now = Date.now();
  const trash = readTrashVolunteers().filter((item) => now - Number(item.deletedAt || 0) < TRASH_RETENTION_MS);
  if (!trash.length) {
    tablaPapeleraVoluntarios.innerHTML = "<tr><td colspan='5' class='muted small'>No hay elementos en papelera.</td></tr>";
    return;
  }
  tablaPapeleraVoluntarios.innerHTML = trash.map((item) => {
    const original = voluntariosCache.find((v) => v.id === item.id);
    const deletedAt = new Date(item.deletedAt).toLocaleString("es-MX");
    const expiresAt = new Date(item.deletedAt + TRASH_RETENTION_MS).toLocaleString("es-MX");
    return `<tr>
      <td>${item.id}</td>
      <td>${original?.identificador || "Oculto temporalmente"}</td>
      <td>${deletedAt}</td>
      <td>${expiresAt}</td>
      <td><button class="btn btn-small btn-primary" data-action="restaurar-vol" data-id="${item.id}">Restaurar</button></td>
    </tr>`;
  }).join("");
}

if (btnPapeleraVoluntarios) {
  btnPapeleraVoluntarios.addEventListener("click", async () => {
    await purgeExpiredTrash();
    renderTrashTable();
    openModal("modal-papelera");
  });
}

if (tablaPapeleraVoluntarios) {
  tablaPapeleraVoluntarios.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action='restaurar-vol']");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const next = readTrashVolunteers().filter((item) => item.id !== id);
    saveTrashVolunteers(next);
    renderTrashTable();
    await cargarVoluntarios();
    showToast("Voluntario restaurado correctamente.", "success");
  });
}

if (inputBusquedaVoluntario) {
  inputBusquedaVoluntario.addEventListener("input", aplicarFiltroVoluntarios);
}

document.addEventListener("click", (e) => {
  const closeBtn = e.target.closest("[data-close-modal]");
  if (closeBtn) {
    closeModal(closeBtn.dataset.closeModal);
    return;
  }

  const modalBackdrop = e.target.classList?.contains("modal") ? e.target : null;
  if (modalBackdrop?.id) closeModal(modalBackdrop.id);
});

function cargarEnFormulario(vol) {
  if (!vol) return;
  idEnEdicion = vol.id;
  inputId.value = vol.id;
  inputIdentificador.value = vol.identificador || "";
  inputSexo.value = vol.sexo || "";
  inputEdad.value = vol.edad || "";
  inputCarrera.value = vol.carrera || "";
  inputCorreo.value = vol.correo || "";
  inputFototipo.value = normalizeFototipoForSelect(vol.fototipo_de_piel);
  inputFecha.value = vol.fecha || "";
  inputEspectros.value = "";
  inputImagenes.value = "";
  btnGuardarVol.textContent = "Actualizar voluntario";
  btnCancelarEdicion.classList.remove("hidden");
}

function resetFormulario() {
  formVoluntario.reset();
  idEnEdicion = null;
  inputId.value = "";
  btnGuardarVol.textContent = "Guardar voluntario";
  btnCancelarEdicion.classList.add("hidden");
}
btnCancelarEdicion.addEventListener("click", () => {
  resetFormulario();
  closeModal("modal-edicion");
});

formVoluntario.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!isLoggedIn || !canManageAsAdmin()) {
    showToast("Solo la Doctora/Administrador puede registrar o editar voluntarios.");
    return;
  }

  const identificador = inputIdentificador.value.trim();
  const sexo = inputSexo.value;
  const edad = parseInt(inputEdad.value, 10);
  const carrera = inputCarrera.value.trim();
  const correo = inputCorreo.value.trim();
  const fototipo = inputFototipo.value;
  const fecha = inputFecha.value;

  if (!/^\d+$/.test(identificador)) {
    showToast("El identificador debe contener solo números.");
    return;
  }

  if (!identificador || !sexo || !carrera || !fototipo || !fecha || !Number.isFinite(edad)) {
    showToast("Por favor, completa todos los campos obligatorios.");
    return;
  }

  if (!/^[^\s@]+@upt\.edu\.mx$/i.test(correo)) {
    showToast("El correo debe ser institucional y terminar en @upt.edu.mx.");
    return;
  }

  let voluntarioId;
  const payload = { identificador, sexo, edad, carrera, correo, fototipo_de_piel: fototipo, fecha };

  if (idEnEdicion) {
    const { data, error } = await supabaseClient.from("voluntarios").update(payload).eq("id", idEnEdicion).select().single();
    if (error) {
      showToast("Error al actualizar voluntario.");
      return;
    }
    voluntarioId = data.id;
  } else {
    const { data, error } = await supabaseClient.from("voluntarios").insert(payload).select().single();
    if (error) {
      showToast("Error al guardar voluntario.");
      return;
    }
    voluntarioId = data.id;
  }

  for (const file of Array.from(inputEspectros.files || [])) {
    const path = `voluntarios/${voluntarioId}/espectros/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabaseClient.storage.from("espectros").upload(path, file);
    if (!upErr) await supabaseClient.from("espectros").insert({ voluntario_id: voluntarioId, espectro_path: path });
  }

  for (const file of Array.from(inputImagenes.files || [])) {
    const path = `voluntarios/${voluntarioId}/imagenes/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabaseClient.storage.from("imagenes").upload(path, file);
    if (!upErr) await supabaseClient.from("imagenes").insert({ voluntario_id: voluntarioId, imagen_path: path });
  }

  resetFormulario();
  closeModal("modal-edicion");
  await cargarVoluntarios();
}
);

// Formulario fototipo
const questionGroups = ["ojos", "cabello", "piel_base", "pecas", "quemadura", "bronceado", "horas_sol", "rostro", "ultima_vez", "regular"];

function validarNombreCompleto(nombre) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return partes.length >= 2;
}

function validarCorreo(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(correo || "").trim());
}

function getSelectedValue(name) {
  const selected = document.querySelector(`input[name="${name}"]:checked`);
  return selected ? Number(selected.value) : null;
}

function validateCurrentStep(targetStep) {
  if (targetStep === 1) {
    const nombre = document.getElementById("nombreConsentimiento").value.trim();
    const aceptaPrimario = document.getElementById("aceptaConsentimiento").checked;
    const aceptaSecundario = document.getElementById("aceptaConfidencialidad").checked;

    if (!validarNombreCompleto(nombre)) {
      showToast("Debes capturar al menos nombre y apellido.");
      return false;
    }

    if (!aceptaPrimario || !aceptaSecundario) {
      showToast("Debes aceptar ambas casillas de consentimiento para continuar.");
      return false;
    }

    return true;
  }

  if (targetStep === 2) {
    const identificador = document.getElementById("identificador").value.trim();
    const edad = document.getElementById("edad").value;
    const sexo = document.getElementById("sexo").value;
    const carrera = document.getElementById("carrera").value.trim();
    const correo = document.getElementById("correo").value.trim();

    if (!/^\d+$/.test(identificador)) {
      showToast("La matrícula/identificador debe contener solo números.");
      return false;
    }

    if (!identificador || !edad || !sexo || !carrera || !correo) {
      showToast("Completa todos los datos obligatorios antes de continuar.");
      return false;
    }

    if (!validarCorreo(correo)) {
      showToast("Captura un correo electrónico válido.");
      return false;
    }

    return true;
  }

  if (targetStep === 3) {
    const pendientes = ["ojos", "cabello", "piel_base", "pecas"].filter((q) => getSelectedValue(q) === null);
    if (pendientes.length) {
      showToast("Debes contestar todas las preguntas de Disposición Genética.");
      return false;
    }
    return true;
  }

  if (targetStep === 4) {
    const pendientes = ["quemadura", "bronceado", "horas_sol", "rostro"].filter((q) => getSelectedValue(q) === null);
    if (pendientes.length) {
      showToast("Debes contestar todas las preguntas de Reacción Solar.");
      return false;
    }
    return true;
  }

  return true;
}

const FORM_INITIAL_STEP = "consentimientoSection";
const FORM_ORDER = [FORM_INITIAL_STEP, "step1", "step2", "step3", "step4"];
let formCurrentStepIndex = 0;


function getFormProgressStorageKey() {
  return currentUserId ? `fototipo-step-${currentUserId}` : null;
}

function saveCurrentFormStepProgress(stepId) {
  const key = getFormProgressStorageKey();
  if (!key) return;
  localStorage.setItem(key, stepId);
}

function readSavedFormStepProgress() {
  const key = getFormProgressStorageKey();
  if (!key) return null;
  const saved = localStorage.getItem(key);
  return FORM_ORDER.includes(saved) ? saved : null;
}

function clearSavedFormStepProgress() {
  const key = getFormProgressStorageKey();
  if (!key) return;
  localStorage.removeItem(key);
}

function renderFormProgress(stepId) {
  const progressFill = document.getElementById("form-progress-fill");
  const progressText = document.getElementById("form-progress-text");
  const steps = document.querySelectorAll(".progress-step");
  const currentIndex = Math.max(0, FORM_ORDER.indexOf(stepId));
  const totalSteps = FORM_ORDER.length;
  const percent = Math.round(((currentIndex + 1) / totalSteps) * 100);

  if (progressFill) progressFill.style.width = `${percent}%`;
  if (progressText) progressText.textContent = `${percent}% completado`;

  steps.forEach((step) => {
    const stepIndex = Number(step.dataset.stepIndex || 0);
    step.classList.toggle("completed", stepIndex < currentIndex);
    step.classList.toggle("active", stepIndex === currentIndex);
  });
}

function setActiveFormStepById(stepId) {
  const targetIndex = FORM_ORDER.indexOf(stepId);
  if (targetIndex === -1) return;

  document.querySelectorAll(".step").forEach((step) => step.classList.remove("active"));
  const target = document.getElementById(stepId);
  if (target) target.classList.add("active");
  formCurrentStepIndex = targetIndex;
  saveCurrentFormStepProgress(stepId);
  renderFormProgress(stepId);

  const prevButtons = document.querySelectorAll(`#${stepId} .btn-prev-step`);
  prevButtons.forEach((btn) => {
    btn.classList.toggle("hidden", stepId === "step1");
  });
}

function nextStep(stepNumber) {
  if (!validateCurrentStep(stepNumber)) return;

  const nextId = `step${stepNumber}`;
  setActiveFormStepById(nextId);
}
window.nextStep = nextStep;

function prevStep() {
  const previousIndex = Math.max(0, formCurrentStepIndex - 1);
  const previousId = FORM_ORDER[previousIndex];
  setActiveFormStepById(previousId);
}
window.prevStep = prevStep;

function cancelarFormularioFototipo() {
  const formulario = document.querySelector(".skin-form");
  if (formulario) formulario.reset();

  const resultadoDiv = document.getElementById("resultadoFototipo");
  if (resultadoDiv) resultadoDiv.classList.add("hidden");

  clearSavedFormStepProgress();
  setActiveFormStepById(FORM_INITIAL_STEP);
  showToast("Formulario cancelado. Regresaste a la autorización inicial.", "info");
}
window.cancelarFormularioFototipo = cancelarFormularioFototipo;

function calcularFototipo(total) {
  if (total <= 6) return "I";
  if (total <= 13) return "II";
  if (total <= 20) return "III";
  if (total <= 27) return "IV";
  if (total <= 34) return "V y VI";
  return "V y VI";
}

function llenarInfoFototipo(tipo) {
  const desc = document.getElementById("descripcionFototipo");
  const rec = document.getElementById("recomendacionFototipo");
  const info = getFototipoDetails(tipo);

  desc.textContent = info.descripcion;
  rec.textContent = info.recomendacion;
}

function mostrarResultadoBonito(tipo) {
  const resultadoDiv = document.getElementById("resultadoFototipo");
  const titulo = document.getElementById("tipoFototipo");
  titulo.textContent = `Tu fototipo es: ${tipo}`;
  llenarInfoFototipo(tipo);
  resultadoDiv.classList.remove("hidden");
  resultadoDiv.scrollIntoView({ behavior: "smooth" });
}

async function guardarVoluntario() {
  if (!isLoggedIn || !currentUserId) {
    showToast("Debes iniciar sesión para guardar el formulario.");
    return;
  }

  if (!canManageAsAdmin()) {
    const completed = await hasVolunteerCompletedForm();
    if (completed) {
      showToast("Ya has realizado este formulario con tu cuenta.", "info");
      await syncFormAccessForCurrentAccount();
      return;
    }
  }

  if (!validateCurrentStep(4)) return;

  const pendientesFinal = ["ultima_vez", "regular"].filter((q) => getSelectedValue(q) === null);
  if (pendientesFinal.length) {
    showToast("Debes contestar todas las preguntas antes de finalizar.");
    return;
  }

  if (!questionGroups.every((q) => getSelectedValue(q) !== null)) {
    showToast("Todas las preguntas del test son obligatorias.");
    return;
  }

  const identificador = document.getElementById("identificador").value.trim();
  const edad = Number(document.getElementById("edad").value);
  const sexo = document.getElementById("sexo").value;
  const carrera = document.getElementById("carrera").value.trim();
  const correo = document.getElementById("correo").value.trim();
  const nombreConsentimiento = document.getElementById("nombreConsentimiento").value.trim();

  const total = questionGroups.reduce((acc, q) => acc + getSelectedValue(q), 0);
  const fototipo = calcularFototipo(total);
  const correoFormulario = canManageAsAdmin()
    ? correo
    : String(currentUserEmail || correo).trim().toLowerCase();

  const { data: authData } = await supabaseClient.auth.getUser();
  const user = authData.user;
  if (!user) {
    showToast("Sesión expirada. Vuelve a iniciar sesión.");
    return;
  }

  await updateProfileCompletionState(user.id, nombreConsentimiento);

  const payload = {
    user_id: currentUserId,
    identificador,
    sexo,
    edad,
    carrera,
    correo: correoFormulario,
    fototipo_de_piel: fototipo,
    fecha: new Date().toISOString().slice(0, 10),
  };

  let { error } = await supabaseClient.from("voluntarios").insert(payload);
  if (shouldFallbackOnSchemaError(error, "user_id")) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.user_id;
    const fallbackInsert = await supabaseClient.from("voluntarios").insert(fallbackPayload);
    error = fallbackInsert.error;
  }

  if (error) {
    console.error(error);
    showToast(`No se pudo guardar la información del voluntario. ${error.message || ""}`);
    return;
  }

  clearSavedFormStepProgress();
  mostrarResultadoBonito(fototipo);

  await notifyVolunteerFototipo({ email: correoFormulario, nombre: nombreConsentimiento, fototipo });

  if (canManageAsAdmin()) {
    await cargarVoluntarios();
  } else {
    await notifyAdminVolunteerCompletedForm({ email: correoFormulario, fototipo });
    await syncFormAccessForCurrentAccount();
  }
}
window.guardarVoluntario = guardarVoluntario;

// Dashboard
const statTotal = document.getElementById("stat-total");
const statEdadPromedio = document.getElementById("stat-edad-promedio");
const statSexo = document.getElementById("stat-sexo");
const statTiposPiel = document.getElementById("stat-tipos-piel");
const chartSexo = document.getElementById("chart-sexo");
const chartPiel = document.getElementById("chart-piel");
const chartEdad = document.getElementById("chart-edad");

function renderBarChart(container, data) {
  container.innerHTML = "";
  if (!data.length) return;

  const max = Math.max(...data.map((d) => d.value), 1);
  data.forEach((item) => {
    const bar = document.createElement("div");
    bar.className = "bar";

    const inner = document.createElement("div");
    inner.className = "bar-inner";
    inner.style.height = `${(item.value / max) * 100}%`;

    const valueLabel = document.createElement("div");
    valueLabel.className = "bar-value";
    valueLabel.textContent = item.value;

    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = item.label;

    bar.append(inner, valueLabel, label);
    container.appendChild(bar);
  });
}

function actualizarDashboard() {
  const total = voluntariosCache.length;
  statTotal.textContent = total;

  if (total === 0) {
    statEdadPromedio.textContent = "0";
    statSexo.textContent = "-";
    statTiposPiel.textContent = "-";
    chartSexo.innerHTML = "";
    chartPiel.innerHTML = "";
    chartEdad.innerHTML = "";
    return;
  }

  const edadProm = voluntariosCache.reduce((sum, v) => sum + Number(v.edad || 0), 0) / total;
  statEdadPromedio.textContent = edadProm.toFixed(1);

  const conteoSexo = { F: 0, M: 0, Otro: 0 };
  voluntariosCache.forEach((v) => {
    if (v.sexo === "F" || v.sexo === "M") conteoSexo[v.sexo] += 1;
    else conteoSexo.Otro += 1;
  });

  const porcF = ((conteoSexo.F / total) * 100).toFixed(1);
  const porcM = ((conteoSexo.M / total) * 100).toFixed(1);
  statSexo.textContent = `F: ${porcF}% · M: ${porcM}%`;

  const conteoPiel = {};
  voluntariosCache.forEach((v) => {
    const t = v.fototipo_de_piel || "N/A";
    conteoPiel[t] = (conteoPiel[t] || 0) + 1;
  });
  statTiposPiel.textContent = Object.keys(conteoPiel).join(", ");

  renderBarChart(chartSexo, [
    { label: "F", value: conteoSexo.F },
    { label: "M", value: conteoSexo.M },
    { label: "Otro", value: conteoSexo.Otro },
  ]);

  renderBarChart(
    chartPiel,
    Object.entries(conteoPiel).map(([label, value]) => ({ label, value }))
  );

  const gruposEdad = { "<18": 0, "18-30": 0, "31-45": 0, "46+": 0 };
  voluntariosCache.forEach((v) => {
    const e = Number(v.edad || 0);
    if (e < 18) gruposEdad["<18"] += 1;
    else if (e <= 30) gruposEdad["18-30"] += 1;
    else if (e <= 45) gruposEdad["31-45"] += 1;
    else gruposEdad["46+"] += 1;
  });

  renderBarChart(
    chartEdad,
    Object.entries(gruposEdad).map(([label, value]) => ({ label, value }))
  );
}

const btnRefrescarAlertas = document.getElementById("btn-refrescar-alertas");
if (btnRefrescarAlertas) {
  btnRefrescarAlertas.addEventListener("click", () => {
    cargarAlertasAdmin();
  });
}

applyDevSettings();
loadManagedArticles();
restoreSession();
})();
