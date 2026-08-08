import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { PortalLayout, type PortalNavItem } from '../../components/PortalLayout'

const NAV: PortalNavItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard' },
  { to: '/admin/families', label: 'Keluarga' },
  { to: '/admin/children', label: 'Siswa' },
  { to: '/admin/teachers', label: 'Guru' },
  { to: '/admin/classrooms', label: 'Kelas' },
  { to: '/admin/curriculum', label: 'Kurikulum' },
  { to: '/admin/periode', label: 'Periode Belajar' },
  { to: '/admin/teachers-attendance', label: 'Kehadiran Guru' },
  { to: '/admin/kelola-akun', label: 'Kelola Akun' },
]

export function AdminLayout() {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <PortalLayout title="Little Schoolars Zone — Admin" navItems={NAV} />
    </LocalizationProvider>
  )
}
