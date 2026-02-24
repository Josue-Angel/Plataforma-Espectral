// ===============================
// CONFIGURACIÓN SUPABASE
// ===============================
const SUPABASE_URL = 'https://bwszeozmxzwuajrywqns.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3c3plb3pteHp3dWFqcnl3cW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyODU2ODAsImV4cCI6MjA3OTg2MTY4MH0.XAj13G3Bwl3iy7gfnVyHddA6LMH4Yc9dnx9Im6Dx8xI'; // Reemplaza con tu Key completa si esta falla
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentRole = null;
let currentStep = 0;
let pointsTotal = 0;

const questions = [
    { q: "¿Color natural de sus ojos?", opts: ["Celeste / Gris / Verde claro", "Azul / Verde / Gris", "Castaño claro", "Castaño oscuro", "Negro"], pts: [0,1,2,3,4] },
    { q: "¿Color natural de su cabello?", opts: ["Pelirrojo", "Rubio", "Castaño claro", "Castaño oscuro", "Negro"], pts: [0,1,2,3,4] },
    { q: "¿Color de su piel (zonas no expuestas)?", opts: ["Rojiza", "Muy pálida", "Clara con tintes dorados", "Trigueña", "Oscura"], pts: [0,1,2,3,4] },
    { q: "¿Tiene pecas en zonas no expuestas?", opts: ["Muchas", "Varias", "Pocas", "Raramente", "Ninguna"], pts: [0,1,2,3,4] },
    { q: "¿Qué pasa si se expone al sol sin protección?", opts: ["Quemadura dolorosa y peladuras", "Quemadura y descamación", "Quemadura ocasional", "Rara vez se quema", "Nunca se quema"], pts: [0,1,2,3,4] }
];

// ===============================
// MANEJO DE SESIÓN Y VISTAS
// ===============================

async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) setupApp(session.user);
    else document.getElementById('vista-login').classList.remove('hidden');
}

async function setupApp(user) {
    currentUser = user;
    const { data: profile } = await supabase.from('perfiles').select('*').eq('id', user.id).single();
    currentRole = profile?.role || 'voluntario';

    document.getElementById('vista-login').classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    document.getElementById('user-label').textContent = `${profile?.nombre || user.email} (${currentRole})`;

    if (currentRole !== 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    }
    
    showView('inicio');
    checkTestStatus();
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
    
    document.querySelectorAll('.nav a').forEach(a => {
        a.classList.toggle('active-link', a.dataset.view === viewId);
    });
}

// ===============================
// LÓGICA DEL WIZARD (FORMULARIO)
// ===============================

async function checkTestStatus() {
    const { data } = await supabase.from('resultados_piel').select('*').eq('user_id', currentUser.id).single();
    if (data) showFinalResult(data.fototipo);
}

function renderQuestion() {
    const container = document.getElementById('pregunta-box');
    const q = questions[currentStep];
    const progress = (currentStep / questions.length) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;

    container.innerHTML = `
        <p class="small">Pregunta ${currentStep + 1} de ${questions.length}</p>
        <h3 style="margin: 15px 0;">${q.q}</h3>
        <div class="options-list">
            ${q.opts.map((opt, i) => `
                <button class="opcion-test" data-pts="${q.pts[i]}">${opt}</button>
            `).join('')}
        </div>
    `;

    document.querySelectorAll('.opcion-test').forEach(btn => {
        btn.onclick = () => {
            pointsTotal += parseInt(btn.dataset.pts);
            currentStep++;
            if (currentStep < questions.length) renderQuestion();
            else saveResult();
        };
    });
}

async function saveResult() {
    const fototipo = calculateFitz(pointsTotal);
    const { error } = await supabase.from('resultados_piel').insert({
        user_id: currentUser.id,
        fototipo: fototipo,
        puntos: pointsTotal,
        nombre: document.getElementById('firma-consentimiento').value
    });
    if (!error) showFinalResult(fototipo);
    else alert("Error al guardar: " + error.message);
}

function calculateFitz(p) {
    if (p <= 4) return "Tipo I";
    if (p <= 8) return "Tipo II";
    if (p <= 12) return "Tipo III";
    if (p <= 16) return "Tipo IV";
    return "Tipo V / VI";
}

function showFinalResult(tipo) {
    document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
    document.getElementById('step-resultado').classList.add('active');
    document.getElementById('fototipo-final').textContent = tipo;
}

// ===============================
// EVENTOS
// ===============================

document.getElementById('btn-iniciar-test').onclick = () => {
    if (!document.getElementById('firma-consentimiento').value) return alert("Firme el consentimiento");
    document.getElementById('step-consent').classList.remove('active');
    document.getElementById('step-test').classList.add('active');
    renderQuestion();
};

document.getElementById('tab-login-btn').onclick = () => {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('tab-login-btn').classList.add('active');
    document.getElementById('tab-register-btn').classList.remove('active');
};

document.getElementById('tab-register-btn').onclick = () => {
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('tab-register-btn').classList.add('active');
    document.getElementById('tab-login-btn').classList.remove('active');
};

document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.auth.signInWithPassword({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
    });
    if (error) document.getElementById('auth-error').textContent = error.message;
    else setupApp(data.user);
};

document.getElementById('logout-btn').onclick = () => {
    supabase.auth.signOut().then(() => location.reload());
};

document.querySelectorAll('.nav a').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); showView(a.dataset.view); };
});

checkAuth();

