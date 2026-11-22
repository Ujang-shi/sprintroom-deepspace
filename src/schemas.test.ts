import { describe, expect, it } from 'vitest'
import { lintSchemas } from 'deepspace/worker'
import { schemas } from './schemas'

describe('SprintRoom schemas', () => {
  it('pass the SDK schema linter with no warnings', () => {
    expect(lintSchemas(schemas)).toEqual([])
  })

  it('project data is member-scoped and not client-writable', () => {
    for (const name of ['projects', 'team_members', 'tasks', 'sprint_insights']) {
      const s = schemas.find((x) => x.name === name)!
      for (const role of ['member', 'admin'] as const) {
        expect(s.permissions[role]).toEqual({ read: 'team', create: false, update: false, delete: false })
      }
      expect(s.permissions.viewer.read).toBe(false)
      expect(s.permissions['*'].read).toBe(false)
      expect(s.teamField).toBeTruthy()
    }
  })

  it('keeps the required users schema', () => {
    expect(schemas.some((s) => s.name === 'users')).toBe(true)
  })
})
