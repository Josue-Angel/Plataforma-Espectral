// USA ESTA CONFIGURACIÓN ÚNICA
const PROJECT_URL = 'https://bwszeozmxzwuajrywqns.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3c3plb3pteHp3dWFqcnl3cW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyODU2ODAsImV4cCI6MjA3OTg2MTY4MH0.XAj13G3Bwl3iy7gfnVyHddA6LMH4Yc9dnx9Im6Dx8xI'; // Asegúrate que no falte ningún caracter

// Evitamos el error de duplicidad usando un nombre de variable único
if (typeof supabaseProyecto === 'undefined') {
    var supabaseProyecto = window.supabase.createClient(PROJECT_URL, ANON_KEY);
}

// Registro de usuario
const formReg = document.getElementById('register-form');
if(formReg) {
    formReg.onsubmit = async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-pass').value;
        const nombre = document.getElementById('reg-name').value;

        // Limpiar errores previos
        document.getElementById('auth-error').textContent = "Registrando...";

        const { data, error } = await supabaseProyecto.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: nombre
                }
            }
        });

        if (error) {
            console.error("Error de Supabase:", error);
            document.getElementById('auth-error').textContent = "Error: " + error.message;
        } else {
            alert("¡Registro exitoso! Ahora intenta iniciar sesión.");
            // Cambiar a la pestaña de login automáticamente
            document.getElementById('btn-tab-login').click();
        }
    };
}

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


