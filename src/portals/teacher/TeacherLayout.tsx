import { PortalLayout, type PortalNavItem } from '../../components/PortalLayout'

const NAV: PortalNavItem[] = [
  { to: '/teacher', label: 'Kelas Saya' },
  { to: '/teacher/kelola-akun', label: 'Kelola Akun' },
]

export function TeacherLayout() {
  return <PortalLayout title="Little Schoolars Zone — Guru" navItems={NAV} />
}
