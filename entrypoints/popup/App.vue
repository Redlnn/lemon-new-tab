<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import Add12Filled from '~icons/fluent/add-12-filled'
import Pin12Regular from '~icons/fluent/pin-12-regular'
import CheckRound from '~icons/ic/round-check'
import CloseRound from '~icons/ic/round-close'

import { browser } from 'wxt/browser'

import { fetchFaviconWithCache, warmFaviconCache } from '@/shared/media'
import { DEFAULT_QUICK_LINK_GROUP_ID, useQuickLinksStore } from '@/shared/quickLinks'
import { settingsStorage } from '@/shared/settings'
import { normalizeUrlForDedup } from '@/shared/url'

import { isValidUrl } from '@newtab/shared/utils'

const { t } = useTranslation('popup')
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
      return results[0]
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
  const [settings] = await Promise.all([
    settingsStorage.getValue(),
    quickLinksStore.init({ acquire: false }),
  ])
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
  }

  if (groupingEnabled.value) {
    await quickLinksStore.addQuickLinkToGroup(DEFAULT_QUICK_LINK_GROUP_ID, quickLink, {
      groupingEnabled: true,
    })
  } else {
    quickLinksStore.items.push(quickLink)
    await quickLinksStore.save()
  }
  isAdded.value = true
}
</script>

<template>
  <div class="popup">
    <div class="popup__header">
      <el-icon size="20" color="var(--el-color-primary)">
        <pin12-regular />
      </el-icon>
      <span class="popup__title">{{ t('title') }}</span>
    </div>
    <template v-if="isLoading">
      <div v-loading="true" class="popup__loading"></div>
    </template>
    <template v-else-if="currentTab">
      <div v-if="isAdded" class="popup__success">
        <el-icon size="48" color="var(--el-color-success)">
          <check-round />
        </el-icon>
        <span>{{ t('addSuccess') }}</span>
      </div>
      <template v-else>
        <div class="popup__content">
          <div class="popup__site-info">
            <el-image :src="currentTabFaviconRef" class="popup__favicon" fit="cover" />
            <div class="popup__site-text">
              <el-text class="popup__site-title" line-clamp="1">{{ currentTab.title }}</el-text>
              <el-text class="popup__site-url" type="info" size="small" line-clamp="1">{{
                currentTab.url
              }}</el-text>
            </div>
          </div>
        </div>

        <div class="popup__footer">
          <el-alert
            v-if="isAlreadyExists"
            type="warning"
            :title="t('alreadyExists')"
            :closable="false"
            show-icon
          />
          <el-button
            v-else
            type="primary"
            @click="addCurrentPage"
            round
            :disabled="isAlreadyExists"
            :icon="Add12Filled"
          >
            {{ t('addToQuickLinks') }}
          </el-button>
        </div>
      </template>
    </template>

    <div v-else class="popup__error">
      <el-icon size="48" color="var(--el-color-danger)">
        <close-round />
      </el-icon>
      <span>{{ t('cannotAdd') }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.popup {
  width: 360px;
  padding: 20px;
  margin: 20px;
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
  color: var(--el-text-color-primary);
}

.popup__loading {
  height: 104px;
}

.popup__success,
.popup__error {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  min-height: 104px;
  color: var(--el-text-color-regular);
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
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 6px;

  &--placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-7);
  }
}

.popup__site-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  .el-text {
    align-self: auto;
    word-break: break-all;
  }
}

.popup__site-title {
  font-weight: 500;
}

.popup__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
