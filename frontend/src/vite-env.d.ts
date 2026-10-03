/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_DEMO_BACKEND?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
