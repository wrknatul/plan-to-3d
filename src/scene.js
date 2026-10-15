// Builds the Three.js scene from a prepared plan and its layout.
// Plan (x, y) maps to world (x, height, y); furniture is modelled in a local frame where
// x runs along the item, +z points out of its front and y is up.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ROOM_TYPES } from './catalog.js';
import { fmt } from './geometry.js';

const P = {
  wall: '#f3f0ea',
  wallTop: '#4f4a44',
  glass: '#9cc9e4',
  sill: '#fbfaf8',
  wood: '#c9a27c',
  woodDark: '#86664b',
  linen: '#f1ede6',
  pillow: '#fdfcfa',
  blanket: '#7a9bb4',
  fabric: '#6d7c8b',
  fabricLight: '#8f9cab',
  dark: '#2c2e32',
  screen: '#111417',
  cabinet: '#ece6dc',
  seam: '#b4aa9c',
  steel: '#bfc4c8',
  white: '#f8f8f6',
  water: '#cfe5f1',
  top: '#3b3936',
  fridge: '#e2e5e7',
  rug: '#d8cdbd',
};
const BOOKS = ['#c2523c', '#3f6e8c', '#d9a441', '#55745a', '#8c5e8a', '#e0d6c3'];

const materials = new Map();
function material(color, extra = {}) {
  const key = `${color}|${extra.roughness ?? ''}|${extra.metalness ?? ''}|${extra.opacity ?? ''}`;
  if (!materials.has(key)) {
    materials.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness: extra.roughness ?? 0.85,
        metalness: extra.metalness ?? 0,
        transparent: extra.opacity !== undefined,
        opacity: extra.opacity ?? 1,
        depthWrite: extra.opacity === undefined,
      }),
    );
  }
  return materials.get(key);
}

function add(group, w, h, d, color, x, y, z, extra) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color, extra));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

let floorMaterials = null;
function getFloorMaterials() {
  if (floorMaterials) return floorMaterials;
  const texture = (draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    draw(canvas.getContext('2d'), 512);
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  // One texture tile covers 1 m × 1 m: shape UVs are plan meters.
  const wood = texture((g, S) => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const planks = 6;
    const ph = S / planks;
    for (let p = 0; p < planks; p++) {
      let x = -rnd() * S * 0.8;
      while (x < S) {
        const len = S * (0.55 + rnd() * 0.5);
        g.fillStyle = `hsl(31, ${34 + rnd() * 8}%, ${70 + rnd() * 8}%)`;
        g.fillRect(x, p * ph, len, ph);
        g.strokeStyle = 'rgba(120, 80, 40, 0.07)';
        for (let k = 0; k < 5; k++) {
          const y = p * ph + rnd() * ph;
          g.beginPath();
          g.moveTo(x, y);
          g.bezierCurveTo(x + len / 3, y + 3, x + (2 * len) / 3, y - 3, x + len, y);
          g.stroke();
        }
        g.fillStyle = 'rgba(90, 60, 30, 0.3)';
        g.fillRect(x, p * ph, 2, ph);
        x += len;
      }
      g.fillStyle = 'rgba(90, 60, 30, 0.3)';
      g.fillRect(0, p * ph, S, 2);
    }
  });
  const tile = texture((g, S) => {
    g.fillStyle = '#d9d6d0';
    g.fillRect(0, 0, S, S);
    const n = 4;
    const t = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.fillStyle = `hsl(40, 8%, ${86 + ((i * 7 + j * 3) % 5)}%)`;
        g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
      }
    }
  });
  floorMaterials = {
    wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 }),
    tile: new THREE.MeshStandardMaterial({ map: tile, roughness: 0.45 }),
  };
  return floorMaterials;
}

function floorMesh(room) {
  const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(x, -y)));
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), getFloorMaterials()[ROOM_TYPES[room.type].floor]);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function wallGroup(wall, H) {
  const group = new THREE.Group();
  const side = material(P.wall);
  const top = material(P.wallTop);
  const faces = [side, side, top, side, side, side];
  const pieces = [];
  let cursor = wall.renderFrom;
  for (const o of wall.openings) {
    if (o.lo > cursor + 1e-4) pieces.push([cursor, o.lo, 0, H]);
    if (o.sill > 0) pieces.push([o.lo, o.hi, 0, Math.min(o.sill, H)]);
    if (o.top < H) pieces.push([o.lo, o.hi, o.top, H]);
    cursor = o.hi;
  }
  if (wall.renderTo > cursor + 1e-4) pieces.push([cursor, wall.renderTo, 0, H]);
  const t = wall.thickness;
  const place = (mesh, along, y) => {
    if (wall.orient === 'h') mesh.position.set(along, y, wall.c);
    else mesh.position.set(wall.c, y, along);
  };
  const dims = (len, h, depth) => (wall.orient === 'h' ? [len, h, depth] : [depth, h, len]);
  for (const [a, b, y0, y1] of pieces) {
    if (y1 - y0 < 1e-3) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dims(b - a, y1 - y0, t)), faces);
    place(mesh, (a + b) / 2, (y0 + y1) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const o of wall.openings) {
    if (o.kind !== 'window' || o.sill >= H) continue;
    const glassTop = Math.min(o.top, H);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(...dims(o.width, glassTop - o.sill, 0.02)),
      material(P.glass, { roughness: 0.05, metalness: 0.1, opacity: 0.35 }),
    );
    place(glass, o.center, (o.sill + glassTop) / 2);
    group.add(glass);
    const board = new THREE.Mesh(new THREE.BoxGeometry(...dims(o.width + 0.1, 0.04, t + 0.1)), material(P.sill));
    place(board, o.center, o.sill + 0.02);
    board.castShadow = board.receiveShadow = true;
    group.add(board);
    if (glassTop - o.sill > 0.3) {
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(...dims(0.05, glassTop - o.sill, 0.06)), material(P.sill));
      place(mullion, o.center, (o.sill + glassTop) / 2);
      group.add(mullion);
    }
  }
  return group;
}

function chair(group, x, z, rotation) {
  const c = new THREE.Group();
  add(c, 0.44, 0.05, 0.42, P.woodDark, 0, 0.46, 0);
  add(c, 0.44, 0.4, 0.04, P.woodDark, 0, 0.7, 0.19);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(c, 0.035, 0.44, 0.035, P.woodDark, sx * 0.19, 0.22, sz * 0.18);
  c.position.set(x, 0, z);
  c.rotation.y = rotation;
  group.add(c);
}

function wardrobe(color) {
  return (g, { w, d, h }) => {
    add(g, w, h, d, color, 0, h / 2, 0);
    const doors = Math.max(2, Math.round(w / 0.6));
    for (let k = 1; k < doors; k++) add(g, 0.012, h - 0.12, 0.01, P.seam, -w / 2 + (w * k) / doors, h / 2 + 0.03, d / 2 + 0.004);
    for (let k = 0; k < doors; k++) {
      const edge = k % 2 === 0 ? 1 : -1;
      const x = -w / 2 + (w * (k + 0.5)) / doors + edge * (w / doors / 2 - 0.06);
      add(g, 0.02, 0.3, 0.03, P.steel, x, h * 0.5, d / 2 + 0.015, { metalness: 0.5, roughness: 0.4 });
    }
    add(g, w, 0.08, 0.01, P.seam, 0, 0.04, d / 2 + 0.004);
  };
}

const BUILDERS = {
  bed(g, { d }) {
    const back = -d / 2;
    add(g, 1.72, 1.0, 0.08, P.woodDark, 0, 0.5, back + 0.04);
    add(g, 1.62, 0.28, 2.0, P.wood, 0, 0.14, back + 1.08);
    add(g, 1.54, 0.2, 1.95, P.linen, 0, 0.38, back + 1.08);
    for (const sx of [-1, 1]) add(g, 0.62, 0.12, 0.36, P.pillow, sx * 0.38, 0.54, back + 0.3);
    add(g, 1.6, 0.07, 1.25, P.blanket, 0, 0.51, back + 1.455);
    for (const sx of [-1, 1]) {
      const x = sx * 1.02;
      add(g, 0.42, 0.45, 0.4, P.wood, x, 0.225, back + 0.22);
      add(g, 0.16, 0.22, 0.16, P.linen, x, 0.56, back + 0.2);
    }
  },
  wardrobe: wardrobe(P.cabinet),
  hallWardrobe: wardrobe('#e4dccf'),
  sofa(g, { w, d }) {
    add(g, w, 0.4, d, P.fabric, 0, 0.2, 0);
    add(g, w - 0.04, 0.42, 0.24, P.fabric, 0, 0.6, -d / 2 + 0.12);
    for (const sx of [-1, 1]) add(g, 0.2, 0.62, d, P.fabric, sx * (w / 2 - 0.1), 0.31, 0);
    const seat = (w - 0.4) / 2;
    for (const sx of [-0.5, 0.5]) add(g, seat - 0.02, 0.14, d - 0.28, P.fabricLight, sx * seat, 0.47, 0.12);
    add(g, 0.42, 0.36, 0.12, P.linen, -w / 2 + 0.45, 0.66, -d / 2 + 0.32);
    add(g, w + 0.2, 0.01, 1.3, P.rug, 0, 0.005, d / 2 + 0.25).userData.noShadow = true;
    add(g, 1.0, 0.04, 0.5, P.wood, 0, 0.42, d / 2 + 0.45);
    add(g, 0.9, 0.38, 0.4, P.woodDark, 0, 0.2, d / 2 + 0.45);
  },
  tv(g, { w, d }) {
    add(g, w, 0.45, d, P.woodDark, 0, 0.225, 0);
    add(g, w - 0.04, 0.012, d - 0.04, P.seam, 0, 0.3, d / 2 - 0.01);
    add(g, 0.3, 0.06, 0.18, P.dark, 0, 0.48, -d / 2 + 0.14);
    add(g, 0.05, 0.12, 0.05, P.dark, 0, 0.55, -d / 2 + 0.12);
    add(g, 1.3, 0.75, 0.05, P.screen, 0, 0.88, -d / 2 + 0.12, { roughness: 0.25 });
  },
  bookcase(g, { w, d, h }) {
    const t = 0.03;
    for (const sx of [-1, 1]) add(g, t, h, d, P.wood, sx * (w / 2 - t / 2), h / 2, 0);
    add(g, w, h, 0.015, P.woodDark, 0, h / 2, -d / 2 + 0.008);
    const shelves = 5;
    const pitch = (h - t) / shelves;
    for (let k = 0; k <= shelves; k++) add(g, w - 2 * t, t, d, P.wood, 0, k * pitch + t / 2, 0);
    let seed = 7;
    for (let k = 0; k < shelves; k++) {
      let x = -w / 2 + t + 0.01;
      const y0 = k * pitch + t;
      for (;;) {
        seed = (seed * 9301 + 49297) % 233280;
        const r = seed / 233280;
        const bw = 0.03 + r * 0.04;
        const bh = 0.18 + r * 0.14;
        if (x + bw > w / 2 - t - 0.01) break;
        add(g, bw, bh, d * 0.75, BOOKS[Math.floor(r * BOOKS.length)], x + bw / 2, y0 + bh / 2, 0.01);
        x += bw + 0.004 + (r > 0.86 ? 0.1 : 0);
      }
    }
  },
  desk(g, { w, d }) {
    add(g, w, 0.04, d, P.wood, 0, 0.73, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, 0.04, 0.71, 0.04, P.dark, sx * (w / 2 - 0.04), 0.355, sz * (d / 2 - 0.04));
    add(g, 0.56, 0.34, 0.03, P.screen, 0, 1.0, -d / 2 + 0.12, { roughness: 0.3 });
    add(g, 0.05, 0.16, 0.05, P.dark, 0, 0.82, -d / 2 + 0.12);
    add(g, 0.42, 0.02, 0.14, P.dark, 0, 0.76, 0.02);
    add(g, 0.14, 0.3, 0.14, P.linen, w / 2 - 0.15, 0.9, -d / 2 + 0.12);
    chair(g, 0, d / 2 + 0.3, 0);
  },
  armchair(g, { w, d }) {
    add(g, w, 0.38, d, P.fabricLight, 0, 0.19, 0);
    add(g, w, 0.5, 0.18, P.fabricLight, 0, 0.63, -d / 2 + 0.09);
    for (const sx of [-1, 1]) add(g, 0.14, 0.58, d, P.fabricLight, sx * (w / 2 - 0.07), 0.29, 0);
    add(g, w - 0.3, 0.12, d - 0.24, P.linen, 0, 0.44, 0.08);
  },
  fridge(g, { w, d, h }) {
    add(g, w, h, d, P.fridge, 0, h / 2, 0, { roughness: 0.4 });
    add(g, w - 0.02, 0.012, 0.01, P.seam, 0, h * 0.62, d / 2 + 0.005);
    add(g, 0.025, 0.35, 0.03, P.steel, w / 2 - 0.06, h * 0.62 + 0.25, d / 2 + 0.02, { metalness: 0.5 });
    add(g, 0.025, 0.45, 0.03, P.steel, w / 2 - 0.06, h * 0.62 - 0.3, d / 2 + 0.02, { metalness: 0.5 });
  },
  counter(g, item) {
    const { w, d } = item;
    add(g, w, 0.82, d - 0.03, P.cabinet, 0, 0.41, -0.015);
    add(g, w, 0.04, d, P.top, 0, 0.84, 0, { roughness: 0.5 });
    const doors = Math.max(1, Math.round(w / 0.6));
    for (let k = 1; k < doors; k++) add(g, 0.01, 0.7, 0.01, P.seam, -w / 2 + (w * k) / doors, 0.45, d / 2 - 0.025);
    add(g, w, 0.08, 0.01, P.seam, 0, 0.04, d / 2 - 0.03);
    const limit = w / 2 - 0.35;
    const local = localX(item, item.sinkAt);
    const sinkX = Math.max(-limit, Math.min(limit, local ?? -w / 2 + Math.min(0.7, w * 0.3)));
    add(g, 0.5, 0.02, 0.4, P.steel, sinkX, 0.865, 0, { metalness: 0.6, roughness: 0.3 });
    add(g, 0.03, 0.25, 0.03, P.steel, sinkX, 0.98, -d / 2 + 0.08, { metalness: 0.6, roughness: 0.3 });
    const cookX = sinkX < 0 ? Math.min(limit, sinkX + 1.0) : Math.max(-limit, sinkX - 1.0);
    add(g, 0.58, 0.012, 0.5, '#1b1b1d', cookX, 0.866, 0, { roughness: 0.25 });
  },
  dining(g, { w, d }) {
    add(g, w, 0.04, d, P.wood, 0, 0.74, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, 0.05, 0.72, 0.05, P.woodDark, sx * (w / 2 - 0.06), 0.36, sz * (d / 2 - 0.06));
    const seats = w >= 1.0 ? [-w / 4, w / 4] : [0];
    for (const x of seats) {
      chair(g, x, d / 2 + 0.25, 0);
      chair(g, x, -d / 2 - 0.25, Math.PI);
    }
    add(g, 0.1, 0.2, 0.1, P.blanket, 0, 0.86, 0, { roughness: 0.3 });
  },
  bathtub(g, { w, d, h }) {
    add(g, w, h, d, P.white, 0, h / 2, 0, { roughness: 0.3 });
    add(g, w - 0.14, 0.02, d - 0.14, P.water, 0, h - 0.04, 0, { roughness: 0.15 });
    add(g, 0.04, 0.2, 0.04, P.steel, -w / 2 + 0.12, h + 0.1, -d / 2 + 0.06, { metalness: 0.6, roughness: 0.3 });
  },
  shower(g, { w, d, h }) {
    add(g, w, 0.08, d, P.white, 0, 0.04, 0, { roughness: 0.3 });
    for (const sx of [-1, 1]) add(g, 0.01, h - 0.08, d, P.glass, sx * (w / 2 - 0.005), h / 2 + 0.04, 0, { roughness: 0.05, opacity: 0.3 });
    add(g, w, h - 0.08, 0.01, P.glass, 0, h / 2 + 0.04, d / 2 - 0.005, { roughness: 0.05, opacity: 0.3 });
    add(g, 0.2, 0.02, 0.2, P.steel, 0, h - 0.1, -d / 2 + 0.2, { metalness: 0.6 });
  },
  toilet(g, { d }) {
    add(g, 0.36, 0.36, 0.17, P.white, 0, 0.62, -d / 2 + 0.09, { roughness: 0.3 });
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.4, 24), material(P.white, { roughness: 0.3 }));
    bowl.scale.set(1, 1, 1.3);
    bowl.position.set(0, 0.2, -d / 2 + 0.42);
    g.add(bowl);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 24), material(P.white, { roughness: 0.3 }));
    seat.scale.set(1, 1, 1.3);
    seat.position.set(0, 0.415, -d / 2 + 0.42);
    g.add(seat);
  },
  sink(g, { w, d }, env) {
    add(g, w, 0.65, d - 0.04, P.cabinet, 0, 0.5, -0.02);
    add(g, w, 0.06, d, P.white, 0, 0.85, 0, { roughness: 0.3 });
    add(g, w - 0.16, 0.02, d - 0.2, P.water, 0, 0.875, 0.03, { roughness: 0.15 });
    add(g, 0.03, 0.18, 0.03, P.steel, 0, 0.96, -d / 2 + 0.06, { metalness: 0.6 });
    if (env.wallHeight > 1.95) add(g, w - 0.04, 0.7, 0.02, '#cfd8dc', 0, 1.55, -d / 2 + 0.01, { metalness: 0.7, roughness: 0.1 });
  },
  washer(g, { w, d, h }) {
    add(g, w, h, d, P.white, 0, h / 2, 0, { roughness: 0.35 });
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 32), material('#9fb3c0', { roughness: 0.2, metalness: 0.2 }));
    door.rotation.x = Math.PI / 2;
    door.position.set(0, 0.42, d / 2 + 0.01);
    g.add(door);
    add(g, w - 0.04, 0.1, 0.01, P.seam, 0, h - 0.08, d / 2 + 0.005);
  },
  bench(g, { w, d }) {
    add(g, w, 0.05, d, P.wood, 0, 0.42, 0);
    add(g, w - 0.06, 0.06, d - 0.06, P.fabricLight, 0, 0.475, 0);
    add(g, w - 0.06, 0.02, d - 0.04, P.woodDark, 0, 0.12, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, 0.04, 0.4, 0.04, P.woodDark, sx * (w / 2 - 0.04), 0.2, sz * (d / 2 - 0.04));
  },
};

const rotationOf = (n) => Math.atan2(n[0], n[1]);
const centerOf = (r) => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];

// Plan point → coordinate along the item's local x axis.
function localX(item, point) {
  if (!point) return null;
  const theta = rotationOf(item.n);
  const [cx, cy] = centerOf(item.body);
  return (point[0] - cx) * Math.cos(theta) - (point[1] - cy) * Math.sin(theta);
}

function furniture(item, env) {
  const group = new THREE.Group();
  const build = BUILDERS[item.key] ?? ((g, it) => add(g, it.w, it.h, it.d, P.cabinet, 0, it.h / 2, 0));
  build(group, item, env);
  const [cx, cy] = centerOf(item.body);
  group.position.set(cx, 0, cy);
  group.rotation.y = rotationOf(item.n);
  group.userData.itemId = item.id;
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.itemId = item.id;
    o.castShadow = !o.material.transparent && !o.userData.noShadow;
    o.receiveShadow = true;
  });
  return group;
}

function flatRect(r, y, mat) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.y1 - r.y0), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((r.x0 + r.x1) / 2, y, (r.y0 + r.y1) / 2);
  mesh.userData.disposable = true;
  return mesh;
}

function outline(r, y, mat) {
  const pts = [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x1, r.y1],
    [r.x0, r.y1],
    [r.x0, r.y0],
  ].map(([x, z]) => new THREE.Vector3(x, y, z));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  line.userData.disposable = true;
  return line;
}

// Passage map: green — reachable from a door by a person of the chosen width,
// orange — free but cut off from the doors.
function passageMap(grid) {
  const { cols, rows, state } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, rows);
  for (let k = 0; k < state.length; k++) {
    const o = k * 4;
    if (state[k] === 3) img.data.set([46, 158, 98, 120], o);
    else if (state[k] === 2) img.data.set([236, 135, 40, 170], o);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const w = cols * grid.cw;
  const h = rows * grid.ch;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(grid.x0 + w / 2, 0.006, grid.y0 + h / 2);
  mesh.userData.disposable = true;
  return mesh;
}

export function buildApartment(plan, layout, { wallHeight }) {
  const root = new THREE.Group();
  root.name = plan.name;
  const items = new Map();
  for (const room of plan.rooms) root.add(floorMesh(room));
  for (const wall of plan.walls) root.add(wallGroup(wall, wallHeight));
  for (const rl of layout.rooms) {
    for (const item of rl.placed) {
      const g = furniture(item, { wallHeight });
      items.set(item.id, g);
      root.add(g);
    }
  }

  const overlay = new THREE.Group();
  const doorFill = new THREE.MeshBasicMaterial({ color: '#8a63d2', transparent: true, opacity: 0.3, depthWrite: false });
  const windowFill = new THREE.MeshBasicMaterial({ color: '#3d8fd1', transparent: true, opacity: 0.3, depthWrite: false });
  const zoneLine = new THREE.LineBasicMaterial({ color: '#1f7a4c' });
  for (const rl of layout.rooms) {
    overlay.add(passageMap(rl.access.grid));
    for (const z of rl.room.doorZones) overlay.add(flatRect(z.rect, 0.012, doorFill));
    for (const z of rl.room.windowZones) overlay.add(flatRect(z.rect, 0.012, windowFill));
    for (const item of rl.placed) if (item.zone) overlay.add(outline(item.zone, 0.02, zoneLine));
  }

  const labels = new THREE.Group();
  for (const room of plan.rooms) {
    const div = document.createElement('div');
    div.className = 'room-label';
    const name = document.createElement('b');
    name.textContent = room.name;
    const area = document.createElement('span');
    area.textContent = `${fmt(room.area, 1)} м²`;
    div.append(name, area);
    const label = new CSS2DObject(div);
    label.position.set(room.label[0], 0.05, room.label[1]);
    labels.add(label);
  }
  return { root, overlay, labels, items };
}

export function disposeObject(object) {
  object.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.userData.disposable && o.material) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}
