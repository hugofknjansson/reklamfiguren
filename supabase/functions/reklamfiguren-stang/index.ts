// Runs when the auction closes (scheduled with pg_cron). Declares the winners and e-mails each one a link to the
// invoice-details form. Safe to call repeatedly: winners are fixed once, and each winner is e-mailed only once.
// E-mail is sent through Resend when the secrets RESEND_API_KEY and REKLAMFIGUREN_FROM are set. Without them the
// winners are still declared and listed in the view public.reklamfiguren_vinnare for manual follow-up.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CLOSE = Date.parse('2026-11-30T20:00:00+01:00');
const SITE = 'https://hugofknjansson.github.io/reklamfiguren/';
const SPOTS: Record<string, string> = {
  brost: 'Bröst', mage: 'Mage', rygg: 'Rygg', 'arm-v': 'Vänster ärm', 'arm-h': 'Höger ärm',
  'lar-v': 'Vänster lår', 'lar-h': 'Höger lår', 'ben-v': 'Vänster sida', 'ben-h': 'Höger sida', bakficka: 'Baksida',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const kr = (n: number) => n.toLocaleString('sv-SE') + ' kr';
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async () => {
  if (Date.now() < CLOSE) return json({ status: 'väntar', stänger: new Date(CLOSE).toISOString() }, 425);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { error: pickError } = await db.rpc('reklamfiguren_utse_vinnare');
  if (pickError) return json({ status: 'fel', steg: 'utse vinnare', fel: pickError.message }, 500);

  const { data: winners, error } = await db
    .from('reklamfiguren_vinst')
    .select('token, spot, email, emailed_at, reklamfiguren_bud(brand, amount)')
    .is('emailed_at', null);
  if (error) return json({ status: 'fel', steg: 'läsa vinnare', fel: error.message }, 500);

  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('REKLAMFIGUREN_FROM');
  if (!key || !from) return json({ status: 'vinnare utsedda, inga mejl skickade (e-posttjänst saknas)', väntar_på_mejl: winners?.length ?? 0 });

  const sent: string[] = [], failed: { spot: string; fel: string }[] = [];
  for (const w of winners ?? []) {
    const bid = Array.isArray(w.reklamfiguren_bud) ? w.reklamfiguren_bud[0] : w.reklamfiguren_bud;
    const name = SPOTS[w.spot] ?? w.spot, link = `${SITE}?vinst=${w.token}`;
    const text = [
      `Hej ${bid.brand}!`, '',
      `Grattis, du vann reklamytan ${name.toLowerCase()} på Reklamfiguren med ditt bud på ${kr(bid.amount)}.`, '',
      'Fyll i dina fakturauppgifter här, så skickar vi fakturan:', link, '',
      'Din annons syns redan på figuren.', '', 'Hälsningar', 'Reklamfiguren',
    ].join('\n');
    const html = `<p>Hej ${esc(bid.brand)}!</p>
<p>Grattis, du vann reklamytan <b>${esc(name.toLowerCase())}</b> på Reklamfiguren med ditt bud på <b>${kr(bid.amount)}</b>.</p>
<p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#000;color:#fff;border-radius:10px;text-decoration:none">Fyll i fakturauppgifter</a></p>
<p>Eller kopiera länken: ${link}</p>
<p>Din annons syns redan på figuren.</p>
<p>Hälsningar<br>Reklamfiguren</p>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `reklamfiguren-vinst-${w.token}` },
      body: JSON.stringify({ from, to: [w.email], subject: `Du vann ${name.toLowerCase()} på Reklamfiguren`, text, html }),
    });
    if (!res.ok) { failed.push({ spot: w.spot, fel: `${res.status} ${(await res.text()).slice(0, 200)}` }); continue; }
    await db.from('reklamfiguren_vinst').update({ emailed_at: new Date().toISOString() }).eq('token', w.token);
    sent.push(w.spot);
  }
  return json({ status: 'klart', mejlade: sent, misslyckade: failed });
});
