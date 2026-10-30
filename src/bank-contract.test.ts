import { describe, expect, it } from 'vitest';
import { bankSourceSchema } from './bank-contract';

const account = { id: 'a', name: 'Konto', last4: '4245', currency: 'PLN', balance: 1, balanceAt: 1 };
const transaction = (n: number) => ({ id: `a:${n}`, accountId: 'a', at: 1 + n, amount: -1, currency: 'PLN', title: 'Sklep' });
const source = (count: number) => ({ live: true, name: 'PKO BP', status: 'connected', observedAt: 1, data: { accounts: [account], transactions: Array.from({ length: count }, (_, n) => transaction(n)) } });

describe('bank source contract', () => {
  // The server keeps up to 700 operations of a reading (KEEP in server/bank.ts); the tile refused anything above the schema's limit,
  // which showed as "no connection to the local server" for the whole tile.
  it('takes as many operations as the server keeps', () => {
    expect(bankSourceSchema.safeParse(source(700)).success).toBe(true);
    expect(bankSourceSchema.safeParse(source(701)).success).toBe(false);
  });
});
