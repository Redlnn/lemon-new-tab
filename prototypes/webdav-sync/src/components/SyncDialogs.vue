<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref, watch } from 'vue'
import CloudOffRound from '~icons/ic/round-cloud-off'
import DevicesRound from '~icons/ic/round-devices'
import DownloadRound from '~icons/ic/round-download'
import ErrorRound from '~icons/ic/round-error'
import HistoryRound from '~icons/ic/round-history'
import LockRound from '~icons/ic/round-lock'
import SecurityRound from '~icons/ic/round-security'
import StorageRound from '~icons/ic/round-storage'
import WarningRound from '~icons/ic/round-warning'

import type {
  DialogName,
  PrototypeScenario,
  SyncPrototypeAdapter,
  SyncScopeDraft,
} from '../types'
import ConflictDialog from './ConflictDialog.vue'
import SetupWizard from './SetupWizard.vue'

const props = defineProps<{
  scenario: PrototypeScenario
  adapter: SyncPrototypeAdapter
}>()

const dialog = defineModel<DialogName>({ required: true })
const scope = defineModel<SyncScopeDraft>('scope', { required: true })
const encryptionPassword = ref('')
const newEncryptionPassword = ref('')
const compressionQuality = ref(82)
const deleteConfirmation = ref('')
const destructiveAction = ref<'disconnect' | 'reset' | 'delete'>('disconnect')
const repairChoice = ref<'local' | 'previous'>('previous')

function visible(name: Exclude<DialogName, null>) {
  return computed({
    get: () => dialog.value === name,
    set: (value: boolean) => {
      if (!value && dialog.value === name) dialog.value = null
      else if (value) dialog.value = name
    },
  })
}

const setupVisible = visible('setup')
const statusVisible = visible('status')
const conflictVisible = visible('conflicts')
const historyVisible = visible('history')
const devicesVisible = visible('devices')
const encryptionVisible = visible('encryption')
const disconnectVisible = visible('disconnect')
const compressionVisible = visible('compression')
const availabilityVisible = visible('availability')

const statusRows = computed(() => [
  { label: '本机基线', value: 'rev-10 · 已验证' },
  { label: '远端模式', value: '条件写入可用' },
  { label: '待处理任务', value: props.scenario.pendingChanges ? `${props.scenario.pendingChanges} 项` : '无' },
  { label: '历史策略', value: '保留最近 10 个完整版本' },
  { label: '客户端加密', value: props.scenario.encrypted ? '已开启' : '关闭' },
])

async function restoreRevision(id: string) {
  try {
    await ElMessageBox.confirm(
      '旧版本不会覆盖历史文件，而会作为一个新的最新版本提交。当前壁纸不可用时会保留本机壁纸。',
      '恢复这个历史版本？',
      { confirmButtonText: '查看差异并恢复', cancelButtonText: '取消', type: 'warning' },
    )
    ElMessage.success(`原型：已准备从 ${id} 创建新的恢复版本`)
  } catch {}
}

function unlock() {
  if (!encryptionPassword.value) return
  ElMessage.success('原型：同步库已解锁，派生密钥将只保存在当前浏览器配置文件')
  encryptionVisible.value = false
}

function startEncryptionMigration() {
  if (newEncryptionPassword.value.length < 8) return
  ElMessage.success('原型：将创建新加密代际，验证完成前旧代际保持有效')
  encryptionVisible.value = false
}

function confirmDangerousAction() {
  if (destructiveAction.value === 'delete' && deleteConfirmation.value !== '删除云端同步数据') return
  const messages = {
    disconnect: '原型：已选择保留云端数据并断开',
    reset: '原型：将创建新的重置代际，其他设备会先暂停并询问',
    delete: '原型：仅删除具有正确所有权标记的 LemonNewTab/ 目录',
  }
  ElMessage.success(messages[destructiveAction.value])
  disconnectVisible.value = false
}

function confirmCompression() {
  ElMessage.success('原型：会先上传并验证候选版本，提交成功后才替换本机原图')
  compressionVisible.value = false
}

watch(disconnectVisible, (opened) => {
  if (!opened) return
  destructiveAction.value = 'disconnect'
  deleteConfirmation.value = ''
})
</script>

<template>
  <SetupWizard
    v-model="setupVisible"
    v-model:scope="scope"
    :scenario="scenario"
    :adapter="adapter"
  />
  <ConflictDialog v-model="conflictVisible" :scenario="scenario" :adapter="adapter" />

  <el-dialog v-model="statusVisible" title="同步状态" width="620px" class="prototype-dialog">
    <div class="status-dialog-heading">
      <component
        :is="['synced', 'permission'].includes(scenario.status) ? StorageRound : WarningRound"
      />
      <div><strong>{{ scenario.statusLabel }}</strong><span>{{ scenario.summary }}</span></div>
    </div>
    <dl class="status-details">
      <div v-for="row in statusRows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
    </dl>
    <el-alert
      v-if="['conflict', 'corrupted', 'format-newer', 'storage-full'].includes(scenario.status)"
      type="error"
      :closable="false"
      show-icon
      title="上传和自动应用已暂停"
    >
      {{ scenario.detail }}
    </el-alert>
    <template #footer>
      <el-button @click="statusVisible = false">关闭</el-button>
      <el-button
        type="primary"
        :disabled="['conflict', 'corrupted', 'format-newer'].includes(scenario.status)"
        @click="adapter.syncNow(scenario.id).then((result) => ElMessage.success(result.message))"
      >
        立即同步
      </el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="historyVisible" title="历史版本" width="760px" class="prototype-dialog">
    <div class="history-toolbar">
      <div><history-round /><span><strong>保留最近 10 个完整版本</strong><small>可调整为 2–20</small></span></div>
      <el-input-number :model-value="10" :min="2" :max="20" controls-position="right" />
    </div>
    <el-alert
      v-if="scenario.history[0]?.integrity === 'corrupted'"
      type="error"
      :closable="false"
      show-icon
      title="最新版本损坏，已停止自动同步"
      class="history-corruption-alert"
    >
      先下载原始文件留存，再选择本机数据或上一份完整云端数据作为新的最新版本。
      <div class="alert-actions">
        <el-button size="small" :icon="DownloadRound">下载原始文件</el-button>
        <el-button size="small" type="primary">比较并修复</el-button>
      </div>
    </el-alert>
    <div class="history-list">
      <article
        v-for="revision in scenario.history"
        :key="revision.id"
        :class="{ corrupted: revision.integrity === 'corrupted' }"
      >
        <component :is="revision.integrity === 'corrupted' ? ErrorRound : HistoryRound" />
        <div>
          <strong>{{ revision.time }} · {{ revision.reason }}</strong>
          <span>{{ revision.device }}</span>
          <small>{{ revision.summary }}</small>
          <el-tag v-if="!revision.wallpaperAvailable" size="small" type="info" effect="plain">
            该历史壁纸未保留
          </el-tag>
        </div>
        <el-button
          v-if="revision.integrity === 'complete'"
          size="small"
          @click="restoreRevision(revision.id)"
        >
          查看差异
        </el-button>
      </article>
    </div>
    <div v-if="scenario.history[0]?.integrity === 'corrupted'" class="repair-choice">
      <strong>修复后使用</strong>
      <el-radio-group v-model="repairChoice">
        <el-radio value="previous">云端上一份完整版本</el-radio>
        <el-radio value="local">当前本机数据</el-radio>
      </el-radio-group>
    </div>
  </el-dialog>

  <el-dialog v-model="devicesVisible" title="已同步设备" width="650px" class="prototype-dialog">
    <div class="device-list">
      <article v-for="device in scenario.devices" :key="device.id">
        <devices-round />
        <div><strong>{{ device.name }}</strong><span>首次同步：{{ device.firstSeen }}</span></div>
        <div><strong>{{ device.lastSeen }}</strong><el-tag v-if="device.status === 'stale'" type="warning" size="small">超过 180 天</el-tag></div>
      </article>
    </div>
    <el-alert type="warning" :closable="false" show-icon title="看到不认识的设备？">
      WebDAV 凭据可能已经泄露。请在服务商处更换密码或应用专用密码，并在可信设备上重新连接。删除一条设备记录不能撤销访问权限。
    </el-alert>
  </el-dialog>

  <el-dialog v-model="encryptionVisible" title="客户端加密" width="600px" class="prototype-dialog">
    <div class="encryption-heading"><security-round /><div><strong>{{ scenario.encrypted ? '此同步库已加密' : '加密默认关闭' }}</strong><span>加密密码独立于 WebDAV 登录密码，忘记后无法找回。</span></div></div>
    <template v-if="scenario.status === 'encrypted-locked'">
      <el-form-item label="独立同步加密密码">
        <el-input v-model="encryptionPassword" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-alert type="info" :closable="false">成功后本机保存不可导出的派生密钥，以支持后台同步。密码不会上传、导出或写入日志。</el-alert>
    </template>
    <template v-else>
      <div class="encryption-facts">
        <div><lock-round /><span><strong>保护个人内容</strong><small>网址、设备名称、时间、设置、摘要和资源信息进入密文</small></span></div>
        <div><storage-round /><span><strong>服务商仍可见</strong><small>账号、连接时间、目录存在和传输大小</small></span></div>
      </div>
      <el-form-item :label="scenario.encrypted ? '新的同步加密密码' : '设置独立同步加密密码'">
        <el-input v-model="newEncryptionPassword" type="password" show-password />
      </el-form-item>
      <el-alert type="warning" :closable="false">切换加密状态或修改密码会创建新代际。完整验证最近版本和当前壁纸后才会切换。</el-alert>
    </template>
    <template #footer>
      <el-button @click="encryptionVisible = false">取消</el-button>
      <el-button v-if="scenario.status === 'encrypted-locked'" type="primary" :disabled="!encryptionPassword" @click="unlock">解锁同步库</el-button>
      <el-button v-else type="primary" :disabled="newEncryptionPassword.length < 8" @click="startEncryptionMigration">开始安全迁移</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="disconnectVisible" title="断开、重置或删除" width="650px" class="prototype-dialog danger-dialog">
    <el-radio-group v-model="destructiveAction" class="danger-options">
      <label :class="{ active: destructiveAction === 'disconnect' }"><el-radio value="disconnect"><strong>保留云端数据并断开</strong></el-radio><span>清除本机连接配置，其他设备不受影响。</span></label>
      <label :class="{ active: destructiveAction === 'reset' }"><el-radio value="reset"><strong>把重置同步到其他设备</strong></el-radio><span>创建新代际；其他设备会暂停并询问是否应用。</span></label>
      <label class="danger" :class="{ active: destructiveAction === 'delete' }"><el-radio value="delete"><strong>删除整个云端同步库</strong></el-radio><span>只删除具有正确所有权标记的 LemonNewTab/，并立即断开。</span></label>
    </el-radio-group>
    <div v-if="destructiveAction === 'delete'" class="typed-confirmation">
      <el-alert type="error" :closable="false" show-icon title="将影响 3 台设备和 10 个历史版本">删除失败时会保留本机连接配置以便重试；其他设备不会自动重建目录。</el-alert>
      <label>请输入 <strong>删除云端同步数据</strong> 继续</label>
      <el-input v-model="deleteConfirmation" autocomplete="off" />
    </div>
    <template #footer>
      <el-button @click="disconnectVisible = false">取消</el-button>
      <el-button
        :type="destructiveAction === 'delete' ? 'danger' : 'primary'"
        :disabled="destructiveAction === 'delete' && deleteConfirmation !== '删除云端同步数据'"
        @click="confirmDangerousAction"
      >
        {{ destructiveAction === 'disconnect' ? '保留云端并断开' : destructiveAction === 'reset' ? '确认同步重置' : '永久删除并断开' }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="compressionVisible" title="压缩浅色壁纸" width="720px" class="prototype-dialog">
    <el-alert type="warning" :closable="false" show-icon title="原图超过 20 MB，当前不会同步">压缩候选会先上传并校验；新版本提交成功后才替换本机原图。</el-alert>
    <div class="compression-comparison">
      <figure><div class="wallpaper-sample wallpaper-sample--original"></div><figcaption><strong>原图</strong><span>24.3 MB · 7680 × 4320 · PNG</span></figcaption></figure>
      <figure><div class="wallpaper-sample wallpaper-sample--compressed"></div><figcaption><strong>压缩候选</strong><span>{{ (7.8 + (compressionQuality - 70) * 0.12).toFixed(1) }} MB · 3840 × 2160 · WebP</span></figcaption></figure>
    </div>
    <div class="compression-quality"><span>质量</span><el-slider v-model="compressionQuality" :min="70" :max="92" /><strong>{{ compressionQuality }}%</strong></div>
    <el-alert type="info" :closable="false">只压缩可可靠解码的静态图片。GIF、APNG、动画 WebP、超大像素图片和视频不会在扩展内处理。</el-alert>
    <template #footer><el-button @click="compressionVisible = false">保留原图，暂不同步</el-button><el-button type="primary" @click="confirmCompression">确认候选并安全上传</el-button></template>
  </el-dialog>

  <el-dialog v-model="availabilityVisible" title="哪些内容会同步？" width="700px" class="prototype-dialog">
    <div class="availability-list">
      <article><storage-round /><div><strong>默认同步</strong><span>设置、快速导航及图标、自定义搜索引擎、语言和颜色模式</span></div><el-tag type="success">已包含</el-tag></article>
      <article><cloud-off-round /><div><strong>由你选择</strong><span>搜索记录、隐藏站点、当前浅色/深色图片壁纸</span></div><el-tag type="info">默认关闭</el-tag></article>
      <article><cloud-off-round /><div><strong>始终只保存在本机</strong><span>视频、浏览器书签、权限、favicon/在线/Bing 缓存、Token 和密码</span></div><el-tag type="info">不会上传</el-tag></article>
      <article><warning-round /><div><strong>等待此设备授权</strong><span>同步的是“希望启用”的偏好，不会复制浏览器权限</span></div><el-tag type="warning">需要操作</el-tag></article>
    </div>
    <p class="availability-note"><cloud-off-round /> 图标只表示某项内容当前不会同步或不能在此设备直接应用；网络失败和整体暂停会显示在同步状态中。</p>
  </el-dialog>
</template>
