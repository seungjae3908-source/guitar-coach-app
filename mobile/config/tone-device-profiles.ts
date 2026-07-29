import type { ToneDeviceId } from './guitar-mode-profiles';

export type ToneControlId =
  | 'ampModel'
  | 'ampClass'
  | 'gain'
  | 'master'
  | 'bass'
  | 'middle'
  | 'treble'
  | 'presence'
  | 'compressor'
  | 'overdriveDistortion'
  | 'modulation'
  | 'delay'
  | 'reverb'
  | 'noiseSuppressor'
  | 'patchLevel';

export type ToneDeviceProfile = {
  id: ToneDeviceId;
  brand: string;
  model: string;
  priority: 'user-owned' | 'supported' | 'generic';
  description: string;
  supportedControls: ToneControlId[];
  ampModels: string[];
  ampClasses?: string[];
  effectBlocks: string[];
  safeNotes: string[];
};

export const TONE_DEVICE_PROFILES: Record<ToneDeviceId, ToneDeviceProfile> = {
  'yamaha-thr30': {
    id: 'yamaha-thr30',
    brand: 'Yamaha',
    model: 'THR30',
    priority: 'user-owned',
    description: '통기타와 일렉기타 연습용 사용자 보유 앰프 프로필',
    supportedControls: [
      'ampModel',
      'ampClass',
      'gain',
      'master',
      'bass',
      'middle',
      'treble',
      'compressor',
      'modulation',
      'delay',
      'reverb',
    ],
    ampModels: ['Acoustic', 'Clean', 'Crunch', 'Lead', 'Hi Gain', 'Special'],
    ampClasses: ['Classic', 'Boutique', 'Modern'],
    effectBlocks: ['Compressor', 'Chorus', 'Flanger', 'Phaser', 'Tremolo', 'Delay', 'Reverb'],
    safeNotes: [
      '앱은 앰프를 직접 조작한다고 표시하지 않고 권장 설정값과 저장 메모를 제공합니다.',
      '통기타 모드에서는 Acoustic 또는 Clean 계열을 우선 제안합니다.',
      '일렉 모드에서는 픽업과 목표 장르에 따라 Clean, Crunch, Lead, Hi Gain을 구분합니다.',
    ],
  },
  'boss-gt1': {
    id: 'boss-gt1',
    brand: 'BOSS',
    model: 'GT-1',
    priority: 'user-owned',
    description: '사용자 보유 멀티이펙터의 패치 작성과 비교용 프로필',
    supportedControls: [
      'ampModel',
      'gain',
      'bass',
      'middle',
      'treble',
      'presence',
      'compressor',
      'overdriveDistortion',
      'modulation',
      'delay',
      'reverb',
      'noiseSuppressor',
      'patchLevel',
    ],
    ampModels: ['Natural Clean', 'Stack Crunch', '1959 Crunch', 'BGNR Lead'],
    effectBlocks: ['COMP/FX1', 'OD/DS', 'PREAMP', 'NS', 'FX2/MOD', 'DELAY', 'REVERB', 'PEDAL FX'],
    safeNotes: [
      'Patch Level을 빠뜨리지 않고 저장합니다.',
      'Clean, Rhythm, Lead 세 패치를 같은 곡 묶음으로 관리할 수 있습니다.',
      '효과 블록 순서와 ON/OFF 상태를 텍스트로 내보낼 수 있게 합니다.',
    ],
  },
  'zoom-g1x-four': {
    id: 'zoom-g1x-four',
    brand: 'ZOOM',
    model: 'G1X FOUR',
    priority: 'supported',
    description: '곡별 Clean, Rhythm, Lead 초안용 프로필',
    supportedControls: [
      'ampModel',
      'gain',
      'bass',
      'middle',
      'treble',
      'compressor',
      'overdriveDistortion',
      'modulation',
      'delay',
      'reverb',
      'noiseSuppressor',
      'patchLevel',
    ],
    ampModels: [],
    effectBlocks: ['Dynamics', 'Drive', 'Amp', 'Cab', 'Modulation', 'Delay', 'Reverb'],
    safeNotes: ['세부 모델명은 사용자가 장비 화면에서 직접 선택하거나 수정합니다.'],
  },
  'line6-pod-go': {
    id: 'line6-pod-go',
    brand: 'Line 6',
    model: 'POD Go',
    priority: 'supported',
    description: '앰프·캐비넷·이펙트 체인 메모와 곡별 패치 초안용 프로필',
    supportedControls: [
      'ampModel',
      'gain',
      'bass',
      'middle',
      'treble',
      'presence',
      'compressor',
      'overdriveDistortion',
      'modulation',
      'delay',
      'reverb',
      'noiseSuppressor',
      'patchLevel',
    ],
    ampModels: [],
    effectBlocks: ['Input', 'Wah', 'Volume', 'FX', 'Amp/Preamp', 'Cab/IR', 'Delay', 'Reverb', 'Output'],
    safeNotes: ['앱은 실제 장비 연결 없이 설정 초안과 메모를 제공합니다.'],
  },
  'generic-multifx': {
    id: 'generic-multifx',
    brand: 'Generic',
    model: 'Multi Effects',
    priority: 'generic',
    description: '장비 모델을 찾지 못했을 때 사용하는 범용 멀티이펙터 프로필',
    supportedControls: [
      'ampModel',
      'gain',
      'bass',
      'middle',
      'treble',
      'presence',
      'compressor',
      'overdriveDistortion',
      'modulation',
      'delay',
      'reverb',
      'noiseSuppressor',
      'patchLevel',
    ],
    ampModels: [],
    effectBlocks: ['Compressor', 'Drive', 'Amp', 'EQ', 'Modulation', 'Delay', 'Reverb', 'Noise Gate'],
    safeNotes: ['모든 값은 사용자가 실제 장비 범위에 맞게 수정할 수 있어야 합니다.'],
  },
  'generic-amp': {
    id: 'generic-amp',
    brand: 'Generic',
    model: 'Amp',
    priority: 'generic',
    description: '기본 앰프와 통기타 앰프의 설정 메모용 프로필',
    supportedControls: ['ampModel', 'gain', 'master', 'bass', 'middle', 'treble', 'reverb'],
    ampModels: ['Acoustic', 'Clean', 'Crunch', 'Lead'],
    effectBlocks: ['Reverb'],
    safeNotes: ['실제 장비의 노브 범위를 사용자가 직접 맞출 수 있게 합니다.'],
  },
};

export function getToneDeviceProfile(id: ToneDeviceId): ToneDeviceProfile {
  return TONE_DEVICE_PROFILES[id];
}
