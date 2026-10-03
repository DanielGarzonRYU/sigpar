/**
 * Ayudas para Chart.js con colores tomados del tema (claro/oscuro).
 */
import { money } from './ui.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export const palette = () => ({
  primary: css('--ink') || '#16171a',
  teal: css('--accent') || '#f2c200',
  green: css('--libre') || '#16a34a',
  red: css('--ocupado') || '#dc2626',
  orange: css('--reservado') || '#ea8a0c',
  gray: css('--inactivo') || '#94a3b8',
  text: css('--ink-2') || '#53555c',
  grid: css('--line') || '#e0e0dc',
  // Tinta y amarillo placa primero; los colores de estado solo cuando hacen falta más series.
  series: [css('--ink') || '#16171a', css('--accent') || '#f2c200', css('--ink-3') || '#7c7e85', css('--libre') || '#1c8f4d', css('--reservado') || '#c56e05', css('--ocupado') || '#c93a2a'],
});

function baseOptions(p, { moneyAxis = false, stacked = false, legend = true } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: legend, position: 'bottom', labels: { color: p.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', font: { family: 'Geist' } } },
      tooltip: { callbacks: moneyAxis ? { label: (c) => `${c.dataset.label}: ${money(c.parsed.y ?? c.parsed)}` } : {} },
    },
    scales: {
      x: { stacked, grid: { display: false }, ticks: { color: p.text }, border: { color: p.grid } },
      y: {
        stacked, beginAtZero: true, grid: { color: p.grid }, border: { display: false },
        ticks: { color: p.text, precision: 0, callback: moneyAxis ? (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${v}`) : undefined },
      },
    },
  };
}

/** Crea (o actualiza) una gráfica. build(p) devuelve { type, data, opts }. */
export function chart(canvas, build) {
  if (!window.Chart) { canvas.parentElement.innerHTML = '<div class="empty">Gráfica no disponible</div>'; return { update() {}, destroy() {} }; }
  Chart.defaults.font.family = 'Geist, system-ui, sans-serif';
  const make = () => {
    const p = palette();
    const { type, data, opts = {}, options = {} } = build(p);
    const base = type === 'doughnut' ? { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom', labels: { color: p.text, usePointStyle: true } } } } : baseOptions(p, opts);
    return new Chart(canvas, { type, data, options: { ...base, ...options } });
  };
  let c = make();
  const onTheme = () => { c.destroy(); c = make(); };
  window.addEventListener('sigpar:theme', onTheme);
  return {
    update() {
      const { data } = build(palette());
      c.data.labels = data.labels;
      data.datasets.forEach((ds, i) => { if (c.data.datasets[i]) c.data.datasets[i].data = ds.data; else c.data.datasets.push(ds); });
      c.update('none');
    },
    destroy() { window.removeEventListener('sigpar:theme', onTheme); c.destroy(); },
  };
}
