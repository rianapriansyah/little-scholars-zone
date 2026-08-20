import { useEffect, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
} from '@mui/material'
import { SendInvoiceDialog } from '../../../components/SendInvoiceDialog'
import { todayIsoDateInWita } from '../../../lib/classStatus'
import { formatIdr } from '../../../lib/formatIdr'
import type { InvoiceData } from '../../../lib/invoicePdf'
import {
  createLearningPeriod,
  fetchActiveClassrooms,
  fetchChildActiveClassroom,
  fetchPeriod,
} from '../../../lib/learningPeriods'
import { fetchPaymentPeriodForLearningPeriod } from '../../../lib/paymentPeriods'
import { familyDisplayName } from '../../../lib/familyDisplayName'
import type { ChildRow } from '../../../types/child'
import type { ClassroomRow } from '../../../types/classroom'
import type { FamilyRow } from '../../../types/family'

const DEFAULT_GUARANTEED_DAYS = 20

type Props = {
  open: boolean
  child: ChildRow
  family: FamilyRow
  onClose: () => void
  onSaved: () => void
}

/**
 * Admin-only. Periods are sold, not taught, so nothing else in the app creates one — and
 * nothing auto-creates the next one when a period closes. Recording attendance for a child
 * with no open period fails loudly on purpose.
 */
export function LearningPeriodDialog({ open, child, family, onClose, onSaved }: Props) {
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([])
  const [classroomId, setClassroomId] = useState('')
  const [startDate, setStartDate] = useState(() => todayIsoDateInWita())
  const [projectedEndDate, setProjectedEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set right after a successful save, so the invoice prompt survives the form dialog closing —
  // this component stays mounted, only its own `open` prop toggles (see FamilyPeriodsTab).
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null)

  useEffect(() => {
    if (!open) return
    setStartDate(todayIsoDateInWita())
    setProjectedEndDate('')
    setError(null)

    void (async () => {
      const [listResult, currentResult] = await Promise.all([
        fetchActiveClassrooms(),
        fetchChildActiveClassroom(child.id),
      ])
      if (!listResult.ok) {
        setError(listResult.error)
        return
      }
      setClassrooms(listResult.data)
      // Preselect where the child actually sits today; the admin can still pick another.
      const current = currentResult.ok ? currentResult.data : null
      setClassroomId(current?.id ?? listResult.data[0]?.id ?? '')
    })()
  }, [open, child.id])

  const selectedClassroom = classrooms.find((classroom) => classroom.id === classroomId)

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  async function handleSave() {
    if (!classroomId) {
      setError('Pilih kelas terlebih dahulu.')
      return
    }

    setSaving(true)
    setError(null)
    const result = await createLearningPeriod({
      childId: child.id,
      classroomId,
      startDate,
      projectedEndDate: projectedEndDate || null,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }

    // Best-effort: the payment_period row always exists (the trigger creates it in the same
    // insert that made the period), but a failed fetch here should never block the admin from
    // seeing the period was created — it just skips the invoice prompt.
    const [periodResult, paymentResult] = await Promise.all([
      fetchPeriod(result.data),
      fetchPaymentPeriodForLearningPeriod(result.data),
    ])
    if (periodResult.ok && paymentResult.ok) {
      setInvoiceData({
        familyName: familyDisplayName(family),
        childName: child.full_name,
        classroomLabel: periodResult.data.classroomLabel,
        periodNo: periodResult.data.periodNo,
        startDate: periodResult.data.startDate,
        amount: paymentResult.data?.amount ?? 0,
        dueDate: paymentResult.data?.dueDate ?? null,
      })
    }

    onSaved()
    onClose()
  }

  return (
    // A Fragment, not a single <Dialog>: SendInvoiceDialog has to survive the form Dialog's
    // `open` flipping to false on save — MUI unmounts a closed Dialog's children, and it would
    // take the invoice prompt down with it if nested inside instead of alongside.
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          Tambah Periode Belajar
          <IconButton onClick={handleClose} disabled={saving} size="small" aria-label="Tutup">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField size="small" label="Siswa" value={child.full_name} disabled fullWidth />
            <TextField
              size="small"
              select
              label="Kelas"
              value={classroomId}
              onChange={(e) => setClassroomId(e.target.value)}
              fullWidth
              required
              helperText="Periode mengikuti kelas, bukan guru — ganti guru tidak mengatur ulang kuota."
            >
              {classrooms.map((classroom) => (
                <MenuItem key={classroom.id} value={classroom.id}>
                  {classroom.label} · {classroom.time_start.slice(0, 5)}
                  {classroom.time_end ? `–${classroom.time_end.slice(0, 5)}` : ''}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Tanggal Mulai"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              fullWidth
              required
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              label="Perkiraan Selesai"
              type="date"
              value={projectedEndDate}
              onChange={(e) => setProjectedEndDate(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Opsional. Perkiraan kasar saja — tanggal selesai sebenarnya dihitung dari hari terpakai."
            />
            {/* Read-only: the trigger copies this from the classroom at insert, so showing an
                editable field here would promise something the database will overwrite. */}
            <Alert severity="info">
              Kuota: <strong>{selectedClassroom?.guaranteed_days ?? DEFAULT_GUARANTEED_DAYS} hari efektif</strong>
              {selectedClassroom ? ` · Harga ${formatIdr(selectedClassroom.price)}` : ''}. Mengikuti kelas yang
              dipilih. Sakit tidak memotong kuota.
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={saving}>
            Batal
          </Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !classroomId}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </DialogActions>
      </Dialog>

      {invoiceData ? (
        <SendInvoiceDialog
          open
          invoice={invoiceData}
          phone={family.contact_phone}
          onClose={() => setInvoiceData(null)}
        />
      ) : null}
    </>
  )
}
