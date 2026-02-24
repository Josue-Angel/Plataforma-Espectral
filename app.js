// 1. CONFIGURACIÓN (Solo una vez)
const URL_PROYECTO = 'https://bwszeozmxzwuajrywqns.supabase.co';
const KEY_ANONIMA = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3c3plb3ptend1YWpyeXdxbnMiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTczMjk3MjU0MCwiZXhwIjoyMDQ4NTQ4NTQwfQ.8Y_U_N_Y_Z_I_D_E_A_T_O_K_E_N';

// Usamos un nombre único para evitar el error "already declared"
const clientSupabase = window.supabase.createClient(URL_PROYECTO, KEY_ANONIMA);

let userSesion = null;

// 2. FUNCIONES DE CAMBIO DE PESTAÑA (Tabs de Login)
const btnTabLogin = document.getElementById('btn-tab-login');
const btnTabReg = document.getElementById('btn-tab-reg');
const formLogin = document.getElementById('login-form');
const formReg = document.getElementById('register-form');

btnTabLogin.onclick = () => {
    formLogin.classList.remove('hidden');
    formReg.classList.add('hidden');
    btnTabLogin.classList.add('active');
    btnTabReg.classList.remove('active');
};

btnTabReg.onclick = () => {
    formReg.classList.remove('hidden');
    formLogin.classList.add('hidden');
    btnTabReg.classList.add('active');
    btnTabLogin.classList.remove('active');
};

// 3. AUTENTICACIÓN
formLogin.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;

    const { data, error } = await clientSupabase.auth.signInWithPassword({ email, password: pass });

    if (error) {
        document.getElementById('auth-error').textContent = "Error: " + error.message;
    } else {
        entrarALaApp(data.user);
    }
};

formReg.onsubmit = async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-pass').value;

    const { data, error } = await clientSupabase.auth.signUp({ email, password: pass });

    if (error) {
        document.getElementById('auth-error').textContent = "Error: " + error.message;
    } else {
        // Crear perfil en tabla de perfiles
        await clientSupabase.from('perfiles').insert({ id: data.user.id, nombre: nombre, role: 'voluntario' });
        alert("¡Registro exitoso! Ya puedes iniciar sesión.");
        btnTabLogin.click();
    }
};

// 4. FLUJO DE LA APLICACIÓN
async function entrarALaApp(user) {
    userSesion = user;
    
    // Obtener rol del perfil
    const { data: perfil } = await clientSupabase.from('perfiles').select('*').eq('id', user.id).single();
    const rol = perfil ? perfil.role : 'voluntario';

    // UI
    document.getElementById('vista-auth').classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    document.getElementById('user-label').textContent = perfil?.nombre || user.email;

    if (rol !== 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.remove());
    }

    showView('inicio');
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// Navegación
document.querySelectorAll('.nav a').forEach(a => {
    a.onclick = (e) => {
        e.preventDefault();
        showView(a.dataset.view);
    };
});

// Logout
document.getElementById('logout-btn').onclick = async () => {
    await clientSupabase.auth.signOut();
    location.reload();
};

// Verificar si hay sesión activa al cargar
async function verificarSesion() {
    const { data: { session } } = await clientSupabase.auth.getSession();
    if (session) entrarALaApp(session.user);
}
verificarSesion();
