import AsyncStorage from '@react-native-async-storage/async-storage';

const SONG_KEY = 'guitar-coach:selected-training-song:v1';

export async function saveSelectedTrainingSongId(id: string) {
  await AsyncStorage.setItem(SONG_KEY, id);
}

export async function loadSelectedTrainingSongId() {
  return AsyncStorage.getItem(SONG_KEY);
}

export async function clearSelectedTrainingSongId() {
  await AsyncStorage.removeItem(SONG_KEY);
}
