/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** The deploy-stamped code SHA (the SPA side of the version-skew contract); unset locally. */
  readonly VITE_APP_BUILD?: string;
}
