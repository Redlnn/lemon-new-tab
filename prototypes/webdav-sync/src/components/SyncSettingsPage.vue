<script setup lang="ts">
import { computed } from 'vue'
import CheckCircleRound from '~icons/ic/round-check-circle'
import ChevronRightRound from '~icons/ic/round-chevron-right'
import CloudOffRound from '~icons/ic/round-cloud-off'
import CloudSyncRound from '~icons/ic/round-cloud-sync'
import DeleteForeverRound from '~icons/ic/round-delete-forever'
import DevicesRound from '~icons/ic/round-devices'
import ErrorRound from '~icons/ic/round-error'
import HistoryRound from '~icons/ic/round-history'
import InfoRound from '~icons/ic/round-info'
import KeyRound from '~icons/ic/round-key'
import LockRound from '~icons/ic/round-lock'
import SettingsBackupRestoreRound from '~icons/ic/round-settings-backup-restore'
import WarningRound from '~icons/ic/round-warning'

import type { DialogName, PrototypeScenario, SyncScopeDraft } from '../types'

const props = defineProps<{
  scenario: PrototypeScenario
  scope: SyncScopeDraft
}>()

const emit = defineEmits<{
  open: [dialog: DialogName]
  sync: []
  'update:scope': [scope: SyncScopeDraft]
}>()

const statusTone = computed(() => {
  if (props.scenario.status === 'synced' || props.scenario.status === 'permission') return 'success'
  if (props.scenario.status === 'pending' || props.scenario.status === 'wallpaper') return 'warning'
  if (props.scenario.status === 'unconfigured') return 'neutral'
  return 'danger'
})

const statusIcon = computed(() => {
  if (statusTone.value === 'success') return CheckCircleRound
  if (statusTone.value === 'warning') return WarningRound
  if (statusTone.value === 'danger') return ErrorRound
  return CloudSyncRound
})

const primaryAction = computed<DialogName>(() => {
  switch (props.scenario.status) {
    case 'unconfigured':
    case 'pending':
      return 'setup'
    case 'conflict':
      return 'conflicts'
    case 'corrupted':
      return 'history'
    case 'encrypted-locked':
      return 'encryption'
    case 'wallpaper':
      return 'compression'
    default:
      return 'status'
  }
})

const primaryLabel = computed(() => {
  switch (props.scenario.status) {
    case 'unconfigured':
      return '设置 WebDAV'
    case 'pending':
      return '继续首次比较'
    case 'conflict':
      return '解决冲突'
    case 'corrupted':
      return '查看修复选项'
    case 'encrypted-locked':
      return '输入加密密码'
    case 'wallpaper':
      return '预览压缩'
    default:
      return '查看详情'
  }
})

function updateScope(key: keyof SyncScopeDraft, value: boolean) {
  emit('update:scope', { ...props.scope, [key]: value })
}
</script>

<template>
  <div class="sync-page">
    <el-alert type="warning" :closable="false" show-icon class="experimental-alert">
      <template #title>WebDAV 同步仍在测试中</template>
      它会把你选择的数据保存到自己的 WebDAV 空间。首次启用前，建议先导出一份本地备份。
    </el-alert>

    <section class="sync-status-card" :class="`sync-status-card--${statusTone}`">
      <component :is="statusIcon" class="sync-status-card__icon" aria-hidden="true" />
      <div class="sync-status-card__copy">
        <span>{{ scenario.statusLabel }}</span>
        <strong>{{ scenario.summary }}</strong>
        <p>{{ scenario.detail }}</p>
        <small v-if="scenario.lastSuccess">上次成功：{{ scenario.lastSuccess }}</small>
      </div>
      <div class="sync-status-card__actions">
        <el-button type="primary" @click="emit('open', primaryAction)">
          {{ primaryLabel }}
        </el-button>
        <el-button
          v-if="scenario.status !== 'unconfigured' && scenario.status !== 'format-newer'"
          :disabled="['conflict', 'corrupted', 'encrypted-locked'].includes(scenario.status)"
          @click="emit('sync')"
        >
          立即同步
        </el-button>
      </div>
    </section>

    <div v-if="scenario.status !== 'unconfigured'" class="sync-page__grid">
      <section class="settings-section-card sync-scope-card">
        <header>
          <div>
            <strong>同步范围</strong>
            <small>核心数据始终同步，可随时调整隐私相关内容</small>
          </div>
          <el-button text type="primary" @click="emit('open', 'availability')">查看说明</el-button>
        </header>

        <div class="sync-row">
          <div>
            <span>设置、快速导航和搜索引擎</span>
            <small>约 {{ scenario.coreSize }}</small>
          </div>
          <el-tag type="success" effect="plain">始终同步</el-tag>
        </div>
        <div class="sync-row">
          <div>
            <span>最近搜索记录</span>
            <small>可能包含你输入过的内容</small>
          </div>
          <el-tooltip
            v-if="!scope.searchHistory"
            content="搜索记录仅保存在此设备。可在这里开启同步。"
          >
            <cloud-off-round class="cloud-off-icon" aria-label="搜索记录未同步" />
          </el-tooltip>
          <el-switch
            :model-value="scope.searchHistory"
            @change="updateScope('searchHistory', $event as boolean)"
          />
        </div>
        <div class="sync-row">
          <div>
            <span>隐藏的常访问站点</span>
            <small>可能反映浏览行为</small>
          </div>
          <el-tooltip v-if="!scope.blockedTopSites" content="隐藏记录仅保存在此设备。">
            <cloud-off-round class="cloud-off-icon" aria-label="隐藏站点未同步" />
          </el-tooltip>
          <el-switch
            :model-value="scope.blockedTopSites"
            @change="updateScope('blockedTopSites', $event as boolean)"
          />
        </div>
        <div v-if="scenario.wallpaper.count" class="sync-row">
          <div>
            <span>当前本地图片壁纸</span>
            <small>{{ scenario.wallpaper.count }} 张，共 {{ scenario.wallpaper.totalSize }}</small>
          </div>
          <el-tooltip
            v-if="!scope.wallpapers || scenario.wallpaper.tooLarge"
            :content="
              scenario.wallpaper.tooLarge
                ? '浅色壁纸超过 20 MB，其他数据仍会同步。'
                : '图片壁纸只保存在此设备。'
            "
          >
            <cloud-off-round class="cloud-off-icon" aria-label="壁纸未完全同步" />
          </el-tooltip>
          <el-switch
            :model-value="scope.wallpapers"
            @change="updateScope('wallpapers', $event as boolean)"
          />
        </div>
        <el-collapse class="scope-advanced-collapse">
          <el-collapse-item name="advanced-scope">
            <template #title>
              <span class="scope-advanced-collapse__title">
                <strong>高级范围</strong>
                <small>2 项，默认开启</small>
              </span>
            </template>
            <div class="sync-row">
              <div>
                <span>在线/API 壁纸地址</span>
                <small>地址可能包含访问 Token；不上传图片缓存</small>
              </div>
              <el-tooltip v-if="!scope.onlineWallpaperUrl" content="在线壁纸地址仅保存在此设备。">
                <cloud-off-round class="cloud-off-icon" aria-label="在线壁纸地址未同步" />
              </el-tooltip>
              <el-switch
                :model-value="scope.onlineWallpaperUrl"
                @change="updateScope('onlineWallpaperUrl', $event as boolean)"
              />
            </div>
            <div class="sync-row">
              <div>
                <span>快速导航内嵌图标</span>
                <small>只同步你明确选择的图标；缓存和自动图标不会上传</small>
              </div>
              <el-tooltip v-if="!scope.quickLinkIcons" content="用户选择的快速导航图标仅保存在此设备。">
                <cloud-off-round class="cloud-off-icon" aria-label="快速导航图标未同步" />
              </el-tooltip>
              <el-switch
                :model-value="scope.quickLinkIcons"
                @change="updateScope('quickLinkIcons', $event as boolean)"
              />
            </div>
          </el-collapse-item>
        </el-collapse>
      </section>

      <section class="settings-section-card sync-tools-card">
        <header>
          <div>
            <strong>管理</strong>
            <small>按需加载，不影响新标签页启动</small>
          </div>
        </header>
        <div class="sync-tool-buttons">
          <button type="button" @click="emit('open', 'status')">
            <info-round />
            <span>同步状态</span>
          </button>
          <button type="button" @click="emit('open', 'history')">
            <history-round />
            <span>历史版本</span>
          </button>
          <button type="button" @click="emit('open', 'devices')">
            <devices-round />
            <span>设备</span>
          </button>
          <button type="button" @click="emit('open', 'encryption')">
            <lock-round />
            <span>客户端加密</span>
          </button>
        </div>
      </section>

      <section v-if="scenario.status === 'permission'" class="settings-section-card sync-wide-card">
        <header>
          <div>
            <strong>此设备等待授权</strong>
            <small>设置意图已经同步，授权状态不会上传</small>
          </div>
        </header>
        <div class="permission-waiting-list">
          <div>
            <key-round />
            <span><strong>Monet 壁纸取色</strong><small>需要访问当前壁纸来源</small></span>
            <el-button>了解并授权</el-button>
          </div>
          <div>
            <key-round />
            <span><strong>网站图标缓存</strong><small>需要读取网站图标</small></span>
            <el-button>了解并授权</el-button>
          </div>
        </div>
      </section>

      <section class="sync-secondary-actions sync-wide-card">
        <el-collapse class="legacy-collapse">
          <el-collapse-item name="legacy">
            <template #title>
              <span class="compact-action-title">
                <settings-backup-restore-round aria-hidden="true" />
                <span>
                  <strong>旧版浏览器云同步数据</strong>
                  <small>下载或清理旧版残留；不会上传到 WebDAV</small>
                </span>
              </span>
            </template>
            <div class="legacy-compact-content">
              <p>仅用于处理旧版浏览器同步残留，不会恢复已经停止支持的同步功能。</p>
              <span>
                <el-button size="small">下载旧数据</el-button>
                <el-button size="small">清理旧数据</el-button>
              </span>
            </div>
          </el-collapse-item>
        </el-collapse>

        <button
          type="button"
          class="compact-connection-action"
          @click="emit('open', 'disconnect')"
        >
          <delete-forever-round aria-hidden="true" />
          <span>
            <strong>连接与远端数据</strong>
            <small>断开、同步重置或删除同步库</small>
          </span>
          <chevron-right-round aria-hidden="true" />
        </button>
      </section>
    </div>

    <section v-else class="settings-section-card unconfigured-help">
      <div>
        <cloud-sync-round />
        <span>
          <strong>开始前会发生什么？</strong>
          <small>测试连接 → 扫描远端 → 选择范围 → 查看差异 → 最终确认</small>
        </span>
      </div>
      <ul>
        <li>连接测试成功不会自动上传。</li>
        <li>远端非空且不是柠檬起始页目录时会拒绝接管。</li>
        <li>默认只同步设置、快速导航、搜索引擎和界面偏好。</li>
      </ul>
    </section>
  </div>
</template>
