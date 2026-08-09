import { Box, TextField, Typography } from '@mui/material'
import { toTitleCase } from '../../lib/textCase'
import type { RegistrationDraft } from '../../lib/registrationDraft'

type Props = {
  draft: RegistrationDraft
  onChange: (patch: Partial<RegistrationDraft>) => void
}

/** Mirrors FamilyDetailEditForm's field set exactly, minus the email field — see registrationDraft.ts. */
export function ParentsStep({ draft, onChange }: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        size="small"
        label="Nama Keluarga"
        value={draft.familyName}
        onChange={(e) => onChange({ familyName: e.target.value })}
        onBlur={() => onChange({ familyName: toTitleCase(draft.familyName) })}
        required
        fullWidth
      />
      <TextField
        size="small"
        label="Telepon Kontak"
        value={draft.contactPhone}
        onChange={(e) => onChange({ contactPhone: e.target.value })}
        required
        fullWidth
        helperText="Info login orang tua dikirim ke nomor ini melalui WhatsApp setelah pendaftaran diverifikasi."
      />

      <Typography variant="subtitle2" sx={{ mt: 1 }}>Ayah</Typography>
      <TextField
        size="small"
        label="Nama Ayah"
        value={draft.fatherName}
        onChange={(e) => onChange({ fatherName: e.target.value })}
        onBlur={() => onChange({ fatherName: toTitleCase(draft.fatherName) })}
        fullWidth
      />
      <TextField
        size="small"
        label="Pekerjaan Ayah"
        value={draft.fatherOccupation}
        onChange={(e) => onChange({ fatherOccupation: e.target.value })}
        onBlur={() => onChange({ fatherOccupation: toTitleCase(draft.fatherOccupation) })}
        fullWidth
      />
      <TextField
        size="small"
        label="Nomor Telepon Ayah"
        value={draft.fatherPhone}
        onChange={(e) => onChange({ fatherPhone: e.target.value })}
        fullWidth
      />

      <Typography variant="subtitle2" sx={{ mt: 1 }}>Ibu</Typography>
      <TextField
        size="small"
        label="Nama Ibu"
        value={draft.motherName}
        onChange={(e) => onChange({ motherName: e.target.value })}
        onBlur={() => onChange({ motherName: toTitleCase(draft.motherName) })}
        fullWidth
      />
      <TextField
        size="small"
        label="Pekerjaan Ibu"
        value={draft.motherOccupation}
        onChange={(e) => onChange({ motherOccupation: e.target.value })}
        onBlur={() => onChange({ motherOccupation: toTitleCase(draft.motherOccupation) })}
        fullWidth
      />
      <TextField
        size="small"
        label="Nomor Telepon Ibu"
        value={draft.motherPhone}
        onChange={(e) => onChange({ motherPhone: e.target.value })}
        fullWidth
      />

      <Typography variant="subtitle2" sx={{ mt: 1 }}>Alamat</Typography>
      <TextField
        size="small"
        label="Alamat"
        value={draft.address}
        onChange={(e) => onChange({ address: e.target.value })}
        onBlur={() => onChange({ address: toTitleCase(draft.address) })}
        fullWidth
        multiline
        rows={2}
      />
    </Box>
  )
}
