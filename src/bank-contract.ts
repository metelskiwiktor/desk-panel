import { z } from 'zod';

/**
 * What the panel needs of the bank account (PKO BP through Enable Banking, read-only): the balance and the booked
 * operations. No full IBAN, no account holder, no ids from the bank beyond what tells two operations apart.
 */
export const bankAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** The last four digits of the IBAN. */
  last4: z.string().regex(/^\d{4}$/).nullable(),
  currency: z.string().length(3),
  balance: z.number().finite().nullable(),
  balanceAt: z.number().finite().nullable(),
});
export type BankAccount = z.infer<typeof bankAccountSchema>;

export const bankTransactionSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  /** Booking day, as noon UTC of that day: the bank gives a date, not a moment. */
  at: z.number().finite(),
  /** Negative for money that left the account. */
  amount: z.number().finite(),
  currency: z.string().length(3),
  /** The other side of the operation, or what the bank wrote as its title. */
  title: z.string(),
  /** The title of the transfer, when the other side is known. */
  note: z.string().optional(),
  /** What the bank sent for this operation (empty fields left out, IBANs cut to their last four digits), for reading in the panel. */
  raw: z.record(z.string(), z.unknown()).optional(),
});
export type BankTransaction = z.infer<typeof bankTransactionSchema>;

export const bankSourceSchema = z.object({
  live: z.literal(true), name: z.literal('PKO BP'),
  status: z.enum(['connected', 'offline', 'unavailable', 'loading']),
  observedAt: z.number().finite().nullable(),
  message: z.string().optional(),
  /** The bank consent is missing or has run out: the tile offers to connect again. */
  loginRequired: z.boolean().optional(),
  /** When the consent given in the bank runs out. */
  consentUntil: z.number().finite().nullable().optional(),
  data: z.object({
    accounts: z.array(bankAccountSchema).max(10),
    transactions: z.array(bankTransactionSchema).max(200),
  }).nullable(),
});
export type BankSource = z.infer<typeof bankSourceSchema>;
