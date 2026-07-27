import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { PortalLayout, type PortalNavItem } from '../../components/PortalLayout'

const NAV: PortalNavItem[] = [
  { to: '/admin/families', label: 'Keluarga' },
  { to: '/admin/children', label: 'Siswa' },
  { to: '/admin/teachers', label: 'Guru' },
  { to: '/admin/classrooms', label: 'Kelas' },
  { to: '/admin/classroom-assignments', label: 'Penugasan' },
]

const BOTTOM_NAV: PortalNavItem[] = [{ to: '/admin/kelola-akun', label: 'Kelola Akun' }]

export function AdminLayout() {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <PortalLayout title="Little Schoolars Zone — Admin" navItems={NAV} bottomNavItems={BOTTOM_NAV} />
    </LocalizationProvider>
  )
}
