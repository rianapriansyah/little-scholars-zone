import DehazeIcon from '@mui/icons-material/Dehaze'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'

type Props = {
  onClick: (e: React.MouseEvent) => void
  /** Accessible name / tooltip (default: Update) */
  title?: string
  disabled?: boolean
}

/** Single "Update" action for DataGrid action columns — icon only. */
export function DataGridUpdateIconButton({ onClick, title = 'Update', disabled }: Props) {
  const btn = (
    <IconButton
      size="small"
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      sx={{ my: 0.5 }}
    >
      <DehazeIcon fontSize="small" />
    </IconButton>
  )
  return disabled ? btn : <Tooltip title={title}>{btn}</Tooltip>
}
