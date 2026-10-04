import { browser } from 'wxt/browser'

import type { WebDavSyncMessage } from './messages.ts'

export function sendSyncDataChanged(): void {
  void browser.runtime
    .sendMessage({ type: 'webdav-sync:data-changed' } satisfies WebDavSyncMessage)
    .catch(() => undefined)
}

export async function prepareSyncBeforeNewTabStartup(): Promise<void> {
  // 导入日志不属于云端同步状态；每次启动均检查，恢复失败也不能阻断本机界面。
  await browser.runtime
    .sendMessage({
      type: 'webdav-sync:resume-apply',
    } satisfies WebDavSyncMessage)
    .catch(() => undefined)
  void browser.runtime
    .sendMessage({ type: 'webdav-sync:natural' } satisfies WebDavSyncMessage)
    .catch(() => undefined)
}

export function setupOnlineSyncTrigger(): () => void {
  const listener = () => {
    void browser.runtime
      .sendMessage({ type: 'webdav-sync:online' } satisfies WebDavSyncMessage)
      .catch(() => undefined)
  }
  window.addEventListener('online', listener)
  return () => window.removeEventListener('online', listener)
}
