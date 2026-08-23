<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import CheckCircleRound from '~icons/ic/round-check-circle'
import CloudDoneRound from '~icons/ic/round-cloud-done'
import LockRound from '~icons/ic/round-lock'
import RoundWarningIcon from '~icons/ic/round-warning'

import { useSettingsStore } from '@/shared/settings'
import { idbGet } from '@/shared/storage/idb'
import { connectSyncConnection, previewSyncConnection } from '@/shared/webdavSync/bridge'
import type {
  BrowserWebDavSetupInput,
  BrowserWebDavSetupPreview,
} from '@/shared/webdavSync/browserEngine'
import { MAX_SYNC_WALLPAPER_BYTES } from '@/shared/webdavSync/catalog'
import { DEFAULT_SYNC_SCOPE } from '@/shared/webdavSync/localState'
import { requestExactWebDavPermission } from '@/shared/webdavSync/permissions'
import { classifyWebDavAddress, WebDavError } from '@/shared/webdavSync/webdav'

const emit = defineEmits<{ connected: [] }>()
const model = defineModel<boolean>({ required: true })
const { t } = useTranslation('settings')
const settings = useSettingsStore()

const step = ref(0)
const testing = ref(false)
const connecting = ref(false)
const preview = shallowRef<BrowserWebDavSetupPreview>()
const testError = ref('')
const localHttpAccepted = ref(false)
const wallpaperInfo = reactive({ count: 0, totalSize: 0, lightSize: 0, darkSize: 0 })
const scope = reactive({ ...DEFAULT_SYNC_SCOPE })
const form = reactive({
  url: '',
  username: '',
  password: '',
  deviceName: '',
  directory: 'LemonNewTab',
  rememberPassword: true,
  encrypted: false,
  encryptionPassword: '',
})

const steps = computed(() => [
  t('webdavSync.setup.steps.connection'),
  t('webdavSync.setup.steps.test'),
  t('webdavSync.setup.steps.scan'),
  t('webdavSync.setup.steps.scope'),
  t('webdavSync.setup.steps.compare'),
  t('webdavSync.setup.steps.confirm'),
])

const addressAssessment = computed(() => {
  if (!form.url) return undefined
  try {
    return classifyWebDavAddress(form.url)
  } catch {
    return undefined
  }
})

const httpApproved = computed(() => {
  if (addressAssessment.value?.transport === 'https') return true
  if (addressAssessment.value?.transport === 'local-http') return localHttpAccepted.value
  return false
})
const publicHttpUnsupported = computed(
  () => /^http:\/\//i.test(form.url.trim()) && !addressAssessment.value,
)

const effectiveEncryption = computed(() =>
  preview.value?.state === 'empty' ? form.encrypted : (preview.value?.encrypted ?? form.encrypted),
)

const canContinue = computed(() => {
  if (step.value === 0) {
    return Boolean(
      form.url && form.username && form.password && addressAssessment.value && httpApproved.value,
    )
  }
  if (step.value === 1) return Boolean(preview.value)
  if (step.value === 5 && effectiveEncryption.value) {
    return form.encryptionPassword.length >= 8
  }
  return true
})

const formattedWallpaperSize = computed(() => formatBytes(wallpaperInfo.totalSize))
const oversizedWallpaperCount = computed(
  () =>
    [wallpaperInfo.lightSize, wallpaperInfo.darkSize].filter(
      (size) => size > MAX_SYNC_WALLPAPER_BYTES,
    ).length,
)
const hasPreviewConflicts = computed(() => Boolean(preview.value?.conflicts.length))
const comparisonTitle = computed(() =>
  preview.value?.state === 'empty'
    ? t('webdavSync.setup.compare.initialTitle')
    : hasPreviewConflicts.value
      ? t('webdavSync.setup.compare.firstConnectionTitle')
      : t('webdavSync.setup.compare.existingTitle'),
)

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function createInput(): BrowserWebDavSetupInput {
  const transport = addressAssessment.value?.transport
  const insecureHttpApproval = transport === 'local-http' ? ('local-warning' as const) : undefined
  return {
    connection: {
      baseUrl: form.url.trim(),
      username: form.username,
      password: form.password,
      insecureHttpApproval,
    },
    directory: form.directory.trim() || 'LemonNewTab',
    deviceName: form.deviceName.trim() || undefined,
    encryptionPassword: effectiveEncryption.value
      ? form.encryptionPassword || undefined
      : undefined,
    rememberPassword: form.rememberPassword,
    scope: { ...scope },
  }
}

function readableError(error: unknown) {
  if (error instanceof WebDavError) {
    if (error.category === 'authentication') return t('webdavSync.setup.errors.authentication')
    if (error.category === 'forbidden') return t('webdavSync.setup.errors.permission')
    if (error.category === 'network' || error.category === 'timeout')
      return t('webdavSync.setup.errors.network')
    if (error.category === 'encryption-locked') return t('webdavSync.setup.errors.encryption')
    if (error.category === 'foreign-vault') return t('webdavSync.setup.errors.foreign')
    if (error.category === 'format-too-new') return t('webdavSync.setup.errors.format')
    if (error.category === 'storage-full') return t('webdavSync.errors.storage-full')
    return t('webdavSync.errors.unknown')
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/authentication|401|password/i.test(message))
    return t('webdavSync.setup.errors.authentication')
  if (/permission|denied|403/i.test(message)) return t('webdavSync.setup.errors.permission')
  if (/encrypted|encryption/i.test(message)) return t('webdavSync.setup.errors.encryption')
  if (/foreign|unrelated/i.test(message)) return t('webdavSync.setup.errors.foreign')
  if (/newer|format/i.test(message)) return t('webdavSync.setup.errors.format')
  return message || t('webdavSync.errors.unknown')
}

async function inspectWallpapers() {
  const candidates = [
    {
      id: settings.background.local.id,
      mediaType: settings.background.local.mediaType,
      store: 'wallpaper' as const,
    },
    {
      id: settings.background.localDark.id,
      mediaType: settings.background.localDark.mediaType,
      store: 'wallpaperDark' as const,
    },
  ]
  const sizes = await Promise.all(
    candidates.map(async (candidate) => {
      if (!candidate.id || candidate.mediaType !== 'image') return 0
      const blob = await idbGet(candidate.store, candidate.id)
      return blob instanceof Blob ? blob.size : 0
    }),
  )
  wallpaperInfo.lightSize = sizes[0] ?? 0
  wallpaperInfo.darkSize = sizes[1] ?? 0
  wallpaperInfo.count = sizes.filter(Boolean).length
  wallpaperInfo.totalSize = sizes.reduce((sum, size) => sum + size, 0)
}

async function testConnection() {
  testError.value = ''
  preview.value = undefined
  testing.value = true
  try {
    if (!(await requestExactWebDavPermission(form.url.trim()))) {
      throw new Error(t('webdavSync.setup.errors.permission'))
    }
    preview.value = await previewSyncConnection(createInput())
    ElMessage.success(t('webdavSync.setup.test.success'))
  } catch (error) {
    testError.value = readableError(error)
  } finally {
    testing.value = false
  }
}

async function finish() {
  if (!preview.value) return
  connecting.value = true
  try {
    await connectSyncConnection(createInput(), preview.value)
    ElMessage.success(t('webdavSync.setup.connected'))
    emit('connected')
    model.value = false
  } catch (error) {
    ElMessage.error(readableError(error))
  } finally {
    connecting.value = false
  }
}

async function nextStep() {
  if (step.value === 3) {
    testing.value = true
    try {
      preview.value = await previewSyncConnection(createInput())
    } catch (error) {
      ElMessage.error(readableError(error))
      return
    } finally {
      testing.value = false
    }
  }
  step.value += 1
}

function reset() {
  step.value = 0
  preview.value = undefined
  testError.value = ''
  localHttpAccepted.value = false
  Object.assign(scope, DEFAULT_SYNC_SCOPE)
  form.password = ''
  form.encryptionPassword = ''
  void inspectWallpapers()
}

watch(model, (visible) => visible && reset(), { immediate: true })
watch(
  () => [form.url, form.username, form.password, form.directory, form.encryptionPassword],
  () => {
    preview.value = undefined
    testError.value = ''
  },
)
</script>

<template>
  <el-dialog
    v-model="model"
    :title="t('webdavSync.setup.title')"
    class="base-dialog webdav-setup-dialog"
    :close-on-click-modal="false"
    destroy-on-close
    append-to-body
  >
    <div class="base-dialog-container">
      <el-steps :active="step" finish-status="success" class="setup-steps" align-center>
        <el-step v-for="label in steps" :key="label" :title="label" />
      </el-steps>

      <el-scrollbar>
        <div class="setup-content">
          <template v-if="step === 0">
            <header>
              <h3>{{ t('webdavSync.setup.connection.title') }}</h3>
            </header>
            <el-form label-position="top">
              <div class="setup-columns">
                <el-form-item :label="t('webdavSync.setup.connection.url')">
                  <el-input v-model="form.url" placeholder="https://example.com/dav/" />
                </el-form-item>
                <el-form-item :label="t('webdavSync.setup.connection.deviceName')">
                  <el-input
                    v-model="form.deviceName"
                    :placeholder="t('webdavSync.setup.connection.deviceNamePlaceholder')"
                    maxlength="80"
                  />
                </el-form-item>
              </div>
              <div class="setup-columns">
                <el-form-item :label="t('webdavSync.setup.connection.username')">
                  <el-input v-model="form.username" autocomplete="username" />
                </el-form-item>
                <el-form-item :label="t('webdavSync.setup.connection.password')">
                  <el-input
                    v-model="form.password"
                    type="password"
                    show-password
                    autocomplete="current-password"
                  />
                </el-form-item>
              </div>
              <el-collapse class="setup-advanced">
                <el-collapse-item name="advanced" :title="t('webdavSync.setup.advanced')">
                  <el-form-item :label="t('webdavSync.setup.connection.directory')">
                    <el-input v-model="form.directory" />
                  </el-form-item>
                  <el-checkbox v-model="form.rememberPassword">
                    {{ t('webdavSync.setup.connection.remember') }}
                  </el-checkbox>
                  <p class="setup-note">
                    {{
                      form.rememberPassword
                        ? t('webdavSync.setup.connection.rememberNote')
                        : t('webdavSync.setup.connection.sessionNote')
                    }}
                  </p>
                  <el-checkbox v-model="form.encrypted">
                    {{ t('webdavSync.setup.encryption.enable') }}
                  </el-checkbox>
                  <el-form-item
                    v-if="form.encrypted"
                    :label="t('webdavSync.setup.encryption.password')"
                  >
                    <el-input
                      v-model="form.encryptionPassword"
                      type="password"
                      show-password
                      autocomplete="new-password"
                    />
                  </el-form-item>
                </el-collapse-item>
              </el-collapse>
              <el-alert
                v-if="addressAssessment?.transport === 'local-http'"
                type="warning"
                :closable="false"
                show-icon
              >
                <div
                  style="
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    margin: 8px 0;
                    font-size: 14px;
                  "
                >
                  {{ t('webdavSync.setup.http.localWarning') }}
                  <el-checkbox
                    v-model="localHttpAccepted"
                    style="height: auto; white-space: normal"
                  >
                    {{ t('webdavSync.setup.http.accept') }}
                  </el-checkbox>
                </div>
              </el-alert>
              <el-alert v-else-if="publicHttpUnsupported" type="error" :closable="false" show-icon>
                {{ t('webdavSync.setup.http.publicUnsupported') }}
              </el-alert>
            </el-form>
          </template>

          <template v-else-if="step === 1">
            <header>
              <h3>{{ t('webdavSync.setup.test.title') }}</h3>
              <p>
                {{
                  t('webdavSync.setup.test.description', {
                    origin: addressAssessment?.permissionOrigin,
                  })
                }}
              </p>
            </header>
            <section class="setup-result-card">
              <component :is="preview ? CheckCircleRound : CloudDoneRound" />
              <div>
                <strong>
                  {{
                    preview
                      ? t('webdavSync.setup.test.success')
                      : t('webdavSync.setup.test.notTested')
                  }}
                </strong>
                <p>
                  {{
                    preview
                      ? t('webdavSync.setup.test.scanned')
                      : t('webdavSync.setup.test.permissionNote')
                  }}
                </p>
              </div>
              <el-button type="primary" :loading="testing" @click="testConnection">
                {{ preview ? t('webdavSync.setup.test.retry') : t('webdavSync.setup.test.action') }}
              </el-button>
            </section>
            <el-alert
              v-if="testError"
              type="error"
              :closable="false"
              show-icon
              :title="testError"
              style="margin-top: 10px"
            />
          </template>

          <template v-else-if="step === 2">
            <header>
              <h3>{{ t('webdavSync.setup.scan.title') }}</h3>
            </header>
            <el-result
              :icon="preview?.state === 'empty' ? 'success' : 'warning'"
              :title="t(`webdavSync.setup.scan.${preview?.state ?? 'empty'}`)"
              :sub-title="
                t(
                  preview?.state === 'empty'
                    ? 'webdavSync.setup.scan.emptyNote'
                    : preview?.state === 'remote-conflict'
                      ? 'webdavSync.setup.scan.remoteConflictNote'
                      : 'webdavSync.setup.scan.existingNote',
                )
              "
            />
          </template>

          <template v-else-if="step === 3">
            <header>
              <h3>{{ t('webdavSync.setup.scope.title') }}</h3>
              <p>{{ t('webdavSync.setup.scope.description') }}</p>
            </header>
            <div class="setup-scope-list">
              <label>
                <span>
                  <strong>{{ t('webdavSync.scope.settings') }}</strong>
                </span>
                <el-switch v-model="scope.settings" />
              </label>
              <label>
                <span>
                  <strong>{{ t('quickLinks.title') }}</strong>
                </span>
                <el-switch v-model="scope.quickLinks" />
              </label>
              <label>
                <span>
                  <strong>{{ t('webdavSync.scope.customSearchEngines') }}</strong>
                </span>
                <el-switch v-model="scope.customSearchEngines" />
              </label>
              <label>
                <span>
                  <strong>{{ t('webdavSync.scope.uiPreferences') }}</strong>
                </span>
                <el-switch v-model="scope.uiPreferences" />
              </label>
              <label>
                <span>
                  <strong>{{ t('webdavSync.scope.blockedTopSites') }}</strong>
                </span>
                <el-switch v-model="scope.blockedTopSites" />
              </label>
              <label>
                <span>
                  <strong>{{ t('webdavSync.scope.onlineWallpaperUrl') }}</strong>
                  <small>{{ t('webdavSync.scope.onlineWallpaperUrlNote') }}</small>
                </span>
                <el-switch v-model="scope.onlineWallpaperUrl" />
              </label>
              <label>
                <span>
                  <strong>{{ t('webdavSync.scope.userIcons') }}</strong>
                  <small>{{ t('webdavSync.scope.userIconsNote') }} </small>
                </span>
                <el-switch v-model="scope.userIcons" />
              </label>
              <label v-if="wallpaperInfo.count > 0">
                <span>
                  <strong>{{ t('webdavSync.scope.wallpapers') }}</strong>
                  <small>
                    {{
                      t('webdavSync.setup.wallpaper.summary', {
                        count: wallpaperInfo.count,
                        size: formattedWallpaperSize,
                      })
                    }}
                  </small>
                </span>
                <el-switch v-model="scope.wallpapers" />
              </label>
              <el-alert
                v-if="oversizedWallpaperCount"
                type="warning"
                :closable="false"
                show-icon
                :title="
                  t('webdavSync.setup.wallpaper.oversized', { count: oversizedWallpaperCount })
                "
                style="grid-column: 1 / -1; margin-top: 10px"
              />
            </div>
          </template>

          <template v-else-if="step === 4">
            <header>
              <h3>{{ comparisonTitle }}</h3>
            </header>
            <div class="comparison-summary">
              <template v-if="hasPreviewConflicts">
                <component :is="RoundWarningIcon" />
                <div>
                  <strong>
                    {{
                      t('webdavSync.setup.compare.conflicts', {
                        count: preview?.conflicts.length ?? 0,
                      })
                    }}
                  </strong>
                </div>
              </template>
              <template v-else>
                <component :is="CheckCircleRound" />
                <div>
                  <strong>{{ t('webdavSync.setup.compare.safe') }}</strong>
                </div>
              </template>
              <el-tag v-if="preview?.state !== 'empty'" type="warning">
                {{ t('webdavSync.setup.compare.existing') }}
              </el-tag>
            </div>
            <el-alert
              v-if="hasPreviewConflicts"
              type="warning"
              :closable="false"
              show-icon
              :title="t('webdavSync.setup.compare.firstConnectionNote')"
              style="margin-top: 10px"
            />
            <el-alert
              v-if="preview?.resourceOmissions.length"
              type="warning"
              :closable="false"
              show-icon
              :title="
                t('webdavSync.setup.scope.omittedResources', {
                  count: preview.resourceOmissions.length,
                })
              "
              style="margin-top: 10px"
            />
          </template>

          <template v-else>
            <header>
              <h3>{{ t('webdavSync.setup.confirm.title') }}</h3>
              <p>{{ t('webdavSync.setup.confirm.description') }}</p>
            </header>
            <div class="final-list">
              <p>
                <check-circle-round />
                <span>
                  <strong>{{ t('webdavSync.setup.connection.url') }}</strong>
                  <small>{{ form.url }} · {{ form.directory }}/</small>
                </span>
              </p>
              <p>
                <check-circle-round />
                <span>
                  <strong>{{ t('webdavSync.setup.connection.deviceName') }}</strong>
                  <small>{{ form.deviceName || t('webdavSync.setup.confirm.autoDevice') }}</small>
                </span>
              </p>
              <p>
                <lock-round />
                <span>
                  <strong>{{ t('webdavSync.encryption.title') }}</strong>
                  <small>
                    {{
                      effectiveEncryption
                        ? t('webdavSync.setup.confirm.encrypted')
                        : t('webdavSync.setup.confirm.plaintext')
                    }}
                  </small>
                </span>
              </p>
            </div>
          </template>
        </div>
      </el-scrollbar>

      <div class="setup-footer">
        <el-button v-if="step > 0" @click="step--">{{ t('webdavSync.setup.back') }}</el-button>
        <el-button @click="model = false">{{ t('newtab:common.cancel') }}</el-button>
        <el-button
          v-if="step < steps.length - 1"
          type="primary"
          :loading="testing"
          :disabled="!canContinue"
          @click="nextStep"
        >
          {{ t('webdavSync.setup.next') }}
        </el-button>
        <el-button
          v-else
          type="primary"
          :loading="connecting"
          :disabled="!canContinue"
          @click="finish"
        >
          {{ t('webdavSync.setup.finish') }}
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style lang="scss">
.webdav-setup-dialog {
  &.base-dialog {
    --el-dialog-width: min(650px, 93%);
    height: fit-content;
    max-height: 90dvh;
  }

  .base-dialog-container {
    display: flex;
    flex-direction: column;
  }

  .setup-steps {
    margin-bottom: 18px;
  }

  .el-scrollbar {
    flex: 0 1 auto;
    padding-right: 15px;

    .el-scrollbar__wrap {
      min-height: 250px;
      max-height: min(500px, calc(100dvh - 250px));
    }
  }

  header {
    margin-bottom: 16px;

    h3,
    p {
      margin: 0;
    }

    p {
      margin-top: 5px;
      color: var(--el-text-color-secondary);
    }
  }

  .setup-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .setup-advanced {
    --el-collapse-header-bg-color: transparent;
    --el-collapse-content-bg-color: transparent;
    --el-collapse-header-height: 22px;
    --el-collapse-header-font-size: var(--el-font-size-base);
    --el-collapse-header-text-color: var(--el-text-color-regular);
    margin-bottom: 18px;
    border: none;

    .el-collapse-item__header {
      margin-bottom: 8px;
    }

    .el-collapse-item__title {
      flex-grow: 0;
    }

    .el-collapse-item__content {
      padding-bottom: 0;
    }

    .el-collapse-item__wrap {
      border: none;
    }
  }

  .setup-note {
    margin: -10px 0 0 24px;
    font-size: var(--el-font-size-extra-small);
    color: var(--el-text-color-secondary);
  }

  .setup-result-card,
  .comparison-summary,
  .wallpaper-choice {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    padding: 18px;
    background: var(--settings-option-background, var(--el-fill-color-light));
    border: 1px solid var(--el-border-color);
    border-radius: var(--le-radius-inner, 12px);

    > svg {
      width: 30px;
      height: 30px;
      color: var(--el-color-primary);
    }

    p {
      margin: 4px 0 0;
      color: var(--el-text-color-secondary);
    }
  }

  .setup-scope-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;

    label {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      padding: 11px 12px;
      background: var(--settings-option-background, var(--el-fill-color-light));
      border-radius: var(--le-radius-inner, 10px);
    }

    span {
      display: grid;
      gap: 3px;
    }

    small {
      color: var(--el-text-color-secondary);
    }
  }

  .final-list {
    display: grid;
    gap: 8px;

    p {
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 10px;
      margin: 0;
      background: var(--settings-option-background, var(--el-fill-color-light));
      border-radius: var(--le-radius-inner, 10px);
    }

    svg {
      width: 22px;
      height: 22px;
      color: var(--el-color-success);
    }

    span {
      display: grid;
    }

    small {
      color: var(--el-text-color-secondary);
    }
  }

  .setup-footer {
    flex-shrink: 0;
    margin-top: 18px;
    margin-bottom: 24px;
    text-align: right;
  }

  @media (width <= 599px) {
    .setup-columns {
      grid-template-columns: 1fr;
      gap: 0;
    }

    .setup-result-card,
    .comparison-summary,
    .wallpaper-choice {
      grid-template-columns: auto minmax(0, 1fr);

      > .el-button,
      > .el-checkbox,
      > .el-tag {
        grid-column: 1 / -1;
      }
    }

    .setup-scope-list {
      grid-template-columns: 1fr;
    }
  }
}
</style>
