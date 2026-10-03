/**
 * Pantalla de inicio de sesión.
 */
import { api, auth } from './api.js';
import { esc } from './ui.js';

if (auth.token) location.replace('app.html');

// Parqueadero en 3D (solo CSS): dos filas de puestos, la vía al medio y un carro amarillo que entra,
// gira y se estaciona en el puesto libre. Los demás carros están quietos. Es la "foto" de lo que hace SIGPAR.
const PUESTOS = { arriba: [1, 1, 0, 1, 'objetivo', 1], abajo: [1, 0, 1, 1, 1, 0] };
const COLORES = ['#c9ccd1', '#8f959e', '#e7e7e3', '#5f646d', '#d3cfc6', '#a9adb3', '#eceae4', '#7a8089'];
const mapa = document.getElementById('heroMapa');
if (mapa) {
  const auto = (x, y, c, extra = '') => `<div class="auto3d${extra}" style="--x:${x}px;--y:${y}px;--c:${c}"><i class="t"></i><i class="v"></i><i class="f"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>`;
  let html = '';
  let k = 0;
  const libres = [...PUESTOS.arriba, ...PUESTOS.abajo].filter((v) => v === 0 || v === 'objetivo').length;
  for (const [fila, top] of [['arriba', 10], ['abajo', 188]]) {
    PUESTOS[fila].forEach((v, i) => {
      const x = 15 + i * 50;
      html += `<div class="pz3d${v === 0 ? ' libre' : v === 'objetivo' ? ' objetivo' : ''}" style="left:${x}px;top:${top}px"></div>`;
      if (v === 1) html += auto(x + 10, top + 19, COLORES[k++ % COLORES.length]);
    });
  }
  mapa.innerHTML = `<div class="cab"><span>Sede Centro, ahora</span><span><b>${libres - 1}</b> libres de 12</span></div>
    <div class="escena3d"><div class="piso3d"><div class="via3d"></div>${html}${auto(225, 29, '#f2c200', ' mueve')}</div></div>`;
}

const form = document.getElementById('form');
const msg = document.getElementById('msg');
const btn = document.getElementById('btn');
const show = (text, cls = 'err') => { msg.innerHTML = `<div class="alert ${cls}" style="margin-bottom:14px">${esc(text)}</div>`; };

if (new URLSearchParams(location.search).has('expirada')) show('Su sesión expiró. Ingrese de nuevo.', 'info');

// Despierta el servidor apenas se abre la página y muestra las cuentas demo si aplica.
api.get('/health').then((h) => { if (h.demo) document.getElementById('demo').classList.remove('hidden'); }).catch(() => {});

document.querySelectorAll('#demo [data-u]').forEach((b) => b.onclick = () => {
  form.email.value = b.dataset.u; form.password.value = 'Sigpar2026*'; form.requestSubmit();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.innerHTML = '';
  if (!form.email.value || !form.password.value) return show('Escriba su correo y contraseña.');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Ingresando…';
  try {
    const r = await api.post('/auth/login', { email: form.email.value, password: form.password.value, origen: 'web' });
    auth.save(r.token, { usuario: r.usuario, sedes: r.sedes, empresa: r.empresa });
    location.replace('app.html');
  } catch (err) {
    show(err.message);
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});
