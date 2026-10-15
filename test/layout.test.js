import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePlan } from '../src/plan.js';
import { checkAccess, layoutPlan } from '../src/layout.js';
import { PRESETS } from '../src/presets.js';
import { CATALOG } from '../src/catalog.js';
import { rectInPolygon, rectsOverlap } from '../src/geometry.js';

const twoRooms = (extra = {}) => ({
  rooms: [
    { id: 'a', type: 'living', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },
    { id: 'b', type: 'bedroom', polygon: [[4, 0], [8, 0], [8, 4], [4, 4]] },
  ],
  doors: [{ at: [4, 1.5], width: 0.8 }, { at: [6, 4], width: 0.9 }],
  ...extra,
});

test('shared edges become interior walls, the rest exterior', () => {
  const plan = preparePlan(twoRooms());
  assert.deepEqual(plan.errors, []);
  const interior = plan.walls.filter((w) => w.kind === 'interior');
  assert.equal(interior.length, 1);
  assert.deepEqual([interior[0].orient, interior[0].c, interior[0].from, interior[0].to], ['v', 4, 0, 3]);
  // Room b is taller: the x = 4 line continues below y = 3 as b's own exterior wall.
  assert.ok(plan.walls.some((w) => w.kind === 'exterior' && w.orient === 'v' && w.c === 4 && w.from === 3 && w.to === 4));
});

test('room interior is inset by half of each wall', () => {
  const plan = preparePlan(twoRooms());
  const a = plan.rooms.find((r) => r.id === 'a');
  assert.deepEqual(a.innerBox, { x0: 0.125, y0: 0.125, x1: 3.95, y1: 2.875 });
});

test('bad input is reported in plain words', () => {
  const window = preparePlan(twoRooms({ windows: [{ at: [4, 1], width: 0.6 }] }));
  assert.match(window.errors[0], /внутренней стене/);
  const floating = preparePlan(twoRooms({ doors: [{ at: [2, 1.5], width: 0.8 }] }));
  assert.match(floating.errors[0], /не лежит ни на одной стене/);
  const slanted = preparePlan({ rooms: [{ id: 'x', type: 'living', polygon: [[0, 0], [4, 1], [4, 4], [0, 4]] }] });
  assert.match(slanted.errors[0], /прямым углом/);
  const overlap = preparePlan({
    rooms: [
      { id: 'x', type: 'living', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: 'y', type: 'bedroom', polygon: [[2, 2], [6, 2], [6, 6], [2, 6]] },
    ],
  });
  assert.match(overlap.errors[0], /перекрываются/);
});

for (const [key, preset] of Object.entries(PRESETS)) {
  test(`hard rules hold for every placed item: ${key}`, () => {
    const plan = preparePlan(preset.plan);
    assert.deepEqual(plan.errors, []);
    for (const seed of [1, 2, 3, 4]) {
      const layout = layoutPlan(plan, { seed, jitter: seed === 1 ? 0 : 1.2 });
      for (const { room, placed } of layout.rooms) {
        for (const it of placed) {
          const spec = CATALOG[it.key];
          assert.ok(rectInPolygon(it.body, room.inner), `${it.id} inside the room`);
          for (const z of room.doorZones) assert.ok(!rectsOverlap(it.body, z.rect), `${it.id} clear of doors`);
          for (const z of room.windowZones) {
            if (spec.avoidWindow || spec.h > z.sill) assert.ok(!rectsOverlap(it.body, z.rect), `${it.id} clear of windows`);
          }
          for (const other of placed) {
            if (other === it) continue;
            assert.ok(!rectsOverlap(it.body, other.body), `${it.id} vs ${other.id}`);
            if (other.zone) assert.ok(!rectsOverlap(it.body, other.zone), `${it.id} off ${other.id} access strip`);
          }
        }
      }
    }
  });
}

test('default layouts place every required item with passages of 0.7 m', () => {
  for (const preset of Object.values(PRESETS)) {
    const layout = layoutPlan(preparePlan(preset.plan));
    assert.equal(layout.missing, 0, preset.title);
    assert.equal(layout.accessIssues, 0, preset.title);
  }
});

test('the TV faces the sofa', () => {
  const layout = layoutPlan(preparePlan(PRESETS.twoRoom.plan));
  const living = layout.rooms.find((r) => r.room.id === 'living').placed;
  const sofa = living.find((p) => p.key === 'sofa');
  const tv = living.find((p) => p.key === 'tv');
  assert.equal(sofa.n[0] * tv.n[0] + sofa.n[1] * tv.n[1], -1);
});

test('same seed gives the same layout', () => {
  const plan = preparePlan(PRESETS.studio.plan);
  const ids = (l) => l.rooms.flatMap((r) => r.placed.map((p) => `${p.id}:${p.body.x0.toFixed(3)},${p.body.y0.toFixed(3)}`));
  assert.deepEqual(ids(layoutPlan(plan, { seed: 5, jitter: 1.2 })), ids(layoutPlan(plan, { seed: 5, jitter: 1.2 })));
});

test('a passage narrower than required is reported', () => {
  const plan = preparePlan({
    rooms: [{ id: 'r', type: 'living', items: [], polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] }],
    doors: [{ at: [1.5, 0], width: 0.9 }],
  });
  const room = plan.rooms[0];
  // A cabinet across the room leaves a 0.6 m gap at the right wall; the shelf is behind it.
  const cabinet = { id: 'c', name: 'Шкаф', key: 'wardrobe', body: { x0: 0.125, y0: 1.2, x1: 2.275, y1: 1.8 }, n: [0, -1] };
  const shelf = { id: 's', name: 'Стеллаж', key: 'bookcase', body: { x0: 0.3, y0: 2.525, x1: 1.3, y1: 2.875 }, n: [0, -1] };
  assert.equal(checkAccess(room, [cabinet, shelf], 0.7).reachable.get('s'), false);
  assert.equal(checkAccess(room, [cabinet, shelf], 0.55).reachable.get('s'), true);
});
