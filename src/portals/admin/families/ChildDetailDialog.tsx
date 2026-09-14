import { useEffect, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from '@mui/material'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { ChildDetailEditForm } from './ChildDetailEditForm'

type Props = {
  open: boolean
  /** The row whose card was clicked, or null to add a new child to `family` (Tambah Siswa). */
  child: ChildRow | null
  family: FamilyRow
  onClose: () => void
  onSaved: () => void
}

/** Everything about one child, behind a click on their row in the Data Anak table: their data,
 *  their learning periods and their classroom enrolments, each in its own collapsible section.
 *  Adding a child uses the same dialog — once the first Simpan creates the row, the periods and
 *  classes sections unlock in place, so there is one look and one flow for both. */
export function ChildDetailDialog({ open, child, family, onClose, onSaved }: Props) {
  // Create mode only: the row inserted by the first Simpan, which the form then edits.
  const [createdChild, setCreatedChild] = useState<ChildRow | null>(null)

  useEffect(() => {
    if (open) setCreatedChild(null)
  }, [open])

  const shownChild = child ?? createdChild

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {shownChild?.full_name ?? 'Tambah Siswa'}
        <IconButton onClick={onClose} size="small" aria-label="Tutup">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {open ? (
          <ChildDetailEditForm child={shownChild} family={family} onSaved={onSaved} onCreated={setCreatedChild} />
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Tutup</Button>
      </DialogActions>
    </Dialog>
  )
}
