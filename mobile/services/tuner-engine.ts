export type GuitarTuningId = 'standard' | 'drop-d' | 'half-step-down' | 'dadgad' | 'open-g' | 'custom';

export type TuningString = {
  stringNumber: 1 | 2 | 3 | 4 | 5 | 6;
  note: string;
  midi: number;
};

export type GuitarTuning = {
  id: GuitarTuningId;
  title: string;
  strings: TuningString[];
};

export const GUITAR_TUNINGS: Record<Exclude<GuitarTuningId, 'custom'>, GuitarTuning> = {
  standard: {
    id: 'standard',
    title: '표준 E A D G B E',
    strings: [
      { stringNumber: 6, note: 'E2', midi: 40 },
      { stringNumber: 5, note: 'A2', midi: 45 },
      { stringNumber: 4, note: 'D3', midi: 50 },
      { stringNumber: 3, note: 'G3', midi: 55 },
      { stringNumber: 2, note: 'B3', midi: 59 },
      { stringNumber: 1, note: 'E4', midi: 64 },
    ],
  },
  'drop-d': {
    id: 'drop-d',
    title: 'Drop D D A D G B E',
    strings: [
      { stringNumber: 6, note: 'D2', midi: 38 },
      { stringNumber: 5, note: 'A2', midi: 45 },
      { stringNumber: 4, note: 'D3', midi: 50 },
      { stringNumber: 3, note: 'G3', midi: 55 },
      { stringNumber: 2, note: 'B3', midi: 59 },
      { stringNumber: 1, note: 'E4', midi: 64 },
    ],
  },
  'half-step-down': {
    id: 'half-step-down',
    title: '반음 다운 E♭ A♭ D♭ G♭ B♭ E♭',
    strings: [
      { stringNumber: 6, note: 'D#2', midi: 39 },
      { stringNumber: 5, note: 'G#2', midi: 44 },
      { stringNumber: 4, note: 'C#3', midi: 49 },
      { stringNumber: 3, note: 'F#3', midi: 54 },
      { stringNumber: 2, note: 'A#3', midi: 58 },
      { stringNumber: 1, note: 'D#4', midi: 63 },
    ],
  },
  dadgad: {
    id: 'dadgad',
    title: 'DADGAD',
    strings: [
      { stringNumber: 6, note: 'D2', midi: 38 },
      { stringNumber: 5, note: 'A2', midi: 45 },
      { stringNumber: 4, note: 'D3', midi: 50 },
      { stringNumber: 3, note: 'G3', midi: 55 },
      { stringNumber: 2, note: 'A3', midi: 57 },
      { stringNumber: 1, note: 'D4', midi: 62 },
    ],
  },
  'open-g': {
    id: 'open-g',
    title: 'Open G D G D G B D',
    strings: [
      { stringNumber: 6, note: 'D2', midi: 38 },
      { stringNumber: 5, note: 'G2', midi: 43 },
      { stringNumber: 4, note: 'D3', midi: 50 },
      { stringNumber: 3, note: 'G3', midi: 55 },
      { stringNumber: 2, note: 'B3', midi: 59 },
      { stringNumber: 1, note: 'D4', midi: 62 },
    ],
  },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type TunerReading = {
  frequencyHz: number;
  midiFloat: number;
  nearestMidi: number;
  noteName: string;
  octave: number;
  targetFrequencyHz: number;
  cents: number;
  status: 'flat' | 'in-tune' | 'sharp';
  confidencePercent: number;
};

export function midiToFrequency(midi: number, referenceA4 = 440) {
  return referenceA4 * 2 ** ((midi - 69) / 12);
}

export function frequencyToMidi(frequencyHz: number, referenceA4 = 440) {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return Number.NaN;
  return 69 + 12 * Math.log2(frequencyHz / referenceA4);
}

export function createTunerReading(
  frequencyHz: number,
  confidence: number,
  referenceA4 = 440,
  inTuneToleranceCents = 4,
): TunerReading | null {
  const safeReference = Math.min(450, Math.max(430, referenceA4));
  const midiFloat = frequencyToMidi(frequencyHz, safeReference);
  if (!Number.isFinite(midiFloat)) return null;
  const nearestMidi = Math.round(midiFloat);
  const cents = (midiFloat - nearestMidi) * 100;
  const noteIndex = ((nearestMidi % 12) + 12) % 12;
  const octave = Math.floor(nearestMidi / 12) - 1;
  const status = Math.abs(cents) <= inTuneToleranceCents ? 'in-tune' : cents < 0 ? 'flat' : 'sharp';

  return {
    frequencyHz,
    midiFloat,
    nearestMidi,
    noteName: NOTE_NAMES[noteIndex],
    octave,
    targetFrequencyHz: midiToFrequency(nearestMidi, safeReference),
    cents,
    status,
    confidencePercent: Math.round(Math.min(1, Math.max(0, confidence)) * 100),
  };
}

export type TuningMatch = {
  stringNumber: number;
  targetNote: string;
  targetMidi: number;
  targetFrequencyHz: number;
  centsFromTarget: number;
  distanceSemitones: number;
};

export function matchReadingToTuning(
  reading: TunerReading,
  tuning: GuitarTuning,
  referenceA4 = 440,
): TuningMatch {
  const closest = tuning.strings.reduce((best, string) => {
    const distance = Math.abs(reading.midiFloat - string.midi);
    const bestDistance = Math.abs(reading.midiFloat - best.midi);
    return distance < bestDistance ? string : best;
  });
  const targetFrequencyHz = midiToFrequency(closest.midi, referenceA4);
  const centsFromTarget = 1200 * Math.log2(reading.frequencyHz / targetFrequencyHz);
  return {
    stringNumber: closest.stringNumber,
    targetNote: closest.note,
    targetMidi: closest.midi,
    targetFrequencyHz,
    centsFromTarget,
    distanceSemitones: reading.midiFloat - closest.midi,
  };
}

export type TunerStability = {
  stable: boolean;
  averageFrequencyHz: number;
  frequencyDeviationHz: number;
  centsDeviation: number;
};

export function calculateTunerStability(frequencies: number[], referenceA4 = 440): TunerStability {
  const valid = frequencies.filter((frequency) => Number.isFinite(frequency) && frequency > 0).slice(-12);
  if (valid.length < 4) {
    return { stable: false, averageFrequencyHz: 0, frequencyDeviationHz: 0, centsDeviation: 0 };
  }
  const averageFrequencyHz = valid.reduce((sum, frequency) => sum + frequency, 0) / valid.length;
  const variance = valid.reduce((sum, frequency) => sum + (frequency - averageFrequencyHz) ** 2, 0) / valid.length;
  const frequencyDeviationHz = Math.sqrt(variance);
  const midiValues = valid.map((frequency) => frequencyToMidi(frequency, referenceA4));
  const averageMidi = midiValues.reduce((sum, midi) => sum + midi, 0) / midiValues.length;
  const centsDeviation = Math.sqrt(midiValues.reduce((sum, midi) => sum + ((midi - averageMidi) * 100) ** 2, 0) / midiValues.length);
  return {
    stable: centsDeviation <= 3.5,
    averageFrequencyHz,
    frequencyDeviationHz,
    centsDeviation,
  };
}
