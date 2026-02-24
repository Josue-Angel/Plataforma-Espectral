// ===============================
// CONFIGURACIÓN SUPABASE
// ===============================
const SUPABASE_URL = 'TU_URL_AQUÍ';
const SUPABASE_ANON_KEY = 'TU_KEY_AQUÍ';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentRole = null;
let currentStep = 0;
let pointsTotal = 0;

// PREGUNTAS FITZPATRICK (Basado en 10 preguntas estándar)
const questions = [
    { q: "¿Color de ojos?", opts: ["Celestes/Grises", "Verdes", "Azul claro", "Castaños", "Negros"], pts: [0,1,2,3,4] },
    { q: "¿Color de cabello natural?", opts: ["Pelirrojo", "Rubio", "Castaño", "Castaño Oscuro", "Negro"], pts: [0,1,2,3,4] },
    { q: "¿Color de piel (no expuesta)?", opts: ["Rojiza", "Blanca", "Blanca-dorada", "Trigueña", "Oscura"], pts: [0,1,2,3,4] },
    // Agrega las demás aquí siguiendo el formato...
];

// ===============================
// INICIO DE SESIÓN Y VISTAS
// ===============================

async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        setupApp(session.user);
    }
}

async function setupApp(user) {
    currentUser = user;
    // Obtener rol (aquí puedes consultar una tabla 'perfiles' o usar lógica simple)
    const { data: profile } = await supabase.from('perfiles').select('*').eq('id', user.id).single();
    currentRole = profile ? profile.role : 'voluntario';

    // UI Updates
    document.getElementById('vista-login').classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    document.getElementById('main-footer').classList.remove('hidden');
    document.getElementById('user-label').textContent = `${profile?.nombre || user.email} (${currentRole})`;

    if (currentRole !== 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    }

    showView('inicio');
    checkTestStatus();
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    document.querySelectorAll('.nav a').forEach(a => {
        a.classList.toggle('active-link', a.dataset.view === viewId);
    });
}

// ===============================
// LÓGICA DEL TEST FITZPATRICK
// ===============================

async function checkTestStatus() {
    if (currentRole === 'admin') return;

    const { data } = await supabase.from('resultados_piel').select('*').eq('user_id', currentUser.id).single();
    if (data) {
        showFinalResult(data.fototipo);
    }
}

function iniciarTest() {
    const firma = document.getElementById('firma-nombre').value;
    const acepto = document.getElementById('acepto-terminos').checked;

    if (!firma || !acepto) {
        alert("Debe firmar y aceptar el consentimiento informado.");
        return;
    }

    document.getElementById('step-consent').classList.remove('active');
    document.getElementById('step-test').classList.add('active');
    renderQuestion();
}

function renderQuestion() {
    const container = document.getElementById('pregunta-box');
    const q = questions[currentStep];
    const progress = ((currentStep) / questions.length) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;

    container.innerHTML = `
        <p class="small">Pregunta ${currentStep + 1} de ${questions.length}</p>
        <h3 style="margin: 15px 0;">${q.q}</h3>
        ${q.opts.map((opt, i) => `
            <button class="opcion-test" onclick="saveAnswer(${q.pts[i]})">${opt}</button>
        `).join('')}
    `;
}

async function saveAnswer(pts) {
    pointsTotal += pts;
    currentStep++;

    if (currentStep < questions.length) {
        renderQuestion();
    } else {
        const fototipo = calculateFitzpatrick(pointsTotal);
        await saveToDatabase(fototipo);
    }
}

function calculateFitzpatrick(p) {
    if (p <= 6) return "Tipo I";
    if (p <= 13) return "Tipo II";
    if (p <= 20) return "Tipo III";
    if (p <= 27) return "Tipo IV";
    if (p <= 34) return "Tipo V";
    return "Tipo VI";
}

async function saveToDatabase(tipo) {
    const { error } = await supabase.from('resultados_piel').insert({
        user_id: currentUser.id,
        nombre_voluntario: document.getElementById('firma-nombre').value,
        fototipo: tipo,
        puntos: pointsTotal
    });

    if (!error) {
        showFinalResult(tipo);
    }
}

function showFinalResult(tipo) {
    document.getElementById('step-test').classList.remove('active');
    document.getElementById('step-consent').classList.remove('active');
    document.getElementById('step-resultado').classList.add('active');
    document.getElementById('fototipo-final').textContent = tipo;
}

// ===============================
// EVENTOS Y NAVEGACIÓN
// ===============================

function switchAuth(type) {
    document.getElementById('login-form').classList.toggle('hidden', type === 'register');
    document.getElementById('register-form').classList.toggle('hidden', type === 'login');
    document.getElementById('tab-login').classList.toggle('active', type === 'login');
    document.getElementById('tab-register').classList.toggle('active', type === 'register');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.auth.signInWithPassword({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
    });
    if (error) document.getElementById('auth-error').textContent = error.message;
    else setupApp(data.user);
});

document.getElementById('logout-btn').addEventListener('click', () => {
    supabase.auth.signOut();
    location.reload();
});

document.querySelectorAll('.nav a').forEach(a => {
    a.addEventListener('click', (e) => {
        e.preventDefault();
        showView(a.dataset.view);
    });
});

checkAuth();
