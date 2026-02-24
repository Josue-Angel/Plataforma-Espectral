// ===============================
// CONFIGURACIÓN SUPABASE
// ===============================
const URL_SUPA = 'https://bwszeozmxzwuajrywqns.supabase.co';
const KEY_SUPA = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3c3plb3pteHp3dWFqcnl3cW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyODU2ODAsImV4cCI6MjA3OTg2MTY4MH0.XAj13G3Bwl3iy7gfnVyHddA6LMH4Yc9dnx9Im6Dx8xI';

// Usamos un nombre que NO sea 'supabase' para evitar el error "Already Declared"
const supaClient = window.supabase.createClient(URL_SUPA, KEY_SUPA);

// Estado de la app
let userLogueado = null;

// ===============================
// NAVEGACIÓN
// ===============================
function mostrarSeccion(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const seccion = document.getElementById(viewId);
    if(seccion) seccion.classList.add('active');
}

document.querySelectorAll('#nav-links a').forEach(link => {
    link.onclick = (e) => {
        e.preventDefault();
        const view = link.dataset.view;
        
        if (!userLogueado && view !== 'inicio') {
            alert("Por favor, inicia sesión primero.");
            return;
        }
        mostrarSeccion(view);
    };
});

// ===============================
// LÓGICA DE LOGIN
// ===============================
const formLogin = document.getElementById('form-login-real');

if(formLogin) {
    formLogin.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('error-msg');
        
        errorDiv.textContent = "Verificando...";

        const { data, error } = await supaClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            errorDiv.textContent = "Error: " + error.message;
        } else {
            successLogin(data.user);
        }
    };
}

function successLogin(user) {
    userLogueado = user;
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('welcome-msg').classList.remove('hidden');
    document.getElementById('logout-btn').classList.remove('hidden');
    document.getElementById('user-label').textContent = user.email;
    
    // Aquí podrías habilitar las opciones de admin si el correo es de admin
    if (user.email.includes('admin')) {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }
}

// LOGOUT
document.getElementById('logout-btn').onclick = async () => {
    await supaClient.auth.signOut();
    location.reload();
};
