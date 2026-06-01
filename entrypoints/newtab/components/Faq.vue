<script setup lang="ts">
import '@newtab/styles/github-markdown.css'
import { TranslationComponent as i18next, useTranslation } from 'i18next-vue'
import Github from '~icons/fa6-brands/github'
import EmailRound from '~icons/ic/round-email'

import BaseDialog from '@newtab/components/BaseDialog.vue'
import { useDialog } from '@newtab/composables/useDialog'

const { opened, show, hide, toggle } = useDialog()
defineExpose({ show, hide, toggle })

const { t } = useTranslation('faq')

function handleEmailClick() {
  navigator.clipboard.writeText('redlnn@outlook.com')
  ElMessage.success(t('help.emailCopied'))
}
</script>

<template>
  <base-dialog v-model="opened" :title="t('newtab:menu.help')" acrylic opacity>
    <div class="issue-container noselect">
      <div>{{ t('help.title') }}</div>
      <div class="issue-links">
        <a
          class="issue-link"
          href="https://github.com/Redlnn/lemon-new-tab/issues/new"
          target="_blank"
        >
          <span class="issue-link-icon">
            <el-icon><Github /></el-icon>
          </span>
          <span>{{ t('help.github') }}</span>
        </a>
        <div class="issue-link" @click="handleEmailClick">
          <span class="issue-link-icon">
            <el-icon><EmailRound /></el-icon>
          </span>
          <span>{{ t('help.email') }}</span>
        </div>
      </div>
    </div>
    <div class="faq noselect">
      {{ t('title') }}
      <span style="margin-left: 5px; font-size: 0.9em; color: var(--el-text-color-secondary)">
        {{ t('subtitle') }}
      </span>
    </div>
    <div class="faq-container">
      <div class="faq-item">
        <div class="faq-item__title">{{ t('items.activateSearch.title') }}</div>
        <div class="markdown-body">
          <p>
            {{ t('items.activateSearch.content.intro') }}
          </p>
          <ul>
            <li>
              <i18next :translation="t('items.activateSearch.content.chrome')">
                <template #key>
                  <kbd>Tab</kbd>
                </template>
              </i18next>
            </li>
            <li>
              <i18next :translation="t('items.activateSearch.content.firefox')">
                <template #key>
                  <kbd>Tab</kbd>
                </template>
              </i18next>
            </li>
          </ul>
        </div>
      </div>
      <div class="faq-item">
        <div class="faq-item__title">{{ t('items.performance.title') }}</div>
        <div class="markdown-body">
          <ul>
            <li>{{ t('items.performance.content.item1') }}</li>
            <li>{{ t('items.performance.content.item2') }}</li>
          </ul>
        </div>
      </div>
      <div class="faq-item">
        <div class="faq-item__title">{{ t('items.restoreQuickLinks.title') }}</div>
        <div class="markdown-body">
          <p>{{ t('items.restoreQuickLinks.content') }}</p>
        </div>
      </div>
      <div class="faq-item">
        <div class="faq-item__title">{{ t('items.performance.title') }}</div>
        <div class="markdown-body">
          <ul>
            <li>{{ t('items.performance.content.item1') }}</li>
            <li>{{ t('items.performance.content.item2') }}</li>
          </ul>
        </div>
      </div>
      <div class="faq-item">
        <div class="faq-item__title">{{ t('items.chromeFooter.title') }}</div>
        <div class="markdown-body">
          <p>{{ t('items.chromeFooter.content.reason') }}</p>
          <p>{{ t('items.chromeFooter.content.step') }}</p>
          <p>
            {{ t('items.chromeFooter.content.reference') }}
            <a href="https://github.com/Redlnn/lemon-new-tab/issues/30" target="_blank">
              {{ t('items.chromeFooter.content.githubIssue') }}
            </a>
          </p>
        </div>
      </div>
      <div class="faq-item">
        <div class="faq-item__title">{{ t('items.browserFreeze.title') }}</div>
        <div class="markdown-body">
          <p>{{ t('items.browserFreeze.content.intro') }}</p>
          <ol>
            <li>{{ t('items.browserFreeze.content.step1') }}</li>
            <li>
              <p>
                <i18next :translation="t('items.browserFreeze.content.step2.text')">
                  <template #code1><code>Choose ANGLE graphics backend</code></template>
                  <template #code2><code>OpenGL</code></template>
                </i18next>
              </p>
              <blockquote>{{ t('items.browserFreeze.content.step2.note') }}</blockquote>
            </li>
            <li>{{ t('items.browserFreeze.content.step3') }}</li>
          </ol>
        </div>
      </div>
    </div>
  </base-dialog>
</template>

<style lang="scss">
.issue-container {
  padding-top: 1.3em;
}

.issue-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;

  .issue-link {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 130px;
    height: 46px;
    padding-left: 9px;
    color: var(--el-text-color-primary);
    text-decoration: none;
    cursor: pointer;
    background-color: var(--el-bg-color);
    border-radius: 15px;
    transition:
      background-color var(--el-transition-duration-fast) ease,
      transform var(--el-transition-duration-fast) ease;

    .issue-link-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      font-size: 18px;
      background-color: var(--el-fill-color-darker);
      border-radius: 8px;
      transition: background-color var(--el-transition-duration-fast) ease;

      html.colorful & {
        background-color: var(--el-color-primary-light-9);
      }

      html.dialog-transparent.colorful & {
        background-color: var(--el-color-primary-light-8);
      }
    }

    &:hover {
      background-color: var(--el-fill-color-lighter);
    }

    &:active {
      transform: scale(0.95);
    }

    html.colorful & {
      background-color: var(--el-color-primary-light-8);

      &:hover {
        background-color: var(--el-color-primary-light-7);

        .issue-link-icon {
          background-color: var(--el-color-primary-light-8);
        }
      }
    }

    html.dialog-transparent.colorful & {
      background-color: var(--el-color-primary-light-9);

      &:hover {
        background-color: var(--el-color-primary-light-7);

        .issue-link-icon {
          background-color: var(--el-color-primary-light-9);
        }
      }
    }
  }
}

.faq {
  margin-top: 1.3em;
}

.faq-container {
  margin-top: 10px;

  .faq-item {
    padding: 20px 22px;
    margin-bottom: 10px;
    background-color: var(--el-bg-color);
    border-radius: 15px;

    &:last-child {
      margin-bottom: 0;
    }

    &__title {
      font-weight: bold;
    }

    html.colorful & {
      background-color: var(--el-color-primary-light-8);
    }

    html.dialog-transparent.colorful & {
      background-color: var(--el-color-primary-light-9);
    }
  }
}
</style>
