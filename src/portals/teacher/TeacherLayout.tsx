import { PortalLayout, type PortalNavItem } from '../../components/PortalLayout'
import { DAILY_REPORT_ENABLED } from '../../lib/featureFlags'

const NAV: PortalNavItem[] = [
  { to: '/teacher', label: 'Kelas Saya' },
  ...(DAILY_REPORT_ENABLED ? [{ to: '/teacher/laporan-harian', label: 'Laporan Harian' }] : []),
  { to: '/teacher/kelola-akun', label: 'Kelola Akun' },
]

export function TeacherLayout() {
  return <PortalLayout title="Little Schoolars Zone — Guru" navItems={NAV} />
}
