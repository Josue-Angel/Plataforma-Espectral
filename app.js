// 1. CONFIGURACIÓN
const URL_DB = 'https://bwszeozmxzwuajrywqns.supabase.co';
const KEY_DB = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3c3plb3pteHp3dWFqcnl3cW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyODU2ODAsImV4cCI6MjA3OTg2MTY4MH0.XAj13G3Bwl3iy7gfnVyHddA6LMH4Yc9dnx9Im6Dx8xI';

// Solo creamos el cliente si no existe
const supabase = window.supabase.createClient(URL_DB, KEY_DB);

// 2. VARIABLES DEL TEST
const preguntas = [
  { q: "¿Color de ojos?", ops: ["Azules/Grises", "Verdes", "Castaños", "Negros"], pts: [0,1,2,3] },
  { q: "¿Reacción al sol?", ops: ["Siempre se quema", "Se quema a veces", "Rara vez se quema", "Nunca se quema"], pts: [0,1,2,3] }
];
let pasoActual = 0;
let puntosTotales = 0;

// 3. NAVEGACIÓN
document.querySelectorAll('.nav a').forEach(link => {
  link.onclick = (e) => {
    e.preventDefault();
    const target = link.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(target).classList.add('active');
    if(target === 'formularios') iniciarTest();
  };
});

// 4. LÓGICA DE LOGIN (CORREGIDA PARA EVITAR 401)
document.getElementById('btn-login').onclick = async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  
  if (error) {
    document.getElementById('error-msg').textContent = "Error: " + error.message;
  } else {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('welcome-msg').classList.remove('hidden');
    document.getElementById('user-label').textContent = data.user.email;
  }
};

// 5. LÓGICA DEL FORMULARIO
function iniciarTest() {
  pasoActual = 0;
  puntosTotales = 0;
  document.getElementById('quiz-container').classList.remove('hidden');
  document.getElementById('resultado-piel').classList.add('hidden');
  mostrarPregunta();
}

function mostrarPregunta() {
  const p = preguntas[pasoActual];
  document.getElementById('pregunta-texto').textContent = p.q;
  const lista = document.getElementById('opciones-lista');
  lista.innerHTML = '';
  p.ops.forEach((op, i) => {
    const btn = document.createElement('button');
    btn.textContent = op;
    btn.className = 'btn-opt'; // Asegúrate de tener este estilo en CSS
    btn.onclick = () => sumarPuntos(p.pts[i]);
    lista.appendChild(btn);
  });
}

function sumarPuntos(pts) {
  puntosTotales += pts;
  pasoActual++;
  if(pasoActual < preguntas.length) mostrarPregunta();
  else finalizarTest();
}

function finalizarTest() {
  document.getElementById('quiz-container').classList.add('hidden');
  document.getElementById('resultado-piel').classList.remove('hidden');
  const tipo = puntosTotales < 2 ? "Tipo I" : "Tipo II+";
  document.getElementById('tipo-badge').textContent = tipo;
}
