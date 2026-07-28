import { useRef, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import { ClassroomDetailEditForm, type ClassroomDetailEditFormHandle } from './ClassroomDetailEditForm'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

/** Create new classroom only — edit opens the Classroom detail page. */
export function ClassroomDialog({ open, onClose, onSaved }: Props) {
  const formRef = useRef<ClassroomDetailEditFormHandle>(null)
  const [busy, setBusy] = useState({ saving: false, deleting: false })
  const isBusy = busy.saving || busy.deleting

  function handleClose() {
    if (isBusy) return
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Tambah Kelas</DialogTitle>
      <DialogContent dividers>
        {open ? (
          <ClassroomDetailEditForm
            ref={formRef}
            classroom={null}
            hideActions
            onBusyChange={setBusy}
            onSaved={() => {
              onSaved()
              onClose()
            }}
          />
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={isBusy}>
          Batal
        </Button>
        <Button variant="contained" onClick={() => void formRef.current?.save()} disabled={isBusy}>
          {busy.saving ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
