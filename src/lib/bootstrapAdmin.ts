/** Opt-in via `.env`: `VITE_SHOW_ADMIN_BOOTSTRAP=true` (remove after first admin exists). */
export function isAdminBootstrapEnabled(): boolean {
  return import.meta.env.VITE_SHOW_ADMIN_BOOTSTRAP === 'true'
}
