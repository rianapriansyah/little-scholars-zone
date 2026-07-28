import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { alpha, useTheme } from '@mui/material/styles'

type Props = {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
  disabled?: boolean
  busyLabel?: string
  busy?: boolean
}

/** Dark panel + red border (GitHub-style danger zone), works on light dialogs too. */
const PANEL_BG = '#161b22'
const PANEL_BORDER = 'rgba(248, 81, 73, 0.4)'
const TITLE_ON_PANEL = '#f0f6fc'
const SUB_ON_PANEL = 'rgba(240, 246, 252, 0.72)'

export function DangerZone({ title, description, actionLabel, onAction, disabled, busyLabel, busy }: Props) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const iconBg = '#ff7b54'
  const btnFill = alpha('#f85149', isDark ? 0.35 : 0.25)
  const btnBorder = alpha('#f85149', 0.65)

  const isBusy = Boolean(busy)
  const label = isBusy && busyLabel ? busyLabel : actionLabel

  return (
    <Box
      sx={{
        mt: 0,
        p: 2,
        borderRadius: 1,
        border: `1px solid ${PANEL_BORDER}`,
        bgcolor: isDark ? alpha('#000', 0.35) : PANEL_BG,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)',
      }}
    >
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1,
            bgcolor: iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <WarningAmberRoundedIcon sx={{ fontSize: 22, color: 'rgba(0,0,0,0.85)' }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: TITLE_ON_PANEL, mb: 0.5 }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: SUB_ON_PANEL, mb: 2, lineHeight: 1.5 }}>
            {description}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            disabled={disabled || isBusy}
            onClick={onAction}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: TITLE_ON_PANEL,
              bgcolor: btnFill,
              borderColor: btnBorder,
              '&:hover': {
                bgcolor: alpha('#f85149', isDark ? 0.45 : 0.35),
                borderColor: '#f85149',
              },
              '&.Mui-disabled': {
                color: alpha(TITLE_ON_PANEL, 0.4),
                borderColor: alpha('#f85149', 0.3),
              },
            }}
          >
            {label}
          </Button>
        </Box>
      </Box>
    </Box>
  )
}
