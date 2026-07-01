import { createTheme } from '@mui/material'

export function createAppTheme(mode: 'light' | 'dark') {
  return createTheme({
    palette: {
      mode,
      primary: mode === 'light' ? { main: '#00897b' } : { main: '#4db6ac' },
      secondary: mode === 'light' ? { main: '#f9a825' } : { main: '#ffd54f' },
    },
    shape: {
      borderRadius: 8,
    },
    typography: {
      htmlFontSize: 16,
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: false },
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: 8,
          },
          sizeLarge: {
            minHeight: 48,
            paddingLeft: 22,
            paddingRight: 22,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            padding: 10,
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          variant: 'outlined',
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: ({ theme }) => ({
            borderRadius: 8,
            border: `1px solid ${theme.palette.mode === 'dark' ? 'hsla(220, 20%, 25%, 0.6)' : theme.palette.divider}`,
            backgroundColor: theme.palette.mode === 'dark' ? '#34373d' : theme.palette.background.paper,
            boxShadow:
              theme.palette.mode === 'dark'
                ? 'hsla(220, 30%, 5%, 0.7) 0px 4px 16px 0px, hsla(220, 25%, 10%, 0.8) 0px 8px 16px -5px'
                : '0 16px 40px rgba(0,0,0,0.2)',
          }),
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: ({ theme }) => ({
            // Below DialogTitle, default top padding is too tight for outlined TextField labels
            '.MuiDialogTitle-root + &': {
              paddingTop: theme.spacing(2),
            },
          }),
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
      MuiTableContainer: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
    },
    breakpoints: {
      values: {
        xs: 0,
        sm: 600,
        md: 900,
        lg: 1200,
        xl: 1536,
      },
    },
  })
}
