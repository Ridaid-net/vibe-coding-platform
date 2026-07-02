import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.rodaid.app',
  appName: 'RODAID',
  webDir: 'out',
  server: {
    url: 'https://rodaid.net',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0F1E35',
  },
  ios: {
    backgroundColor: '#0F1E35',
    contentInset: 'always',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0F1E35',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
