/** Must match server/src/middleware/auth.middleware.ts ROLE_RANK */
export type UserRole = 'ADMIN' | 'MANAGER' | 'ANNOTATOR' | 'VIEWER'

const ROLE_RANK: Record<UserRole, number> = {
  VIEWER:     0,
  ANNOTATOR:  1,
  MANAGER:    2,
  ADMIN:      3,
}

export function roleSatisfies(userRole: UserRole, minRole: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole]
}
