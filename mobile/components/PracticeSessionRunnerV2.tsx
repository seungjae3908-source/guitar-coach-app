import { useEffect } from 'react';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import { stopNativeAudioAnalysisAsync } from '../modules/guitar-coach-audio';
import { setLiveAnalysisSubscribersSuppressed } from '../services/analysis-stream';
import PracticeSessionRunnerV8 from './PracticeSessionRunnerV8';

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
    <PracticeSessionRunnerV8
      mode={mode}
      voiceCoachEnabled={voiceCoachEnabled}
      onClose={onClose}
    />
  );
}
