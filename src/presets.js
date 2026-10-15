// Sample plans. Coordinates are wall center lines in meters, x to the right, y down the sheet.
export const PRESETS = {
  twoRoom: {
    title: 'Двушка с кабинетом, 70 м²',
    plan: {
      name: 'Двушка с кабинетом',
      height: 2.7,
      rooms: [
        { id: 'kitchen', type: 'kitchen', polygon: [[0, 0], [3.2, 0], [3.2, 3.2], [0, 3.2]] },
        {
          id: 'hall',
          type: 'hall',
          polygon: [[3.2, 0], [5.2, 0], [5.2, 2.0], [7.6, 2.0], [7.6, 3.2], [3.2, 3.2]],
        },
        { id: 'bath', type: 'bath', polygon: [[5.2, 0], [7.6, 0], [7.6, 2.0], [5.2, 2.0]] },
        { id: 'study', type: 'study', polygon: [[7.6, 0], [10, 0], [10, 3.2], [7.6, 3.2]] },
        { id: 'living', type: 'living', polygon: [[0, 3.2], [5.6, 3.2], [5.6, 7], [0, 7]] },
        { id: 'bedroom', type: 'bedroom', polygon: [[5.6, 3.2], [10, 3.2], [10, 7], [5.6, 7]] },
      ],
      doors: [
        { at: [4.2, 0], width: 0.9 },
        { at: [3.2, 2.5], width: 0.8 },
        { at: [5.9, 2.0], width: 0.7 },
        { at: [7.6, 2.6], width: 0.8 },
        { at: [4.6, 3.2], width: 0.9 },
        { at: [6.4, 3.2], width: 0.8 },
      ],
      windows: [
        { at: [1.6, 0], width: 1.4, sill: 0.9 },
        { at: [8.8, 0], width: 1.2 },
        { at: [1.5, 7], width: 1.5 },
        { at: [4.0, 7], width: 1.5 },
        { at: [7.8, 7], width: 1.5 },
      ],
    },
  },
  studio: {
    title: 'Студия с Г-образной комнатой, 34 м²',
    plan: {
      name: 'Студия',
      height: 2.8,
      rooms: [
        {
          id: 'bath',
          type: 'bath',
          items: ['shower', 'sink', 'toilet', 'washer'],
          polygon: [[0, 0], [2.0, 0], [2.0, 2.2], [0, 2.2]],
        },
        {
          id: 'main',
          type: 'studio',
          polygon: [[2.0, 0], [6.2, 0], [6.2, 5.6], [0, 5.6], [0, 2.2], [2.0, 2.2]],
        },
      ],
      doors: [
        { at: [0, 3.1], width: 0.9 },
        { at: [1.3, 2.2], width: 0.7 },
      ],
      windows: [
        { at: [6.2, 1.5], width: 1.4 },
        { at: [6.2, 4.1], width: 1.4 },
        { at: [3.6, 5.6], width: 1.4 },
      ],
    },
  },
};
