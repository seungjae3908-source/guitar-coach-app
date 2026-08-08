import type { ChordTemplate } from '../services/fretboard-chord-engine';

export const POWER_CHORD_TEMPLATES: ChordTemplate[] = [
  {
    id: 'e5-open',
    name: 'E5',
    aliases: ['E power chord'],
    strings: [0, 2, 2, -1, -1, -1],
    preferredFingers: {
      '5:2': 'index',
      '4:2': 'ring',
    },
  },
  {
    id: 'f5-sixth-root',
    name: 'F5',
    aliases: ['F power chord'],
    strings: [1, 3, 3, -1, -1, -1],
    preferredFingers: {
      '6:1': 'index',
      '5:3': 'ring',
      '4:3': 'pinky',
    },
  },
  {
    id: 'g5-sixth-root',
    name: 'G5',
    aliases: ['G power chord'],
    strings: [3, 5, 5, -1, -1, -1],
    preferredFingers: {
      '6:3': 'index',
      '5:5': 'ring',
      '4:5': 'pinky',
    },
  },
  {
    id: 'a5-open',
    name: 'A5',
    aliases: ['A power chord', 'open A5'],
    strings: [-1, 0, 2, 2, -1, -1],
    preferredFingers: {
      '4:2': 'index',
      '3:2': 'ring',
    },
  },
  {
    id: 'a5-sixth-root',
    name: 'A5',
    aliases: ['A power chord', 'sixth-string A5'],
    strings: [5, 7, 7, -1, -1, -1],
    preferredFingers: {
      '6:5': 'index',
      '5:7': 'ring',
      '4:7': 'pinky',
    },
  },
  {
    id: 'b5-fifth-root',
    name: 'B5',
    aliases: ['B power chord'],
    strings: [-1, 2, 4, 4, -1, -1],
    preferredFingers: {
      '5:2': 'index',
      '4:4': 'ring',
      '3:4': 'pinky',
    },
  },
  {
    id: 'c5-fifth-root',
    name: 'C5',
    aliases: ['C power chord'],
    strings: [-1, 3, 5, 5, -1, -1],
    preferredFingers: {
      '5:3': 'index',
      '4:5': 'ring',
      '3:5': 'pinky',
    },
  },
  {
    id: 'd5-fifth-root',
    name: 'D5',
    aliases: ['D power chord'],
    strings: [-1, 5, 7, 7, -1, -1],
    preferredFingers: {
      '5:5': 'index',
      '4:7': 'ring',
      '3:7': 'pinky',
    },
  },
];
