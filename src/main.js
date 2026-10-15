import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { PRESETS } from './presets.js';
import { preparePlan } from './plan.js';
import { layoutPlan, REASON_TEXT, RULES } from './layout.js';
import { buildApartment, disposeObject } from './scene.js';
import { fmt } from './geometry.js';

const CUT_HEIGHT = 1.2;
const $ = (id) => document.getElementById(id);
const els = {
  viewport: $('viewport'),
  preset: $('preset'),
  json: $('json'),
  height: $('height'),
  heightVal: $('heightVal'),
  passage: $('passage'),
  passageVal: $('passageVal'),
  cut: $('cut'),
  zones: $('zones'),
  variant: $('variant'),
  variantVal: $('variantVal'),
  glb: $('glb'),
  report: $('report'),
  errors: $('errors'),
  legend: $('legend'),
  view3d: $('view3d'),
  viewTop: $('viewTop'),
  reset: $('resetJson'),
};

const state = { preset: 'twoRoom', seed: 1, jitter: 0, passage: 0.7, cut: true, zones: false, selected: null };

// --- Three.js setup -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
els.viewport.prepend(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
els.viewport.append(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#ebe6de');
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

scene.add(new THREE.HemisphereLight('#ffffff', '#cdbfae', 1.9));
const sun = new THREE.DirectionalLight('#fff3e2', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#e2dbd0', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
scene.add(ground);

let current = null;
let highlight = null;

function sizeOf(b) {
  return { cx: (b.x0 + b.x1) / 2, cz: (b.y0 + b.y1) / 2, S: Math.max(b.x1 - b.x0, b.y1 - b.y0) };
}

function placeLights(bounds) {
  const { cx, cz, S } = sizeOf(bounds);
  sun.position.set(cx + S * 0.45, S * 1.5, cz + S * 0.8);
  sun.target.position.set(cx, 0, cz);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -S * 0.9;
  cam.right = cam.top = S * 0.9;
  cam.near = 0.1;
  cam.far = S * 5;
  cam.updateProjectionMatrix();
  ground.scale.set(S * 6, S * 6, 1);
  ground.position.set(cx, -0.01, cz);
}

function setView(mode) {
  if (!current) return;
  const b = current.plan.bounds;
  const { cx, cz } = sizeOf(b);
  // Distance at which the whole plan fits the frame, both by width and by depth.
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fit = Math.max((b.x1 - b.x0) / (2 * tan * camera.aspect), (b.y1 - b.y0) / (2 * tan)) * 1.12;
  controls.target.set(cx, 0, cz);
  if (mode === 'top') camera.position.set(cx, fit, cz + 0.01);
  else {
    const dir = new THREE.Vector3(0.1, 1, 0.95).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, fit * 1.12);
  }
  controls.update();
  els.view3d.classList.toggle('active', mode !== 'top');
  els.viewTop.classList.toggle('active', mode === 'top');
}

// --- Plan → layout → scene ------------------------------------------------
function rebuild({ fit = false } = {}) {
  let raw;
  try {
    raw = JSON.parse(els.json.value);
  } catch (err) {
    return showErrors([`JSON не читается: ${err.message}`]);
  }
  const plan = preparePlan(raw, { height: Number(els.height.value) });
  if (plan.errors.length) return showErrors(plan.errors);
  const layout = layoutPlan(plan, { seed: state.seed, jitter: state.jitter, minPassage: state.passage });
  const built = buildApartment(plan, layout, { wallHeight: state.cut ? Math.min(CUT_HEIGHT, plan.height) : plan.height });

  if (current) {
    current.built.labels.clear(); // CSS2D labels drop their DOM nodes only when removed one by one
    scene.remove(current.built.root, current.built.overlay, current.built.labels);
    disposeObject(current.built.root);
    disposeObject(current.built.overlay);
  }
  built.overlay.visible = state.zones;
  scene.add(built.root, built.overlay, built.labels);
  current = { plan, layout, built };
  showErrors([], plan.warnings);
  placeLights(plan.bounds);
  if (fit) setView('3d');
  renderReport();
  select(state.selected && built.items.has(state.selected) ? state.selected : null);
}

function showErrors(errors, warnings = []) {
  const list = [...errors.map((e) => ['error', e]), ...warnings.map((w) => ['warn', w])];
  els.errors.replaceChildren(
    ...list.map(([kind, text]) => {
      const li = document.createElement('li');
      li.className = kind;
      li.textContent = text;
      return li;
    }),
  );
  els.errors.hidden = !list.length;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (n) => n.toLocaleString('ru-RU');
const plural = (n, [one, few, many]) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
};

function tallyText(tally) {
  const parts = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${REASON_TEXT[k]} — ${num(v)}`);
  return parts.length ? `отсеяно: ${parts.join(', ')}` : '';
}

function renderReport() {
  const { plan, layout } = current;
  const rulesHtml = RULES.map(
    (r) => `<li><span>${escapeHtml(r.title)}</span><b>${num(layout.tally[r.id] ?? 0)}</b></li>`,
  ).join('');
  const passOk = layout.accessIssues === 0;
  const rooms = layout.rooms
    .map((rl) => {
      const items = rl.results
        .map((res) => {
          const stats = `проверено позиций: ${num(res.tried)}${res.tried ? '; ' : ''}${tallyText(res.tally)}`;
          if (!res.ok) {
            const cls = res.optional ? 'skip' : 'fail';
            const why = res.optional ? `необязательный, пропущен: ${res.reason}` : `не встал: ${res.reason}`;
            return `<div class="item ${cls}"><span class="mark">${res.optional ? '–' : '✕'}</span><span class="body"><span class="name">${escapeHtml(res.name)}</span><span class="why">${escapeHtml(why)}</span><span class="stats">${escapeHtml(stats)}</span></span></div>`;
          }
          const cls = res.reachable ? 'ok' : 'warn';
          const why = res.reachable ? res.notes.join(' · ') : `не подойти: проход уже ${fmt(state.passage)} м`;
          return `<button type="button" class="item ${cls}" data-id="${res.item.id}"><span class="mark">${res.reachable ? '✓' : '!'}</span><span class="body"><span class="name">${escapeHtml(res.name)}</span><span class="why">${escapeHtml(why || 'у стены')}</span><span class="stats">${escapeHtml(stats)}</span></span></button>`;
        })
        .join('');
      const doorIssues = rl.access.issues
        .filter((t) => t.startsWith('Дверь') || t.startsWith('Входная') || t.startsWith('В комнате'))
        .map((t) => `<div class="item warn"><span class="mark">!</span><span class="body"><span class="why">${escapeHtml(t)}</span></span></div>`)
        .join('');
      return `<details open><summary>${escapeHtml(rl.room.name)} <small>${fmt(rl.room.area, 1)} м²</small></summary>${items}${doorIssues}</details>`;
    })
    .join('');
  els.report.innerHTML = `
    <div class="kpis">
      <div><b>${layout.placed}/${layout.total}</b><span>${plural(layout.total, ['предмет', 'предмета', 'предметов'])} расставлено</span></div>
      <div class="${passOk ? '' : 'bad'}"><b>${passOk ? 'ок' : layout.accessIssues}</b><span>${passOk ? 'проходы' : `${plural(layout.accessIssues, ['проблема', 'проблемы', 'проблем'])} с проходом`}</span></div>
      <div><b>${Math.max(1, Math.round(layout.ms))} мс</b><span>${num(layout.tried)} ${plural(layout.tried, ['позиция', 'позиции', 'позиций'])}</span></div>
    </div>
    <h2>Правила <small>сколько позиций отсеяло</small></h2>
    <ul class="rules">${rulesHtml}
      <li><span>Проход от двери до каждого предмета не уже ${fmt(state.passage)} м — поиск в ширину по сетке 2,5 см</span><b class="${passOk ? 'good' : 'bad'}">${passOk ? 'ок' : `${layout.accessIssues} наруш.`}</b></li>
    </ul>
    <h2>Комнаты <small>нажмите на предмет — покажу, почему он там</small></h2>
    ${rooms}`;
}

const highlightMaterial = new THREE.MeshBasicMaterial({ color: '#2b7de9', transparent: true, opacity: 0.22, depthWrite: false });

function select(id) {
  state.selected = id;
  if (highlight) {
    scene.remove(highlight);
    highlight.traverse((o) => o.geometry?.dispose());
    highlight = null;
  }
  if (id && current?.built.items.has(id)) {
    const target = current.built.items.get(id);
    const box = new THREE.Box3().setFromObject(target);
    const size = box.getSize(new THREE.Vector3()).addScalar(0.06);
    highlight = new THREE.Group();
    const volume = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), highlightMaterial);
    box.getCenter(volume.position);
    volume.updateMatrixWorld();
    highlight.add(volume, new THREE.BoxHelper(volume, '#2b7de9'));
    scene.add(highlight);
  }
  for (const el of els.report.querySelectorAll('.item[data-id]')) {
    const on = el.dataset.id === id;
    el.classList.toggle('selected', on);
    if (on) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// --- Picking in 3D --------------------------------------------------------
const raycaster = new THREE.Raycaster();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || !current || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(current.built.root, true).find((h) => h.object.userData.itemId);
  select(hit ? hit.object.userData.itemId : null);
});

// --- UI wiring ------------------------------------------------------------
function compactJson(value) {
  return JSON.stringify(value, null, 2)
    .replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]')
    .replace(/\[\s+((?:\[-?[\d.]+, -?[\d.]+\],?\s+)+)\]/g, (_, inner) => `[${inner.trim().split(/,\s+/).join(', ')}]`)
    .replace(/\[\s+((?:"[^"]*",?\s+)+)\]/g, (_, inner) => `[${inner.trim().split(/,\s+/).join(', ')}]`)
    .replace(/\{\s+("at": \[[^\]]*\],?\s+(?:"[a-z]+": [\d.]+,?\s+)*)\}/g, (_, inner) => `{ ${inner.trim().split(/,\s+/).join(', ')} }`);
}

function loadPreset(key) {
  state.preset = key;
  state.seed = 1;
  state.jitter = 0;
  state.selected = null;
  const plan = PRESETS[key].plan;
  els.json.value = compactJson(plan);
  els.height.value = plan.height ?? 2.7;
  updateLabels();
  rebuild({ fit: true });
}

function updateLabels() {
  els.heightVal.textContent = `${fmt(Number(els.height.value))} м`;
  els.passageVal.textContent = `${fmt(state.passage)} м`;
  els.variantVal.textContent = state.seed === 1 && !state.jitter ? 'лучший по очкам' : `вариант ${state.seed}`;
}

els.preset.replaceChildren(
  ...Object.entries(PRESETS).map(([key, p]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = p.title;
    return opt;
  }),
);
els.preset.addEventListener('change', () => loadPreset(els.preset.value));
els.reset.addEventListener('click', () => loadPreset(state.preset));

let typing = 0;
els.json.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(() => rebuild(), 500);
});
els.height.addEventListener('input', () => {
  updateLabels();
  rebuild();
});
els.passage.addEventListener('input', () => {
  state.passage = Number(els.passage.value);
  updateLabels();
  rebuild();
});
els.cut.addEventListener('change', () => {
  state.cut = els.cut.checked;
  rebuild();
});
els.zones.addEventListener('change', () => {
  state.zones = els.zones.checked;
  if (current) current.built.overlay.visible = state.zones;
  els.legend.hidden = !state.zones;
});
els.variant.addEventListener('click', () => {
  state.seed += 1;
  state.jitter = 1.2;
  updateLabels();
  rebuild();
});
els.view3d.addEventListener('click', () => setView('3d'));
els.viewTop.addEventListener('click', () => setView('top'));
els.report.addEventListener('click', (e) => {
  const item = e.target.closest('.item[data-id]');
  if (item) select(item.dataset.id === state.selected ? null : item.dataset.id);
});
els.glb.addEventListener('click', () => {
  if (!current) return;
  new GLTFExporter().parse(
    current.built.root,
    (glb) => {
      const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plan.glb';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    (err) => showErrors([`Экспорт не удался: ${err?.message ?? err}`]),
    { binary: true },
  );
});

let sized = false;
new ResizeObserver(() => {
  const { clientWidth: w, clientHeight: h } = els.viewport;
  if (!w || !h) return;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!sized) {
    sized = true;
    setView('3d');
  }
}).observe(els.viewport);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

els.cut.checked = state.cut;
els.zones.checked = state.zones;
els.passage.value = state.passage;
loadPreset(state.preset);
