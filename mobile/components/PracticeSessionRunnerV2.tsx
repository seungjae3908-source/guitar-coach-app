import { useEffect } from 'react';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import { stopNativeAudioAnalysisAsync } from '../modules/guitar-coach-audio';
import PracticeSessionRunnerV6 from './PracticeSessionRunnerV6';

export default function PracticeSessionRunnerV2({
  mode,
  voiceCoachEnabled,
  onClose,
}: {
  mode: GuitarModeId;
  voiceCoachEnabled: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    void stopNativeAudioAnalysisAsync();
    return () => {
      void stopNativeAudioAnalysisAsync();
    };
  }, []);

  return (
    <PracticeSessionRunnerV6
      mode={mode}
      voiceCoachEnabled={voiceCoachEnabled}
      onClose={onClose}
    />
  );
}
