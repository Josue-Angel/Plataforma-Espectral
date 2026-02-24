// CONFIGURACIÓN ÚNICA
const S_URL = 'https://bwszeozmxzwuajrywqns.supabase.co';
const S_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3c3plb3pteHp3dWFqcnl3cW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyODU2ODAsImV4cCI6MjA3OTg2MTY4MH0.XAj13G3Bwl3iy7gfnVyHddA6LMH4Yc9dnx9Im6Dx8xI';
const supabase = window.supabase.createClient(S_URL, S_KEY);

let userActual = null;
let stepActual = 0;
let puntosTest = 0;

// Preguntas originales extraídas de tu código anterior
const preguntas = [
    { q: "¿Color natural de sus ojos?", opts: ["Celeste/Gris/Verde claro", "Azul/Verde/Gris", "Castaño claro", "Castaño oscuro", "Negro"], pts: [0,1,2,3,4] },
    { q: "¿Color natural de su cabello?", opts: ["Pelirrojo", "Rubio", "Castaño claro", "Castaño oscuro", "Negro"], pts: [0,1,2,3,4] },
    { q: "¿Color de su piel (zonas no expuestas)?", opts: ["Rojiza", "Muy pálida", "Clara con tintes dorados", "Trigueña", "Oscura"], pts: [0,1,2,3,4] },
    { q: "¿Qué pasa si se expone al sol?", opts: ["Quemadura dolorosa", "Quemadura y descamación", "Quemadura ocasional", "Rara vez se quema", "Nunca se quema"], pts: [0,1,2,3,4] }
];

// NAVEGACIÓN
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// GESTIÓN DE TEST (WIZARD)
window.iniciarTest = () => {
    if (!document.getElementById('firma-nombre').value) return alert("Por favor, firme el consentimiento.");
    document.getElementById('step-consent').classList.remove('active');
    document.getElementById('step-test').classList.add('active');
    renderPregunta();
};

function renderPregunta() {
    const box = document.getElementById('pregunta-box');
    const p = preguntas[stepActual];
    const progreso = (stepActual / preguntas.length) * 100;
    document.getElementById('progress-bar').style.width = `${progreso}%`;

    box.innerHTML = `
        <h3>${p.q}</h3>
        <div class="options-grid">
            ${p.opts.map((opt, i) => `<button class="btn-opt" onclick="sigPregunta(${p.pts[i]})">${opt}</button>`).join('')}
        </div>
    `;
}

window.sigPregunta = (pts) => {
    puntosTest += pts;
    stepActual++;
    if (stepActual < preguntas.length) renderPregunta();
    else finalizarTest();
};

async function finalizarTest() {
    let tipo = puntosTest <= 4 ? "Tipo I" : puntosTest <= 8 ? "Tipo II" : puntosTest <= 12 ? "Tipo III" : "Tipo IV+";
    document.getElementById('step-test').classList.remove('active');
    document.getElementById('step-resultado').classList.add('active');
    document.getElementById('fototipo-final').textContent = tipo;
    
    // Guardar en Supabase
    await supabase.from('resultados_piel').insert({ user_id: userActual.id, fototipo: tipo, nombre: document.getElementById('firma-nombre').value });
}

// AUTHENTICATION
document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.auth.signInWithPassword({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
    });
    if (error) document.getElementById('auth-error').textContent = error.message;
    else loginExitoso(data.user);
};

document.getElementById('register-form').onsubmit = async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const { data, error } = await supabase.auth.signUp({ email, password: document.getElementById('reg-pass').value });
    
    if (error) return document.getElementById('auth-error').textContent = error.message;
    
    await supabase.from('perfiles').insert({ id: data.user.id, nombre: nombre, role: 'voluntario' });
    alert("Registro exitoso. Ahora puedes iniciar sesión.");
    location.reload();
};

async function loginExitoso(user) {
    userActual = user;
    const { data: perfil } = await supabase.from('perfiles').select('*').eq('id', user.id).single();
    
    document.getElementById('vista-auth').classList.add('hidden');
    document.getElementById('main-header').classList.remove('hidden');
    document.getElementById('user-label').textContent = perfil?.nombre || user.email;
    
    if (perfil?.role !== 'admin') document.querySelectorAll('.admin-only').forEach(el => el.remove());
    showView('inicio');
}

// TABS LOGIN/REG
document.getElementById('btn-tab-login').onclick = () => {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
};
document.getElementById('btn-tab-reg').onclick = () => {
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('login-form').classList.add('hidden');
};

// LOGOUT
document.getElementById('logout-btn').onclick = () => {
    supabase.auth.signOut().then(() => location.reload());
};

// NAV LINKS
document.querySelectorAll('.nav a').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); showView(a.dataset.view); };
});
