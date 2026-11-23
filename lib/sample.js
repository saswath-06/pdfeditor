// Generates the sample document shown on first run, plus a few starter marks.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function buildSample() {
  const d = await PDFDocument.create();
  const Tr = await d.embedFont(StandardFonts.TimesRoman), Tb = await d.embedFont(StandardFonts.TimesRomanBold);
  const Ti = await d.embedFont(StandardFonts.TimesRomanItalic), Hb = await d.embedFont(StandardFonts.HelveticaBold);
  const Hr = await d.embedFont(StandardFonts.Helvetica);
  const W = 612, H = 792, M = 72, ink = rgb(0.063, 0.075, 0.102), mk = {};
  let pg, y, n = 0;

  const wrap = (t, f, s) => {
    const o = []; let l = '';
    for (const w of t.split(' ')) {
      const tt = l ? l + ' ' + w : w;
      if (f.widthOfTextAtSize(tt, s) > W - 2 * M && l) { o.push(l); l = w; } else l = tt;
    }
    if (l) o.push(l);
    return o;
  };
  const para = (t, s, f, gap) => {
    const ls = wrap(t, f, s), y0 = y;
    ls.forEach((l, i) => pg.drawText(l, { x: M, y: y0 - s - i * s * 1.45, size: s, font: f, color: ink }));
    y -= ls.length * s * 1.45 + gap;
    return { top: H - y0 + 0.2 * s, bot: H - (y0 - s - (ls.length - 1) * s * 1.45) + 0.25 * s, w1: f.widthOfTextAtSize(ls[0], s), s };
  };
  const page = () => { pg = d.addPage([W, H]); y = H - M; n++; };
  const foot = () => pg.drawText(`Studio Rental Agreement · page ${n} of 2`, { x: M, y: 40, size: 9, font: Hr, color: rgb(0.4, 0.42, 0.48) });
  const clause = (t, b, tag) => { para(t, 12, Tb, 3); mk[tag] = para(b, 11.5, Tr, 14); };

  page();
  pg.drawText('Studio Rental Agreement', { x: M, y: y - 26, size: 26, font: Hb, color: ink }); y -= 40;
  para('Between Maple Row Studios Ltd. (the Landlord) and the Tenant named on page 2. Draft for review, not yet signed.', 12, Ti, 10);
  pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: ink }); y -= 22;
  clause('1. Premises', 'Unit 3B, 214 Maple Row: a 640 sq ft light-industrial studio with one loading door, a shared washroom and two reserved parking spaces.', 'c1');
  clause('2. Term', 'Twelve months starting January 1, 2027 and ending December 31, 2027. Either party may renew by written notice at least 60 days before the end date.', 'c2');
  clause('3. Use', 'Rehearsal, recording and small-scale production. No overnight stays, and no amplified sound after 11 pm on weekdays or midnight on weekends.', 'c3');
  clause('4. Rent', 'Monthly rent is $1,450, due on the first of each month by e-transfer. A $50 late fee applies to any payment more than five days overdue.', 'rent');
  clause('5. Deposit', 'A deposit equal to one month of rent is held by the Landlord and returned within 30 days of move-out, less any documented damage beyond normal wear.', 'dep');
  y -= 26;
  clause('6. Utilities', 'Electricity and internet are included up to $120 per month. Usage above that amount is billed quarterly with the meter readings attached.', 'c6');
  clause('7. Insurance', 'The Tenant keeps contents and liability insurance of at least $2,000,000 and names the Landlord as an additional insured on the policy.', 'c7');
  foot(); page();
  clause('8. Alterations', 'The Tenant may install acoustic panels and shelving that can be removed without damage. Structural changes, new wiring or painting need written approval first.', 'c8');
  clause('9. Access', 'The Landlord may enter with 24 hours of notice for inspections and repairs, or without notice in an emergency.', 'c9');
  clause('10. Ending early', 'After the first six months, either party may end this agreement with 90 days of written notice. Rent is owed through the end of the notice period.', 'c10');
  clause('11. Governing law', 'This agreement is governed by the laws of the Province of Ontario.', 'c11');
  y -= 20; pg.drawText('Signatures', { x: M, y: y - 18, size: 18, font: Hb, color: ink }); y -= 64;
  const line = (lab, yy) => {
    pg.drawLine({ start: { x: M, y: yy }, end: { x: M + 270, y: yy }, thickness: 0.8, color: ink });
    pg.drawLine({ start: { x: M + 310, y: yy }, end: { x: W - M, y: yy }, thickness: 0.8, color: ink });
    pg.drawText(lab, { x: M, y: yy - 14, size: 10, font: Hr, color: ink });
    pg.drawText('Date', { x: M + 310, y: yy - 14, size: 10, font: Hr, color: ink });
  };
  line('Landlord: Maple Row Studios Ltd.', y); line('Tenant', y - 80); foot();

  const r1 = v => Math.round(v * 10) / 10, r = mk.rent, dp = mk.dep;
  const anns = [
    { t: 'hl', x: M - 2, y: r1(r.top - 1), w: r1(r.w1 + 4), h: r1(r.s * 1.2), c: '#ffd400' },
    { t: 'box', x: M - 8, y: r1(dp.top - 24), w: W - 2 * M + 16, h: r1(dp.bot - dp.top + 30), c: '#c1121f', sw: 1.5 },
    { t: 'text', x: M, y: r1(dp.bot + 8), text: 'Ask whether the deposit can be split over two payments', size: 12, c: '#c1121f', f: 'sans' },
  ];
  return { bytes: await d.save(), anns };
}

module.exports = { buildSample };
