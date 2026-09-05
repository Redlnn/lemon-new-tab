<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import CloudOffRound from '~icons/ic/round-cloud-off'

import {
  getSyncAvailability,
  type SyncCatalogKey,
  type WallpaperAvailabilityContext,
} from '@/shared/webdavSync/catalog'

import { useWebDavSyncState } from '../composables/useWebDavSyncState'

const props = defineProps<{
  catalogKey: SyncCatalogKey
  pendingPermission?: 'favicon' | 'monet' | 'wallpaper'
  wallpaper?: WallpaperAvailabilityContext
  wallpaperVariant?: 'dark' | 'light'
}>()

const { t } = useTranslation('settings')
const syncState = useWebDavSyncState()
const availability = computed(() =>
  getSyncAvailability(props.catalogKey, {
    scope: syncState.value.scope,
    pendingPermissions: props.pendingPermission ? new Set([props.pendingPermission]) : undefined,
    wallpapers:
      props.wallpaper && props.wallpaperVariant
        ? { [props.wallpaperVariant]: props.wallpaper }
        : undefined,
  }),
)
const label = computed(() =>
  availability.value.state === 'included' ? '' : t(availability.value.reasonKey),
)
</script>

<template>
  <el-tooltip v-if="availability.state !== 'included'" :content="label" placement="top">
    <cloud-off-round class="sync-availability-icon" role="img" :aria-label="label" />
  </el-tooltip>
</template>

<style scoped>
.sync-availability-icon {
  width: 1em;
  height: 1em;
  margin-inline-start: 0.3em;
  vertical-align: -0.14em;
  color: var(--el-text-color-secondary);
}
</style>
