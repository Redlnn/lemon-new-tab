import { fileURLToPath, URL } from 'node:url'

import Vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [Vue(), Icons({ compiler: 'vue3' })],
  resolve: {
    alias: {
      '@prototype': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../../.output/webdav-sync-prototype', import.meta.url)),
    emptyOutDir: true,
  },
})
