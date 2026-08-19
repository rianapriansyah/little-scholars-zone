import { useRef, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import { FamilyDetailEditForm, type FamilyDetailEditFormHandle } from './FamilyDetailEditForm'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

/** Create new family only — edit opens the Family detail page. */
export function FamilyDialog({ open, onClose, onSaved }: Props) {
  const formRef = useRef<FamilyDetailEditFormHandle>(null)
  const [busy, setBusy] = useState({ saving: false, generating: false, checking: false })
  const [step, setStep] = useState<'form' | 'review'>('form')
  const isBusy = busy.saving || busy.generating || busy.checking

  function handleClose() {
    if (isBusy) return
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Tambah Keluarga</DialogTitle>
      <DialogContent dividers>
        {open ? (
          <FamilyDetailEditForm
            ref={formRef}
            family={null}
            hideActions
            onBusyChange={setBusy}
            onStepChange={setStep}
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
        {step === 'review' ? (
          <Button onClick={() => formRef.current?.back()} disabled={isBusy}>
            Kembali
          </Button>
        ) : null}
        <Button variant="contained" onClick={() => void formRef.current?.submit()} disabled={isBusy}>
          {step === 'review'
            ? busy.saving
              ? 'Membuat…'
              : 'Simpan & Buat Login'
            : busy.checking
              ? 'Memeriksa…'
              : 'Selanjutnya'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
