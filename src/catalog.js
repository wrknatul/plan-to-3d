// Furniture catalog. Sizes in meters: w — along the wall, d — depth from the wall, h — height.
// clearFront — free strip in front of the item that a person needs to use it.
// avoidWindow — never in front of a window, even when lower than the sill.
// partner — when choosing a spot, look ahead where the partner item would go.
export const CATALOG = {
  bed: {
    name: 'Кровать 160×200 с тумбами',
    w: 2.5,
    d: 2.1,
    h: 1.0,
    clearFront: 0.6,
    avoidWindow: true,
    avoidDoorWall: true,
    prefer: { center: true, farFromDoor: true },
  },
  wardrobe: { name: 'Шкаф', w: 1.8, d: 0.6, h: 2.2, clearFront: 0.8, prefer: { corner: true } },
  sofa: {
    name: 'Диван',
    w: 2.2,
    d: 0.95,
    h: 0.85,
    clearFront: 1.0,
    avoidDoorWall: true,
    partner: 'tv',
    prefer: { center: true },
  },
  tv: { name: 'ТВ-тумба с телевизором', w: 1.6, d: 0.45, h: 1.3, clearFront: 0.8, faces: 'sofa' },
  bookcase: { name: 'Стеллаж', w: 0.8, d: 0.35, h: 2.0, clearFront: 0.6, prefer: { corner: true } },
  desk: { name: 'Рабочий стол', w: 1.2, d: 0.6, h: 0.75, clearFront: 0.8, prefer: { window: true } },
  armchair: { name: 'Кресло', w: 0.85, d: 0.85, h: 0.9, clearFront: 0.5, prefer: { corner: true } },
  fridge: { name: 'Холодильник', w: 0.6, d: 0.65, h: 1.9, clearFront: 0.8, prefer: { corner: true } },
  counter: {
    name: 'Кухонный гарнитур',
    widths: [3.0, 2.6, 2.2, 1.8],
    d: 0.6,
    h: 0.85,
    clearFront: 0.8,
    prefer: { nextTo: 'fridge', window: true },
  },
  dining: { name: 'Обеденный стол', w: 1.1, d: 0.7, h: 0.75, free: true, clearAll: 0.55 },
  bathtub: { name: 'Ванна', w: 1.7, d: 0.75, h: 0.6, clearFront: 0.6, prefer: { corner: true } },
  shower: { name: 'Душевая', w: 0.9, d: 0.9, h: 2.0, clearFront: 0.6, prefer: { corner: true } },
  toilet: { name: 'Унитаз', w: 0.4, d: 0.68, h: 0.8, clearFront: 0.6, prefer: { corner: true } },
  sink: { name: 'Раковина', w: 0.6, d: 0.5, h: 0.85, clearFront: 0.6 },
  washer: { name: 'Стиральная машина', w: 0.6, d: 0.6, h: 0.85, clearFront: 0.6, optional: true },
  hallWardrobe: { name: 'Шкаф в прихожей', w: 1.2, d: 0.45, h: 2.2, clearFront: 0.7, prefer: { corner: true } },
  bench: { name: 'Банкетка', w: 1.0, d: 0.4, h: 0.45, clearFront: 0.5 },
};

// Items are placed in this order: the larger and pickier ones first.
export const ROOM_TYPES = {
  living: { name: 'Гостиная', floor: 'wood', items: ['sofa', 'tv', 'bookcase', 'armchair'] },
  bedroom: { name: 'Спальня', floor: 'wood', items: ['bed', 'wardrobe', 'desk'] },
  study: { name: 'Кабинет', floor: 'wood', items: ['desk', 'bookcase', 'armchair'] },
  kitchen: { name: 'Кухня', floor: 'tile', items: ['fridge', 'counter', 'dining'] },
  bath: { name: 'Санузел', floor: 'tile', items: ['bathtub', 'sink', 'toilet', 'washer'] },
  hall: { name: 'Прихожая', floor: 'wood', items: ['hallWardrobe', 'bench'] },
  studio: {
    name: 'Кухня-гостиная',
    floor: 'wood',
    items: ['fridge', 'counter', 'sofa', 'tv', 'wardrobe', 'dining', 'desk'],
  },
};
