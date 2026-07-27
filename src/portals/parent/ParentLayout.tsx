import { PortalLayout, type PortalNavItem } from '../../components/PortalLayout'

const NAV: PortalNavItem[] = [{ to: '/parent', label: 'Anak Saya' }]
const BOTTOM_NAV: PortalNavItem[] = [{ to: '/parent/kelola-akun', label: 'Kelola Akun' }]

export function ParentLayout() {
  return <PortalLayout title="Little Schoolars Zone — Orang Tua" navItems={NAV} bottomNavItems={BOTTOM_NAV} />
}
