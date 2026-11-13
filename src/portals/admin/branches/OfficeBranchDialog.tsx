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
  IconButton,
  TextField,
} from '@mui/material'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { DangerZone } from '../../../components/DangerZone'
import { createOfficeBranch, deleteOfficeBranch, updateOfficeBranch } from '../../../lib/officeBranches'
import type { OfficeBranchRow } from '../../../types/officeBranch'

type Props = {
  open: boolean
  /** Null to add a new branch; a row to edit (and delete) that one. */
  branch: OfficeBranchRow | null
  onClose: () => void
  onSaved: () => void
}

export function OfficeBranchDialog({ open, branch, onClose, onSaved }: Props) {
  const isEdit = branch !== null

  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(branch?.name ?? '')
    setError(null)
  }, [open, branch])

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  async function handleSave() {
    if (!name.trim()) {
      setError('Masukkan nama cabang.')
      return
    }
    setSaving(true)
    setError(null)
    const result = isEdit ? await updateOfficeBranch(branch.id, name) : await createOfficeBranch(name)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
    onClose()
  }

  async function handleDelete() {
    if (!branch) return
    setConfirmDelete(false)
    setSaving(true)
    setError(null)
    const result = await deleteOfficeBranch(branch.id)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          {isEdit ? 'Edit Cabang' : 'Tambah Cabang'}
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
              size="small"
              label="Nama Cabang"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              fullWidth
              autoFocus
            />

            {isEdit ? (
              <>
                <Divider />
                <DangerZone
                  title="Hapus cabang"
                  description="Cabang akan dihapus permanen."
                  actionLabel="Hapus Cabang"
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
        title="Hapus cabang?"
        description={`"${branch?.name ?? ''}" akan dihapus permanen.`}
        confirmLabel="Hapus"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}
