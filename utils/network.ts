import NetInfo from '@react-native-community/netinfo';

/** Returns true if the device appears to be online. */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return !!state.isConnected;
}
