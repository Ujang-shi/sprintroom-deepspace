import { ActionError } from './actions'

/**
 * A teammate's `users` row appears about a second or two after they first open the app (measured on
 * production), so an invite sent in that window returns `user_not_found`. Retry a couple of times before
 * telling the owner to ask them to sign in. Any other error is surfaced immediately.
 */
export const INVITE_ATTEMPTS = 3
export const INVITE_RETRY_MS = 1500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function inviteWithRetry<T>(
  invite: () => Promise<T>,
  setStatus: (s: string | null) => void,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await invite()
    } catch (e) {
      const retryable = e instanceof ActionError && e.code === 'user_not_found' && attempt < INVITE_ATTEMPTS
      if (!retryable) throw e
      setStatus(`Looking for that teammate… (attempt ${attempt + 1} of ${INVITE_ATTEMPTS})`)
      await wait(INVITE_RETRY_MS)
    }
  }
}
