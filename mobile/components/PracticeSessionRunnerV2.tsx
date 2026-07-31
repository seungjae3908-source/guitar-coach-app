import { useEffect } from 'react';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import { stopNativeAudioAnalysisAsync } from '../modules/guitar-coach-audio';
import { setLiveAnalysisSubscribersSuppressed } from '../services/analysis-stream';
import PracticeSessionRunnerV7 from './PracticeSessionRunnerV7';

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
    setLiveAnalysisSubscribersSuppressed(true);
    void stopNativeAudioAnalysisAsync();
    return () => {
      setLiveAnalysisSubscribersSuppressed(false);
      void stopNativeAudioAnalysisAsync();
    };
  }, []);

  return (
    <PracticeSessionRunnerV7
      mode={mode}
      voiceCoachEnabled={voiceCoachEnabled}
      onClose={onClose}
    />
  );
}
