<script setup lang="ts" vapor>
import i18next from 'i18next'

import { browser } from 'wxt/browser'

import { fetchFaviconWithCache, warmFaviconCache } from '@/shared/media'
import { DEFAULT_QUICK_LINK_GROUP_ID, useQuickLinksStore } from '@/shared/quickLinks'
import { settingsStorage } from '@/shared/settings'
import {
  clearExtensionData,
  downloadLegacySettingsBackup,
  reloadNewtabTabs,
} from '@/shared/settings/legacySettingsRecovery'
import { normalizeUrlForDedup } from '@/shared/url'

import { isValidUrl } from '@newtab/shared/utils'

const props = defineProps<{
  hasInvalidSettings: boolean
}>()

const t = (key: string) => i18next.t(key)
const legacyT = (key: string) => i18next.t(`newtab:bootstrap.invalidVer.${key}`)
const quickLinksStore = useQuickLinksStore()

const currentTab = shallowRef<{
  url: string
  title: string
  favIconUrl?: string
  tabId?: number
} | null>(null)

const isLoading = ref(true)
const isAdded = ref(false)
const isAlreadyExists = ref(false)
const groupingEnabled = ref(false)
const isResetting = ref(false)
const resetError = shallowRef<Error | null>(null)
const includeSync = ref(false)

/** 从激活页的 DOM 中读取 favicon href（通过注入 content script）。 */
async function getFaviconFromTabDOM(tabId: number): Promise<string | null> {
  try {
    if (import.meta.env.MANIFEST_VERSION === 2) {
      // Firefox MV2: browser.scripting 不存在，改用 browser.tabs.executeScript
      const results = (await browser.tabs.executeScript(tabId, {
        code: `(function () {
          var s = ['link[rel~="apple-touch-icon"][href]', 'link[rel~="icon"][href]'];
          for (var i = 0; i < s.length; i++) { var el = document.querySelector(s[i]); if (el && el.href) return el.href; }
          return null;
        })()`,
      })) as (string | null)[]
      return results[0] ?? null
    }
    // Chrome/Edge MV3：使用 browser.scripting.executeScript
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selectors = ['link[rel~="apple-touch-icon"][href]', 'link[rel~="icon"][href]']
        for (const sel of selectors) {
          const el = document.querySelector<HTMLLinkElement>(sel)
          if (el?.href) return el.href // 在选项卡上下文中 href 已为绝对地址
        }
        return null
      },
    })
    return results[0]?.result ?? null
  } catch {
    return null
  }
}

/** 稳定的 favicon 引用，会在 currentTab 变更时异步更新。 */
const currentTabFaviconRef = shallowRef('/favicon.png')
watchEffect(async () => {
  const tab = currentTab.value
  if (!tab) {
    currentTabFaviconRef.value = '/favicon.png'
    return
  }
  if (tab.favIconUrl) {
    currentTabFaviconRef.value = tab.favIconUrl
    return
  }
  if (tab.tabId != null) {
    const domFavicon = await getFaviconFromTabDOM(tab.tabId).catch(() => null)
    if (domFavicon) {
      currentTabFaviconRef.value = domFavicon
      return
    }
  }
  fetchFaviconWithCache(tab.url)
    .then((d) => {
      if (d) currentTabFaviconRef.value = d
    })
    .catch(() => {})
})

onMounted(async () => {
  if (props.hasInvalidSettings) return

  const [settings] = await Promise.all([settingsStorage.getValue(), quickLinksStore.init()])
  groupingEnabled.value = settings.quickLinks.grouping ?? false

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (tab?.url && isValidUrl(tab.url)) {
      currentTab.value = {
        url: tab.url,
        title: tab.title || tab.url,
        favIconUrl: tab.favIconUrl,
        tabId: tab.id,
      }

      // 检查是否已经存在（规范化 URL 后比较）
      const normalizedTabUrl = normalizeUrlForDedup(tab.url)
      isAlreadyExists.value = quickLinksStore.items.some(
        (item) => normalizeUrlForDedup(item.url) === normalizedTabUrl,
      )
    }
  } catch (error) {
    console.error('Failed to get current tab:', error)
  } finally {
    isLoading.value = false
  }
})

function useFallbackFavicon() {
  if (currentTabFaviconRef.value !== '/favicon.png') {
    currentTabFaviconRef.value = '/favicon.png'
  }
}

async function addCurrentPage() {
  if (!currentTab.value) return

  const hasValidFavicon =
    currentTabFaviconRef.value && currentTabFaviconRef.value !== '/favicon.png'

  let finalFavicon: string | null = null
  if (hasValidFavicon) {
    currentTab.value.favIconUrl = currentTabFaviconRef.value
    finalFavicon = await warmFaviconCache(currentTab.value.url, currentTabFaviconRef.value)
  }

  const quickLink = {
    url: currentTab.value.url,
    title: currentTab.value.title,
    // 此处若获取到图标则同时把缓存的base64结果存储到quickLinksStore
    // 后续QuickLinkItem组件优先使用该字段，避免每次都调用getFaviconURL函数获取图标
    favicon: finalFavicon ?? undefined,
    faviconSource: finalFavicon ? ('automatic' as const) : undefined,
  }

  if (groupingEnabled.value) {
    await quickLinksStore.addQuickLinkToGroup(DEFAULT_QUICK_LINK_GROUP_ID, quickLink, {
      groupingEnabled: true,
    })
  } else {
    await quickLinksStore.addFlatQuickLink(quickLink)
  }
  isAdded.value = true
}

async function resetLegacySettings() {
  isResetting.value = true
  resetError.value = null

  try {
    await clearExtensionData({ includeSync: includeSync.value })
    await reloadNewtabTabs()
    window.close()
  } catch (error) {
    isResetting.value = false
    resetError.value = error instanceof Error ? error : new Error(String(error))
    console.error('Failed to clear data:', resetError.value)
  }
}

function reloadPage() {
  location.reload()
}
</script>

<template>
  <main class="popup">
    <section v-if="resetError" class="popup__recovery popup__recovery--error" role="alert">
      <svg class="popup__recovery-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M0 0h24v24H0z" fill="none" />
        <path
          fill="currentColor"
          fill-rule="evenodd"
          d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20m0 5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1m0 9a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 0 1 0-2.5"
          clip-rule="evenodd"
        />
      </svg>
      <h1 class="popup__recovery-title">{{ t('settings:other.purge.failed.title') }}</h1>
      <p>{{ resetError.message }}</p>
      <button type="button" class="popup__button popup__button--primary" @click="reloadPage">
        {{ t('settings:other.purge.failed.refresh') }}
      </button>
    </section>
    <section v-else-if="props.hasInvalidSettings" class="popup__recovery" :aria-busy="isResetting">
      <svg class="popup__recovery-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M0 0h24v24H0z" fill="none" />
        <path
          fill="currentColor"
          fill-rule="evenodd"
          d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12s4.477 10 10 10s10-4.477 10-10M12 7a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1m-1 9a1 1 0 0 1 1-1h.008a1 1 0 1 1 0 2H12a1 1 0 0 1-1-1"
          clip-rule="evenodd"
        />
      </svg>
      <h1 class="popup__recovery-title">{{ legacyT('title') }}</h1>
      <p>{{ legacyT('msg') }}</p>
      <p>{{ legacyT('bak') }}</p>
      <label class="popup__recovery-sync">
        <input v-model="includeSync" type="checkbox" :disabled="isResetting" />
        {{ t('settings:other.purge.confirm.data.includeSync') }}
      </label>
      <div class="popup__recovery-actions">
        <button type="button" class="popup__button" @click="downloadLegacySettingsBackup">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M0 0h24v24H0z" fill="none" />
            <path
              fill="currentColor"
              d="M11.625 15.513q-.175-.063-.325-.213l-3.6-3.6q-.3-.3-.288-.7t.288-.7q.3-.3.713-.312t.712.287L11 12.15V5q0-.425.288-.712T12 4t.713.288T13 5v7.15l1.875-1.875q.3-.3.713-.288t.712.313q.275.3.288.7t-.288.7l-3.6 3.6q-.15.15-.325.213t-.375.062t-.375-.062M6 20q-.825 0-1.412-.587T4 18v-2q0-.425.288-.712T5 15t.713.288T6 16v2h12v-2q0-.425.288-.712T19 15t.713.288T20 16v2q0 .825-.587 1.413T18 20z"
            />
          </svg>
          Download
        </button>
        <button
          type="button"
          class="popup__button popup__button--primary"
          :disabled="isResetting"
          @click="resetLegacySettings"
        >
          <span
            v-if="isResetting"
            class="popup__spinner popup__spinner--small"
            aria-hidden="true"
          />
          {{ legacyT('btn') }}
        </button>
      </div>
    </section>

    <template v-else>
      <div class="popup__header">
        <!-- <pin12-regular /> -->
        <svg class="popup__icon popup__icon--primary" aria-hidden="true" viewBox="0 0 12 12">
          <path d="M0 0h12v12H0z" fill="none" />
          <path
            fill="currentColor"
            d="M8.052 1.436a1.5 1.5 0 0 0-2.38.347L4.145 4.608l-2.33.928a.5.5 0 0 0-.169.818l1.647 1.647l-2.146 2.146l-.147.854l.854-.147L4 8.708l1.646 1.646a.5.5 0 0 0 .818-.168l.933-2.332l2.821-1.526a1.5 1.5 0 0 0 .347-2.38zm-1.5.822a.5.5 0 0 1 .793-.115l2.513 2.513a.5.5 0 0 1-.116.793L6.762 7.06a.5.5 0 0 0-.226.254L5.817 9.11L2.891 6.184l1.793-.715a.5.5 0 0 0 .254-.226z"
          />
        </svg>
        <span class="popup__title">{{ t('title') }}</span>
      </div>
      <div v-if="isLoading" class="popup__loading" role="status">
        <span class="popup__spinner" aria-hidden="true" />
      </div>
      <template v-else-if="currentTab">
        <div v-if="isAdded" class="popup__success">
          <!-- <check-round /> -->
          <svg class="popup__icon popup__icon--success" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M0 0h24v24H0z" fill="none" />
            <path
              fill="currentColor"
              d="M9 16.17L5.53 12.7a.996.996 0 1 0-1.41 1.41l4.18 4.18c.39.39 1.02.39 1.41 0L20.29 7.71a.996.996 0 1 0-1.41-1.41z"
            />
          </svg>
          <span>{{ t('popup:addSuccess') }}</span>
        </div>
        <template v-else>
          <div class="popup__content">
            <div class="popup__site-info">
              <img
                :src="currentTabFaviconRef"
                :alt="currentTab.title"
                class="popup__favicon"
                @error="useFallbackFavicon"
              />
              <div class="popup__site-text">
                <span class="popup__site-title">{{ currentTab.title }}</span>
                <span class="popup__site-url">{{ currentTab.url }}</span>
              </div>
            </div>
          </div>

          <div class="popup__footer">
            <div v-if="isAlreadyExists" class="popup__alert" role="alert">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M0 0h24v24H0z" fill="none" />
                <path
                  fill="currentColor"
                  fill-rule="evenodd"
                  d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12s4.477 10 10 10s10-4.477 10-10M12 7a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1m-1 9a1 1 0 0 1 1-1h.008a1 1 0 1 1 0 2H12a1 1 0 0 1-1-1"
                  clip-rule="evenodd"
                />
              </svg>
              <span>{{ t('popup:alreadyExists') }}</span>
            </div>
            <button
              v-else
              type="button"
              class="popup__button popup__button--primary"
              @click="addCurrentPage"
            >
              <svg aria-hidden="true" viewBox="0 0 12 12">
                <path d="M0 0h12v12H0z" fill="none" />
                <path
                  fill="currentColor"
                  d="M6 1.75a.75.75 0 0 1 .75.75v2.75H9.5a.75.75 0 0 1 0 1.5H6.75V9.5a.75.75 0 0 1-1.5 0V6.75H2.5a.75.75 0 0 1 0-1.5h2.75V2.5A.75.75 0 0 1 6 1.75"
                />
              </svg>
              {{ t('popup:addToQuickLinks') }}
            </button>
          </div>
        </template>
      </template>

      <div v-else class="popup__error">
        <svg class="popup__icon popup__icon--danger" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M0 0h24v24H0z" fill="none" />
          <path
            fill="currentColor"
            d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59L7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12L5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4"
          />
        </svg>
        <span>{{ t('popup:cannotAdd') }}</span>
      </div>
    </template>
  </main>
</template>

<style lang="scss" scoped>
.popup {
  width: 360px;
  padding: 20px;
  margin: 20px;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  border-radius: var(--el-border-radius-round);
  box-shadow: var(--el-box-shadow-light);
}

.popup__header {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 12px;
  margin-left: 3px;
}

.popup__title {
  font-size: 16px;
  font-weight: 600;
}

.popup__icon,
.popup__button svg,
.popup__alert svg {
  display: block;
  flex: none;
  width: 1.5em;
  height: 1.5em;
}

.popup__icon--primary {
  color: var(--el-color-primary);
}

.popup__icon--success,
.popup__icon--danger {
  width: 48px;
  height: 48px;
}

.popup__icon--success {
  color: var(--el-color-success);
}

.popup__icon--danger {
  color: var(--el-color-danger);
}

.popup__loading,
.popup__success,
.popup__error {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 104px;
}

.popup__success,
.popup__error {
  flex-direction: column;
  gap: 12px;
  color: var(--el-text-color-regular);
}

.popup__spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--el-color-primary-light-7);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: popup-spin 0.8s linear infinite;
}

.popup__spinner--small {
  width: 14px;
  height: 14px;
  border-width: 2px;
}

.popup__content {
  margin-bottom: 12px;
}

.popup__site-info {
  display: flex;
  gap: 12px;
  align-items: center;
  height: 60px;
  padding: 12px 17px;
  margin-bottom: 12px;
  background: var(--el-fill-color-light);
  border-radius: 15px;
}

.popup__favicon {
  flex: none;
  width: 26px;
  height: 26px;
  object-fit: cover;
  border-radius: 6px;
}

.popup__site-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.popup__site-title,
.popup__site-url {
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-all;
  white-space: nowrap;
}

.popup__site-title {
  font-weight: 500;
}

.popup__site-url {
  font-size: var(--el-font-size-small);
  color: var(--el-text-color-secondary);
}

.popup__footer {
  display: flex;
  justify-content: flex-end;
}

.popup__button {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 8px 15px;
  font: inherit;
  line-height: 1;
  color: var(--el-text-color-regular);
  cursor: pointer;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-round);
  transition: 0.15s ease;

  &:hover:not(:disabled) {
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    border-color: var(--el-color-primary-light-5);
  }

  &:focus-visible {
    outline: 2px solid var(--el-color-primary-light-5);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.popup__button--primary {
  color: var(--el-color-white);
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);

  &:hover:not(:disabled) {
    color: var(--el-color-white);
    background: var(--el-color-primary-light-3);
    border-color: var(--el-color-primary-light-3);
  }
}

.popup__alert {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  font-size: var(--el-font-size-small);
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
  border-radius: var(--el-border-radius-base);
}

.popup__alert svg {
  color: var(--el-color-warning);
}

.popup__recovery {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  color: var(--el-text-color-regular);
}

.popup__recovery-icon {
  width: 40px;
  height: 40px;
  color: var(--el-color-warning);
}

.popup__recovery-title,
.popup__recovery p {
  margin: 0;
}

.popup__recovery-title {
  font-size: 18px;
  color: var(--el-text-color-primary);
}

.popup__recovery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.popup__recovery-sync {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: var(--el-font-size-small);
}

.popup__recovery--error {
  min-height: 190px;
  color: var(--el-color-danger);
}

@keyframes popup-spin {
  to {
    transform: rotate(1turn);
  }
}
</style>
