import { PortalLayout, type PortalNavItem } from '../../components/PortalLayout'

const NAV: PortalNavItem[] = [
  { to: '/parent', label: 'Anak Saya' },
  { to: '/parent/manage-account', label: 'Kelola Akun' },
]

export function ParentLayout() {
  return <PortalLayout title="Little Schoolars Zone — Orang Tua" navItems={NAV} />
}
