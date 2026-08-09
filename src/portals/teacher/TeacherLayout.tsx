import { PortalLayout, type PortalNavItem } from '../../components/PortalLayout'
import { DAILY_REPORT_ENABLED } from '../../lib/featureFlags'

const NAV: PortalNavItem[] = [
  { to: '/teacher', label: 'Kelas Saya' },
  { to: '/teacher/my-attendance', label: 'Kehadiran Saya' },
  ...(DAILY_REPORT_ENABLED ? [{ to: '/teacher/daily-report', label: 'Laporan Harian' }] : []),
  { to: '/teacher/manage-account', label: 'Kelola Akun' },
]

export function TeacherLayout() {
  return <PortalLayout title="Little Schoolars Zone — Guru" navItems={NAV} />
}
