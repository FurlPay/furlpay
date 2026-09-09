import * as Haptics from 'expo-haptics';

export function triggerHapticSelection() {
  Haptics.selectionAsync();
}

export function triggerHapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
