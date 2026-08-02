#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MOBILE = ROOT / "mobile"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Pattern not found in {path}: {old[:180]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Android: stop using the native CameraX PreviewView path that binds but renders black
# on the reported Samsung device. Route hand modes through the proven expo-camera preview.
live = MOBILE / "components/LiveLocalCoachCamera.tsx"
replace_once(
    live,
    """  Linking,\n  Pressable,""",
    """  Linking,\n  Platform,\n  Pressable,""",
)
replace_once(
    live,
    """  if (cameraFocus === 'full-body' || cameraFocus === 'none') {""",
    """  if (cameraFocus === 'full-body' || cameraFocus === 'none' || Platform.OS === 'android') {""",
)

# 2) Make the stable expo-camera hand path work without a guitar ROI. A saved manual
# calibration is still used when present, but absence now falls back to full-frame hand AI.
focus = MOBILE / "components/FocusCoachCameraV7.tsx"
replace_once(
    focus,
    """const LEFT_HAND_REGION: NormalizedRegion = { left: 0.02, top: 0.14, right: 0.86, bottom: 0.96 };\nconst ROI_KEY_PREFIX""",
    """const LEFT_HAND_REGION: NormalizedRegion = { left: 0.02, top: 0.14, right: 0.86, bottom: 0.96 };\nconst FULL_HAND_REGION: NormalizedRegion = { left: 0.015, top: 0.025, right: 0.985, bottom: 0.985 };\nconst ROI_KEY_PREFIX""",
)
replace_once(
    focus,
    """  const [region, setRegion] = useState<NormalizedRegion | null>(cameraFocus === 'left-hand' ? LEFT_HAND_REGION : null);\n  const [handResult""",
    """  const [region, setRegion] = useState<NormalizedRegion | null>(\n    cameraFocus === 'left-hand' ? LEFT_HAND_REGION : cameraFocus === 'right-hand' ? FULL_HAND_REGION : null,\n  );\n  const [useFullFrameHandAnalysis, setUseFullFrameHandAnalysis] = useState(cameraFocus === 'right-hand');\n  const [handResult""",
)
replace_once(
    focus,
    """    if (cameraFocus === 'left-hand') {\n      setRegion(LEFT_HAND_REGION);\n      return;\n    }\n    if (cameraFocus === 'full-body' || cameraFocus === 'none') {\n      setRegion(null);\n      return;\n    }\n    setRegion(null);\n    void loadFocusV7RightHandRegion(facing).then((stored) => {\n      if (cancelled) return;\n      if (!stored) {\n        updateStatus('기타 위치 자동 인식 또는 수동 보정이 필요합니다.');\n        onNeedCalibration?.(facing);\n        return;\n      }\n      setRegion(stored);\n      updateStatus('오른손 분석 영역 준비 완료');\n    });""",
    """    if (cameraFocus === 'left-hand') {\n      setRegion(LEFT_HAND_REGION);\n      setUseFullFrameHandAnalysis(false);\n      return;\n    }\n    if (cameraFocus === 'full-body' || cameraFocus === 'none') {\n      setRegion(null);\n      setUseFullFrameHandAnalysis(false);\n      return;\n    }\n    setRegion(FULL_HAND_REGION);\n    setUseFullFrameHandAnalysis(true);\n    updateStatus('전체 화면에서 오른손을 찾는 중 · 기타 없이도 인식합니다.');\n    void loadFocusV7RightHandRegion(facing).then((stored) => {\n      if (cancelled || !stored) return;\n      setRegion(stored);\n      setUseFullFrameHandAnalysis(false);\n      updateStatus('저장된 오른손 분석 영역 준비 완료');\n    });""",
)
replace_once(
    focus,
    """    if (cameraFocus === 'right-hand' && (!HandModule?.androidHandRegionAnalysisAvailable || !HandModule.analyzeHandInRegionAsync)) {\n      setAnalysisError('ROI 손 분석 모듈이 없습니다. 전체 화면 분석으로 대체하지 않습니다.');\n      return;\n    }\n\n""",
    """""",
)
replace_once(
    focus,
    """          if (cameraFocus === 'right-hand') {\n            const photoRegion = previewRegionToImage(activeRegion, size, photoSize, 0.025);\n            rawResult = await HandModule!.analyzeHandInRegionAsync!(\n              photo.uri,\n              pickColor(category, cameraFocus),\n              photoRegion.left,\n              photoRegion.top,\n              photoRegion.right,\n              photoRegion.bottom,\n            );\n          } else {\n            rawResult = await HandModule!.analyzeHandAsync(photo.uri, 'none');\n          }""",
    """          if (\n            cameraFocus === 'right-hand'\n            && !useFullFrameHandAnalysis\n            && HandModule?.androidHandRegionAnalysisAvailable\n            && HandModule.analyzeHandInRegionAsync\n          ) {\n            const photoRegion = previewRegionToImage(activeRegion, size, photoSize, 0.025);\n            rawResult = await HandModule.analyzeHandInRegionAsync(\n              photo.uri,\n              pickColor(category, cameraFocus),\n              photoRegion.left,\n              photoRegion.top,\n              photoRegion.right,\n              photoRegion.bottom,\n            );\n          } else {\n            rawResult = await HandModule!.analyzeHandAsync(\n              photo.uri,\n              cameraFocus === 'right-hand' ? pickColor(category, cameraFocus) : 'none',\n            );\n          }""",
)
replace_once(
    focus,
    """              updateStatus('지정된 기타 구역에서 손을 찾는 중 · 아직 판정 안 함');""",
    """              updateStatus(useFullFrameHandAnalysis\n                ? '전체 화면에서 손을 찾는 중 · 아직 판정 안 함'\n                : '저장된 분석 영역에서 손을 찾는 중 · 아직 판정 안 함');""",
)
replace_once(
    focus,
    """  }, [cameraError, cameraFocus, cameraReady, category, coachingActive, facing, permission?.granted, region, size.height, size.width]);""",
    """  }, [cameraError, cameraFocus, cameraReady, category, coachingActive, facing, permission?.granted, region, size.height, size.width, useFullFrameHandAnalysis]);""",
)
replace_once(
    focus,
    """          <Text style={styles.trackingRegionLabel}>{cameraFocus === 'right-hand' ? '오른손 AI 입력' : '왼손 분석 영역'}</Text>""",
    """          <Text style={styles.trackingRegionLabel}>{cameraFocus === 'right-hand'\n            ? useFullFrameHandAnalysis ? '전체 화면 손 AI' : '오른손 AI 입력'\n            : '왼손 분석 영역'}</Text>""",
)

# 3) Confirm before leaving a live lesson. Android Modal onRequestClose and the visible
# close button use the same guarded prompt.
runner = MOBILE / "components/PracticeSessionRunnerV8.tsx"
replace_once(
    runner,
    """import {\n  Modal,""",
    """import {\n  Alert,\n  Modal,""",
)
replace_once(
    runner,
    """  const subjectLockedRef = useRef(false);""",
    """  const subjectLockedRef = useRef(false);\n  const closePromptOpenRef = useRef(false);""",
)
replace_once(
    runner,
    """    if (closeAfter) onClose();\n  };\n\n  const handleMotionSample""",
    """    if (closeAfter) onClose();\n  };\n\n  const requestClose = () => {\n    if (closePromptOpenRef.current) return;\n    closePromptOpenRef.current = true;\n    const release = () => { closePromptOpenRef.current = false; };\n    Alert.alert(\n      running ? '레슨을 종료할까요?' : '집중교정을 닫을까요?',\n      running\n        ? '현재 연습 기록을 저장하고 집중교정을 닫습니다.'\n        : '집중교정 화면에서 나가 홈으로 돌아갑니다.',\n      [\n        { text: running ? '계속 연습' : '취소', style: 'cancel', onPress: release },\n        {\n          text: running ? '종료·저장' : '닫기',\n          style: 'destructive',\n          onPress: () => {\n            release();\n            void stopLesson(true);\n          },\n        },\n      ],\n      { cancelable: true, onDismiss: release },\n    );\n  };\n\n  const handleMotionSample""",
)
replace_once(
    runner,
    """    <Modal visible animationType=\"fade\" presentationStyle=\"fullScreen\" onRequestClose={() => void stopLesson(true)}>""",
    """    <Modal visible animationType=\"fade\" presentationStyle=\"fullScreen\" onRequestClose={requestClose}>""",
)
replace_once(
    runner,
    """              <Pressable onPress={() => void stopLesson(true)} style={styles.closeButton}>""",
    """              <Pressable onPress={requestClose} style={styles.closeButton}>""",
)
runner_text = runner.read_text(encoding="utf-8").replace("FOCUS LIVE · v25", "FOCUS LIVE · v26").replace("FOCUS LIVE v25", "FOCUS LIVE v26")
runner.write_text(runner_text, encoding="utf-8")

# 4) Protect app exit. Back closes sheets, returns tools to home, and only exits after
# explicit confirmation from home. The session modal owns its own back confirmation.
app = MOBILE / "CompleteBetaAppV060Plus.tsx"
replace_once(app, "import { useState } from 'react';", "import { useEffect, useRef, useState } from 'react';")
replace_once(
    app,
    """import {\n  Modal,""",
    """import {\n  Alert,\n  BackHandler,\n  Modal,""",
)
replace_once(
    app,
    """  const [moreVisible, setMoreVisible] = useState(false);\n  const { mode""",
    """  const [moreVisible, setMoreVisible] = useState(false);\n  const exitPromptOpenRef = useRef(false);\n  const { mode""",
)
replace_once(
    app,
    """  const openTool = (next: GlobalTool) => {\n    setTool(next);\n    setMoreVisible(false);\n  };\n\n  const moreToolActive""",
    """  const openTool = (next: GlobalTool) => {\n    setTool(next);\n    setMoreVisible(false);\n  };\n\n  useEffect(() => {\n    if (tool === 'session') return undefined;\n    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {\n      if (moreVisible) {\n        setMoreVisible(false);\n        return true;\n      }\n      if (tool !== 'app') {\n        setTool('app');\n        return true;\n      }\n      if (exitPromptOpenRef.current) return true;\n      exitPromptOpenRef.current = true;\n      const release = () => { exitPromptOpenRef.current = false; };\n      Alert.alert(\n        '앱을 종료할까요?',\n        '기타 코치 AI를 종료합니다.',\n        [\n          { text: '취소', style: 'cancel', onPress: release },\n          { text: '앱 종료', style: 'destructive', onPress: () => { release(); BackHandler.exitApp(); } },\n        ],\n        { cancelable: true, onDismiss: release },\n      );\n      return true;\n    });\n    return () => subscription.remove();\n  }, [moreVisible, tool]);\n\n  const moreToolActive""",
)
app_text = app.read_text(encoding="utf-8").replace("0.6.0 v25", "0.6.0 v26")
app.write_text(app_text, encoding="utf-8")

# 5) Correct Photograph's capo-2 shape order. The prior intro/verse/outro placed G
# before A, while the verified common arrangement is D-Bm-A-G (sounding E-C#m-B-A).
guides = MOBILE / "config/song-chord-guides.ts"
replace_once(
    guides,
    """    sections: { intro: ['D', 'Bm', 'G', 'A'], verse: ['D', 'Bm', 'G', 'A'], chorus: ['D', 'A', 'Bm', 'G'], bridge: ['Bm', 'G', 'D', 'A'], outro: ['D', 'Bm', 'G', 'A'] },""",
    """    sections: { intro: ['D', 'Bm', 'A', 'G'], verse: ['D', 'Bm', 'A', 'G'], chorus: ['D', 'A', 'Bm', 'G'], bridge: ['Bm', 'G', 'D', 'A'], outro: ['D', 'Bm', 'A', 'G'] },""",
)
replace_once(
    guides,
    """    note: '연주 폼 코드와 실제 울림 코드를 분리한 구간 연습 가이드입니다. 원곡 전체 채보가 아니므로 영상 구간 보정과 귀 확인을 함께 사용하세요.',""",
    """    note: '실제 울림 코드와 카포 연주 폼을 분리한 구간 가이드입니다. 검증된 초 단위 코드 타임라인이 없으므로 앱이 현재 코드를 추측하지 않고 사용자가 코드 칩으로 직접 맞춥니다.',""",
)

# 6) Stop fabricating precise current chords from coarse section ratios. Show the actual
# sounding chord prominently, keep capo shapes secondary, and let the user advance the
# verified section progression manually.
studio = MOBILE / "components/MasterSongStudioPanel.tsx"
replace_once(
    studio,
    """import { chordAtSectionProgress, getSongChordGuide } from '../config/song-chord-guides';""",
    """import { getSongChordGuide } from '../config/song-chord-guides';""",
)
replace_once(
    studio,
    """  const [capo, setCapo] = useState(0);\n  const [loopEnabled""",
    """  const [capo, setCapo] = useState(0);\n  const [manualChordIndex, setManualChordIndex] = useState(0);\n  const [loopEnabled""",
)
replace_once(
    studio,
    """    setLoopEnabled(false);\n    setLoopSectionId""",
    """    setLoopEnabled(false);\n    setManualChordIndex(0);\n    setLoopSectionId""",
)
replace_once(
    studio,
    """  const sectionProgress = active && active.end > active.start\n    ? Math.max(0, Math.min(1, (currentTime - active.start) / (active.end - active.start)))\n    : 0;\n  const chordState = chordAtSectionProgress(chordGuide.chords, sectionProgress, chordGuide.beatWeights);\n  const soundingChordState = chordAtSectionProgress(chordGuide.soundingChords, sectionProgress, chordGuide.beatWeights);""",
    """  const safeChordIndex = chordGuide.chords.length\n    ? Math.max(0, Math.min(chordGuide.chords.length - 1, manualChordIndex))\n    : 0;\n  const chordState = {\n    index: safeChordIndex,\n    current: chordGuide.chords[safeChordIndex] ?? '-',\n    next: chordGuide.chords[(safeChordIndex + 1) % Math.max(1, chordGuide.chords.length)] ?? '-',\n  };\n  const soundingChordState = {\n    index: safeChordIndex,\n    current: chordGuide.soundingChords[safeChordIndex] ?? '-',\n    next: chordGuide.soundingChords[(safeChordIndex + 1) % Math.max(1, chordGuide.soundingChords.length)] ?? '-',\n  };\n\n  useEffect(() => {\n    setManualChordIndex(0);\n    lastSpokenChordRef.current = '';\n  }, [activeSectionId, song?.id]);""",
)
replace_once(
    studio,
    """        `현재 ${chordState.current} 폼, 실제 울림 ${soundingChordState.current}. 다음 ${chordState.next} 폼입니다.`,""",
    """        `현재 실제 울림 ${soundingChordState.current}, 카포 연주 폼 ${chordState.current}. 다음 울림 ${soundingChordState.next}입니다.`,""",
)
replace_once(
    studio,
    """      <Text style={styles.subtitle}>YouTube IFrame의 실제 재생 시간을 읽어 현재 구간을 자동 강조·스크롤합니다. 제공되는 내용은 원곡 TAB·가사가 아니라 실력 향상을 위한 상세 연습 지도이며, 영상별 시작 차이는 직접 보정할 수 있습니다.</Text>""",
    """      <Text style={styles.subtitle}>YouTube의 실제 재생 시간으로 연습 구간을 강조합니다. 코드 초 단위 타이밍은 추측하지 않으며, 검증된 구간 진행을 코드 칩이나 이전·다음 버튼으로 직접 맞춥니다.</Text>""",
)
replace_once(
    studio,
    """<View style={styles.currentChordWrap}>\n  <Text style={styles.chordLabel}>현재 연주 폼</Text>\n  <Text style={styles.currentChord}>{chordState.current}</Text>\n  <Text style={styles.chordLabel}>실제 울림 {soundingChordState.current}</Text>\n</View>\n<View style={styles.nextChordWrap}>\n  <Text style={styles.chordLabel}>다음 연주 폼</Text>\n  <Text style={styles.nextChord}>{chordState.next}</Text>\n  <Text style={styles.chordLabel}>울림 {soundingChordState.next}</Text>\n</View>""",
    """<View style={styles.currentChordWrap}>\n  <Text style={styles.chordLabel}>현재 실제 울림</Text>\n  <Text style={styles.currentChord}>{soundingChordState.current}</Text>\n  <Text style={styles.chordLabel}>카포 {capo} · 연주 폼 {chordState.current}</Text>\n</View>\n<View style={styles.nextChordWrap}>\n  <Text style={styles.chordLabel}>다음 실제 울림</Text>\n  <Text style={styles.nextChord}>{soundingChordState.next}</Text>\n  <Text style={styles.chordLabel}>연주 폼 {chordState.next}</Text>\n</View>""",
)
replace_once(
    studio,
    """{chordGuide.chords.map((chord, index) => (\n  <View key={`${activeSectionId}-${chord}-${index}`} style={[styles.chordChip, index === chordState.index && styles.chordChipActive]}>\n    <Text style={[styles.chordChipText, index === chordState.index && styles.chordChipTextActive]}>{chord}{chordGuide.soundingChords[index] !== chord ? ` · ${chordGuide.soundingChords[index]}` : ''}</Text>\n  </View>\n))}""",
    """{chordGuide.chords.map((chord, index) => (\n  <Pressable\n    key={`${activeSectionId}-${chord}-${index}`}\n    onPress={() => setManualChordIndex(index)}\n    style={[styles.chordChip, index === chordState.index && styles.chordChipActive]}\n  >\n    <Text style={[styles.chordChipText, index === chordState.index && styles.chordChipTextActive]}>\n      {chordGuide.soundingChords[index] ?? chord}{chordGuide.soundingChords[index] !== chord ? ` · 폼 ${chord}` : ''}\n    </Text>\n  </Pressable>\n))}""",
)
replace_once(
    studio,
    """        </View>\n        <View style={styles.syncRow}>\n          <Pressable onPress={() => setCapo""",
    """        </View>\n        <View style={styles.syncRow}>\n          <Pressable\n            onPress={() => setManualChordIndex((value) => (value - 1 + chordGuide.chords.length) % Math.max(1, chordGuide.chords.length))}\n            style={styles.syncButton}\n          ><Text style={styles.syncText}>이전 코드</Text></Pressable>\n          <View style={styles.syncValueWrap}>\n            <Text style={styles.syncLabel}>코드 수동 맞춤</Text>\n            <Text style={styles.syncValue}>{chordGuide.chords.length ? `${safeChordIndex + 1}/${chordGuide.chords.length}` : '-'}</Text>\n          </View>\n          <Pressable\n            onPress={() => setManualChordIndex((value) => (value + 1) % Math.max(1, chordGuide.chords.length))}\n            style={styles.syncButton}\n          ><Text style={styles.syncText}>다음 코드</Text></Pressable>\n        </View>\n        <Text style={styles.chordGuideNote}>자동 코드 추측 OFF · 듣고 맞는 코드 칩을 누르면 그 위치를 유지합니다.</Text>\n        <View style={styles.syncRow}>\n          <Pressable onPress={() => setCapo""",
)

# 7) Regression assertions for the reported song.
test = MOBILE / "tests/song-chord-guides.test.ts"
replace_once(
    test,
    """assert(guide.strumPattern.includes('1 & 2 & 3 & 4 &'), '스트럼을 박·앤드 단위로 표시해야 합니다.');\nconsole.log""",
    """assert(guide.strumPattern.includes('1 & 2 & 3 & 4 &'), '스트럼을 박·앤드 단위로 표시해야 합니다.');\nconst photograph = getSongChordGuide('acoustic-photograph', 'verse', 'acoustic');\nassert(photograph.chords.join('-') === 'D-Bm-A-G', 'Photograph 카포 2 연주 폼 순서는 D-Bm-A-G여야 합니다.');\nassert(photograph.soundingChords.join('-') === 'E-C#m-B-A', 'Photograph 실제 울림 순서는 E-C#m-B-A여야 합니다.');\nconsole.log""",
)

print('Applied v26 camera preview, back confirmation, and song chord repairs')
