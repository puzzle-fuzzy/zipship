/// <reference types="vite/client" />

declare module '*.css' {
  const content: string;
  export default content;
}

interface Window {
  __ZIPSHIP_API_BASE_URL?: string;
  __ZIPSHIP_ACCESS_BASE_URL?: string;
}
