/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

interface Window {
  __ZIPSHIP_RUNTIME_CONFIG__?: {
    apiBaseUrl?: string;
    accessBaseUrl?: string;
  };
}
