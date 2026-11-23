import { describe, expect, it, vi } from 'vitest'
import { ActionError } from './actions'
import { INVITE_ATTEMPTS, INVITE_RETRY_MS, inviteWithRetry } from './invite'

const notFound = () => new ActionError('No user', 'user_not_found')

describe('inviteWithRetry', () => {
  it('returns immediately on success without waiting', async () => {
    const wait = vi.fn(async () => {})
    const setStatus = vi.fn()
    await expect(inviteWithRetry(async () => ({ role: 'viewer' }), setStatus, wait)).resolves.toEqual({ role: 'viewer' })
    expect(wait).not.toHaveBeenCalled()
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('retries user_not_found (invitee still registering) and then succeeds', async () => {
    const invite = vi.fn().mockRejectedValueOnce(notFound()).mockRejectedValueOnce(notFound()).mockResolvedValue({ role: 'editor' })
    const wait = vi.fn(async () => {})
    const setStatus = vi.fn()
    await expect(inviteWithRetry(invite, setStatus, wait)).resolves.toEqual({ role: 'editor' })
    expect(invite).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledWith(INVITE_RETRY_MS)
    expect(setStatus).toHaveBeenCalledTimes(2)
    expect(setStatus.mock.calls[0][0]).toMatch(/attempt 2 of 3/)
  })

  it('gives up after the bounded number of attempts and surfaces the error', async () => {
    const invite = vi.fn().mockRejectedValue(notFound())
    await expect(inviteWithRetry(invite, vi.fn(), async () => {})).rejects.toMatchObject({ code: 'user_not_found' })
    expect(invite).toHaveBeenCalledTimes(INVITE_ATTEMPTS)
  })

  it.each(['forbidden', 'ambiguous', 'bad_request'])('does not retry %s', async (code) => {
    const invite = vi.fn().mockRejectedValue(new ActionError('nope', code))
    await expect(inviteWithRetry(invite, vi.fn(), async () => {})).rejects.toMatchObject({ code })
    expect(invite).toHaveBeenCalledTimes(1)
  })

  it('does not retry plain (non-action) errors', async () => {
    const invite = vi.fn().mockRejectedValue(new Error('network'))
    await expect(inviteWithRetry(invite, vi.fn(), async () => {})).rejects.toThrow('network')
    expect(invite).toHaveBeenCalledTimes(1)
  })
})
