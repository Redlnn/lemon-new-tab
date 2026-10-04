export type WebDavErrorCategory =
  | 'unknown'
  | 'data-too-large'
  | 'permission-required'
  | 'authentication'
  | 'conflict'
  | 'corrupted'
  | 'forbidden'
  | 'foreign-vault'
  | 'format-too-new'
  | 'generation-reset'
  | 'insecure-http'
  | 'encryption-locked'
  | 'invalid-response'
  | 'locked'
  | 'network'
  | 'not-found'
  | 'precondition'
  | 'rate-limited'
  | 'redirect-cross-origin'
  | 'redirect-insecure'
  | 'redirect-required'
  | 'response-too-large'
  | 'server'
  | 'storage-full'
  | 'timeout'
  | 'unsupported'

export class WebDavError extends Error {
  readonly category: WebDavErrorCategory
  readonly status?: number

  constructor(category: WebDavErrorCategory, message: string, status?: number) {
    super(message)
    this.name = 'WebDavError'
    this.category = category
    this.status = status
  }
}

export interface SerializedWebDavError {
  category: WebDavErrorCategory
  status?: number
}

/** 只跨扩展消息边界传递决策所需字段，避免带出地址或凭据。 */
export function serializeWebDavError(error: unknown): SerializedWebDavError {
  if (!(error instanceof WebDavError)) return { category: 'unknown' }
  return {
    category: error.category,
    ...(error.status === undefined ? {} : { status: error.status }),
  }
}

export function deserializeWebDavError(error: SerializedWebDavError): WebDavError {
  return new WebDavError(error.category, 'WebDAV operation failed', error.status)
}

export function webDavErrorKey(error: unknown): string {
  const category = error instanceof WebDavError ? error.category : 'unknown'
  const setup: Partial<Record<WebDavErrorCategory, string>> = {
    forbidden: 'permission',
    'encryption-locked': 'encryption',
    'foreign-vault': 'foreign',
    'format-too-new': 'format',
    unsupported: 'unsupported',
  }
  return setup[category]
    ? `webdavSync.setup.errors.${setup[category]}`
    : `webdavSync.errors.${category}`
}
