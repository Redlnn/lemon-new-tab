<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, reactive, watch } from 'vue'
import CallMergeRound from '~icons/ic/round-call-merge'
import ComputerRound from '~icons/ic/round-computer'
import StorageRound from '~icons/ic/round-storage'

import type { PrototypeScenario, SyncPrototypeAdapter } from '../types'

const props = defineProps<{
  scenario: PrototypeScenario
  adapter: SyncPrototypeAdapter
}>()

const model = defineModel<boolean>({ required: true })
const resolutions = reactive<Record<string, string>>({})
const resolvedCount = computed(
  () => props.scenario.conflicts.filter((conflict) => resolutions[conflict.id]).length,
)
const allResolved = computed(
  () => props.scenario.conflicts.length > 0 && resolvedCount.value === props.scenario.conflicts.length,
)

async function submit() {
  const result = await props.adapter.resolveConflicts(resolutions)
  ElMessage.success(result.message)
  model.value = false
}

watch(model, (visible) => {
  if (!visible) return
  for (const key of Object.keys(resolutions)) delete resolutions[key]
})
</script>

<template>
  <el-dialog
    v-model="model"
    title="解决同步冲突"
    width="820px"
    class="prototype-dialog conflict-dialog"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-alert type="warning" :closable="false" show-icon>
      <template #title>同步保持暂停，直到全部冲突得到处理</template>
      可以先关闭此窗口；选择不会超时。重新打开时会先扫描远端并重新计算差异。
    </el-alert>

    <div class="conflict-summary">
      <call-merge-round />
      <div><strong>安全部分已经自动合并</strong><span>仍有 {{ scenario.conflicts.length }} 项需要决定</span></div>
      <el-progress
        type="circle"
        :width="48"
        :stroke-width="5"
        :percentage="scenario.conflicts.length ? (resolvedCount / scenario.conflicts.length) * 100 : 0"
        :show-text="false"
      />
    </div>

    <div class="conflict-list">
      <article v-for="conflict in scenario.conflicts" :key="conflict.id" class="conflict-item">
        <header>
          <div><el-tag size="small" effect="plain">{{ conflict.category }}</el-tag><strong>{{ conflict.label }}</strong></div>
          <small>{{ conflict.modifiedAt }}</small>
        </header>
        <div class="conflict-item__base"><span>共同基线</span><code>{{ conflict.base }}</code></div>
        <div class="conflict-choices">
          <label :class="{ selected: resolutions[conflict.id] === 'local' }">
            <el-radio v-model="resolutions[conflict.id]" value="local">
              <computer-round /> 使用本机
            </el-radio>
            <strong>{{ conflict.local }}</strong>
            <small>{{ conflict.localDevice }}</small>
          </label>
          <label :class="{ selected: resolutions[conflict.id] === 'remote' }">
            <el-radio v-model="resolutions[conflict.id]" value="remote">
              <storage-round /> 使用云端
            </el-radio>
            <strong>{{ conflict.remote }}</strong>
            <small>{{ conflict.remoteDevice }}</small>
          </label>
          <label
            v-if="conflict.canKeepBoth"
            :class="{ selected: resolutions[conflict.id] === 'both' }"
          >
            <el-radio v-model="resolutions[conflict.id]" value="both">
              <call-merge-round /> 保留两份
            </el-radio>
            <strong>恢复删除项并保留修改后的副本</strong>
            <small>新副本会获得独立 ID</small>
          </label>
        </div>
      </article>
    </div>

    <template #footer>
      <div class="dialog-footer conflict-footer">
        <span>已处理 {{ resolvedCount }} / {{ scenario.conflicts.length }}</span>
        <el-button @click="model = false">暂不处理</el-button>
        <el-button type="primary" :disabled="!allResolved" @click="submit">
          查看影响并创建合并版本
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
