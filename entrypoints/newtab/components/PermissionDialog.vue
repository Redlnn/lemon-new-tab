<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { browser } from 'wxt/browser'

import { useImeAwareDialog } from '@newtab/composables/useImeAwareDialog'
import { PermissionContext, PermissionResult } from '@newtab/composables/usePermission'

const props = defineProps<{
  hostname: string
  onlyAll?: boolean
  context?: PermissionContext
}>()
const model = defineModel<boolean>({ required: true })
const emit = defineEmits<{
  result: [result: PermissionResult]
}>()

const { t } = useTranslation('settings')
const { isComposing } = useImeAwareDialog()

const contextMessage = computed(() => {
  switch (props.context) {
    case PermissionContext.WallpaperCache:
      return t('background.permission.request.wallpaperCacheMessage')
    case PermissionContext.FaviconCache:
      return t('background.permission.request.faviconCacheMessage')
    case PermissionContext.MonetColor:
      return t('background.permission.request.monetColorMessage')
    default:
      return t('background.permission.request.message')
  }
})

async function requestPermission(isAll: boolean) {
  if (import.meta.env.MANIFEST_VERSION === 2 && !isAll) {
    // Firefox MV2 不需要请求当前网站权限，直接视为已授权
    return emit('result', PermissionResult.GrantedCurrent)
  }
  const permissions = { origins: isAll ? [`*://*/*`] : [`*://${props.hostname}/*`] }
  try {
    const granted = await browser.permissions.request(permissions)
    emit(
      'result',
      granted
        ? isAll
          ? PermissionResult.GrantedAll
          : PermissionResult.GrantedCurrent
        : PermissionResult.DeniedByBrowser,
    )
  } catch (error) {
    console.error(`Failed to request ${isAll ? 'all' : 'current'} permissions:`, error)
    emit('result', PermissionResult.DeniedByBrowser)
  }
}

function onDeny() {
  emit('result', PermissionResult.DeniedByUser)
}
</script>

<template>
  <el-dialog
    v-model="model"
    :title="t('background.permission.request.title')"
    width="400px"
    class="permission-dialog base-dialog--blur base-dialog--opacity noselect"
    :close-on-press-escape="!isComposing"
  >
    <div class="permission-dialog-content">
      <p>{{ contextMessage }}</p>
      <ul v-if="!props.onlyAll">
        <li>
          <strong>{{ t('background.permission.request.subA.label') }}</strong>
          {{ t('background.permission.request.subA.content') }}
        </li>
        <li>
          <strong>{{ t('background.permission.request.subB.label') }}</strong>
          {{ t('background.permission.request.subB.content') }}
        </li>
      </ul>
      <div
        class="permission-dialog-actions"
        :class="{ 'permission-dialog-actions--only-all': props.onlyAll }"
      >
        <el-button type="primary" plain @click="requestPermission(true)" class="permission-btn">
          {{ t('background.permission.allowAll') }}
        </el-button>
        <el-button v-if="!props.onlyAll" @click="requestPermission(false)" class="permission-btn">
          {{ t('background.permission.allowCurrent') }}
        </el-button>
        <el-button
          type="danger"
          plain
          @click="onDeny"
          class="permission-btn"
          style="grid-area: deny"
        >
          {{ t('background.permission.deny') }}
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style lang="scss">
.permission-dialog.el-dialog {
  padding: 25px;
}

.permission-dialog-content {
  ul {
    padding-left: 1em;
  }

  li {
    margin-bottom: 0.3em;
    line-height: 1.25em;

    &:last-of-type {
      margin-bottom: 0;
    }
  }
}

.permission-dialog-actions {
  display: grid;
  grid-template: '. .' 1fr 'deny deny' 1fr / 1fr 1fr;
  gap: 10px;

  &.permission-dialog-actions--only-all {
    grid-template: '.' 1fr 'deny' 1fr / 1fr;
  }
}

.permission-btn.el-button {
  width: 100%;
  margin-left: 0;
}
</style>
