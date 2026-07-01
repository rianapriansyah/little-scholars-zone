import { CssBaseline, ThemeProvider } from '@mui/material'
import useMediaQuery from '@mui/material/useMediaQuery'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { createAppTheme } from '../theme/createAppTheme'

export type ColorModePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'lsz-color-mode'

type ColorModeContextValue = {
  preference: ColorModePreference
  setPreference: (p: ColorModePreference) => void
  resolvedMode: 'light' | 'dark'
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null)

function readStoredPreference(): ColorModePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ColorModePreference>(() => readStoredPreference())
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)', { defaultMatches: false })

  const setPreference = useCallback((p: ColorModePreference) => {
    setPreferenceState(p)
    try {
      localStorage.setItem(STORAGE_KEY, p)
    } catch {
      /* ignore */
    }
  }, [])

  const resolvedMode: 'light' | 'dark' =
    preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference

  const theme = useMemo(() => createAppTheme(resolvedMode), [resolvedMode])

  const value = useMemo(
    () => ({ preference, setPreference, resolvedMode }),
    [preference, setPreference, resolvedMode],
  )

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}

export function useColorMode(): ColorModeContextValue {
  const ctx = useContext(ColorModeContext)
  if (!ctx) {
    throw new Error('useColorMode must be used within ColorModeProvider')
  }
  return ctx
}
