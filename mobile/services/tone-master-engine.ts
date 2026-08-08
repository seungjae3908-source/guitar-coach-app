import {
  generateTonePresetDraft,
  type ToneParameter,
  type TonePresetDraft,
  type TonePresetRequest,
} from './tone-preset-engine';

export type ToneCharacter = 'balanced' | 'warm' | 'cut' | 'tight' | 'ambient';
export type ToneProblem = 'muddy' | 'harsh' | 'thin' | 'noisy' | 'buried' | 'attack-blur';

export type ToneVariation = {
  id: 'A' | 'B' | 'C';
  label: string;
  purpose: string;
  preset: TonePresetDraft;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function characterRequest(request: TonePresetRequest, character: ToneCharacter): TonePresetRequest {
  if (character === 'warm') {
    return { ...request, brightness: request.brightness - 28, gainAmount: request.gainAmount - 4, ambience: request.ambience + 4 };
  }
  if (character === 'cut') {
    return { ...request, brightness: request.brightness + 26, gainAmount: request.gainAmount - 2, ambience: request.ambience - 7 };
  }
  if (character === 'tight') {
    return { ...request, brightness: request.brightness + 8, gainAmount: request.gainAmount - 12, ambience: request.ambience - 18 };
  }
  if (character === 'ambient') {
    return { ...request, brightness: request.brightness + 3, gainAmount: request.gainAmount - 7, ambience: request.ambience + 36 };
  }
  return request;
}

function retitle(preset: TonePresetDraft, title: string, suffix: string): TonePresetDraft {
  return {
    ...preset,
    id: `${preset.id}-${suffix}`,
    title,
  };
}

export function generateToneVariations(
  request: TonePresetRequest,
  character: ToneCharacter,
): ToneVariation[] {
  const center = characterRequest(request, character);
  const a = retitle(generateTonePresetDraft({
    ...center,
    brightness: center.brightness - 8,
    gainAmount: center.gainAmount - 5,
    ambience: center.ambience + 3,
  }), 'A · 부드럽고 여유 있는 톤', 'A');
  const b = retitle(generateTonePresetDraft(center), 'B · 균형 기준 톤', 'B');
  const c = retitle(generateTonePresetDraft({
    ...center,
    brightness: center.brightness + 8,
    gainAmount: center.gainAmount + 4,
    ambience: center.ambience - 4,
  }), 'C · 선명하고 앞으로 나오는 톤', 'C');

  return [
    { id: 'A', label: '부드러운 A', purpose: '집 연습, 잔잔한 곡, 피킹 거친 소리를 줄이는 시작점', preset: a },
    { id: 'B', label: '균형 B', purpose: '대부분의 곡에서 먼저 맞춰 볼 기준 톤', preset: b },
    { id: 'C', label: '선명한 C', purpose: '합주에서 묻히거나 리드 어택을 또렷하게 만들 때', preset: c },
  ];
}

function numericValue(parameter: ToneParameter | undefined) {
  return parameter && typeof parameter.value === 'number' ? parameter.value : null;
}

function updateNumber(parameters: ToneParameter[], id: string, change: number) {
  return parameters.map((parameter) => {
    if (parameter.id !== id || typeof parameter.value !== 'number') return parameter;
    const min = parameter.min ?? 0;
    const max = parameter.max ?? 100;
    return { ...parameter, value: Math.round(clamp(parameter.value + change, min, max)) };
  });
}

export function applyToneProblemCorrection(
  preset: TonePresetDraft,
  problem: ToneProblem,
): { preset: TonePresetDraft; explanation: string; listeningCheck: string } {
  let parameters = [...preset.parameters];
  let explanation = '';
  let listeningCheck = '';

  if (problem === 'muddy') {
    parameters = updateNumber(parameters, 'bass', -7);
    parameters = updateNumber(parameters, 'gain', -5);
    parameters = updateNumber(parameters, 'middle', 3);
    parameters = updateNumber(parameters, 'reverb', -4);
    explanation = '저음·게인·리버브가 겹치면 코드 분리가 흐려집니다. Bass와 Gain을 먼저 낮추고 Mid를 조금 살립니다.';
    listeningCheck = '낮은 줄을 친 뒤 다음 코드의 첫 음이 뭉개지지 않고 따로 들리는지 확인하세요.';
  } else if (problem === 'harsh') {
    parameters = updateNumber(parameters, 'treble', -7);
    parameters = updateNumber(parameters, 'presence', -6);
    parameters = updateNumber(parameters, 'gain', -3);
    explanation = '고역과 Presence가 과하면 피크 소리와 치찰음이 앞섭니다. Treble과 Presence를 작은 폭으로 줄입니다.';
    listeningCheck = '1·2번 줄을 세게 쳐도 귀를 찌르는 소리 없이 음정 중심이 남는지 확인하세요.';
  } else if (problem === 'thin') {
    parameters = updateNumber(parameters, 'middle', 7);
    parameters = updateNumber(parameters, 'bass', 3);
    parameters = updateNumber(parameters, 'gain', 3);
    explanation = '얇은 소리는 무조건 Bass보다 Mid 부족일 때가 많습니다. Mid를 먼저 올리고 Bass는 조금만 보강합니다.';
    listeningCheck = '한 음을 길게 쳤을 때 첫 어택 뒤 몸통이 남고, 합주에서도 음이 사라지지 않는지 확인하세요.';
  } else if (problem === 'noisy') {
    parameters = updateNumber(parameters, 'gain', -8);
    parameters = updateNumber(parameters, 'noiseSuppressor', 8);
    parameters = updateNumber(parameters, 'compressor', -4);
    explanation = '노이즈는 게인을 먼저 줄인 뒤 NS를 필요한 만큼만 올립니다. NS를 과하게 올리면 서스테인이 잘립니다.';
    listeningCheck = '손을 줄에서 뗐을 때 잡음은 줄고, 음을 길게 눌렀을 때 끝부분이 갑자기 잘리지 않는지 확인하세요.';
  } else if (problem === 'buried') {
    parameters = updateNumber(parameters, 'middle', 8);
    parameters = updateNumber(parameters, 'presence', 4);
    parameters = updateNumber(parameters, 'bass', -3);
    parameters = updateNumber(parameters, 'reverb', -3);
    explanation = '합주에서 묻히면 볼륨만 올리기보다 Mid와 Presence를 올리고 Bass·Reverb를 줄여 자리를 만듭니다.';
    listeningCheck = '반주 위에서 코드와 리드의 윤곽이 들리되 다른 악기를 덮지 않는지 확인하세요.';
  } else {
    parameters = updateNumber(parameters, 'delay', -5);
    parameters = updateNumber(parameters, 'reverb', -5);
    parameters = updateNumber(parameters, 'compressor', -3);
    parameters = updateNumber(parameters, 'treble', 2);
    explanation = '어택이 흐리면 공간계와 컴프레서를 줄이고 고역을 아주 조금 보강해 피킹 시작점을 드러냅니다.';
    listeningCheck = '빠른 피킹에서 각 음의 시작이 붙지 않고 하나씩 구분되는지 확인하세요.';
  }

  return {
    preset: {
      ...preset,
      id: `${preset.id}-${problem}-${Date.now()}`,
      title: `${preset.title} · ${problem} 교정`,
      parameters,
      warnings: [...preset.warnings, `청음 교정 적용: ${explanation}`],
    },
    explanation,
    listeningCheck,
  };
}

export function buildToneLesson(preset: TonePresetDraft) {
  const amp = preset.parameters.find((parameter) => parameter.id === 'ampModel')?.value ?? '-';
  const gain = numericValue(preset.parameters.find((parameter) => parameter.id === 'gain'));
  const bass = numericValue(preset.parameters.find((parameter) => parameter.id === 'bass'));
  const middle = numericValue(preset.parameters.find((parameter) => parameter.id === 'middle'));
  const treble = numericValue(preset.parameters.find((parameter) => parameter.id === 'treble'));
  return [
    `1. 모든 이펙트를 끄고 AMP ${amp}, Gain ${gain ?? '-'}, Bass ${bass ?? '-'}, Mid ${middle ?? '-'}, Treble ${treble ?? '-'}부터 맞춥니다.`,
    '2. 같은 리프를 약하게·보통·세게 세 번 연주해 피킹 세기에 따라 소리가 무너지지 않는지 듣습니다.',
    '3. Gain은 소리가 나올 만큼만 두고, 코드 분리는 Mid와 피킹 깊이로 먼저 해결합니다.',
    '4. Delay와 Reverb는 마지막에 올리며, 빠른 연주에서 어택이 흐려지면 다시 줄입니다.',
    '5. 앱의 숫자는 시작점입니다. 실제 기타·픽업·스피커 소리를 듣고 한 번에 2~5만 움직여 A/B 비교합니다.',
  ];
}
