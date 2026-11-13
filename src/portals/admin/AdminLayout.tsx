import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { PortalLayout, type PortalNavItem, type PortalNavSection } from '../../components/PortalLayout'

const NAV: PortalNavItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard' },
  { to: '/admin/registrations', label: 'Pendaftaran' },
  { to: '/admin/families', label: 'Keluarga' },
  { to: '/admin/children', label: 'Siswa' },
  { to: '/admin/teachers', label: 'Guru' },
  { to: '/admin/classrooms', label: 'Kelas' },
  { to: '/admin/curriculum', label: 'Kurikulum' },
  { to: '/admin/periods', label: 'Periode Belajar' },
  { to: '/admin/teachers-attendance', label: 'Kehadiran Guru' },
]

const ADMINISTRATION: PortalNavSection = {
  title: 'Area Administrasi',
  items: [
    { to: '/admin/manage-account', label: 'Kelola Akun' },
    { to: '/admin/branches', label: 'Kelola Cabang' },
  ],
}

export function AdminLayout() {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="id">
      <PortalLayout title="Little Schoolars Zone — Admin" navItems={NAV} footer={ADMINISTRATION} />
    </LocalizationProvider>
  )
}
