import { PortalLayout, type PortalNavItem } from '../../components/PortalLayout'

const NAV: PortalNavItem[] = [{ to: '/teacher', label: 'Kelas Saya' }]
const BOTTOM_NAV: PortalNavItem[] = [{ to: '/teacher/kelola-akun', label: 'Kelola Akun' }]

export function TeacherLayout() {
  return <PortalLayout title="Little Schoolars Zone — Guru" navItems={NAV} bottomNavItems={BOTTOM_NAV} />
}
