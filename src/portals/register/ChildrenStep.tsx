import DeleteIcon from '@mui/icons-material/Delete'
import { Box, Button, IconButton, Paper, TextField, Typography } from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { formatAge } from '../../lib/calculateAge'
import { toTitleCase } from '../../lib/textCase'
import { MAX_CHILDREN, emptyChild, type DraftChild } from '../../lib/registrationDraft'

type Props = {
  children: DraftChild[]
  onChange: (children: DraftChild[]) => void
}

export function ChildrenStep({ children, onChange }: Props) {
  function updateChild(key: string, patch: Partial<DraftChild>) {
    onChange(children.map((child) => (child.key === key ? { ...child, ...patch } : child)))
  }

  function addChild() {
    onChange([...children, emptyChild(crypto.randomUUID())])
  }

  function removeChild(key: string) {
    onChange(children.filter((child) => child.key !== key))
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {children.map((child, index) => (
        <Paper key={child.key} variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle2">Anak {index + 1}</Typography>
            {children.length > 1 ? (
              <IconButton
                size="small"
                aria-label={`Hapus Anak ${index + 1}`}
                onClick={() => removeChild(child.key)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            ) : null}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              size="small"
              label="Nama Lengkap"
              value={child.fullName}
              onChange={(e) => updateChild(child.key, { fullName: e.target.value })}
              onBlur={() => updateChild(child.key, { fullName: toTitleCase(child.fullName) })}
              required
              fullWidth
            />
            <TextField
              size="small"
              label="Tempat Lahir"
              value={child.birthPlace}
              onChange={(e) => updateChild(child.key, { birthPlace: e.target.value })}
              onBlur={() => updateChild(child.key, { birthPlace: toTitleCase(child.birthPlace) })}
              fullWidth
            />
            <DatePicker
              label="Tanggal Lahir"
              value={child.birthdate ? dayjs(child.birthdate) : null}
              onChange={(value) =>
                updateChild(child.key, {
                  birthdate: value?.isValid() ? value.format('YYYY-MM-DD') : null,
                })
              }
              format="DD-MM-YYYY"
              disableFuture
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
            {child.birthdate && formatAge(dayjs(child.birthdate)) ? (
              <Typography variant="body2" color="text.secondary">
                Usia: {formatAge(dayjs(child.birthdate))}
              </Typography>
            ) : null}
            <TextField
              size="small"
              label="Catatan (opsional)"
              value={child.notes}
              onChange={(e) => updateChild(child.key, { notes: e.target.value })}
              multiline
              minRows={2}
              fullWidth
            />
          </Box>
        </Paper>
      ))}

      <Button
        variant="outlined"
        onClick={addChild}
        disabled={children.length >= MAX_CHILDREN}
        sx={{ alignSelf: 'flex-start' }}
      >
        Tambah Anak
      </Button>
    </Box>
  )
}
