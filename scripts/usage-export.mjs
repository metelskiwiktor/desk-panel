// Prints the usage summaries of a period as JSON, read from the running service (docs/uzycie.md).
// Usage: node scripts/usage-export.mjs [FROM] [TO]   (dates YYYY-MM-DD in Europe/Warsaw; default: the last 7 days)
const day = offset => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(Date.now() + offset * 86_400_000);
const [from = day(-6), to = day(0)] = process.argv.slice(2);
const port = process.env.DESK_PORT || 5174;
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/usage/summary?from=${from}&to=${to}`);
  const body = await response.text();
  if (!response.ok) { console.error(`Usługa odpowiedziała ${response.status}: ${body}`); process.exit(1); }
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.error(`Usługa nie odpowiada na porcie ${port}. Uruchom ją (just service) i spróbuj ponownie.`);
  process.exit(1);
}
