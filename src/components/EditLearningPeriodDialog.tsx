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
  TextField,
} from '@mui/material'
import { updateLearningPeriod } from '../lib/learningPeriods'
import type { LearningPeriodListEntry } from '../types/attendance'

type Props = {
  open: boolean
  period: LearningPeriodListEntry
  onClose: () => void
  /** Fires after a successful save, so the card's chips and quota tiles reload. */
  onSaved: () => void
}

/**
 * Admin-only. Corrects a period that was already sold — see updateLearningPeriod for why these
 * fields and no others, what changing the quota does to the period's closure, and what
 * renumbering decides.
 *
 * The child and the class are shown but disabled rather than left out: an admin editing one of
 * several periods needs to see which one they have open, and a field that is visibly fixed says
 * more about the rules than an absent one.
 */
export function EditLearningPeriodDialog({ open, period, onClose, onSaved }: Props) {
  const [periodNo, setPeriodNo] = useState(String(period.periodNo))
  const [startDate, setStartDate] = useState(period.startDate)
  const [projectedEndDate, setProjectedEndDate] = useState(period.projectedEndDate ?? '')
  const [guaranteedDays, setGuaranteedDays] = useState(String(period.guaranteedDays))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset from the period every time it opens: the dialog is kept mounted by the card, so last
  // time's half-finished edit would otherwise still be sitting in the fields.
  useEffect(() => {
    if (!open) return
    setPeriodNo(String(period.periodNo))
    setStartDate(period.startDate)
    setProjectedEndDate(period.projectedEndDate ?? '')
    setGuaranteedDays(String(period.guaranteedDays))
    setError(null)
  }, [open, period.periodNo, period.startDate, period.projectedEndDate, period.guaranteedDays])

  const parsedDays = Number(guaranteedDays)
  const daysValid = Number.isInteger(parsedDays) && parsedDays > 0
  const belowConsumed = daysValid && parsedDays < period.daysConsumed

  const parsedPeriodNo = Number(periodNo)
  const periodNoValid = Number.isInteger(parsedPeriodNo) && parsedPeriodNo > 0

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  async function handleSave() {
    if (!periodNoValid) return setError('Nomor periode harus berupa angka lebih dari 0.')
    if (!startDate) return setError('Tanggal mulai wajib diisi.')
    if (!daysValid) return setError('Kuota harus berupa angka lebih dari 0.')

    setSaving(true)
    setError(null)
    const result = await updateLearningPeriod({
      periodId: period.id,
      periodNo: parsedPeriodNo,
      startDate,
      projectedEndDate: projectedEndDate || null,
      guaranteedDays: parsedDays,
    })
    setSaving(false)
    if (!result.ok) return setError(result.error)

    onSaved()
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        Ubah Periode Belajar
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
          <TextField size="small" label="Siswa" value={period.childName} disabled fullWidth />
          <TextField
            size="small"
            label="Kelas"
            value={period.classroomLabel}
            disabled
            fullWidth
            helperText="Kelas tidak dapat diubah — absensi dan tagihan sudah tercatat atas kelas ini."
          />
          <TextField
            size="small"
            label="Nomor Periode"
            type="number"
            value={periodNo}
            onChange={(e) => setPeriodNo(e.target.value)}
            fullWidth
            required
            error={periodNo !== '' && !periodNoValid}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            helperText="Menentukan urutan: absensi hari baru memotong periode terbuka dengan nomor terkecil. Nomor yang sudah dipakai di kelas ini akan ditolak."
          />
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
          <TextField
            size="small"
            label="Kuota (hari dijamin)"
            type="number"
            value={guaranteedDays}
            onChange={(e) => setGuaranteedDays(e.target.value)}
            fullWidth
            required
            error={belowConsumed}
            slotProps={{ htmlInput: { min: Math.max(period.daysConsumed, 1), step: 1 } }}
            helperText={
              belowConsumed
                ? `Tidak boleh kurang dari ${period.daysConsumed} hari yang sudah terpakai.`
                : `Sudah terpakai ${period.daysConsumed} hari. Sakit tidak memotong kuota.`
            }
          />

          {daysValid && !belowConsumed && parsedDays === period.daysConsumed ? (
            <Alert severity="warning">
              Kuota disamakan dengan hari terpakai, jadi periode ini akan ditutup dan tidak bisa menerima absensi
              baru.
            </Alert>
          ) : null}

          {daysValid && parsedDays > period.daysConsumed && !period.isActive ? (
            <Alert severity="info">
              Menambah kuota akan membuka kembali periode ini, sehingga absensi berikutnya kembali memotong
              kuotanya.
            </Alert>
          ) : null}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          Batal
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={saving || !daysValid || belowConsumed || !periodNoValid}
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
