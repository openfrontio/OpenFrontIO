import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.openfront.game',
  appName: 'OpenFront',
  webDir: 'static',
  server: {
    androidScheme: 'http',
    cleartext: true
  }
};

export default config;
