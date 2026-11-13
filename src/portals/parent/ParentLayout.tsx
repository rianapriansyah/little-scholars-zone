import { PortalLayout, type PortalNavItem, type PortalNavSection } from '../../components/PortalLayout'

const NAV: PortalNavItem[] = [{ to: '/parent', label: 'Anak Saya' }]

const FOOTER: PortalNavSection = { items: [{ to: '/parent/manage-account', label: 'Kelola Akun' }] }

export function ParentLayout() {
  return <PortalLayout title="Little Schoolars Zone — Orang Tua" navItems={NAV} footer={FOOTER} />
}
