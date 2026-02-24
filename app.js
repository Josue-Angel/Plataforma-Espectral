// CONFIGURACIÓN SUPABASE
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentRole = null;
let currentStep = 0;
let pointsTotal = 0;

// PREGUNTAS (Basadas en la Escala de Fitzpatrick - 10 preguntas)
const questions = [
    { q: "¿Color de ojos?", opts: ["Celestes/Grises (0)", "Verdes (1)", "Azul claro (2)", "Castaños (3)", "Negros (4)"], values: [0, 1, 2, 3, 4] },
    { q: "¿Color de cabello natural?", opts: ["Pelirrojo (0)", "Rubio (1)", "Castaño (2)", "Castaño Oscuro (3)", "Negro (4)"], values: [0, 1, 2, 3, 4] },
    // ... añade las otras 8 preguntas siguiendo este mismo patrón ...
];

// ===============================
// CONTROL DE ACCESO Y NAVEGACIÓN
// ===============================

async function checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        handlePostLogin(session.user);
    } else {
        showView('vista-auth');
    }
}

async function handlePostLogin(user) {
    currentUser = user;
    
    // Obtener perfil para saber el ROL
    const { data: profile } = await supabaseClient.from('perfiles').select('*').eq('id', user.id).single();
    currentRole = profile ? profile.role : 'voluntario';

    // Mostrar UI
    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('user-label').textContent = `${profile.nombre || user.email} (${currentRole})`;
    
    // Filtrar menú por rol
    if (currentRole === 'voluntario') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    }

    showView('inicio');
    checkIfFormDone();
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    document.querySelectorAll('.nav a').forEach(a => {
        a.classList.toggle('active-link', a.dataset.view === viewId);
    });
}

// ===============================
// LÓGICA DEL FORMULARIO WIZARD
// ===============================

async function checkIfFormDone() {
    if (currentRole === 'admin') return; // Admin siempre puede repetir

    const { data } = await supabaseClient.from('resultados_piel').select('*').eq('usuario_id', currentUser.id).single();
    if (data) {
        showResult(data.fototipo, true);
    }
}

function startWizard() {
    const signature = document.getElementById('consent-signature').value;
    const accepted = document.getElementById('consent-checkbox').checked;

    if (!signature || !accepted) {
        alert("Debe firmar y aceptar el consentimiento.");
        return;
    }

    document.getElementById('form-step-0').classList.remove('active');
    document.getElementById('form-step-wizard').classList.add('active');
    renderQuestion();
}

function renderQuestion() {
    const container = document.getElementById('question-container');
    const q = questions[currentStep];
    const progress = ((currentStep) / questions.length) * 100;
    
    document.getElementById('progress-bar').style.width = `${progress}%`;

    container.innerHTML = `
        <p class="muted small">Pregunta ${currentStep + 1} de ${questions.length}</p>
        <h3 style="margin-bottom:20px;">${q.q}</h3>
        ${q.opts.map((opt, i) => `
            <button class="question-option" onclick="processAnswer(${q.values[i]})">${opt}</button>
        `).join('')}
    `;
}

function processAnswer(val) {
    pointsTotal += val;
    currentStep++;

    if (currentStep < questions.length) {
        renderQuestion();
    } else {
        calculateAndSave();
    }
}

async function calculateAndSave() {
    let fototipo = "";
    if (pointsTotal <= 6) fototipo = "Tipo I";
    else if (pointsTotal <= 13) fototipo = "Tipo II";
    else if (pointsTotal <= 20) fototipo = "Tipo III";
    else if (pointsTotal <= 27) fototipo = "Tipo IV";
    else if (pointsTotal <= 34) fototipo = "Tipo V";
    else fototipo = "Tipo VI";

    // GUARDAR EN BASE DE DATOS
    const { error } = await supabaseClient.from('resultados_piel').insert({
        usuario_id: currentUser.id,
        nombre_voluntario: document.getElementById('consent-signature').value,
        puntos: pointsTotal,
        fototipo: fototipo
    });

    if (!error) showResult(fototipo);
}

function showResult(tipo, alreadyDone = false) {
    document.getElementById('form-step-wizard').classList.remove('active');
    document.getElementById('form-step-0').classList.remove('active');
    document.getElementById('form-step-result').classList.add('active');

    document.getElementById('result-display').innerHTML = `
        <h2>${alreadyDone ? 'Resultado de tu Análisis previo' : '¡Análisis Completado!'}</h2>
        <div style="font-size: 3rem; font-weight: 800; color: var(--blue-bright); margin: 20px 0;">${tipo}</div>
        <p>Sus datos han sido integrados a la base de datos del Proyecto Espectral.</p>
    `;
}

// ===============================
// EVENTOS LOGIN/LOGOUT
// ===============================

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
    });
    if (error) alert(error.message);
    else handlePostLogin(data.user);
});

document.getElementById('logout-btn').addEventListener('click', () => {
    supabaseClient.auth.signOut();
    location.reload();
});

// Navegación
document.querySelectorAll('.nav a').forEach(a => {
    a.addEventListener('click', (e) => {
        e.preventDefault();
        showView(a.dataset.view);
    });
});

// Inicio
checkSession();
