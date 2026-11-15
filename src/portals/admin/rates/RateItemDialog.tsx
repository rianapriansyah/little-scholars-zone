import { useEffect, useState, type ReactNode } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { DangerZone } from '../../../components/DangerZone'
import { digitsOnly, groupDigits } from '../../../lib/formatIdr'
import type { Result } from '../../../lib/result'
import type { OfficeBranchRow } from '../../../types/officeBranch'

/** The fields a program and a work item share: each is one priced kind of work in one branch. */
export type RateItemValues = { branchId: string; name: string; hourlyRate: number; active: boolean }

type Props = {
  open: boolean
  /** "Program" or "Item Kerja" — used in the title, labels and messages. */
  noun: string
  /** Null to add a new one; the current values to edit (and delete) an existing one. */
  item: (RateItemValues & { id: string }) | null
  branches: OfficeBranchRow[]
  /** One line under the rate field saying who is paid this rate. */
  rateHelperText: string
  /** Shown above the delete button: what deleting means for this kind of item. */
  deleteDescription: string
  onSave: (values: RateItemValues, id: string | null) => Promise<Result<void>>
  onDelete: (id: string) => Promise<Result<void>>
  onClose: () => void
  onSaved: () => void
  /** Extra section shown when editing an existing item (Kelola Item Kerja: its assignments). */
  renderExtra?: (id: string) => ReactNode
}

/**
 * Add / edit / delete dialog for anything that carries an hourly rate: a program (Kelola Program)
 * or a work item (Kelola Item Kerja). The rate typed here is the single source of that pay —
 * changing it changes the estimate for every hour already worked on it this month too.
 */
export function RateItemDialog({
  open,
  noun,
  item,
  branches,
  rateHelperText,
  deleteDescription,
  onSave,
  onDelete,
  onClose,
  onSaved,
  renderExtra,
}: Props) {
  const isEdit = item !== null

  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState('')
  /** Raw digits, dot-grouped only for display — same money-input convention as the class price. */
  const [rate, setRate] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(item?.name ?? '')
    setBranchId(item?.branchId ?? (branches.length === 1 ? branches[0].id : ''))
    setRate(item ? String(Math.round(item.hourlyRate)) : '')
    setActive(item?.active ?? true)
    setError(null)
  }, [open, item, branches])

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  async function handleSave() {
    if (!name.trim()) {
      setError(`Masukkan nama ${noun.toLowerCase()}.`)
      return
    }
    if (!branchId) {
      setError('Pilih cabang.')
      return
    }
    const hourlyRate = Number(rate)
    if (!rate || hourlyRate <= 0) {
      setError('Masukkan rate per jam lebih dari 0.')
      return
    }
    setSaving(true)
    setError(null)
    const result = await onSave({ branchId, name, hourlyRate, active }, item?.id ?? null)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
    onClose()
  }

  async function handleDelete() {
    if (!item) return
    setConfirmDelete(false)
    setSaving(true)
    setError(null)
    const result = await onDelete(item.id)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
    onClose()
  }

  const rateChanged = isEdit && rate !== '' && Number(rate) !== Math.round(item.hourlyRate)

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          {isEdit ? `Edit ${noun}` : `Tambah ${noun}`}
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
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSave()
            }}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <TextField
              id="rate-item-name"
              size="small"
              label={`Nama ${noun}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              fullWidth
              autoFocus
            />
            <TextField
              id="rate-item-branch"
              select
              size="small"
              label="Cabang"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              required
              fullWidth
              helperText="Jam kerja di sini masuk ke slip gaji cabang ini."
            >
              {branches.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              id="rate-item-rate"
              size="small"
              label="Rate per Jam"
              value={groupDigits(rate)}
              onChange={(e) => setRate(digitsOnly(e.target.value))}
              required
              fullWidth
              inputMode="numeric"
              slotProps={{ input: { startAdornment: <InputAdornment position="start">Rp</InputAdornment> } }}
              helperText={rateHelperText}
            />
            {rateChanged ? (
              <Typography variant="body2" color="warning.main" sx={{ mt: -1 }}>
                Rate baru juga dipakai untuk jam yang sudah tercatat bulan ini, karena belum ada riwayat rate.
              </Typography>
            ) : null}
            <FormControlLabel
              control={<Switch id="rate-item-active" checked={active} onChange={(e) => setActive(e.target.checked)} />}
              label="Aktif"
            />

            {isEdit && renderExtra ? (
              <>
                <Divider />
                {renderExtra(item.id)}
              </>
            ) : null}

            {isEdit ? (
              <>
                <Divider />
                <DangerZone
                  title={`Hapus ${noun.toLowerCase()}`}
                  description={deleteDescription}
                  actionLabel={`Hapus ${noun}`}
                  onAction={() => setConfirmDelete(true)}
                  disabled={saving}
                />
              </>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={saving}>
            Batal
          </Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        title={`Hapus ${noun.toLowerCase()}?`}
        description={`"${item?.name ?? ''}" akan dihapus permanen.`}
        confirmLabel="Hapus"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}
