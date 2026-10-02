import { browser } from 'wxt/browser'

export const GREETING_SESSION_KEY = 'greetingShown'

export type GreetingClaimMessage = { type: 'greeting:claim' }

export function isGreetingClaimMessage(message: unknown): message is GreetingClaimMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'greeting:claim'
  )
}

export function requestGreetingClaim(): Promise<boolean> {
  return browser.runtime.sendMessage({ type: 'greeting:claim' } satisfies GreetingClaimMessage)
}
