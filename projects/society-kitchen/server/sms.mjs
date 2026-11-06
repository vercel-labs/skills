// How one-time codes get to a phone.
//   OTP_PROVIDER=console  prints the code in the server log (development only)
//   OTP_PROVIDER=webhook  POSTs {phone, message} as JSON to OTP_WEBHOOK_URL, so any
//                         SMS gateway (MSG91, Twilio, a small cloud function...) can be plugged in.
// Indian SMS gateways usually require a pre-registered message template (DLT);
// adjust `message` in the receiving function to match yours.
export function createSender({ provider = 'console', webhookUrl } = {}) {
  if (provider === 'console') {
    return async (phone, code) => { console.log(`[OTP] ${phone}: ${code}`); };
  }
  if (provider === 'webhook') {
    if (!webhookUrl) throw new Error('OTP_PROVIDER=webhook needs OTP_WEBHOOK_URL');
    return async (phone, code) => {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, message: `${code} is your Society Kitchen code. It expires in 10 minutes. Don't share it with anyone.` }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`SMS webhook answered ${res.status}`);
    };
  }
  throw new Error(`Unknown OTP_PROVIDER "${provider}" (use console or webhook)`);
}
