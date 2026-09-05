import { fileURLToPath, URL } from 'node:url'

import Vue from '@vitejs/plugin-vue'
import postcss from 'postcss'
import AutoImport from 'unplugin-auto-import/vite'
import Icons from 'unplugin-icons/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import Markdown from 'unplugin-vue-markdown/vite'
import { defaultAllowedOrigins } from 'vite'
import i18nextLoader from 'vite-plugin-i18next-loader'
import svgLoader from 'vite-svg-loader'
import { defineConfig } from 'wxt'

import { keepFirst5H2Plugin } from './scripts/mdit-keep-first-5-h2.ts'
import { removeH1Plugin } from './scripts/mdit-remove-h1.ts'

const baseManifest = {
  name: '__MSG_extension_name__',
  author: 'Red_lnn<lemon@redlnn.top>',
  description: '__MSG_extension_description__',
  default_locale: 'en',
  icons: {
    16: '/icon-16.png',
    24: '/icon-24.png',
    32: '/icon-32.png',
    48: '/icon-48.png',
    64: '/icon-64.png',
    96: '/icon-96.png',
    128: '/icon-128.png',
    256: '/icon-256.png',
    512: '/icon-512.png',
  },
  host_permissions: [
    'https://www.bing.com/', // Bing 每日壁纸
    'https://api.bing.com/', // Bing 搜索建议
    'https://suggestion.baidu.com/', // 百度搜索建议
    'https://suggestqueries.google.com/', // Google 搜索建议
    'https://v2.jinrishici.com/', // 今日诗词 API
    'https://v1.hitokoto.cn/', // 一言 API
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'none'; img-src 'self' https: http: data: blob:; worker-src 'self'",
  },
}

const firefoxManifest = {
  ...baseManifest,
  permissions: ['topSites', 'storage', 'bookmarks', 'activeTab', 'tabs'],
  optional_permissions: ['webRequest', '*://*/*'],
  chrome_settings_overrides: {
    homepage: 'newtab.html',
  },
  browser_specific_settings: {
    gecko: {
      id: '{25566b3f-eaeb-4f05-aac6-da1efc2dc1fd}',
      data_collection_permissions: {
        required: ['bookmarksInfo', 'browsingActivity'],
      },
    },
  },
}

const chromeManifest = {
  ...baseManifest,
  permissions: ['topSites', 'storage', 'favicon', 'bookmarks', 'activeTab', 'tabs', 'scripting'],
  optional_permissions: ['webRequest'],
  optional_host_permissions: ['*://*/*'],
}

const elementPlusResolver = ElementPlusResolver({
  importStyle: 'sass',
})

// 将 所有 Element Plus CSS 包裹在 @layer element-plus { } 中，以便未分层的用户样式始终优先（Vite 8+）
const elementPlusLayerPlugin: postcss.Plugin = {
  postcssPlugin: 'element-plus-layer',
  Once(root, { result }) {
    const from: string = (result.opts.from ?? '').replace(/\\/g, '/')
    if (!from.includes('/node_modules/element-plus/')) return
    if (!root.nodes?.length) return

    const nodes = root.nodes.map((n) => n.clone())
    root.removeAll()
    const layer = postcss.atRule({ name: 'layer', params: 'element-plus' })
    layer.append(...nodes)
    root.append(layer)
  },
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/webextension-polyfill'],
  imports: false,
  manifest: ({ browser }) => {
    if (browser === 'firefox') {
      return firefoxManifest
    } else {
      return chromeManifest
    }
  },
  hooks: {
    'build:publicAssets': (wxt, files) => {
      if (wxt.config.command !== 'serve' || !wxt.server) return

      const devOrigin = `${wxt.server.origin}/`
      files.push({
        relativeDest: 'dev-worker-bootstrap.js',
        contents: `const workerUrl = new URL(import.meta.url).searchParams.get('url')
if (!workerUrl?.startsWith(${JSON.stringify(devOrigin)})) throw new Error('Invalid dev worker URL')
await import(workerUrl)`,
      })
    },
  },
  vite: () => ({
    server: {
      cors: {
        origin: [defaultAllowedOrigins, /^(?:chrome|moz)-extension:\/\//],
      },
    },
    plugins: [
      Vue({
        include: [/\.vue$/, /\.md$/],
      }), // 自己添加 @vitejs/plugin-vue 不使用 @wxt-dev/module-vue
      i18nextLoader({
        paths: ['./locales'],
        namespaceResolution: 'basename',
      }),
      svgLoader(),
      Icons({ compiler: 'vue3' }),
      Markdown({
        include: [/CHANGELOG.*\.md$/],
        markdownItSetup(md) {
          md.use(removeH1Plugin)
          md.use(keepFirst5H2Plugin)
        },
      }),
      Markdown({
        include: [/\.md$/],
        exclude: [/CHANGELOG.*\.md$/],
      }),
      AutoImport({
        include: [
          /\.[tj]sx?$/, // .ts, .tsx, .js, .jsx
          /\.vue$/,
          /\.vue\?vue/, // .vue
          /\.vue\.[tj]sx?\?vue/, // .vue (vue-loader with experimentalInlineMatchResource enabled)
        ],
        imports: ['vue'],
        resolvers: [elementPlusResolver],
        viteOptimizeDeps: true,
        dts: 'types/auto-imports.d.ts',
      }),
      Components({
        resolvers: [elementPlusResolver],
        dts: 'types/components.d.ts',
      }),
    ],
    build: {
      sourcemap: false, // for HMP (@wxt-dev/module-vue 会自动添加)
      chunkSizeWarningLimit: 2000,
    },
    ssr: {
      noExternal: ['element-plus'],
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./', import.meta.url)),
        '@newtab': fileURLToPath(new URL('./entrypoints/newtab', import.meta.url)),
      },
    },
    css: {
      postcss: {
        plugins: [elementPlusLayerPlugin],
      },
      preprocessorOptions: {
        scss: {
          additionalData: `@use "@/assets/styles/element/index.scss" as *;`,
        },
      },
    },
  }),
})
