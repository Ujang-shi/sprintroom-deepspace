/**
 * SprintRoom collections.
 *
 * Project-level RBAC model
 * ------------------------
 * - `team_members` is the SDK's membership collection: one row per
 *   (project, user), `teamId` = the project's record id, plus a project `role`
 *   (owner | editor | viewer).
 * - `projects`, `tasks`, `team_members` and `sprint_insights` are READABLE only
 *   by members of that project (`read: 'team'`) - the Durable Object filters
 *   rows before broadcasting, so non-members never receive them.
 * - They are NOT writable from the client (`create/update/delete: false`).
 *   Every write goes through a server action (src/actions) that checks the
 *   caller's project role from `team_members`, because `create` has no
 *   per-project dimension and a `'team'` update would let viewers edit.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const readOnlyForMembers: RolePermissions = { read: 'team', create: false, update: false, delete: false }
const noAccess: RolePermissions = { read: false, create: false, update: false, delete: false }

/** Same rule for every authenticated role; only project membership matters. */
const memberScoped: CollectionSchema['permissions'] = {
  '*': noAccess,
  viewer: noAccess,
  member: readOnlyForMembers,
  admin: readOnlyForMembers,
}

export const projectsSchema: CollectionSchema = {
  name: 'projects',
  columns: [
    { name: 'name', storage: 'text', interpretation: { kind: 'plain' }, required: true, maxLength: 160 },
    { name: 'ownerId', storage: 'text', interpretation: { kind: 'plain' } },
  ],
  // The project's own row id is the team id.
  teamField: '_rowId',
  permissions: memberScoped,
}

export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: { kind: 'plain' }, required: true },
    { name: 'userId', storage: 'text', interpretation: { kind: 'plain' }, required: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['active', 'removed'] }, default: 'active' },
    { name: 'role', storage: 'text', interpretation: { kind: 'select', options: ['owner', 'editor', 'viewer'] }, default: 'viewer' },
    { name: 'name', storage: 'text', interpretation: { kind: 'plain' }, maxLength: 160 },
  ],
  uniqueOn: ['teamId', 'userId'],
  teamField: 'teamId',
  permissions: memberScoped,
}

export const tasksSchema: CollectionSchema = {
  name: 'tasks',
  columns: [
    { name: 'projectId', storage: 'text', interpretation: { kind: 'plain' }, required: true },
    { name: 'title', storage: 'text', interpretation: { kind: 'plain' }, required: true, maxLength: 160 },
    { name: 'description', storage: 'text', interpretation: { kind: 'plain' }, maxLength: 160 },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['todo', 'doing', 'done'] }, default: 'todo' },
    { name: 'priority', storage: 'text', interpretation: { kind: 'select', options: ['low', 'medium', 'high'] }, default: 'medium' },
    { name: 'assigneeId', storage: 'text', interpretation: { kind: 'plain' } },
    { name: 'due', storage: 'text', interpretation: { kind: 'plain' } },
    { name: 'blocked', storage: 'number', interpretation: { kind: 'boolean' }, default: 0 },
  ],
  teamField: 'projectId',
  permissions: memberScoped,
}

/** Persisted AI Sprint Insights, one row per project (upserted with id = projectId). */
export const sprintInsightsSchema: CollectionSchema = {
  name: 'sprint_insights',
  columns: [
    { name: 'projectId', storage: 'text', interpretation: { kind: 'plain' }, required: true },
    { name: 'summary', storage: 'text', interpretation: { kind: 'plain' }, maxLength: 4000 },
    { name: 'source', storage: 'text', interpretation: { kind: 'select', options: ['ai', 'rules'] }, default: 'rules' },
    { name: 'model', storage: 'text', interpretation: { kind: 'plain' } },
    { name: 'generatedBy', storage: 'text', interpretation: { kind: 'plain' } },
    { name: 'generatedAt', storage: 'text', interpretation: { kind: 'plain' } },
    { name: 'metrics', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'nextActions', storage: 'text', interpretation: { kind: 'json' } },
  ],
  teamField: 'projectId',
  permissions: memberScoped,
}
