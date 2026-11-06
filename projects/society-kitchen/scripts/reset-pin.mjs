// Sets a new PIN for a resident who forgot theirs (also clears any lockout).
//   DATABASE_URL=... node scripts/reset-pin.mjs MAPLE-7QX4K "Meera Iyer" B-402 123456
// Give the resident the new PIN privately; they can sign in with it right away.
import { hashPin, loginKey } from '../server/pinauth.mjs';
let Pool;
try { ({ Pool } = (await import('pg')).default); } catch { ({ Pool } = await import('../lib/minipg.mjs')); }

const [code, name, flat, pin] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !pin) { console.error('Usage: DATABASE_URL=... node scripts/reset-pin.mjs INVITE-CODE "Full name" FLAT NEW-6-DIGIT-PIN'); process.exit(1); }
if (!/^\d{6}$/.test(pin)) { console.error('The PIN must be exactly 6 digits.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows: [soc] } = await pool.query('select id from societies where lower(invite_code) = lower(trim($1))', [code]);
const res = soc && await pool.query(
  'update accounts set pin_hash = $2, failed_pins = 0, locked_until = null where login_key = $1 returning id',
  [loginKey(soc.id, name, flat), hashPin(pin)]);
console.log(res?.rows.length ? `PIN reset for ${name} (${flat}).` : 'No such resident. Check the invite code, name and flat.');
await pool.end();
process.exit(res?.rows.length ? 0 : 1);
