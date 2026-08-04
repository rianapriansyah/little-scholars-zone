/**
 * Seeded test accounts for the dev-only role switcher.
 *
 * Switching role in this app means switching WHICH USER you are, not flipping a claim: only
 * the admin policies read app_metadata.role, while teacher and parent policies resolve
 * identity through teachers.auth_user_id / families.auth_user_id, and the route guards check
 * for those rows. So the switcher signs in as a different real account and exercises the same
 * RLS the live app does.
 *
 * SECURITY: VITE_* variables are inlined into the JS bundle at build time, so these passwords
 * are readable by anyone who views source. Set them in your local .env only — NEVER in Vercel.
 * The switcher renders nothing unless VITE_DEV_ROLE_SWITCHER is exactly 'true', so a
 * production build without the flag has no switcher at all.
 */

export const DEV_ROLES = ['admin', 'teacher', 'parent'] as const

export type DevRole = (typeof DEV_ROLES)[number]

export type DevAccount = {
  role: DevRole
  label: string
  email: string
  password: string
}

export const DEV_ROLE_LABELS: Record<DevRole, string> = {
  admin: 'Admin',
  teacher: 'Guru',
  parent: 'Orang Tua',
}

const ENV_KEYS: Record<DevRole, { email: string; password: string }> = {
  admin: { email: 'VITE_DEV_ADMIN_EMAIL', password: 'VITE_DEV_ADMIN_PASSWORD' },
  teacher: { email: 'VITE_DEV_TEACHER_EMAIL', password: 'VITE_DEV_TEACHER_PASSWORD' },
  parent: { email: 'VITE_DEV_PARENT_EMAIL', password: 'VITE_DEV_PARENT_PASSWORD' },
}

export type EnvLike = Record<string, string | boolean | undefined>

function viteEnv(): EnvLike {
  return import.meta.env as unknown as EnvLike
}

/** Strictly 'true' — a stray value must not switch this on in a deployed build. */
export function isDevRoleSwitcherEnabled(env: EnvLike = viteEnv()): boolean {
  return env.VITE_DEV_ROLE_SWITCHER === 'true'
}

/**
 * The accounts that are fully configured. A role with only half its variables set is skipped
 * rather than offered and then failing at sign-in.
 */
export function readDevAccounts(env: EnvLike = viteEnv()): DevAccount[] {
  if (!isDevRoleSwitcherEnabled(env)) return []

  const accounts: DevAccount[] = []
  for (const role of DEV_ROLES) {
    const email = env[ENV_KEYS[role].email]
    const password = env[ENV_KEYS[role].password]
    if (typeof email !== 'string' || typeof password !== 'string') continue
    if (!email.trim() || !password) continue
    accounts.push({ role, label: DEV_ROLE_LABELS[role], email: email.trim(), password })
  }
  return accounts
}
