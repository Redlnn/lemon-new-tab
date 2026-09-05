import type { VaultEncryptionMetadataV1 } from './types.ts'

const MAGIC = new Uint8Array([0x4c, 0x4e, 0x45, 0x01])
const IV_BYTES = 12
export const MIN_PBKDF2_ITERATIONS = 600_000
export const MAX_PBKDF2_ITERATIONS = 2_000_000
const encoder = new TextEncoder()

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
  }
  return btoa(chunks.join(''))
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error('Encrypted metadata contains invalid Base64')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function createEncryptionAad(input: {
  vaultId: string
  generationId: string
  objectType: 'asset' | 'device' | 'key-check' | 'revision'
  objectId: string
}): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `lemon-new-tab\0v1\0${input.vaultId}\0${input.generationId}\0${input.objectType}\0${input.objectId}`,
  )
}

export async function deriveEncryptionKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  if (!password) throw new Error('Encryption password is required')
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new Error('PBKDF2 iteration count is unsafe')
  }
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt', 'encrypt'],
  )
}

export async function encryptSyncBytes(
  key: CryptoKey,
  plaintext: ArrayBuffer | ArrayBufferView<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const source = ArrayBuffer.isView(plaintext)
    ? new Uint8Array(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
    : new Uint8Array(plaintext)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      key,
      source,
    ),
  )
  const envelope = new Uint8Array(MAGIC.byteLength + iv.byteLength + ciphertext.byteLength)
  envelope.set(MAGIC, 0)
  envelope.set(iv, MAGIC.byteLength)
  envelope.set(ciphertext, MAGIC.byteLength + iv.byteLength)
  return envelope
}

export async function decryptSyncBytes(
  key: CryptoKey,
  envelope: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    envelope.byteLength < MAGIC.byteLength + IV_BYTES + 16 ||
    !MAGIC.every((value, index) => envelope[index] === value)
  ) {
    throw new Error('Encrypted payload header is invalid')
  }
  const iv = envelope.slice(MAGIC.byteLength, MAGIC.byteLength + IV_BYTES)
  const ciphertext = envelope.slice(MAGIC.byteLength + IV_BYTES)
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
        key,
        ciphertext,
      ),
    )
  } catch {
    throw new Error('Encryption password is incorrect or data was modified')
  }
}

export async function createVaultEncryption(
  password: string,
  vaultId: string,
  generationId: string,
  iterations = MIN_PBKDF2_ITERATIONS,
): Promise<{ key: CryptoKey; metadata: VaultEncryptionMetadataV1 }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveEncryptionKey(password, salt, iterations)
  const keyCheck = await encryptSyncBytes(
    key,
    encoder.encode('lemon-new-tab-key-check-v1'),
    createEncryptionAad({ vaultId, generationId, objectType: 'key-check', objectId: 'v1' }),
  )
  return {
    key,
    metadata: {
      algorithm: 'AES-256-GCM',
      kdf: 'PBKDF2-HMAC-SHA-256',
      iterations,
      salt: bytesToBase64(salt),
      keyCheck: bytesToBase64(keyCheck),
    },
  }
}

export async function unlockVaultEncryption(
  password: string,
  vaultId: string,
  generationId: string,
  metadata: VaultEncryptionMetadataV1,
): Promise<CryptoKey> {
  if (
    metadata.algorithm !== 'AES-256-GCM' ||
    metadata.kdf !== 'PBKDF2-HMAC-SHA-256' ||
    metadata.iterations < MIN_PBKDF2_ITERATIONS ||
    metadata.iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new Error('Encrypted vault uses unsupported parameters')
  }
  const key = await deriveEncryptionKey(password, base64ToBytes(metadata.salt), metadata.iterations)
  const plaintext = await decryptSyncBytes(
    key,
    base64ToBytes(metadata.keyCheck),
    createEncryptionAad({ vaultId, generationId, objectType: 'key-check', objectId: 'v1' }),
  )
  if (new TextDecoder().decode(plaintext) !== 'lemon-new-tab-key-check-v1') {
    throw new Error('Encryption password is incorrect or data was modified')
  }
  return key
}
