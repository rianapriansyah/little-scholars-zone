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
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
} from '@mui/material'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { DangerZone } from '../../../components/DangerZone'
import { supabase } from '../../../lib/supabase'
import { CURRICULUM_SUBJECTS, CURRICULUM_SUBJECT_LABELS } from '../../../types/curriculumItem'
import type { CurriculumItemRow, CurriculumSubject } from '../../../types/curriculumItem'

type Props = {
  open: boolean
  item: CurriculumItemRow | null
  /** Used to default sort_order for a new item so it lands at the end of its subject. */
  nextSortOrder: (subject: CurriculumSubject) => number
  onClose: () => void
  onSaved: () => void
}

export function CurriculumItemDialog({ open, item, nextSortOrder, onClose, onSaved }: Props) {
  const isEdit = item !== null

  const [subject, setSubject] = useState<CurriculumSubject>('literasi')
  const [label, setLabel] = useState('')
  const [sortOrder, setSortOrder] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    const nextSubject = (item?.subject as CurriculumSubject | undefined) ?? 'literasi'
    setSubject(nextSubject)
    setLabel(item?.label ?? '')
    setSortOrder(String(item?.sort_order ?? nextSortOrder(nextSubject)))
    setIsActive(item?.is_active ?? true)
    setError(null)
  }, [open, item, nextSortOrder])

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  async function handleSave() {
    if (!label.trim()) {
      setError('Masukkan nama materi.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      subject,
      label: label.trim(),
      sort_order: Number(sortOrder) || 0,
      is_active: isActive,
    }
    const { error: wErr } = isEdit
      ? await supabase.from('curriculum_items').update(payload).eq('id', item.id)
      : await supabase.from('curriculum_items').insert(payload)
    setSaving(false)

    if (wErr) {
      setError(wErr.code === '23505' ? 'Materi dengan nama ini sudah ada pada mata pelajaran tersebut.' : wErr.message)
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
    const { error: dErr } = await supabase.from('curriculum_items').delete().eq('id', item.id)
    setSaving(false)
    if (dErr) {
      // daily_report_items references curriculum_items without ON DELETE CASCADE on purpose:
      // deleting a materi that is already on a report would rewrite history.
      setError(
        dErr.code === '23503'
          ? 'Materi ini sudah dipakai di laporan harian, jadi tidak bisa dihapus. Nonaktifkan saja agar tidak muncul lagi untuk guru.'
          : dErr.message,
      )
      return
    }
    onSaved()
    onClose()
  }

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          {isEdit ? 'Edit Materi' : 'Tambah Materi'}
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
            <TextField
              size="small"
              select
              label="Mata Pelajaran"
              value={subject}
              onChange={(e) => setSubject(e.target.value as CurriculumSubject)}
              fullWidth
            >
              {CURRICULUM_SUBJECTS.map((value) => (
                <MenuItem key={value} value={value}>
                  {CURRICULUM_SUBJECT_LABELS[value]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Nama Materi"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              fullWidth
              helperText="Tulis persis seperti pada formulir kertas."
            />
            <TextField
              size="small"
              label="Urutan"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              fullWidth
              helperText="Menentukan urutan tampil untuk guru. Angka kecil tampil lebih dulu."
            />
            <FormControlLabel
              control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
              label="Aktif"
            />
            {!isActive ? (
              <Alert severity="info">
                Materi nonaktif tidak muncul lagi saat guru mengisi laporan, tetapi tetap tampil pada laporan lama.
              </Alert>
            ) : null}

            {isEdit ? (
              <>
                <Divider />
                <DangerZone
                  title="Hapus materi"
                  description="Hanya bisa dihapus bila belum pernah dipakai di laporan harian mana pun. Bila sudah pernah dipakai, nonaktifkan saja."
                  actionLabel="Hapus Materi"
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
          <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !label.trim()}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        title="Hapus materi?"
        description={`"${item?.label ?? ''}" akan dihapus permanen dari daftar kurikulum.`}
        confirmLabel="Hapus"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}
