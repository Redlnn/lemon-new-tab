<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, reactive, ref, watch } from 'vue'
import CheckCircleRound from '~icons/ic/round-check-circle'
import CloudDoneRound from '~icons/ic/round-cloud-done'
import LockRound from '~icons/ic/round-lock'

import type { PrototypeScenario, SyncPrototypeAdapter, SyncScopeDraft } from '../types'

const props = defineProps<{
  scenario: PrototypeScenario
  adapter: SyncPrototypeAdapter
}>()

const model = defineModel<boolean>({ required: true })
const scope = defineModel<SyncScopeDraft>('scope', { required: true })

const step = ref(0)
const testing = ref(false)
const connectionTested = ref(false)
const form = reactive({
  url: 'https://dav.example.com/remote.php/dav/files/lemon/',
  username: 'lemon',
  password: '',
  deviceName: '',
  directory: 'LemonNewTab/',
  rememberPassword: true,
  encrypted: false,
  encryptionPassword: '',
})

const steps = ['连接', '测试', '扫描', '范围', '壁纸', '比较', '确认']
const canContinue = computed(() => {
  if (step.value === 0) return Boolean(form.url && form.username && form.password)
  if (step.value === 1) return connectionTested.value
  if (step.value === 6 && form.encrypted) return form.encryptionPassword.length >= 8
  return true
})

async function testConnection() {
  testing.value = true
  try {
    await props.adapter.testConnection()
    connectionTested.value = true
    ElMessage.success('连接成功，已获得此服务器的精确访问权限')
  } finally {
    testing.value = false
  }
}

function finish() {
  ElMessage.success('原型：已确认开启 WebDAV 同步')
  model.value = false
}

watch(model, (visible) => {
  if (visible) {
    step.value = 0
    connectionTested.value = false
  }
})
</script>

<template>
  <el-dialog
    v-model="model"
    title="设置 WebDAV 同步"
    width="760px"
    class="prototype-dialog setup-dialog"
    :close-on-click-modal="false"
  >
    <el-steps :active="step" finish-status="success" align-center class="setup-steps">
      <el-step v-for="label in steps" :key="label" :title="label" />
    </el-steps>

    <div class="setup-step-content">
      <template v-if="step === 0">
        <div class="setup-heading">
          <h2>连接自己的网络存储</h2>
          <p>WebDAV 是你自己选择的网络存储。密码只保存在当前浏览器配置文件中。</p>
        </div>
        <el-form label-position="top" class="setup-form">
          <el-form-item label="服务器地址">
            <el-input v-model="form.url" placeholder="https://example.com/dav/" />
          </el-form-item>
          <div class="setup-form__columns">
            <el-form-item label="用户名">
              <el-input v-model="form.username" autocomplete="username" />
            </el-form-item>
            <el-form-item label="密码或应用专用密码">
              <el-input
                v-model="form.password"
                type="password"
                show-password
                autocomplete="current-password"
              />
            </el-form-item>
          </div>
          <el-form-item label="设备名称（可不填）">
            <el-input v-model="form.deviceName" placeholder="Chrome · Windows · A7K3" />
          </el-form-item>
          <el-collapse class="advanced-settings">
            <el-collapse-item title="高级设置" name="advanced">
              <el-form-item label="扩展专属目录">
                <el-input v-model="form.directory" />
              </el-form-item>
              <el-checkbox v-model="form.rememberPassword">记住密码并允许后台同步</el-checkbox>
              <el-checkbox v-model="form.encrypted">使用独立密码加密同步内容</el-checkbox>
            </el-collapse-item>
          </el-collapse>
        </el-form>
      </template>

      <template v-else-if="step === 1">
        <div class="setup-heading">
          <h2>测试连接并申请权限</h2>
          <p>只申请 <strong>https://dav.example.com/*</strong>，不会把访问所有网站作为同步前提。</p>
        </div>
        <div class="connection-test-card" :class="{ success: connectionTested }">
          <component :is="connectionTested ? CheckCircleRound : CloudDoneRound" />
          <div>
            <strong>{{ connectionTested ? '连接成功' : '尚未测试' }}</strong>
            <p>
              {{
                connectionTested
                  ? '服务器支持基础 WebDAV 操作，接下来将只读扫描目录。'
                  : '点击测试后浏览器会说明为什么需要访问这个地址。'
              }}
            </p>
          </div>
          <el-button type="primary" :loading="testing" @click="testConnection">
            {{ connectionTested ? '重新测试' : '测试连接' }}
          </el-button>
        </div>
      </template>

      <template v-else-if="step === 2">
        <div class="setup-heading">
          <h2>扫描远端目录</h2>
          <p>扫描阶段不会上传、删除或修改远端文件。</p>
        </div>
        <el-result
          :icon="scenario.remoteHasData ? 'warning' : 'success'"
          :title="scenario.remoteHasData ? '找到已有同步库' : '目录为空，可以创建新同步库'"
          :sub-title="
            scenario.remoteHasData
              ? '已验证所有权标记和最近完整版本，将在后续步骤比较本机数据。'
              : '只有最终确认后才会创建 LemonNewTab/ 和第一个版本。'
          "
        />
      </template>

      <template v-else-if="step === 3">
        <div class="setup-heading">
          <h2>选择同步范围</h2>
          <p>核心数据始终同步。可能包含浏览内容的数据默认关闭。</p>
        </div>
        <div class="scope-list">
          <div><span><strong>设置、快速导航和搜索引擎</strong><small>约 {{ scenario.coreSize }}</small></span><el-tag type="success">始终同步</el-tag></div>
          <div><span><strong>最近搜索记录</strong><small>可能包含你输入过的内容</small></span><el-switch v-model="scope.searchHistory" /></div>
          <div><span><strong>隐藏的常访问站点</strong><small>可能反映浏览行为</small></span><el-switch v-model="scope.blockedTopSites" /></div>
        </div>
        <el-collapse class="scope-options-collapse">
          <el-collapse-item title="高级范围（默认开启）" name="advanced-scope">
            <div class="scope-option-row">
              <span><strong>在线/API 壁纸地址</strong><small>地址可能包含访问 Token；图片缓存不会上传</small></span>
              <el-switch v-model="scope.onlineWallpaperUrl" />
            </div>
            <div class="scope-option-row">
              <span><strong>快速导航内嵌图标</strong><small>只同步用户明确选择的图标</small></span>
              <el-switch v-model="scope.quickLinkIcons" />
            </div>
          </el-collapse-item>
        </el-collapse>
      </template>

      <template v-else-if="step === 4">
        <div class="setup-heading">
          <h2>是否同步当前图片壁纸？</h2>
          <p>仅保存当前使用的静态图片，视频和历史壁纸不会上传。</p>
        </div>
        <el-empty v-if="scenario.wallpaper.count === 0" description="当前没有本地图片壁纸" />
        <div v-else class="wallpaper-choice">
          <div class="wallpaper-choice__preview"><span>浅色</span><strong>{{ scenario.wallpaper.lightSize }}</strong></div>
          <div class="wallpaper-choice__preview wallpaper-choice__preview--dark"><span>深色</span><strong>{{ scenario.wallpaper.darkSize }}</strong></div>
          <div class="wallpaper-choice__summary">
            <strong>{{ scenario.wallpaper.count }} 张，共 {{ scenario.wallpaper.totalSize }}</strong>
            <p>每张最多 20 MB。超过限制时只跳过该壁纸，其他数据继续同步。</p>
            <el-checkbox v-model="scope.wallpapers">同步这些图片壁纸</el-checkbox>
          </div>
        </div>
      </template>

      <template v-else-if="step === 5">
        <div class="setup-heading">
          <h2>{{ scenario.remoteHasData ? '比较本机与云端' : '确认初始上传内容' }}</h2>
          <p>时间只用于帮助识别设备，不会被用来自动判定哪一份获胜。</p>
        </div>
        <div v-if="scenario.remoteHasData" class="compare-columns">
          <section><small>本机 · Chrome · Windows · A7K3</small><strong>31 项设置</strong><span>18 个快速导航 · 3 个搜索引擎</span></section>
          <div class="compare-result"><check-circle-round /><strong>27 项可安全合并</strong><span>{{ scenario.conflicts.length }} 项需要选择</span></div>
          <section><small>云端 · Firefox · macOS · M2F8</small><strong>30 项设置</strong><span>19 个快速导航 · 3 个搜索引擎</span></section>
        </div>
        <div v-else class="initial-summary">
          <check-circle-round />
          <div><strong>核心数据 · {{ scenario.coreSize }}</strong><span>设置、快速导航、搜索引擎、语言和颜色模式</span></div>
          <div><strong>可选数据</strong><span>搜索记录 {{ scope.searchHistory ? '已选择' : '未选择' }} · 壁纸 {{ scope.wallpapers ? scenario.wallpaper.totalSize : '未选择' }} · 高级范围 {{ Number(scope.onlineWallpaperUrl) + Number(scope.quickLinkIcons) }}/2</span></div>
        </div>
        <el-alert
          v-if="scenario.conflicts.length"
          type="warning"
          :closable="false"
          title="有差异需要逐项确认；完成前不会上传或应用。"
        />
      </template>

      <template v-else>
        <div class="setup-heading">
          <h2>最终确认</h2>
          <p>确认后才会创建或更新远端同步库。本机没有未上传修改且远端继承已知基线时才会自动应用。</p>
        </div>
        <div class="final-check-list">
          <div><check-circle-round /><span><strong>服务器</strong><small>https://dav.example.com/ · LemonNewTab/</small></span></div>
          <div><check-circle-round /><span><strong>设备</strong><small>{{ form.deviceName || 'Chrome · Windows · A7K3' }}</small></span></div>
          <div><check-circle-round /><span><strong>范围</strong><small>核心数据{{ scope.searchHistory ? '、搜索记录' : '' }}{{ scope.blockedTopSites ? '、隐藏站点' : '' }}{{ scope.wallpapers ? '、当前图片壁纸' : '' }}{{ scope.onlineWallpaperUrl ? '、在线壁纸地址' : '' }}{{ scope.quickLinkIcons ? '、用户选择的快速导航图标' : '' }}</small></span></div>
          <div><lock-round /><span><strong>客户端加密</strong><small>{{ form.encrypted ? '已开启；忘记密码无法找回' : '关闭（默认）' }}</small></span></div>
        </div>
        <el-form-item v-if="form.encrypted" label="独立同步加密密码" class="encryption-confirm-field">
          <el-input v-model="form.encryptionPassword" type="password" show-password />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon>
          关闭同步时默认保留云端数据。删除云端目录需要另外输入确认文字。
        </el-alert>
      </template>
    </div>

    <template #footer>
      <div class="dialog-footer setup-footer">
        <el-button v-if="step > 0" @click="step--">上一步</el-button>
        <span></span>
        <el-button @click="model = false">取消</el-button>
        <el-button
          v-if="step < steps.length - 1"
          type="primary"
          :disabled="!canContinue"
          @click="step++"
        >
          下一步
        </el-button>
        <el-button v-else type="primary" :disabled="!canContinue" @click="finish">
          确认开启同步
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
