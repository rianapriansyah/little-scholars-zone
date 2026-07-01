import DarkMode from '@mui/icons-material/DarkMode'
import LightMode from '@mui/icons-material/LightMode'
import Monitor from '@mui/icons-material/Monitor'
import { Box, IconButton, Paper, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { ColorModePreference } from '../contexts/ColorModeContext'
import { useColorMode } from '../contexts/ColorModeContext'

const EXPANDED_STORAGE_KEY = 'lsz-appearance-panel-expanded'

function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function PreferenceIcon({ preference }: { preference: ColorModePreference }) {
  switch (preference) {
    case 'light':
      return <LightMode sx={{ fontSize: '1.15rem' }} />
    case 'dark':
      return <DarkMode sx={{ fontSize: '1.15rem' }} />
    default:
      return <Monitor sx={{ fontSize: '1.15rem' }} />
  }
}

function preferenceLabel(p: ColorModePreference): string {
  switch (p) {
    case 'light':
      return 'Light theme'
    case 'dark':
      return 'Dark theme'
    default:
      return 'Match system'
  }
}

export function AppearanceBar() {
  const { preference, setPreference } = useColorMode()
  const [expanded, setExpanded] = useState(readExpanded)

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [expanded])

  const toggleExpanded = useCallback(() => setExpanded((e) => !e), [])

  const handleChange = useCallback((_: React.MouseEvent<HTMLElement>, next: ColorModePreference | null) => {
    if (next !== null) {
      setPreference(next)
      setExpanded(false)
    }
  }, [setPreference])

  if (!expanded) {
    return (
      <Box sx={{ mb: 1.25 }}>
        <Tooltip title={`${preferenceLabel(preference)} — choose theme`} placement="bottom-start">
          <IconButton
            onClick={toggleExpanded}
            aria-expanded={false}
            aria-haspopup="true"
            aria-label={`${preferenceLabel(preference)}, open theme options`}
            color="inherit"
            size="small"
            sx={{
              color: 'text.primary',
              width: 32,
              height: 32,
              p: 0.5,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <PreferenceIcon preference={preference} />
          </IconButton>
        </Tooltip>
      </Box>
    )
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 1.25,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: { xs: 1, sm: 1.25 },
          pt: { xs: 0.75, sm: 0.875 },
          pb: 0.35,
        }}
      >
        <Tooltip title="Close theme options">
          <IconButton
            onClick={toggleExpanded}
            aria-expanded
            aria-label="Close theme options"
            color="inherit"
            size="small"
            sx={{ color: 'text.primary', width: 30, height: 30, p: 0.4 }}
          >
            <PreferenceIcon preference={preference} />
          </IconButton>
        </Tooltip>
        <Typography variant="subtitle1" fontWeight={600} sx={{ lineHeight: 1.3 }}>
          Appearance
        </Typography>
      </Box>

      <Box
        sx={{
          px: { xs: 1.75, sm: 2 },
          pb: { xs: 1.35, sm: 1.5 },
          pt: 0,
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, fontSize: '0.8125rem', lineHeight: 1.4 }}>
          Light, dark, or match your system setting.
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          value={preference}
          onChange={handleChange}
          aria-label="Theme"
          sx={{
            display: 'flex',
            gap: 0,
            '& .MuiToggleButtonGroup-grouped': {
              flex: 1,
              py: 0.75,
              px: 0.5,
              borderColor: 'divider',
            },
            '& .MuiToggleButtonGroup-grouped:first-of-type': {
              borderTopLeftRadius: 8,
              borderBottomLeftRadius: 8,
            },
            '& .MuiToggleButtonGroup-grouped:last-of-type': {
              borderTopRightRadius: 8,
              borderBottomRightRadius: 8,
            },
            '& .MuiToggleButton-root': {
              borderColor: 'divider',
              bgcolor: 'background.paper',
              color: 'text.primary',
              textTransform: 'none',
              '& .MuiSvgIcon-root': { fontSize: '1.1rem' },
              '&.Mui-selected': {
                bgcolor: (t) => (t.palette.mode === 'dark' ? 'action.selected' : '#E5E5E5'),
                color: 'text.primary',
                '&:hover': {
                  bgcolor: (t) => (t.palette.mode === 'dark' ? 'action.selected' : '#E0E0E0'),
                },
              },
              '&:hover': {
                bgcolor: (t) => (t.palette.mode === 'dark' ? 'action.hover' : 'grey.50'),
              },
            },
          }}
        >
          <ToggleButton value="light" aria-label="Light mode" disableRipple>
            <LightMode />
          </ToggleButton>
          <ToggleButton value="dark" aria-label="Dark mode" disableRipple>
            <DarkMode />
          </ToggleButton>
          <ToggleButton value="system" aria-label="System theme" disableRipple>
            <Monitor />
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
    </Paper>
  )
}
