import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, Box, Button, Typography } from '@mui/material'

type Props = { children: ReactNode }

type State = { hasError: boolean; message: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 560, mx: 'auto', mt: { xs: 2, sm: 4 } }}>
          <Typography variant="h6" gutterBottom>
            Something went wrong
          </Typography>
          <Alert severity="error" sx={{ mb: 2 }}>
            {this.state.message}
          </Alert>
          <Button variant="contained" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </Box>
      )
    }
    return this.props.children
  }
}
