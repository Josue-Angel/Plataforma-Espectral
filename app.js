// ===============================
// CONFIGURACIÓN SUPABASE
// ===============================
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// ===============================
// ROLES Y NAVEGACIÓN
// ===============================
const viewPermissions = {
  inicio: ["admin", "voluntario"],
  equipo: ["admin", "voluntario"],
  "base-datos": ["admin"],
  formularios: ["admin", "voluntario"],
  "modelo-ia": ["admin"],
  archivos: ["admin", "voluntario"],
  dashboard: ["admin"],
};

let currentRole = null; // 'admin' | 'voluntario' | null
let isLoggedIn = false;
let currentUserName = null;
let currentUserEmail = null;

// DOM navegación
const views = document.querySelectorAll(".view");
const navLinks = document.querySelectorAll("#nav-links a");
const userLabel = document.getElementById("user-label");
const logoutBtn = document.getElementById("logout-btn");

function showView(viewId) {
  if (isLoggedIn) {
    const allowedRoles = viewPermissions[viewId];
    if (allowedRoles && !allowedRoles.includes(currentRole)) {
      alert("No tienes permiso para acceder a esta sección.");
      return;
    }
  } else {
    if (viewId !== "inicio") {
      alert("Debes iniciar sesión primero.");
      viewId = "inicio";
    }
  }

  views.forEach((v) => v.classList.remove("active"));
  const target = document.getElementById(viewId);
  if (target) target.classList.add("active");

  navLinks.forEach((link) => {
    link.classList.remove("active-link");
    if (link.dataset.view === viewId) link.classList.add("active-link");
  });
}

function updateNavForRole(role) {
  navLinks.forEach((link) => {
    const viewId = link.dataset.view;
    const roles = (link.dataset.roles || "").split(",");
    const trimmed = roles.map((r) => r.trim()).filter(Boolean);

    if (!role) {
      // sin login: solo Inicio
      if (viewId === "inicio") link.classList.remove("hidden");
      else link.classList.add("hidden");
    } else {
      // logueado: ocultar Inicio
      if (viewId === "inicio") {
        link.classList.add("hidden");
        return;
      }
      if (trimmed.length === 0 || trimmed.includes(role)) {
        link.classList.remove("hidden");
      } else {
        link.classList.add("hidden");
      }
    }
  });
}

// eventos de navegación
navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const viewId = link.dataset.view;
    if (viewId) showView(viewId);
  });
});

// ===============================
// AUTH: LOGIN + REGISTRO VOLUNTARIOS
// ===============================

// Tabs login/registro
const tabButtons = document.querySelectorAll(".tab-auth");
const loginPanel = document.getElementById("login-panel");
const registerPanel = document.getElementById("register-panel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const target = btn.dataset.target;
    if (target === "login-panel") {
      loginPanel.classList.remove("hidden");
      registerPanel.classList.add("hidden");
    } else {
      registerPanel.classList.remove("hidden");
      loginPanel.classList.add("hidden");
    }
  });
});

// LOGIN
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  loginError.textContent = "";

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value.trim();

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("Error login:", error);
    loginError.textContent = error.message || "Error al iniciar sesión.";
    loginError.classList.remove("hidden");
    return;
  }

  if (data.user) {
    await initSession(data.user);
  }
});

// REGISTRO (solo voluntarios)
const registerForm = document.getElementById("register-form");
const regError = document.getElementById("register-error");
const regSuccess = document.getElementById("register-success");

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  regError.classList.add("hidden");
  regSuccess.classList.add("hidden");
  regError.textContent = "";

  const nombre = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const pass1 = document.getElementById("reg-password").value;
  const pass2 = document.getElementById("reg-password2").value;

  if (pass1 !== pass2) {
    regError.textContent = "Las contraseñas no coinciden.";
    regError.classList.remove("hidden");
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password: pass1,
  });

  if (error) {
    console.error("Error registro:", error);
    regError.textContent = error.message || "Error al crear la cuenta.";
    regError.classList.remove("hidden");
    return;
  }

  const user = data.user;
  // Crear perfil con rol voluntario
  if (user) {
    const { error: profErr } = await supabaseClient.from("perfiles").insert({
      id: user.id,
      email,
      nombre,
      role: "voluntario",
    });
    if (profErr) {
      console.error("Error creando perfil:", profErr);
    }
  }

  registerForm.reset();
  regSuccess.classList.remove("hidden");
});

// Cerrar sesión
logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  isLoggedIn = false;
  currentRole = null;
  currentUserEmail = null;
  currentUserName = null;
  userLabel.textContent = "No has iniciado sesión";
  logoutBtn.classList.add("hidden");
  updateNavForRole(null);
  showView("inicio");
});

// Inicializar sesión (login o sesión ya existente)
async function initSession(user) {
  isLoggedIn = true;
  currentUserEmail = user.email || "";

  // Obtener perfil para saber rol
  const { data: perfil, error } = await supabaseClient
    .from("perfiles")
    .select("nombre, role")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("Error cargando perfil:", error);
    currentRole = "voluntario";
    currentUserName = currentUserEmail;
  } else {
    currentRole = perfil.role || "voluntario";
    currentUserName = perfil.nombre || currentUserEmail;
  }

  userLabel.textContent = `${currentUserName} (${
    currentRole === "admin" ? "Doctora/Administrador" : "Voluntario"
  })`;
  logoutBtn.classList.remove("hidden");
  updateNavForRole(currentRole);

  if (currentRole === "admin") {
    await cargarVoluntarios();
    showView("equipo");
  } else {
    showView("equipo");
  }
}

// Restaurar sesión si ya estaba logueado
async function restoreSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("Error obteniendo sesión:", error);
    updateNavForRole(null);
    showView("inicio");
    return;
  }
  const session = data.session;
  if (session && session.user) {
    await initSession(session.user);
  } else {
    updateNavForRole(null);
    showView("inicio");
  }
}

// ===============================
// BASE DE DATOS ESPECTRAL CON SUPABASE
// ===============================

let voluntariosCache = [];

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

// Cargar voluntarios + espectros + imagenes
async function cargarVoluntarios() {
  const { data, error } = await supabaseClient
    .from("voluntarios")
    .select(
      "id,identificador,sexo,edad,carrera,correo,fototipo_de_piel,fecha,espectros(id,espectro_path),imagenes(id,imagen_path)"
    )
    .order("id", { ascending: true });

  if (error) {
    console.error("Error cargando voluntarios:", error);
    alert("Error al cargar voluntarios desde Supabase.");
    return;
  }

  voluntariosCache = data || [];
  renderVoluntarios();
  actualizarDashboard();
}

// Pintar tabla
function renderVoluntarios() {
  tablaVoluntarios.innerHTML = "";

  voluntariosCache.forEach((v) => {
    const espectros = v.espectros || [];
    const imagenes = v.imagenes || [];

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${v.id}</td>
      <td>${v.identificador}</td>
      <td>${v.sexo}</td>
      <td>${v.edad}</td>
      <td>${v.carrera}</td>
      <td>${v.correo}</td>
      <td>${v.fototipo_de_piel}</td>
      <td>${v.fecha}</td>
      <td>
        ${
          espectros.length > 0
            ? `<button class="btn btn-small" data-action="ver-espectros" data-id="${v.id}">
                 Ver archivos (${espectros.length})
               </button>`
            : "<span class='small muted'>Sin espectros</span>"
        }
      </td>
      <td>
        ${
          imagenes.length > 0
            ? `<button class="btn btn-small" data-action="ver-imagenes" data-id="${v.id}">
                 Ver imágenes (${imagenes.length})
               </button>`
            : "<span class='small muted'>Sin imágenes</span>"
        }
      </td>
      <td>
        <button class="btn btn-small btn-outline" data-action="editar" data-id="${v.id}">
          Editar
        </button>
      </td>
    `;
    tablaVoluntarios.appendChild(tr);
  });
}

// Mostrar archivos / imágenes de un voluntario
function mostrarArchivos(vol, tipo) {
  if (!vol) return;

  const espectros = vol.espectros || [];
  const imagenes = vol.imagenes || [];

  detalleLista.innerHTML = "";

  if (tipo === "espectros") {
    detalleTitulo.textContent = `Espectros de ${vol.identificador}`;
    espectros.forEach((e) => {
      const url = supabaseClient.storage
        .from("espectros")
        .getPublicUrl(e.espectro_path).data.publicUrl;
      const li = document.createElement("li");
      li.innerHTML = `<a href="${url}" target="_blank">${e.espectro_path}</a>`;
      detalleLista.appendChild(li);
    });
  } else {
    detalleTitulo.textContent = `Imágenes de ${vol.identificador}`;
    imagenes.forEach((img) => {
      const url = supabaseClient.storage
        .from("imagenes")
        .getPublicUrl(img.imagen_path).data.publicUrl;
      const li = document.createElement("li");
      li.innerHTML = `<a href="${url}" target="_blank">${img.imagen_path}</a>`;
      detalleLista.appendChild(li);
    });
  }

  detalleArchivosCard.classList.remove("hidden");
}

// Click en botones de la tabla
tablaVoluntarios.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const id = parseInt(btn.dataset.id, 10);
  const action = btn.dataset.action;
  const vol = voluntariosCache.find((v) => v.id === id);

  if (action === "ver-espectros") {
    mostrarArchivos(vol, "espectros");
  } else if (action === "ver-imagenes") {
    mostrarArchivos(vol, "imagenes");
  } else if (action === "editar") {
    if (!isLoggedIn || currentRole !== "admin") {
      alert("Solo la Doctora/Administrador puede editar voluntarios.");
      return;
    }
    cargarEnFormulario(vol);
  }
});

// ===============================
// CONTROL DE PASOS
// ===============================
/* ============================
   CONTROL DE STEPS
============================ */

function nextStep(stepNumber) {

  const steps = document.querySelectorAll(".step");

  steps.forEach(step => step.classList.remove("active"));

  const next = document.getElementById("step" + stepNumber);
  if (next) {
    next.classList.add("active");
  }
}


/* ============================
   CALCULAR FOTOTIPO
============================ */

function calcularFototipo(total) {

  if (total <= 6) return "Fototipo I";
  if (total <= 13) return "Fototipo II";
  if (total <= 20) return "Fototipo III";
  if (total <= 27) return "Fototipo IV";
  if (total <= 34) return "Fototipo V";
  return "Fototipo VI";

}


/* ============================
   FUNCIÓN FINAL
============================ */

function guardarVoluntario() {

  // Datos básicos
  const identificador = document.getElementById("identificador").value.trim();
  const edad = document.getElementById("edad").value.trim();
  const sexo = document.getElementById("sexo").value;
  const correo = document.getElementById("correo").value.trim();

  if (!identificador || !edad || !sexo) {
    alert("Completa los datos del voluntario.");
    return;
  }

  // Obtener respuestas seleccionadas
  const respuestas = [
    "ojos",
    "cabello",
    "piel_base",
    "pecas",
    "quemadura",
    "bronceado",
    "horas_sol",
    "rostro",
    "ultima_vez",
    "regular"
  ];

  let total = 0;

  for (let name of respuestas) {
    const seleccionada = document.querySelector(`input[name="${name}"]:checked`);

    if (!seleccionada) {
      alert("Responde todas las preguntas antes de finalizar.");
      return;
    }

    total += parseInt(seleccionada.value);
  }

  const fototipo = calcularFototipo(total);

  console.log("TOTAL:", total);
  console.log("FOTOTIPO:", fototipo);

  // Aquí llamas tu función existente de envío a BD
  // Ejemplo:
  enviarDatos({
    identificador,
    edad,
    sexo,
    correo,
    total,
    fototipo
  });

}



function cargarEnFormulario(vol) {
  if (!vol) return;

  idEnEdicion = vol.id;
  inputId.value = vol.id;
  inputIdentificador.value = vol.identificador;
  inputSexo.value = vol.sexo;
  inputEdad.value = vol.edad;
  inputCarrera.value = vol.carrera;
  inputCorreo.value = vol.correo;
  inputFototipo.value = vol.fototipo_de_piel;
  inputFecha.value = vol.fecha;

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
});

// Guardar / actualizar voluntario + subir archivos
formVoluntario.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!isLoggedIn || currentRole !== "admin") {
    alert("Solo la Doctora/Administrador puede registrar o editar voluntarios.");
    return;
  }

  const identificador = inputIdentificador.value.trim();
  const sexo = inputSexo.value;
  const edad = parseInt(inputEdad.value, 10);
  const carrera = inputCarrera.value.trim();
  const correo = inputCorreo.value.trim();
  const fototipo = inputFototipo.value;
  const fecha = inputFecha.value;

  if (!identificador || !sexo || !carrera || !correo || !fototipo || !fecha || !Number.isFinite(edad)) {
    alert("Por favor, completa todos los campos obligatorios.");
    return;
  }

  let voluntarioId;

  if (idEnEdicion) {
    const { data, error } = await supabaseClient
      .from("voluntarios")
      .update({
        identificador,
        sexo,
        edad,
        carrera,
        correo,
        fototipo_de_piel: fototipo,
        fecha,
      })
      .eq("id", idEnEdicion)
      .select()
      .single();

    if (error) {
      console.error("Error actualizando voluntario:", error);
      alert("Error al actualizar voluntario.");
      return;
    }
    voluntarioId = data.id;
  } else {
    const { data, error } = await supabaseClient
      .from("voluntarios")
      .insert({
        identificador,
        sexo,
        edad,
        carrera,
        correo,
        fototipo_de_piel: fototipo,
        fecha,
      })
      .select()
      .single();

    if (error) {
      console.error("Error insertando voluntario:", error);
      alert("Error al guardar voluntario.");
      return;
    }
    voluntarioId = data.id;
  }

  // Subir espectros múltiples
  const espectroFiles = Array.from(inputEspectros.files || []);
  for (const file of espectroFiles) {
    const path = `voluntarios/${voluntarioId}/espectros/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabaseClient.storage
      .from("espectros")
      .upload(path, file);
    if (!upErr) {
      await supabaseClient.from("espectros").insert({
        voluntario_id: voluntarioId,
        espectro_path: path,
      });
    } else {
      console.error("Error subiendo espectro:", upErr);
    }
  }

  // Subir imágenes múltiples
  const imagenFiles = Array.from(inputImagenes.files || []);
  for (const file of imagenFiles) {
    const path = `voluntarios/${voluntarioId}/imagenes/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabaseClient.storage
      .from("imagenes")
      .upload(path, file);
    if (!upErr) {
      await supabaseClient.from("imagenes").insert({
        voluntario_id: voluntarioId,
        imagen_path: path,
      });
    } else {
      console.error("Error subiendo imagen:", upErr);
    }
  }

  resetFormulario();
  await cargarVoluntarios();
});

// ===============================
// DASHBOARD (usa voluntariosCache)
// ===============================
const statTotal = document.getElementById("stat-total");
const statEdadPromedio = document.getElementById("stat-edad-promedio");
const statSexo = document.getElementById("stat-sexo");
const statTiposPiel = document.getElementById("stat-tipos-piel");

const chartSexo = document.getElementById("chart-sexo");
const chartPiel = document.getElementById("chart-piel");
const chartEdad = document.getElementById("chart-edad");

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

  const sumaEdad = voluntariosCache.reduce((sum, v) => sum + (v.edad || 0), 0);
  const edadProm = sumaEdad / total;
  statEdadPromedio.textContent = edadProm.toFixed(1);

  const conteoSexo = { F: 0, M: 0, Otro: 0 };
  voluntariosCache.forEach((v) => {
    if (v.sexo === "F" || v.sexo === "M") conteoSexo[v.sexo]++;
    else conteoSexo.Otro++;
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

  const pielData = Object.entries(conteoPiel).map(([label, value]) => ({
    label,
    value,
  }));
  renderBarChart(chartPiel, pielData);

  const gruposEdad = { "<18": 0, "18-30": 0, "31-45": 0, "46+": 0 };
  voluntariosCache.forEach((v) => {
    const e = v.edad || 0;
    if (e < 18) gruposEdad["<18"]++;
    else if (e <= 30) gruposEdad["18-30"]++;
    else if (e <= 45) gruposEdad["31-45"]++;
    else gruposEdad["46+"]++;
  });
  const edadData = Object.entries(gruposEdad).map(([label, value]) => ({
    label,
    value,
  }));
  renderBarChart(chartEdad, edadData);
}

function renderBarChart(container, data) {
  container.innerHTML = "";
  if (!data || data.length === 0) return;

  const max = Math.max(...data.map((d) => d.value)) || 1;

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

   bar.appendChild(inner);
bar.appendChild(valueLabel);
bar.appendChild(label);


    container.appendChild(bar);
  });
}

// Arranque
restoreSession();





