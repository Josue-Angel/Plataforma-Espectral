(() => {
const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const viewPermissions = {
  inicio: ["admin", "voluntario"],
  equipo: ["admin", "voluntario"],
  "base-datos": ["admin"],
  formularios: ["admin", "voluntario"],
  "modelo-ia": ["admin"],
  archivos: ["admin", "voluntario"],
  dashboard: ["admin"],
};

let voluntariosCache = [];
let currentRole = null;
let isLoggedIn = false;
let currentUserName = null;
let currentUserId = null;
let currentUserEmail = null;
let currentProfile = null;

const views = document.querySelectorAll(".view");
const navLinks = document.querySelectorAll("#nav-links a");
const userLabel = document.getElementById("user-label");
const logoutBtn = document.getElementById("logout-btn");
const headerEl = document.querySelector(".header");

const GUEST_LANDING_VIEW = "inicio";
const AUTH_LANDING_VIEW = "equipo";
const ADMIN_EMAILS = ["admin@ejemplo.com"];
const ADMIN_NOTIFICATION_EMAIL = "admin@ejemplo.com";
const ADMIN_NOTIFICATIONS_STORAGE_KEY = "admin-notificaciones-local";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_API_KEY_VALUE = window.RESEND_API_KEY || "";
const RESEND_API_KEY = window.RESEND_API_KEY || "";
const BREVO_API_KEY = window.BREVO_API_KEY || "";
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const SMTP2GO_API_KEY = window.SMTP2GO_API_KEY || "";
const SMTP2GO_API_KEY_FALLBACK = (!SMTP2GO_API_KEY && /^api-/i.test(String(RESEND_API_KEY_VALUE || ""))) ? RESEND_API_KEY_VALUE : "";
const SMTP2GO_ENDPOINT = "https://api.smtp2go.com/v3/email/send";
const FROM_EMAIL = window.NOTIFICATION_FROM_EMAIL || "onboarding@resend.dev";

function resolveRoleFromProfile(perfil, userEmail) {
  const roleFromProfile = perfil?.role ? String(perfil.role).trim().toLowerCase() : "";
  if (roleFromProfile === "admin" || roleFromProfile === "voluntario") return roleFromProfile;

  const normalizedEmail = String(userEmail || "").trim().toLowerCase();
  if (ADMIN_EMAILS.includes(normalizedEmail)) return "admin";

  return "voluntario";
}

function getFototipoDetails(tipo) {
  const info = {
    I: { descripcion: "Piel muy clara, se quema con mucha facilidad.", recomendacion: "Usa SPF 50+ y evita el sol directo." },
    II: { descripcion: "Piel clara con alta sensibilidad al sol.", recomendacion: "Protección alta y reaplicación frecuente." },
    III: { descripcion: "Piel intermedia, puede quemarse y broncearse gradualmente.", recomendacion: "SPF 30-50 y protección en horas pico." },
    IV: { descripcion: "Piel morena clara, menor riesgo de quemadura severa.", recomendacion: "SPF 30 y cuidado continuo." },
    "V y VI": { descripcion: "Piel morena oscura/oscura, alta tolerancia al sol.", recomendacion: "SPF 15-30 para prevenir daño acumulado." },
  };

  return info[tipo] || {
    descripcion: "Fototipo no disponible.",
    recomendacion: "Mantén hábitos de protección solar adecuados.",
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
  const status = String(error.status || "");
  return code === "22P02" || code === "22023" || code === "PGRST100" || status === "400";
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

async function sendEmailNotification({ to, subject, html }) {
  const normalizedTo = String(to || "").trim();
  const providers = [];

  if (SMTP2GO_API_KEY_FALLBACK) {
    console.warn("Se detectó una clave con formato SMTP2GO en RESEND_API_KEY. Se usará como fallback de SMTP2GO.");
  }

  if (RESEND_API_KEY_VALUE) {
    providers.push(async () => {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY_VALUE}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [normalizedTo],
          subject,
          html,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || "Error al enviar correo con Resend.");
      }

      return { skipped: false, payload, provider: "resend" };
    });
  }

  if (BREVO_API_KEY) {
    providers.push(async () => {
      const response = await fetch(BREVO_ENDPOINT, {
        method: "POST",
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: { email: FROM_EMAIL, name: "Proyecto Espectral" },
          to: [{ email: normalizedTo }],
          subject,
          htmlContent: html,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.code || "Error al enviar correo con Brevo.");
      }

      return { skipped: false, payload, provider: "brevo" };
    });
  }

  const smtp2goKey = SMTP2GO_API_KEY || SMTP2GO_API_KEY_FALLBACK;
  if (smtp2goKey) {
    providers.push(async () => {
      const response = await fetch(SMTP2GO_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: smtp2goKey,
          sender: FROM_EMAIL,
          to: [normalizedTo],
          subject,
          html_body: html,
        }),
      });

      const payload = await response.json();
      const okByBody = payload?.data?.succeeded > 0 || payload?.succeeded > 0;
      if (!response.ok || !okByBody) {
        throw new Error(payload?.data?.error || payload?.error || "Error al enviar correo con SMTP2GO.");
      }

      return { skipped: false, payload, provider: "smtp2go" };
    });
  }

  providers.push(async () => {
    const fnName = window.SUPABASE_EMAIL_FUNCTION || "send-email";
    const { data, error } = await supabaseClient.functions.invoke(fnName, {
      body: { to: normalizedTo, subject, html, from: FROM_EMAIL },
    });

    if (error) throw error;
    return { skipped: false, payload: data, provider: "supabase-function" };
  });

  let lastError = null;
  for (const sendWithProvider of providers) {
    try {
      return await sendWithProvider();
    } catch (error) {
      lastError = error;
      console.warn("Proveedor de correo falló, se intenta siguiente fallback:", error);
    }
  }

  console.warn("No se pudo enviar correo con ningún proveedor configurado.", lastError);
  return { skipped: true, reason: "email_provider_not_configured", error: lastError };
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
  });

  if (sent?.error) {
    showToast("Voluntario registrado, pero falló el aviso por correo al administrador.", "info");
  } else if (sent?.skipped) {
    showToast("Voluntario registrado. Configura RESEND_API_KEY (solo Resend), BREVO_API_KEY, SMTP2GO_API_KEY o función send-email para enviar correos.", "info");
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

  const html = `
    <h2>Resultado de tu fototipo de piel</h2>
    <p>Hola ${safeName}, gracias por completar el formulario.</p>
    <p><strong>Tu fototipo de piel es:</strong> ${fototipo}</p>
    <p><strong>Descripción:</strong> ${details.descripcion}</p>
    <p><strong>Recomendación:</strong> ${details.recomendacion}</p>
  `;

  const sent = await sendEmailNotification({
    to: normalizedEmail,
    subject: "Resultado de tu fototipo de piel",
    html,
  });

  if (sent?.error) {
    showToast("Formulario guardado, pero no se pudo enviar el correo del fototipo.", "info");
  } else if (sent?.skipped) {
    showToast("Formulario guardado. Configura RESEND_API_KEY (solo Resend), BREVO_API_KEY, SMTP2GO_API_KEY o función send-email para enviar el correo al voluntario.", "info");
  }
}

async function cargarAlertasAdmin() {
  const lista = document.getElementById("lista-alertas-admin");
  if (!lista) return;

  if (!isLoggedIn || currentRole !== "admin") {
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

  if (currentRole === "admin") {
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

  currentRole = resolveRoleFromProfile(perfil, user.email);
  currentUserName = perfil?.nombre || user.email;
  currentUserId = user.id;
  currentUserEmail = user.email || null;
  currentProfile = perfil || null;

  userLabel.textContent = `${currentUserName} (${currentRole === "admin" ? "Doctora/Administrador" : "Voluntario"})`;
  logoutBtn.classList.remove("hidden");
  updateNavForRole(currentRole);

  // Redirección automática tras login a la sección Equipo y proyecto.
  showView(AUTH_LANDING_VIEW);

  if (currentRole === "admin") {
    await cargarVoluntarios();
    await cargarAlertasAdmin();
  }

  await syncFormAccessForCurrentAccount();
}


async function restoreSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session?.user) {
    await initSession(data.session.user);
  } else {
    updateNavForRole(null);
    setAuthTab("login-panel");
    showView(GUEST_LANDING_VIEW);
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

const modalDetalles = document.getElementById("modal-detalles");
const modalArchivos = document.getElementById("modal-archivos");
const modalEdicion = document.getElementById("modal-edicion");
const detalleVoluntario = document.getElementById("detalle-voluntario");
const detalleArchivos = document.getElementById("detalle-archivos");

let idEnEdicion = null;
let voluntariosFiltrados = [];

function normalizeFototipoForSelect(value) {
  if (!value) return "";
  const clean = String(value).toUpperCase().replace("FOTOTIPO", "").trim();
  const mapping = { I: "I", II: "II", III: "III", IV: "IV", V: "V y VI", VI: "V y VI", "V Y VI": "V y VI" };
  return mapping[clean] || "";
}

async function cargarVoluntarios() {
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

  voluntariosCache = data || [];
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

  voluntariosFiltrados.forEach((v) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${v.id}</td>
      <td>${v.identificador || ""}</td>
      <td>${v.correo || ""}</td>
      <td>
        <div class="actions-inline">
          <button class="btn btn-small btn-action-detail" data-action="ver-detalles" data-id="${v.id}">ℹ️ Ver detalles</button>
          <button class="btn btn-small btn-action-files" data-action="ver-archivos" data-id="${v.id}">🖼️ Ver imágenes</button>
          <button class="btn btn-small btn-outline" data-action="editar" data-id="${v.id}">✏️ Editar</button>
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
    if (!isLoggedIn || currentRole !== "admin") {
      showToast("Solo la Doctora/Administrador puede editar voluntarios.");
      return;
    }
    cargarEnFormulario(vol);
    openModal("modal-edicion");
  }
});

if (btnNuevoVoluntario) {
  btnNuevoVoluntario.addEventListener("click", () => {
    resetFormulario();
    openModal("modal-edicion");
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

  if (!isLoggedIn || currentRole !== "admin") {
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

  if (currentRole !== "admin") {
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
  const correoFormulario = currentRole === "admin"
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

  if (currentRole === "admin") {
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

restoreSession();
})();
