import { Box, Paper, Typography } from '@mui/material'
import { formatIdr } from '../../lib/formatIdr'
import { mandatoryFeeTotal, type FeeItemOption } from '../../lib/registrationDraft'

type Props = {
  feeItems: FeeItemOption[]
  childCount: number
}

/**
 * Itemized breakdown of the mandatory per-child equipment fee (uniform, stationery) — nothing
 * here is selectable, it's informational only, so parents see exactly what the "+ perlengkapan
 * wajib" line on the total is made of before they transfer. Shared between PaymentStep and
 * ReviewStep so the two never show it differently.
 */
export function MandatoryFeeCard({ feeItems, childCount }: Props) {
  if (feeItems.length === 0) return null
  const perChild = mandatoryFeeTotal(feeItems)

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        Perlengkapan Wajib (per anak)
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {feeItems.map((item) => (
          <Box key={item.id}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {item.label} · {formatIdr(item.price)}
            </Typography>
            {item.items.map((line) => (
              <Typography key={line} variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1.5 }}>
                • {line}
              </Typography>
            ))}
          </Box>
        ))}
      </Box>
      <Typography variant="body2" sx={{ mt: 1.5 }}>
        {formatIdr(perChild)} × {childCount} anak = <strong>{formatIdr(perChild * childCount)}</strong>
      </Typography>
    </Paper>
  )
}
