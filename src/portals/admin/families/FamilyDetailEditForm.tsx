import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { createFamilyAccount } from '../../../lib/createFamilyAccount'
import { familyEmailLocalPart, generateUniqueFamilyEmail } from '../../../lib/familyEmail'
import { toTitleCase } from '../../../lib/textCase'
import { CredentialsRevealDialog } from '../../../components/CredentialsRevealDialog'
import type { FamilyRow } from '../../../types/family'

export type FamilyDetailEditFormHandle = {
  /** Create mode: advances form -> review on the first call (validating + resolving the login
   *  email), then actually saves on the next. Edit mode: always saves — there is no review step. */
  submit: () => Promise<void>
  /** Review step only: back to the form without discarding what was entered. */
  back: () => void
}

type Props = {
  family: FamilyRow | null
  onSaved: () => void
  /** Batal (create dialog only). */
  onCancel?: () => void
  /**
   * When true, the built-in actions row (Batal/Selanjutnya/Simpan) is suppressed. The parent
   * is expected to render its own buttons and drive the form via the imperative handle.
   */
  hideActions?: boolean
  onBusyChange?: (busy: { saving: boolean; generating: boolean; checking: boolean }) => void
  /** Create mode only — mirrors the internal step, so a parent using hideActions can label its
   *  own button and offer a "Kembali" action. Always 'form' in edit mode. */
  onStepChange?: (step: 'form' | 'review') => void
}

/** Read-only stand-in for a TextField on the review step: same label-above-value shape as the
 *  form it mirrors, just without the input chrome. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body1">{value || '—'}</Typography>
    </Box>
  )
}

export const FamilyDetailEditForm = forwardRef<FamilyDetailEditFormHandle, Props>(function FamilyDetailEditForm(
  { family, onSaved, onCancel, hideActions = false, onBusyChange, onStepChange },
  ref,
) {
  const isEdit = family !== null

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [fatherName, setFatherName] = useState('')
  const [fatherOccupation, setFatherOccupation] = useState('')
  const [fatherPhone, setFatherPhone] = useState('')
  const [motherName, setMotherName] = useState('')
  const [motherOccupation, setMotherOccupation] = useState('')
  const [motherPhone, setMotherPhone] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [credentials, setCredentials] = useState<{ email: string; password: string; reused?: boolean } | null>(null)

  /** Create mode only: 'form' while filling in details, 'review' once the login email has
   *  been resolved and the admin is confirming everything before the account is created. */
  const [step, setStep] = useState<'form' | 'review'>('form')
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [generatedEmail, setGeneratedEmail] = useState('')

  const phoneDigits = phone.replace(/\D/g, '')

  useEffect(() => {
    setName(family?.name ?? '')
    setEmail(family?.contact_email ?? '')
    setPhone(family?.contact_phone ?? '')
    setFatherName(family?.father_name ?? '')
    setFatherOccupation(family?.father_occupation ?? '')
    setFatherPhone(family?.father_phone ?? '')
    setMotherName(family?.mother_name ?? '')
    setMotherOccupation(family?.mother_occupation ?? '')
    setMotherPhone(family?.mother_phone ?? '')
    setAddress(family?.address ?? '')
    setError(null)
  }, [family])

  useEffect(() => {
    onBusyChange?.({ saving, generating, checking: checkingEmail })
  }, [saving, generating, checkingEmail, onBusyChange])

  useEffect(() => {
    onStepChange?.(step)
  }, [step, onStepChange])

  const extras = {
    father_name: fatherName.trim() || null,
    father_occupation: fatherOccupation.trim() || null,
    father_phone: fatherPhone.trim() || null,
    mother_name: motherName.trim() || null,
    mother_occupation: motherOccupation.trim() || null,
    mother_phone: motherPhone.trim() || null,
    address: address.trim() || null,
  }

  async function handleSave() {
    setError(null)
    if (isEdit && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Masukkan alamat email yang valid.')
      return
    }
    if (!phoneDigits) {
      setError('Masukkan nomor telepon kontak — digunakan untuk mengirim info login melalui WhatsApp.')
      return
    }
    if (!isEdit && !familyEmailLocalPart(name)) {
      setError('Masukkan nama keluarga untuk membuat email login.')
      return
    }

    setSaving(true)
    if (isEdit) {
      const { error: uErr } = await supabase
        .from('families')
        .update({
          name: name.trim(),
          contact_email: email.trim(),
          contact_phone: phone.trim() || null,
          ...extras,
        })
        .eq('id', family.id)
      setSaving(false)
      if (uErr) {
        setError(uErr.message)
        return
      }
      onSaved()
    } else {
      // generatedEmail was already resolved in handleNext(), before the review step ever
      // showed — recomputing here could silently save a different address than the one the
      // admin just reviewed.
      const result = await createFamilyAccount({ name, email: generatedEmail, phone })
      if (!result.ok) {
        setSaving(false)
        setError(result.message)
        return
      }

      // Patch the extra fields onto the newly created family row (looked up by email).
      const hasExtras = Object.values(extras).some((v) => v !== null)
      if (hasExtras) {
        await supabase.from('families').update(extras).eq('contact_email', generatedEmail)
      }

      setSaving(false)
      setCredentials({ email: generatedEmail, password: result.password })
    }
  }

  /** Create mode: validates the form, resolves the actual (uniqueness-checked) login email,
   *  and moves to the review step — nothing is written yet. */
  async function handleNext() {
    setError(null)
    if (!phoneDigits) {
      setError('Masukkan nomor telepon kontak — digunakan untuk mengirim info login melalui WhatsApp.')
      return
    }
    if (!familyEmailLocalPart(name)) {
      setError('Masukkan nama keluarga untuk membuat email login.')
      return
    }
    setCheckingEmail(true)
    const resolvedEmail = await generateUniqueFamilyEmail(name)
    setCheckingEmail(false)
    setGeneratedEmail(resolvedEmail)
    setStep('review')
  }

  function handleBack() {
    setError(null)
    setStep('form')
  }

  useImperativeHandle(ref, () => ({
    submit: () => (!isEdit && step === 'form' ? handleNext() : handleSave()),
    back: handleBack,
  }))

  async function handleGenerateCredentials() {
    if (!family) return
    const targetEmail = email.trim() || family.contact_email || ''
    if (!targetEmail) return
    setGenerating(true)
    setError(null)
    const result = await createFamilyAccount({
      name: name.trim() || family.name,
      email: targetEmail,
      phone: phone.trim() || family.contact_phone,
    })
    setGenerating(false)
    if (!result.ok) {
      setError(`Gagal membuat info login: ${result.message}`)
      return
    }
    setCredentials({ email: targetEmail, password: result.password, reused: !!family.auth_user_id })
  }

  function handleCredentialsDone() {
    setCredentials(null)
    onSaved()
  }

  const canGenerateCredentials = isEdit && !!(email.trim() || family.contact_email) && !!phoneDigits

  if (!isEdit && step === 'review') {
    return (
      <>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Field label="Nama Keluarga" value={name} />
          <Field label="Email Login" value={generatedEmail} />
          <Field label="Telepon Kontak" value={phone} />
          <Field label="Nama Ayah" value={fatherName} />
          <Field label="Pekerjaan Ayah" value={fatherOccupation} />
          <Field label="Nomor Telepon Ayah" value={fatherPhone} />
          <Field label="Nama Ibu" value={motherName} />
          <Field label="Pekerjaan Ibu" value={motherOccupation} />
          <Field label="Nomor Telepon Ibu" value={motherPhone} />
          <Field label="Alamat" value={address} />

          {hideActions ? null : (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', mt: 1 }}>
              <Button onClick={handleBack} disabled={saving}>
                Kembali
              </Button>
              {onCancel ? (
                <Button onClick={onCancel} disabled={saving}>
                  Batal
                </Button>
              ) : null}
              <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Membuat…' : 'Simpan & Buat Login'}
              </Button>
            </Box>
          )}
        </Box>
        <CredentialsRevealDialog
          open={credentials !== null}
          name={name.trim()}
          email={credentials?.email ?? ''}
          password={credentials?.password ?? ''}
          phone={phone}
          reused={credentials?.reused}
          onClose={handleCredentialsDone}
        />
      </>
    )
  }

  return (
    <>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          size="small"
          label="Nama Keluarga"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setName((v) => toTitleCase(v))}
          required
          fullWidth
        />
        {isEdit ? (
          <TextField
            size="small"
            label="Email Kontak"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
            helperText="Digunakan sebagai email login orang tua."
          />
        ) : null}
        <TextField
          size="small"
          label="Telepon Kontak"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          fullWidth
          helperText="Detail login dikirim ke nomor ini melalui WhatsApp."
        />

        <Typography variant="subtitle2" sx={{ mt: 1 }}>Ayah</Typography>
        <TextField
          size="small"
          label="Nama Ayah"
          value={fatherName}
          onChange={(e) => setFatherName(e.target.value)}
          onBlur={() => setFatherName((v) => toTitleCase(v))}
          fullWidth
        />
        <TextField
          size="small"
          label="Pekerjaan Ayah"
          value={fatherOccupation}
          onChange={(e) => setFatherOccupation(e.target.value)}
          onBlur={() => setFatherOccupation((v) => toTitleCase(v))}
          fullWidth
        />
        <TextField
          size="small"
          label="Nomor Telepon Ayah"
          value={fatherPhone}
          onChange={(e) => setFatherPhone(e.target.value)}
          fullWidth
        />

        <Typography variant="subtitle2" sx={{ mt: 1 }}>Ibu</Typography>
        <TextField
          size="small"
          label="Nama Ibu"
          value={motherName}
          onChange={(e) => setMotherName(e.target.value)}
          onBlur={() => setMotherName((v) => toTitleCase(v))}
          fullWidth
        />
        <TextField
          size="small"
          label="Pekerjaan Ibu"
          value={motherOccupation}
          onChange={(e) => setMotherOccupation(e.target.value)}
          onBlur={() => setMotherOccupation((v) => toTitleCase(v))}
          fullWidth
        />
        <TextField
          size="small"
          label="Nomor Telepon Ibu"
          value={motherPhone}
          onChange={(e) => setMotherPhone(e.target.value)}
          fullWidth
        />

        <Typography variant="subtitle2" sx={{ mt: 1 }}>Alamat</Typography>
        <TextField
          size="small"
          label="Alamat"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onBlur={() => setAddress((v) => toTitleCase(v))}
          fullWidth
          multiline
          rows={2}
        />

        {isEdit ? (
          <Button
            variant="outlined"
            disabled={generating || saving || !canGenerateCredentials}
            onClick={() => void handleGenerateCredentials()}
            sx={{ alignSelf: 'flex-start' }}
          >
            {generating ? 'Memproses…' : family.auth_user_id ? 'Reset Kata Sandi' : 'Buat Info Login'}
          </Button>
        ) : null}

        {hideActions ? null : (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            {onCancel ? (
              <Button onClick={onCancel} disabled={saving}>
                Batal
              </Button>
            ) : null}
            <Button
              variant="contained"
              onClick={() => void (isEdit ? handleSave() : handleNext())}
              disabled={
                saving ||
                generating ||
                checkingEmail ||
                !name.trim() ||
                !phoneDigits ||
                (isEdit ? !email.trim() : !familyEmailLocalPart(name))
              }
            >
              {isEdit
                ? saving
                  ? 'Menyimpan…'
                  : 'Simpan'
                : checkingEmail
                  ? 'Memeriksa…'
                  : 'Selanjutnya'}
            </Button>
          </Box>
        )}
      </Box>
      <CredentialsRevealDialog
        open={credentials !== null}
        name={name.trim() || family?.name || ''}
        email={credentials?.email ?? ''}
        password={credentials?.password ?? ''}
        phone={phone}
        reused={credentials?.reused}
        onClose={handleCredentialsDone}
      />
    </>
  )
})
