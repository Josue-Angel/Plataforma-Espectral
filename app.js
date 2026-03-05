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

const GUEST_LANDING_VIEW = "inicio";
const AUTH_LANDING_VIEW = "equipo";
const ADMIN_EMAILS = ["admin@ejemplo.com"];
const ADMIN_NOTIFICATION_EMAIL = "admin@ejemplo.com";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_API_KEY_VALUE = window.RESEND_API_KEY || "";
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

async function updateProfileCompletionState(userId, nombreConsentimiento) {
  const payload = {
    nombre_completo: nombreConsentimiento,
    consentimiento: true,
    test_fototipo_completado: true,
  };

  const { error } = await supabaseClient.from("perfiles").update(payload).eq("id", userId);
  if (!error) return;

  if (isMissingColumnError(error, "nombre_completo") || isMissingColumnError(error, "consentimiento")) {
    const fallback = await supabaseClient
      .from("perfiles")
      .update({ test_fototipo_completado: true })
      .eq("id", userId);

    if (!fallback.error) return;

    if (isMissingColumnError(fallback.error, "test_fototipo_completado")) {
      console.warn("La tabla perfiles no contiene columnas de estado del formulario. Se continúa sin bloqueo por perfil.");
      return;
    }

    console.error("No se pudo actualizar el perfil del voluntario:", fallback.error);
    return;
  }

  if (isMissingColumnError(error, "test_fototipo_completado")) {
    console.warn("La columna test_fototipo_completado no existe en perfiles.");
    return;
  }

  console.error("No se pudo actualizar el perfil del voluntario:", error);
}

async function hasVolunteerCompletedForm() {
  const correoFormulario = document.getElementById("correo")?.value?.trim().toLowerCase() || "";
  const correoBusqueda = correoFormulario || String(currentUserEmail || "").trim().toLowerCase();

  const perfilResp = await supabaseClient
    .from("perfiles")
    .select("test_fototipo_completado")
    .eq("id", currentUserId)
    .maybeSingle();

  if (!perfilResp.error && perfilResp.data?.test_fototipo_completado) return true;

  if (perfilResp.error && !isMissingColumnError(perfilResp.error, "test_fototipo_completado")) {
    console.error("Error al consultar el estado del formulario en perfiles:", perfilResp.error);
  }

  if (!correoBusqueda) return false;

  const { data: ultimo, error } = await supabaseClient
    .from("voluntarios")
    .select("id")
    .eq("correo", correoBusqueda)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error al validar formulario completado en voluntarios:", error);
    return false;
  }

  return Boolean(ultimo?.id);
}

async function sendEmailNotification({ to, subject, html }) {
  if (!RESEND_API_KEY_VALUE) {
    console.warn("RESEND_API_KEY no configurada. Se omitió el envío de correo.");
    return { skipped: true, reason: "missing_api_key" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY_VALUE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.message || "Error al enviar correo con Resend.");
    }

    return { skipped: false, payload };
  } catch (error) {
    console.error("Error al enviar notificación por correo:", error);
    return { skipped: false, error };
  }
}

async function createAdminNotificationLog(message) {
  const { error } = await supabaseClient.from("admin_notificaciones").insert({
    message,
    tipo: "nuevo_registro",
  });

  if (error) {
    console.error("No se pudo registrar la notificación para administrador:", error);
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
  }
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
    console.error("Error al cargar notificaciones de administrador:", error);
    lista.innerHTML = "<li class=\"muted small\">No se pudieron cargar las notificaciones.</li>";
    return;
  }

  if (!data?.length) {
    lista.innerHTML = "<li class=\"muted small\">Sin notificaciones por ahora.</li>";
    return;
  }

  lista.innerHTML = data
    .map((item) => {
      const fecha = item.created_at ? new Date(item.created_at).toLocaleString("es-MX") : "Sin fecha";
      return `<li><strong>${item.message}</strong><span class=\"muted small\">${fecha}</span></li>`;
    })
    .join("");
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
  } else if (!isMissingColumnError(perfilResp.error, "test_fototipo_completado")) {
    console.error("Error al consultar perfiles:", perfilResp.error);
  }

  currentProfile = { ...(currentProfile || {}), ...(perfil || {}) };

  if (currentRole === "admin") {
    setActiveFormStepById(readSavedFormStepProgress() || FORM_INITIAL_STEP);
    return;
  }

  const completedFromProfile = Boolean(perfil?.test_fototipo_completado);
  const correoBusqueda = String(currentUserEmail || "").trim().toLowerCase();
  const { data: ultimoRegistro } = await supabaseClient
    .from("voluntarios")
    .select("fototipo_de_piel")
    .eq("correo", correoBusqueda)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (completedFromProfile || ultimoRegistro?.fototipo_de_piel) {
    renderReadOnlyFormResult(ultimoRegistro?.fototipo_de_piel || "No disponible");
    skinForm.classList.add("form-locked");
    return;
  }

  setActiveFormStepById(readSavedFormStepProgress() || FORM_INITIAL_STEP);
}

async function initSession(user) {
  isLoggedIn = true;
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

const detalleArchivosCard = document.getElementById("detalle-archivos");
const detalleTitulo = document.getElementById("detalle-titulo");
const detalleLista = document.getElementById("detalle-lista");
let idEnEdicion = null;

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
  renderVoluntarios();
  actualizarDashboard();
}

function renderVoluntarios() {
  tablaVoluntarios.innerHTML = "";

  voluntariosCache.forEach((v) => {
    const tr = document.createElement("tr");
    const espectros = v.espectros || [];
    const imagenes = v.imagenes || [];

    tr.innerHTML = `
      <td>${v.id}</td>
      <td>${v.identificador || ""}</td>
      <td>${v.sexo || ""}</td>
      <td>${v.edad || ""}</td>
      <td>${v.carrera || ""}</td>
      <td>${v.correo || ""}</td>
      <td>${v.fototipo_de_piel || ""}</td>
      <td>${v.fecha || ""}</td>
      <td>${espectros.length ? `<button class="btn btn-small" data-action="ver-espectros" data-id="${v.id}">Ver archivos (${espectros.length})</button>` : "<span class='small muted'>Sin espectros</span>"}</td>
      <td>${imagenes.length ? `<button class="btn btn-small" data-action="ver-imagenes" data-id="${v.id}">Ver imágenes (${imagenes.length})</button>` : "<span class='small muted'>Sin imágenes</span>"}</td>
      <td><button class="btn btn-small btn-outline" data-action="editar" data-id="${v.id}">Editar</button></td>
    `;

    tablaVoluntarios.appendChild(tr);
  });
}

function mostrarArchivos(vol, tipo) {
  if (!vol) return;
  const items = tipo === "espectros" ? vol.espectros || [] : vol.imagenes || [];
  const bucket = tipo === "espectros" ? "espectros" : "imagenes";
  const pathKey = tipo === "espectros" ? "espectro_path" : "imagen_path";

  detalleTitulo.textContent = `${tipo === "espectros" ? "Espectros" : "Imágenes"} de ${vol.identificador}`;
  detalleLista.innerHTML = "";

  items.forEach((item) => {
    const path = item[pathKey];
    const url = supabaseClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    const li = document.createElement("li");
    li.innerHTML = `<a href="${url}" target="_blank">${path}</a>`;
    detalleLista.appendChild(li);
  });

  detalleArchivosCard.classList.remove("hidden");
}

tablaVoluntarios.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const id = Number(btn.dataset.id);
  const vol = voluntariosCache.find((v) => v.id === id);
  const action = btn.dataset.action;

  if (action === "ver-espectros") mostrarArchivos(vol, "espectros");
  if (action === "ver-imagenes") mostrarArchivos(vol, "imagenes");

  if (action === "editar") {
    if (!isLoggedIn || currentRole !== "admin") {
      showToast("Solo la Doctora/Administrador puede editar voluntarios.");
      return;
    }
    cargarEnFormulario(vol);
  }
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
btnCancelarEdicion.addEventListener("click", resetFormulario);

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
  await cargarVoluntarios();
});

// Formulario fototipo
const questionGroups = ["ojos", "cabello", "piel_base", "pecas", "quemadura", "bronceado", "horas_sol", "rostro", "ultima_vez", "regular"];

function validarNombreCompleto(nombre) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return partes.length >= 2;
}

function validarCorreoUpt(correo) {
  return /^[^\s@]+@upt\.edu\.mx$/i.test(correo);
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

    if (!validarCorreoUpt(correo)) {
      showToast("El correo debe ser válido y terminar en @upt.edu.mx.");
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
    correo,
    fototipo_de_piel: fototipo,
    fecha: new Date().toISOString().slice(0, 10),
  };

  let { error } = await supabaseClient.from("voluntarios").insert(payload);
  if (isMissingColumnError(error, "user_id")) {
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

  await notifyVolunteerFototipo({ email: correo, nombre: nombreConsentimiento, fototipo });

  if (currentRole === "admin") {
    await cargarVoluntarios();
  } else {
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
