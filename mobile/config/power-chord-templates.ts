import type { ChordTemplate } from '../services/fretboard-chord-engine';

export const POWER_CHORD_TEMPLATES: ChordTemplate[] = [
  {
    name: 'E5',
    aliases: ['E power chord'],
    strings: [0, 2, 2, -1, -1, -1],
    preferredFingers: {
      '5:2': 'index',
      '4:2': 'ring',
    },
  },
  {
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
    name: 'A5',
    aliases: ['A power chord', 'open A5'],
    strings: [-1, 0, 2, 2, -1, -1],
    preferredFingers: {
      '4:2': 'index',
      '3:2': 'ring',
    },
  },
  {
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
