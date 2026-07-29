import type { ToneDeviceId } from '../config/guitar-mode-profiles';

export type GuitarPickup = 'acoustic-piezo' | 'single-coil' | 'humbucker' | 'p90' | 'unknown';
export type ToneRole = 'clean' | 'rhythm' | 'lead';
export type ToneGenre = 'acoustic' | 'pop' | 'rock' | 'blues' | 'ballad' | 'metal' | 'ambient' | 'indie';

export type TonePresetRequest = {
  deviceId: ToneDeviceId;
  role: ToneRole;
  genre: ToneGenre;
  pickup: GuitarPickup;
  brightness: number;
  gainAmount: number;
  ambience: number;
  notes?: string;
};

export type ToneParameter = {
  id: string;
  label: string;
  value: string | number;
  min?: number;
  max?: number;
  unit?: string;
  explanation: string;
};

export type TonePresetDraft = {
  id: string;
  deviceId: ToneDeviceId;
  title: string;
  role: ToneRole;
  genre: ToneGenre;
  parameters: ToneParameter[];
  chain: string[];
  warnings: string[];
  notes: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const percent = (value: number) => Math.round(clamp(value, 0, 100));

function roleGain(role: ToneRole) {
  if (role === 'clean') return 24;
  if (role === 'rhythm') return 46;
  return 62;
}

function genreMid(genre: ToneGenre) {
  switch (genre) {
    case 'metal': return 42;
    case 'rock': return 55;
    case 'blues': return 62;
    case 'ballad': return 58;
    case 'ambient': return 54;
    case 'indie': return 57;
    case 'pop': return 55;
    case 'acoustic': return 50;
  }
}

function pickupCompensation(pickup: GuitarPickup) {
  switch (pickup) {
    case 'single-coil': return { gain: 5, bass: 3, treble: -5 };
    case 'humbucker': return { gain: -6, bass: -4, treble: 4 };
    case 'p90': return { gain: -2, bass: -1, treble: 1 };
    case 'acoustic-piezo': return { gain: -12, bass: -3, treble: -4 };
    case 'unknown': return { gain: 0, bass: 0, treble: 0 };
  }
}

function ampModelFor(deviceId: ToneDeviceId, role: ToneRole, genre: ToneGenre) {
  if (deviceId === 'yamaha-thr30') {
    if (genre === 'acoustic') return 'Acoustic';
    if (role === 'clean') return 'Clean';
    if (role === 'rhythm') return genre === 'metal' ? 'Hi Gain' : 'Crunch';
    return genre === 'metal' ? 'Hi Gain' : 'Lead';
  }
  if (deviceId === 'boss-gt1') {
    if (role === 'clean') return 'Natural Clean';
    if (role === 'rhythm') return genre === 'blues' ? '1959 Crunch' : 'Stack Crunch';
    return genre === 'metal' ? 'BGNR Lead' : '1959 Crunch';
  }
  return role === 'clean' ? 'Clean' : role === 'rhythm' ? 'Crunch' : 'Lead';
}

function buildCommonParameters(request: TonePresetRequest): ToneParameter[] {
  const pickup = pickupCompensation(request.pickup);
  const gain = percent(roleGain(request.role) + request.gainAmount * 0.25 + pickup.gain);
  const bass = percent(50 + pickup.bass - request.brightness * 0.08);
  const middle = percent(genreMid(request.genre));
  const treble = percent(50 + pickup.treble + request.brightness * 0.22);
  const presence = percent(42 + request.brightness * 0.2);
  const delay = percent(request.role === 'lead' ? 12 + request.ambience * 0.28 : request.ambience * 0.14);
  const reverb = percent(8 + request.ambience * 0.3);

  return [
    { id: 'ampModel', label: 'AMP', value: ampModelFor(request.deviceId, request.role, request.genre), explanation: '역할과 장르에 맞춘 시작 앰프 모델' },
    { id: 'gain', label: 'Gain', value: gain, min: 0, max: 100, explanation: '픽업 출력과 Clean/Rhythm/Lead 역할을 반영한 시작값' },
    { id: 'bass', label: 'Bass', value: bass, min: 0, max: 100, explanation: '저음 뭉침과 피에조의 얇은 소리를 보정하는 시작값' },
    { id: 'middle', label: 'Mid', value: middle, min: 0, max: 100, explanation: '기타가 합주에서 묻히지 않도록 장르별 중심 대역을 조정' },
    { id: 'treble', label: 'Treble', value: treble, min: 0, max: 100, explanation: '원하는 밝기와 픽업 특성을 반영' },
    { id: 'presence', label: 'Presence', value: presence, min: 0, max: 100, explanation: '피킹 선명도와 고역 존재감의 시작값' },
    { id: 'delay', label: 'Delay', value: delay, min: 0, max: 100, explanation: '리드와 공간계 요구에 따라 최소량부터 설정' },
    { id: 'reverb', label: 'Reverb', value: reverb, min: 0, max: 100, explanation: '연습 시 어택이 흐려지지 않는 범위의 시작값' },
  ];
}

function deviceSpecificParameters(request: TonePresetRequest): ToneParameter[] {
  if (request.deviceId === 'yamaha-thr30') {
    const ampClass = request.genre === 'metal' ? 'Modern' : request.genre === 'blues' || request.genre === 'rock' ? 'Classic' : 'Boutique';
    return [
      { id: 'ampClass', label: 'AMP Class', value: ampClass, explanation: 'THR30의 Classic/Boutique/Modern 계열 시작 선택' },
      { id: 'master', label: 'Master', value: request.role === 'lead' ? 58 : 52, min: 0, max: 100, explanation: 'Gain과 분리해 출력감과 질감을 조절' },
      { id: 'compressor', label: 'Compressor', value: request.genre === 'acoustic' || request.role === 'clean' ? 18 : 8, min: 0, max: 100, explanation: '통기타와 클린의 음량 편차를 가볍게 정리' },
    ];
  }

  if (request.deviceId === 'boss-gt1') {
    return [
      { id: 'compressor', label: 'COMP/FX1', value: request.role === 'clean' ? 20 : 10, min: 0, max: 100, explanation: '피킹 균일성을 보조하되 어택을 죽이지 않는 시작값' },
      { id: 'overdriveDistortion', label: 'OD/DS', value: request.role === 'clean' ? 'OFF' : request.genre === 'metal' ? 'Distortion' : 'Overdrive', explanation: '프리앰프 앞에서 게인 질감을 보조' },
      { id: 'noiseSuppressor', label: 'NS', value: request.genre === 'metal' ? 45 : request.role === 'clean' ? 12 : 25, min: 0, max: 100, explanation: '하이게인 노이즈를 줄이되 서스테인을 과하게 자르지 않는 시작값' },
      { id: 'patchLevel', label: 'Patch Level', value: request.role === 'lead' ? 105 : 100, min: 0, max: 200, explanation: '패치 간 체감 음량을 맞추기 위한 기준값' },
    ];
  }

  return [
    { id: 'compressor', label: 'Compressor', value: request.role === 'clean' ? 18 : 8, min: 0, max: 100, explanation: '범용 시작값' },
    { id: 'noiseSuppressor', label: 'Noise Gate', value: request.genre === 'metal' ? 40 : 15, min: 0, max: 100, explanation: '장비에 맞게 실제 범위를 수정해야 하는 범용값' },
  ];
}

function buildChain(request: TonePresetRequest) {
  if (request.deviceId === 'boss-gt1') {
    return ['COMP/FX1', 'OD/DS', 'PREAMP', 'NS', 'FX2/MOD', 'DELAY', 'REVERB', 'PEDAL FX'];
  }
  if (request.deviceId === 'yamaha-thr30') {
    return ['AMP', 'COMPRESSOR', 'MODULATION', 'DELAY', 'REVERB'];
  }
  return ['COMPRESSOR', 'DRIVE', 'AMP', 'EQ', 'MODULATION', 'DELAY', 'REVERB', 'NOISE GATE'];
}

export function generateTonePresetDraft(request: TonePresetRequest): TonePresetDraft {
  const parameters = [...buildCommonParameters(request), ...deviceSpecificParameters(request)];
  const warnings = [
    '이 값은 시작점이며 실제 기타, 픽업, 스피커와 연주 공간에 맞춰 귀로 조정해야 합니다.',
    '앱은 장비를 직접 제어하지 않고 설정값을 저장·비교·공유합니다.',
  ];
  if (request.genre === 'metal' && request.gainAmount > 80) {
    warnings.push('Gain을 과하게 올리면 노이즈와 음 분리가 악화될 수 있으니 Mid와 NS를 함께 확인하세요.');
  }
  if (request.pickup === 'acoustic-piezo') {
    warnings.push('피에조 통기타는 고역이 날카로울 수 있으므로 Treble과 Reverb를 작은 폭으로 조정하세요.');
  }

  return {
    id: `${request.deviceId}-${request.genre}-${request.role}-${Date.now()}`,
    deviceId: request.deviceId,
    title: `${request.genre.toUpperCase()} ${request.role.toUpperCase()}`,
    role: request.role,
    genre: request.genre,
    parameters,
    chain: buildChain(request),
    warnings,
    notes: request.notes?.trim() || '곡명과 사용 기타를 메모하세요.',
  };
}

export function tonePresetToShareText(preset: TonePresetDraft): string {
  const parameters = preset.parameters.map((item) => `${item.label}: ${item.value}${item.unit ?? ''}`).join('\n');
  return [
    preset.title,
    `Device: ${preset.deviceId}`,
    `Role: ${preset.role}`,
    `Genre: ${preset.genre}`,
    '',
    parameters,
    '',
    `Chain: ${preset.chain.join(' → ')}`,
    '',
    ...preset.warnings.map((warning) => `주의: ${warning}`),
    '',
    `메모: ${preset.notes}`,
  ].join('\n');
}
