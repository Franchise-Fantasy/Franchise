import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

export default function LoadingScreen() {
  return (
    <View style={styles.container}>
      <Image 
        source={require('../assets/images/react-logo.png')}
        style={styles.logo}
      />
      <ActivityIndicator size="large" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 20,
  },
  spinner: {
    marginTop: 20,
  },
});