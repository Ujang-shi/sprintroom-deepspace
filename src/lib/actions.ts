import { getAuthToken } from 'deepspace'

export interface ActionResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

/** Call a server action (POST /api/actions/<name>) with the signed-in user's JWT. */
export async function callAction<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in required')
  const res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  let body: ActionResponse<T>
  try {
    body = (await res.json()) as ActionResponse<T>
  } catch {
    throw new Error(`Request failed (${res.status})`)
  }
  if (!res.ok || !body.success) throw new Error(body.error || `Request failed (${res.status})`)
  return body.data as T
}
