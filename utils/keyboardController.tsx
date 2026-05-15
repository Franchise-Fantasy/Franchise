import Constants from 'expo-constants';
import React from 'react';
import {
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  type KeyboardAvoidingViewProps,
} from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

// `react-native-keyboard-controller` ships native code that Expo Go doesn't
// include. Importing it under Expo Go crashes at module init
// (`KeyboardControllerNative.getConstants is not a function`). Custom dev
// clients and EAS builds (dev/preview/production) bundle the native module
// and use the real implementation; only Expo Go falls through to the shims.
const isExpoGo = Constants.appOwnership === 'expo';

type KeyboardAnimation = {
  height: SharedValue<number>;
  progress: SharedValue<number>;
};

let KeyboardProvider: React.ComponentType<{ children: React.ReactNode }>;
let KeyboardAvoidingView: React.ComponentType<KeyboardAvoidingViewProps>;
let useReanimatedKeyboardAnimation: () => KeyboardAnimation;

if (isExpoGo) {
  KeyboardProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  KeyboardAvoidingView = RNKeyboardAvoidingView;
  useReanimatedKeyboardAnimation = () => {
    const height = useSharedValue(0);
    const progress = useSharedValue(0);
    return { height, progress };
  };
} else {
  const real = require('react-native-keyboard-controller');
  KeyboardProvider = real.KeyboardProvider;
  KeyboardAvoidingView = real.KeyboardAvoidingView;
  useReanimatedKeyboardAnimation = real.useReanimatedKeyboardAnimation;
}

export { KeyboardAvoidingView, KeyboardProvider, useReanimatedKeyboardAnimation };
