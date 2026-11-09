/// <reference types="vite/client" />
/// <reference types="vite-svg-loader" />
/// <reference types="unplugin-icons/types/vue" />
/// <reference types="chrome" />

declare module 'virtual:*'

declare module '*.md' {
  import type { ComponentOptions } from 'vue'

  const Component: ComponentOptions
  export default Component
}
