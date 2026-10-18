import { PortalLayout, type PortalNavItem } from '../../components/PortalLayout'
import { DAILY_REPORT_ENABLED } from '../../lib/featureFlags'

const NAV: PortalNavItem[] = [
  { to: '/teacher', label: 'Kelas Saya' },
  { to: '/teacher/my-attendance', label: 'Kehadiran Saya' },
  ...(DAILY_REPORT_ENABLED ? [{ to: '/teacher/daily-report', label: 'Laporan Harian' }] : []),
  // Below Laporan Harian, and gated on the same flag: standing in for a colleague is the same job
  // — absensi and Catatan Guru — for a class that is not hers, so it makes no sense to offer it
  // while the report screen itself is hidden.
  ...(DAILY_REPORT_ENABLED ? [{ to: '/teacher/substitute', label: 'Gantikan Kelas' }] : []),
  { to: '/teacher/manage-account', label: 'Kelola Akun' },
]

export function TeacherLayout() {
  return <PortalLayout title="Little Schoolars Zone — Guru" navItems={NAV} />
}
