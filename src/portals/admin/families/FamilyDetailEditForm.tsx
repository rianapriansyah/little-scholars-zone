import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import DeleteIcon from '@mui/icons-material/Delete'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { supabase } from '../../../lib/supabase'
import { createFamilyAccount } from '../../../lib/createFamilyAccount'
import { familyEmailLocalPart, generateUniqueFamilyEmail } from '../../../lib/familyEmail'
import { formatAge } from '../../../lib/calculateAge'
import { DISPLAY_DATE_FORMAT, formatDate } from '../../../lib/formatDate'
import { todayIsoDateInWita } from '../../../lib/classStatus'
import { findChildPeriodError } from '../../../lib/familyChildPeriods'
import { formatIdr } from '../../../lib/formatIdr'
import { createChildrenWithFirstPeriods, fetchActiveClassrooms } from '../../../lib/learningPeriods'
import { uploadPaymentReceipt } from '../../../lib/paymentPeriods'
import type { ClassroomRow } from '../../../types/classroom'
import { MAX_CHILDREN } from '../../../lib/registrationDraft'
import { toTitleCase } from '../../../lib/textCase'
import { FormPanel as Panel, FormSection as Section } from '../../../components/FormSection'
import { CredentialsRevealDialog } from '../../../components/CredentialsRevealDialog'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { DangerZone } from '../../../components/DangerZone'
import { familyDisplayName } from '../../../lib/familyDisplayName'
import type { FamilyRow } from '../../../types/family'

export type FamilyDetailEditFormHandle = {
  /** Create mode: advances one step (form -> children -> review) on each call, resolving the
   *  login email on the first, then actually saves on the last. Edit mode: always saves —
   *  there is no wizard. */
  submit: () => Promise<void>
  /** Children/review steps only: back one step without discarding what was entered. */
  back: () => void
}

/** Create mode only. One child being entered before the family is saved — never sent to the
 *  server directly; handleSave() maps these onto `children` rows once the family exists. */
type DraftChild = {
  /** React list key, never sent to the server. */
  key: string
  fullName: string
  birthPlace: string
  /** ISO yyyy-mm-dd, or null when not filled in. */
  birthdate: string | null
  notes: string
  /** First learning period — required for every named child (the family has already paid). */
  classroomId: string
  /** ISO yyyy-mm-dd, or '' when cleared. */
  startDate: string
  /** Sudah Lunas: the period's payment row is marked paid in the same transaction. */
  paid: boolean
  /** Optional proof of payment, uploaded once the payment row exists. Only used when `paid`. */
  receiptFile: File | null
}

function emptyChild(key: string): DraftChild {
  return {
    key,
    fullName: '',
    birthPlace: '',
    birthdate: null,
    notes: '',
    classroomId: '',
    startDate: todayIsoDateInWita(),
    paid: true,
    receiptFile: null,
  }
}

type Step = 'form' | 'children' | 'review'

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
  onStepChange?: (step: Step) => void
  /** Edit mode only: called after the family (and, via ON DELETE CASCADE, every one of its
   *  children and their learning periods, attendance, daily reports and invoices) has been
   *  deleted. The caller is expected to navigate away — this row no longer exists. */
  onDeleted?: () => void
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
  { family, onSaved, onCancel, hideActions = false, onBusyChange, onStepChange, onDeleted },
  ref,
) {
  const isEdit = family !== null

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleteChildCount, setDeleteChildCount] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  /** Create mode only: 'form' (parents) -> 'children' -> 'review', once the login email has
   *  been resolved and the admin is confirming everything before the account is created. */
  const [step, setStep] = useState<Step>('form')
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [generatedEmail, setGeneratedEmail] = useState('')
  const [children, setChildren] = useState<DraftChild[]>([emptyChild(crypto.randomUUID())])
  /** Create mode only: what a first learning period can be sold for — active, fee-paying classes. */
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([])

  useEffect(() => {
    if (family) return
    void fetchActiveClassrooms().then((result) => {
      if (result.ok) setClassrooms(result.data)
      else setError(result.error)
    })
  }, [family])

  const phoneDigits = phone.replace(/\D/g, '')
  // Families aren't identified by a "family name" — the login email is derived from whichever
  // parent's name is on file, father first.
  const primaryParentName = fatherName.trim() || motherName.trim()

  useEffect(() => {
    setEmail(family?.login_email ?? '')
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
    if (!isEdit && !familyEmailLocalPart(primaryParentName)) {
      setError('Masukkan nama ayah atau ibu untuk membuat email login.')
      return
    }
    // Checked again here, before the login is created — failing after it would leave a family
    // account with none of its children.
    if (!isEdit) {
      const periodError = findChildPeriodError(children)
      if (periodError) {
        setError(periodError)
        return
      }
    }

    setSaving(true)
    if (isEdit) {
      const { error: uErr } = await supabase
        .from('families')
        .update({
          login_email: email.trim(),
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
      const result = await createFamilyAccount({ email: generatedEmail, phone })
      if (!result.ok) {
        setSaving(false)
        setError(result.message)
        return
      }

      // Need the new row's id for children.family_id — createFamilyAccount only returns the
      // auth user, not the family row.
      const { data: familyRow, error: familyErr } = await supabase
        .from('families')
        .select('id')
        .eq('login_email', generatedEmail)
        .single()

      if (familyErr || !familyRow) {
        setSaving(false)
        // The login already exists at this point — surface it as a login result, not a
        // fatal error, so the admin isn't misled into retrying and creating a duplicate.
        setCredentials({ email: generatedEmail, password: result.password })
        return
      }

      // Patch the extra fields onto the newly created family row.
      const hasExtras = Object.values(extras).some((v) => v !== null)
      if (hasExtras) {
        await supabase.from('families').update(extras).eq('id', familyRow.id)
      }

      // Blank cards (never filled in) are silently dropped — Data Anak is optional here, but
      // every named child arrives with their first, already-sold learning period. Children,
      // periods and the paid flag go in as one transaction, so a failure never strands a child
      // without a period.
      const namedChildren = children.filter((child) => child.fullName.trim())
      if (namedChildren.length > 0) {
        const created = await createChildrenWithFirstPeriods(
          familyRow.id,
          namedChildren.map((child) => ({
            fullName: child.fullName.trim(),
            birthPlace: child.birthPlace.trim() || null,
            birthdate: child.birthdate,
            notes: child.notes.trim() || null,
            classroomId: child.classroomId,
            startDate: child.startDate,
            paid: child.paid,
          })),
        )
        if (!created.ok) {
          setSaving(false)
          setError(
            `Keluarga dan login tersimpan, tetapi gagal menyimpan data anak dan periode belajar: ${created.error}`,
          )
          setCredentials({ email: generatedEmail, password: result.password })
          return
        }

        // Receipts are history only — attaching one never changes the paid status — so a failed
        // upload is reported but undoes nothing.
        const failedReceipts: string[] = []
        for (const [index, child] of namedChildren.entries()) {
          if (!child.paid || !child.receiptFile) continue
          const upload = await uploadPaymentReceipt(created.data[index].paymentPeriodId, child.receiptFile)
          if (!upload.ok) failedReceipts.push(child.fullName.trim())
        }
        if (failedReceipts.length > 0) {
          setError(
            `Gagal mengunggah bukti pembayaran untuk: ${failedReceipts.join(', ')}. Unggah ulang dari Data Anak → Periode Belajar → Pembayaran.`,
          )
        }
      }

      setSaving(false)
      setCredentials({ email: generatedEmail, password: result.password })
    }
  }

  /** Parents step: validates the form, resolves the actual (uniqueness-checked) login email,
   *  and moves to Data Anak — nothing is written yet. */
  async function handleNext() {
    setError(null)
    if (!phoneDigits) {
      setError('Masukkan nomor telepon kontak — digunakan untuk mengirim info login melalui WhatsApp.')
      return
    }
    if (!familyEmailLocalPart(primaryParentName)) {
      setError('Masukkan nama ayah atau ibu untuk membuat email login.')
      return
    }
    setCheckingEmail(true)
    const resolvedEmail = await generateUniqueFamilyEmail(primaryParentName)
    setCheckingEmail(false)
    setGeneratedEmail(resolvedEmail)
    setStep('children')
  }

  function updateChild(key: string, patch: Partial<DraftChild>) {
    setChildren((prev) => prev.map((child) => (child.key === key ? { ...child, ...patch } : child)))
  }

  function addChild() {
    setChildren((prev) => [...prev, emptyChild(crypto.randomUUID())])
  }

  function removeChild(key: string) {
    setChildren((prev) => prev.filter((child) => child.key !== key))
  }

  /** Children step → review, only once every named child has a class and start date. */
  function goToReview() {
    const periodError = findChildPeriodError(children)
    if (periodError) {
      setError(periodError)
      return
    }
    setError(null)
    setStep('review')
  }

  function handleBack() {
    setError(null)
    setStep((current) => (current === 'review' ? 'children' : 'form'))
  }

  useImperativeHandle(ref, () => ({
    submit: () => {
      if (isEdit) return handleSave()
      if (step === 'form') return handleNext()
      if (step === 'children') {
        goToReview()
        return Promise.resolve()
      }
      return handleSave()
    },
    back: handleBack,
  }))

  async function handleGenerateCredentials() {
    if (!family) return
    const targetEmail = email.trim() || family.login_email || ''
    if (!targetEmail) return
    setGenerating(true)
    setError(null)
    const result = await createFamilyAccount({
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

  /** Looks up how many children hang off this family first, purely so the confirmation dialog
   *  can tell the admin what they're about to lose — the delete itself doesn't need the count. */
  async function handleOpenDelete() {
    if (!family) return
    const { count } = await supabase
      .from('children')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', family.id)
    setDeleteChildCount(count ?? 0)
    setConfirmDeleteOpen(true)
  }

  async function handleDelete() {
    if (!family) return
    setDeleting(true)
    setError(null)
    // ON DELETE CASCADE takes every child, and their learning periods, attendance, daily
    // reports and invoices, down with the family in the same statement.
    const { error: dErr } = await supabase.from('families').delete().eq('id', family.id)
    setDeleting(false)
    setConfirmDeleteOpen(false)
    if (dErr) {
      setError(dErr.message)
      return
    }
    onDeleted?.()
  }

  const canGenerateCredentials = isEdit && !!(email.trim() || family.login_email) && !!phoneDigits

  if (!isEdit && step === 'children') {
    return (
      <>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {children.map((child, index) => (
            <Paper key={child.key} variant="outlined" sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="subtitle2">{children.length > 1 ? `Anak ${index + 1}` : 'Anak'}</Typography>
                {children.length > 1 ? (
                  <IconButton size="small" aria-label={`Hapus Anak ${index + 1}`} onClick={() => removeChild(child.key)}>
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
                    updateChild(child.key, { birthdate: value?.isValid() ? value.format('YYYY-MM-DD') : null })
                  }
                  format={DISPLAY_DATE_FORMAT}
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

                <Typography variant="subtitle2" sx={{ mt: 1 }}>
                  Periode Belajar
                </Typography>
                <TextField
                  size="small"
                  select
                  label="Kelas"
                  value={child.classroomId}
                  onChange={(e) => updateChild(child.key, { classroomId: e.target.value })}
                  required
                  fullWidth
                  helperText="Periode mengikuti kelas, bukan guru — ganti guru tidak mengatur ulang kuota."
                >
                  {classrooms.map((classroom) => (
                    <MenuItem key={classroom.id} value={classroom.id}>
                      {classroom.label} · {classroom.time_start.slice(0, 5)}
                      {classroom.time_end ? `–${classroom.time_end.slice(0, 5)}` : ''}
                    </MenuItem>
                  ))}
                </TextField>
                <DatePicker
                  label="Tanggal Mulai"
                  value={child.startDate ? dayjs(child.startDate) : null}
                  onChange={(value) =>
                    updateChild(child.key, { startDate: value?.isValid() ? value.format('YYYY-MM-DD') : '' })
                  }
                  format={DISPLAY_DATE_FORMAT}
                  slotProps={{ textField: { size: 'small', fullWidth: true, required: true } }}
                />
                {(() => {
                  // Read-only: the trigger copies quota and price from the classroom at insert, so
                  // an editable field here would promise something the database will overwrite.
                  const classroom = classrooms.find((c) => c.id === child.classroomId)
                  return classroom ? (
                    <Alert severity="info">
                      Kuota: <strong>{classroom.guaranteed_days} hari efektif</strong> · Harga{' '}
                      {formatIdr(classroom.price)}. Sakit tidak memotong kuota.
                    </Alert>
                  ) : null
                })()}
                <FormControlLabel
                  control={
                    <Switch
                      checked={child.paid}
                      onChange={(e) =>
                        updateChild(child.key, {
                          paid: e.target.checked,
                          // A receipt only belongs to a paid period — drop it if unpaid.
                          receiptFile: e.target.checked ? child.receiptFile : null,
                        })
                      }
                    />
                  }
                  label="Sudah Lunas"
                />
                {child.paid ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
                    <Button variant="outlined" component="label" size="small" startIcon={<UploadFileIcon />}>
                      {child.receiptFile ? 'Ganti Bukti Pembayaran' : 'Unggah Bukti Pembayaran (opsional)'}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null
                          e.target.value = ''
                          if (file) updateChild(child.key, { receiptFile: file })
                        }}
                      />
                    </Button>
                    {child.receiptFile ? (
                      <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                        {child.receiptFile.name}
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}
              </Box>
            </Paper>
          ))}

          <Button
            variant="outlined"
            onClick={addChild}
            disabled={children.length >= MAX_CHILDREN}
            sx={{ alignSelf: 'flex-start' }}
          >
            Tambah Data Anak
          </Button>

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
              <Button variant="contained" onClick={goToReview}>
                Selanjutnya
              </Button>
            </Box>
          )}
        </Box>
      </>
    )
  }

  if (!isEdit && step === 'review') {
    return (
      <>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Field label="Email Login" value={generatedEmail} />
          <Field label="Telepon Kontak" value={phone} />
          <Field label="Nama Ayah" value={fatherName} />
          <Field label="Pekerjaan Ayah" value={fatherOccupation} />
          <Field label="Nomor Telepon Ayah" value={fatherPhone} />
          <Field label="Nama Ibu" value={motherName} />
          <Field label="Pekerjaan Ibu" value={motherOccupation} />
          <Field label="Nomor Telepon Ibu" value={motherPhone} />
          <Field label="Alamat" value={address} />

          {(() => {
            const namedChildren = children.filter((child) => child.fullName.trim())
            return namedChildren.flatMap((child, index) => {
              const suffix = namedChildren.length > 1 ? ` ${index + 1}` : ''
              const classroom = classrooms.find((c) => c.id === child.classroomId)
              return [
                <Field key={`${child.key}-name`} label={`Nama Anak${suffix}`} value={child.fullName} />,
                <Field key={`${child.key}-place`} label={`Tempat Lahir Anak${suffix}`} value={child.birthPlace} />,
                <Field
                  key={`${child.key}-date`}
                  label={`Tanggal Lahir Anak${suffix}`}
                  value={formatDate(child.birthdate, '')}
                />,
                <Field key={`${child.key}-notes`} label={`Catatan Anak${suffix}`} value={child.notes} />,
                <Field key={`${child.key}-classroom`} label={`Kelas Anak${suffix}`} value={classroom?.label ?? ''} />,
                <Field
                  key={`${child.key}-start`}
                  label={`Mulai Periode Anak${suffix}`}
                  value={formatDate(child.startDate, '')}
                />,
                <Field
                  key={`${child.key}-price`}
                  label={`Harga Periode Anak${suffix}`}
                  value={classroom ? formatIdr(classroom.price) : ''}
                />,
                <Field
                  key={`${child.key}-paid`}
                  label={`Pembayaran Anak${suffix}`}
                  value={child.paid ? 'Lunas' : 'Belum Lunas'}
                />,
                <Field
                  key={`${child.key}-receipt`}
                  label={`Bukti Pembayaran Anak${suffix}`}
                  value={child.paid ? (child.receiptFile?.name ?? '') : ''}
                />,
              ]
            })
          })()}

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
          name={primaryParentName}
          email={credentials?.email ?? ''}
          password={credentials?.password ?? ''}
          phone={phone}
          reused={credentials?.reused}
          onClose={handleCredentialsDone}
        />
      </>
    )
  }

  const fatherIsPrimaryContact = !!phoneDigits && phone.trim() === fatherPhone.trim() && !!fatherPhone.trim()
  const motherIsPrimaryContact = !!phoneDigits && phone.trim() === motherPhone.trim() && !!motherPhone.trim()

  return (
    <>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Section title="Kontak">
          <Panel>
            {isEdit ? (
              <TextField
                size="small"
                label="Email Login"
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
              slotProps={{ input: { readOnly: true } }}
              required
              fullWidth
              helperText="Diisi otomatis lewat tombol Kontak Utama di bawah — detail login dikirim ke nomor ini melalui WhatsApp."
            />
          </Panel>
          {isEdit ? (
            <Button
              variant="outlined"
              disabled={generating || saving || !canGenerateCredentials}
              onClick={() => void handleGenerateCredentials()}
              sx={{ alignSelf: 'flex-start', mt: 1.5 }}
            >
              {generating ? 'Memproses…' : family.auth_user_id ? 'Reset Kata Sandi' : 'Buat Info Login'}
            </Button>
          ) : null}
        </Section>

        <Section
          title="Ayah"
          chip={fatherIsPrimaryContact ? <Chip size="small" label="Kontak Utama" color="success" variant="outlined" /> : null}
        >
          <Panel>
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
            {fatherIsPrimaryContact ? null : (
              <Button
                variant="outlined"
                size="small"
                onClick={() => setPhone(fatherPhone)}
                fullWidth
              >
                Jadikan Kontak Utama
              </Button>
            )}
          </Panel>
        </Section>

        <Section
          title="Ibu"
          chip={motherIsPrimaryContact ? <Chip size="small" label="Kontak Utama" color="success" variant="outlined" /> : null}
        >
          <Panel>
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
            {motherIsPrimaryContact ? null : (
              <Button
                variant="outlined"
                size="small"
                onClick={() => setPhone(motherPhone)}
                fullWidth
              >
                Jadikan Kontak Utama
              </Button>
            )}
          </Panel>
        </Section>

        <Section title="Alamat">
          <Panel>
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
          </Panel>
        </Section>

        {hideActions ? null : (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', mt: 2 }}>
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
                !phoneDigits ||
                (isEdit ? !email.trim() : !familyEmailLocalPart(primaryParentName))
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

        {isEdit && !hideActions ? (
          <Box sx={{ mt: 3 }}>
            <DangerZone
              title="Zona Terbatas"
              description="Keluarga ini akan dihapus permanen, termasuk seluruh data anak, riwayat kelas, periode belajar, presensi, laporan harian, dan tagihan mereka."
              actionLabel="Hapus Keluarga"
              busyLabel="Menghapus…"
              busy={deleting}
              disabled={saving}
              onAction={() => void handleOpenDelete()}
            />
          </Box>
        ) : null}
      </Box>
      <CredentialsRevealDialog
        open={credentials !== null}
        name={primaryParentName}
        email={credentials?.email ?? ''}
        password={credentials?.password ?? ''}
        phone={phone}
        reused={credentials?.reused}
        onClose={handleCredentialsDone}
      />
      {isEdit ? (
        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Hapus Keluarga"
          description={
            deleteChildCount
              ? `Hapus keluarga "${familyDisplayName(family)}"? ${deleteChildCount} data anak beserta seluruh riwayat kelas, periode belajar, presensi, laporan harian, dan tagihan mereka akan ikut terhapus permanen. Tindakan ini tidak dapat dibatalkan.`
              : `Hapus keluarga "${familyDisplayName(family)}"? Tindakan ini tidak dapat dibatalkan.`
          }
          confirmLabel={deleting ? 'Menghapus…' : 'Hapus'}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => void handleDelete()}
        />
      ) : null}
    </>
  )
})
