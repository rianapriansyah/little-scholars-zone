import FilterAltOff from '@mui/icons-material/FilterAltOff'
import Search from '@mui/icons-material/Search'
import {
  Box,
  Button,
  InputAdornment,
  Paper,
  TextField,
} from '@mui/material'

export type DataGridSearchPanelProps = {
  keyword: string
  onKeywordChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onClear: () => void
  searchPlaceholder: string
  loading?: boolean
  submitLabel?: string
  clearLabel?: string
}

export function DataGridSearchPanel({
  keyword,
  onKeywordChange,
  onSubmit,
  onClear,
  searchPlaceholder,
  loading = false,
  submitLabel = 'Search',
  clearLabel = 'Clear filters',
}: DataGridSearchPanelProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box component="form" onSubmit={onSubmit}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 1.5,
            alignItems: { xs: 'stretch', sm: 'flex-start' },
            flexWrap: 'wrap',
          }}
        >
          <TextField
            fullWidth
            size="small"
            placeholder={searchPlaceholder}
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            sx={{ flex: { sm: 1 }, minWidth: { sm: 200 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search color="action" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button type="submit" variant="contained" disabled={loading} sx={{ minWidth: 100 }}>
              {loading ? 'Searching…' : submitLabel}
            </Button>
            <Button
              type="button"
              variant="outlined"
              color="secondary"
              startIcon={<FilterAltOff />}
              disabled={loading}
              onClick={onClear}
            >
              {clearLabel}
            </Button>
          </Box>
        </Box>
      </Box>
    </Paper>
  )
}
