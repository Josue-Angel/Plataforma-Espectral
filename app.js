// ===============================
// CONFIGURACIÓN SUPABASE
// ===============================
const URL_SUPA = 'https://bwszeozmxzwuajrywqns.supabase.co';
const KEY_SUPA = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3c3plb3pteHp3dWFqcnl3cW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyODU2ODAsImV4cCI6MjA3OTg2MTY4MH0.XAj13G3Bwl3iy7gfnVyHddA6LMH4Yc9dnx9Im6Dx8xI';

// Usamos un nombre que NO sea 'supabase' para evitar el error "Already Declared"
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let sesionActiva = false;

// ===============================
// NAVEGACIÓN DIRECTA
// ===============================
function cambiarVista(viewId) {
    // 1. Ocultar todas las vistas
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
        v.style.display = 'none'; // Forzamos el ocultamiento
    });

    // 2. Mostrar la vista seleccionada
    const vistaDestino = document.getElementById(viewId);
    if (vistaDestino) {
        vistaDestino.classList.add('active');
        vistaDestino.style.display = 'block'; // Forzamos que se vea
        console.log("Cambiando a vista:", viewId);
    }
}

// Configurar los clics en el menú
document.querySelectorAll('#nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.getAttribute('data-view');
        
        // Solo dejamos navegar si ya se logueó
        if (sesionActiva) {
            cambiarVista(view);
        } else {
            alert("Inicia sesión para navegar.");
        }
    });
});

// ===============================
// MANEJO DEL LOGIN
// ===============================
const loginForm = document.getElementById('login-form'); // Asegúrate que tu <form> tenga este ID
if (loginForm) {
    loginForm.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        const { data, error } = await supa.auth.signInWithPassword({ email, password });

        if (error) {
            alert("Error: " + error.message);
        } else {
            loginExitoso(data.user);
        }
    };
}

function loginExitoso(user) {
    sesionActiva = true;
    
    // UI: Ocultar login y mostrar bienvenida
    const loginCard = document.querySelector('.card'); // El contenedor del login
    if(loginCard) loginCard.style.display = 'none';
    
    const welcome = document.getElementById('welcome-msg');
    if(welcome) welcome.style.display = 'block';

    document.getElementById('user-label').textContent = user.email;
    document.getElementById('logout-btn').classList.remove('hidden');

    // Por seguridad, mostramos la vista de inicio por defecto
    cambiarVista('inicio');
}

// Cerrar Sesión
document.getElementById('logout-btn').onclick = () => {
    supa.auth.signOut().then(() => location.reload());
};
