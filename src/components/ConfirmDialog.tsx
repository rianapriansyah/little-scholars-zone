import type { ReactNode } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Button,
  type ButtonProps,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
} from '@mui/material'

type Props = {
  open: boolean
  title: string
  description: string
  /** Extra content below the description — e.g. a computed summary. Not wrapped in DialogContentText's <p>, so it can safely hold block-level markup. */
  extra?: ReactNode
  confirmLabel?: string
  confirmColor?: ButtonProps['color']
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  extra,
  confirmLabel = 'Konfirmasi',
  confirmColor = 'error',
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {title}
        <IconButton onClick={onCancel} size="small" aria-label="Tutup">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <DialogContentText>{description}</DialogContentText>
        {extra}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel}>Batal</Button>
        <Button color={confirmColor} variant="contained" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
