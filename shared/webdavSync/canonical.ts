import type { JsonObject, JsonValue } from './types.ts'

function normalizeJsonValue(value: unknown, seen: Set<object>): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Sync data contains a non-finite number')
    return value
  }
  if (typeof value !== 'object') throw new TypeError('Sync data contains a non-JSON value')
  if (seen.has(value)) throw new TypeError('Sync data contains a cycle')

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeJsonValue(item, seen))
    }

    const result: JsonObject = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) {
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          value: normalizeJsonValue(item, seen),
          writable: true,
        })
      }
    }
    return result
  } finally {
    seen.delete(value)
  }
}

export function canonicalize(value: unknown): JsonValue {
  return normalizeJsonValue(value, new Set())
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).byteLength
}

export function jsonEquals(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

export async function sha256Hex(value: ArrayBuffer | ArrayBufferView | string): Promise<string> {
  let bytes: Uint8Array<ArrayBuffer>
  if (typeof value === 'string') {
    bytes = new TextEncoder().encode(value)
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.byteLength)
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  } else {
    bytes = new Uint8Array(value)
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hashCanonicalJson(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value))
}
