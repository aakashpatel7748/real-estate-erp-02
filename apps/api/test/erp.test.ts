import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { api, bookingBody, getApp, key, registerCompany, setupInventory, type Session } from './helpers';

async function balanced(s: Session) {
  return (await api(s).get('/accounting/reports/trial-balance').expect(200)).body.data.balanced as boolean;
}
async function accountId(s: Session, systemKey: string) {
  const rows = (await api(s).get('/accounting/accounts').expect(200)).body.data as { id: string; systemKey?: string }[];
  return rows.find((a) => a.systemKey === systemKey)!.id;
}
async function book(s: Session, inv: Awaited<ReturnType<typeof setupInventory>>, plots = [0], extra: object = {}) {
  return (await api(s).post('/bookings', bookingBody(inv, plots, extra), key()).expect(201)).body.data as { id: string; bookingNumber: string };
}
async function installments(s: Session, bookingId: string) {
  return (await api(s).get(`/bookings/${bookingId}`).expect(200)).body.data.installments as { id: string; name: string; amountPaise: number; paidPaise: number; status: string }[];
}
describe('masters', () => {
  it('keeps unsent fields on PATCH and validates references', async () => {
    const s = await registerCompany();
    const http = api(s);
    const party = (await http.post('/parties', { kind: 'partner', name: 'Ravi Agarwal', shareBp: 2500, isActive: false }).expect(201)).body.data;
    const patched = (await http.patch(`/parties/${party.id}`, { phone: '+91 98260 00000' }).expect(200)).body.data;
    expect(patched.isActive).toBe(false); // PATCH must not reset defaults
    expect(patched.shareBp).toBe(2500);
    await http.post('/parties', { kind: 'land_owner', name: 'X', landParcelIds: ['0123456789abcdef01234567'] }).expect(400);
    const list = (await http.get('/parties?kind=partner&q=ravi').expect(200)).body.data as { name: string }[];
    expect(list.map((p) => p.name)).toEqual(['Ravi Agarwal']);

    const consultant = (await http.post('/consultants', { name: 'Adv. Mehta', type: 'advocate' }).expect(201)).body.data;
    await http.delete(`/consultants/${consultant.id}`).expect(200);
    await http.get(`/consultants/${consultant.id}`).expect(404);
  });

  it('prices other charges for selected units and offers them on bookings', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 2, 'CHG');
    const http = api(s);
    await http.post('/charges', { name: 'Club membership', kind: 'club', basis: 'fixed', value: 50_000_00 }).expect(201);
    await http.post('/charges', { projectId: inv.project.id, name: 'Maintenance deposit', kind: 'maintenance', basis: 'per_sqft', value: 25_00, gstBp: 1800 }).expect(201);
    await http.post('/charges', { name: 'Legal', kind: 'legal', basis: 'percent', value: 10_001 }).expect(400);
    const priced = (await http.post('/charges/compute', { projectId: inv.project.id, plotIds: [inv.plots[0]!.id] }).expect(200)).body.data as {
      name: string;
      amountPaise: number;
    }[];
    // 1000 sq ft × ₹25 = ₹25,000 + 18% GST = ₹29,500; club fixed ₹50,000 per unit.
    expect(priced.find((c) => c.name.startsWith('Maintenance'))!.amountPaise).toBe(29_500_00);
    expect(priced.find((c) => c.name === 'Club membership')!.amountPaise).toBe(50_000_00);
  });

  it('applies rate indexes only to unlocked units', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 3, 'RATE');
    const http = api(s);
    await book(s, inv, [0]);
    const idx = (await http.post('/rate-indexes', { projectId: inv.project.id, name: 'Diwali revision', ratePaisePerSqft: 1_200_00, effectiveFrom: '2026-10-20' }).expect(201)).body.data;
    const dry = (await http.post(`/rate-indexes/${idx.id}/apply`, { dryRun: true }).expect(200)).body.data;
    expect(dry).toMatchObject({ units: 2, applied: false, valueBeforePaise: 20_00_000_00, valueAfterPaise: 24_00_000_00 });
    expect((await http.post(`/rate-indexes/${idx.id}/apply`, {}).expect(200)).body.data.applied).toBe(true);
    const plots = (await http.get(`/projects/${inv.project.id}/plots?pageSize=10&sort=plotNumber`).expect(200)).body.data as { status: string; listPricePaise: number }[];
    expect(plots.find((p) => p.status === 'booked')!.listPricePaise).toBe(10_00_000_00);
    expect(plots.filter((p) => p.status === 'available').every((p) => p.listPricePaise === 12_00_000_00)).toBe(true);
  });

  it('allots parking to bookings and frees it when the booking is cancelled', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 2, 'PRK');
    const http = api(s);
    await http.post('/parking/bulk', { projectId: inv.project.id, type: 'covered', prefix: 'C-', startNumber: 1, count: 3, pricePaise: 2_00_000_00 }).expect(201);
    await http.post('/parking', { projectId: inv.project.id, code: 'C-2', type: 'open' }).expect(409);
    const slots = (await http.get(`/parking?projectId=${inv.project.id}&sort=code`).expect(200)).body.data as { id: string; code: string }[];
    expect(slots.map((p) => p.code)).toEqual(['C-1', 'C-2', 'C-3']);
    const b = await book(s, inv, [0]);
    await http.post(`/parking/${slots[0]!.id}/allot`, { bookingId: b.id }).expect(200);
    await http.post(`/parking/${slots[0]!.id}/allot`, { bookingId: b.id }).expect(409);
    expect((await http.get(`/parking/summary?projectId=${inv.project.id}`).expect(200)).body.data).toMatchObject({ allotted: 1, available: 2, total: 3 });
    await http.delete(`/parking/${slots[0]!.id}`).expect(422);
    await http.post(`/bookings/${b.id}/cancel`, { reason: 'Changed mind' }).expect(200);
    expect((await http.get(`/parking/summary?projectId=${inv.project.id}`).expect(200)).body.data).toMatchObject({ allotted: 0, available: 3 });
  });

  it('tracks home loans per lender and blocks deleting a lender in use', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 1, 'LOAN');
    const http = api(s);
    const sbi = (await http.post('/financers', { name: 'State Bank of India', type: 'bank', branch: 'MP Nagar', approvedProjectIds: [inv.project.id] }).expect(201)).body.data;
    const b = await book(s, inv);
    await http.put(`/post-sales/bookings/${b.id}/loan`, { financerId: sbi.id, status: 'sanctioned', sanctionedPaise: 8_00_000_00, disbursedPaise: 9_00_000_00 }).expect(400);
    await http.put(`/post-sales/bookings/${b.id}/loan`, { financerId: sbi.id, status: 'sanctioned', sanctionedPaise: 8_00_000_00 }).expect(200);
    const list = (await http.get('/financers').expect(200)).body.data as { loans: number; sanctionedPaise: number }[];
    expect(list[0]).toMatchObject({ loans: 1, sanctionedPaise: 8_00_000_00 });
    expect((await http.get(`/financers/${sbi.id}`).expect(200)).body.data.bookings).toHaveLength(1);
    await http.delete(`/financers/${sbi.id}`).expect(422);
  });

  it('lists phases and towers with unit counts', async () => {
    const s = await registerCompany();
    const http = api(s);
    const project = (await http.post('/projects', { name: 'Skyline', code: 'SKY', status: 'active' }).expect(201)).body.data;
    const tower = (await http.post(`/projects/${project.id}/blocks`, { name: 'Tower A', code: 'TA' }).expect(201)).body.data;
    await http
      .post(`/projects/${project.id}/plots/bulk`, { blockId: tower.id, prefix: 'A-', startNumber: 101, count: 4, unitType: 'flat', floor: 1, configuration: '2 BHK', areaX100: 120_000, ratePaisePerSqft: 5_000_00 })
      .expect(201);
    const structure = (await http.get('/structure').expect(200)).body.data as { code: string; blocks: { code: string; units: Record<string, number> }[] }[];
    expect(structure.find((p) => p.code === 'SKY')!.blocks[0]).toMatchObject({ code: 'TA', units: { total: 4, available: 4 } });
    const flats = (await http.get(`/projects/${project.id}/plots?unitType=flat`).expect(200)).body.data as { configuration: string; floor: number }[];
    expect(flats).toHaveLength(4);
    expect(flats[0]).toMatchObject({ configuration: '2 BHK', floor: 1 });
  });
});

describe('pre sales', () => {
  it('uses configurable lead sources and stage labels', async () => {
    const s = await registerCompany();
    const http = api(s);
    const settings = (await http.get('/lead-settings').expect(200)).body.data;
    expect(settings.sources.map((x: { key: string }) => x.key)).toContain('99acres');
    await http.post('/leads', { name: 'A', phone: '+91 90000 33333', source: 'radio' }).expect(400);
    await http
      .put('/lead-settings', {
        sources: [...settings.sources.filter((x: { key: string }) => x.key !== 'hoarding'), { key: 'radio', label: 'Radio FM', active: true }, { key: 'hoarding', label: 'Hoarding', active: false }],
        stageLabels: { ...settings.stageLabels, site_visit: 'Site visit done' },
        lostReasons: ['Budget'],
      })
      .expect(200);
    await http.post('/leads', { name: 'A', phone: '+91 90000 33333', source: 'radio' }).expect(201);
    await http.post('/leads', { name: 'B', phone: '+91 90000 33334', source: 'hoarding' }).expect(400); // inactive
    expect((await http.get('/lead-settings').expect(200)).body.data.stageLabels.site_visit).toBe('Site visit done');
  });

  it('renders WhatsApp templates into click-to-chat links and logs them', async () => {
    const s = await registerCompany('Sunrise Colonizers');
    const inv = await setupInventory(s, 1, 'WA');
    const http = api(s);
    const tpl = (
      await http.post('/whatsapp-templates', { name: 'Dues reminder', category: 'payment_reminder', body: 'Dear {{name}}, {{amount_due}} is due on {{booking_no}} ({{units}}). – {{company}}' }).expect(201)
    ).body.data;
    const b = await book(s, inv);
    const out = (await http.post(`/whatsapp-templates/${tpl.id}/render`, { entityType: 'booking', entityId: b.id }).expect(200)).body.data;
    expect(out.url.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    expect(out.text).toContain('Dear Test Buyer');
    expect(out.text).toContain(b.bookingNumber);
    expect(out.text).toContain('Sunrise Colonizers');
    expect(out.missing).toEqual([]);
    const follow = (await http.get(`/post-sales/follow-ups?bookingId=${b.id}`).expect(200)).body.data as { type: string }[];
    expect(follow[0]!.type).toBe('whatsapp');
    const lead = (await http.post('/leads', { name: 'Kavya', phone: '9826012345' }).expect(201)).body.data;
    const leadMsg = (await http.post(`/whatsapp-templates/${tpl.id}/render`, { entityType: 'lead', entityId: lead.id }).expect(200)).body.data;
    expect(leadMsg.url.startsWith('https://wa.me/919826012345')).toBe(true);
    expect(leadMsg.missing).toContain('amount_due');
  });

  it('captures portal leads through the public webhook, deduplicating repeat enquiries', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 1, 'PORT');
    const http = api(s);
    const integ = (await http.post('/integrations', { portal: '99acres', name: '99acres – Green Valley', projectId: inv.project.id, defaultAssigneeId: s.userId }).expect(201)).body.data;
    expect(integ.token).toMatch(/^[\w-]{30,}$/);
    const hook = (t: string) => request(getApp()).post(`/api/v1/inbound/leads/${t}`);
    await hook('not-a-real-token-at-all-xxxxxxxx').send({ name: 'X', mobile: '9999999999' }).expect(404);
    await hook(integ.token).send({ name: 'No Phone' }).expect(422);
    await hook(integ.token).send({ SENDER_NAME: 'Amit Verma', SENDER_MOBILE: '+91-98270-11111', QUERY_MESSAGE: 'Need 1500 sqft plot', property: 'Green Valley' }).expect(201);
    // Form-encoded website post, same phone → repeat enquiry on the open lead.
    await hook(integ.token).type('form').send('full_name=Amit+V&phone=9827011111&message=Call+me').expect(200);
    const leads = (await http.get('/leads?source=99acres').expect(200)).body.data as { id: string; name: string; assignedTo?: { id: string } }[];
    expect(leads).toHaveLength(1);
    expect(leads[0]!.name).toBe('Amit Verma');
    const detail = (await http.get(`/leads/${leads[0]!.id}`).expect(200)).body.data;
    expect(detail.activities.some((a: { summary: string }) => a.summary.startsWith('Repeat enquiry'))).toBe(true);
    const logs = (await http.get(`/integrations/${integ.id}/logs`).expect(200)).body.data as { outcome: string }[];
    expect(logs.map((l) => l.outcome).sort()).toEqual(['created', 'duplicate', 'rejected']);
    const rotated = (await http.post(`/integrations/${integ.id}/rotate`).expect(200)).body.data.token;
    await hook(integ.token).send({ name: 'Old', phone: '9000000000' }).expect(404);
    await hook(rotated).send({ name: 'New', phone: '9000000000' }).expect(201);
    // CORS for website forms on other domains.
    const pre = await request(getApp()).options(`/api/v1/inbound/leads/${rotated}`).set('Origin', 'https://my-site.example').set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBe('https://my-site.example');
  });

  it('saves quotations and converts one into exactly one booking', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 2, 'QTN');
    const http = api(s);
    const lead = (await http.post('/leads', { name: 'Prospect', phone: '+91 90000 44444', projectId: inv.project.id }).expect(201)).body.data;
    const qBody = { projectId: inv.project.id, plotIds: [inv.plots[0]!.id], paymentPlanId: inv.plan.id, leadId: lead.id, quoteDate: '2026-10-25', charges: [{ name: 'Club', amountPaise: 50_000_00 }] };
    const q = (await http.post('/quotations', qBody).expect(201)).body.data;
    expect(q.number).toMatch(/^QTN\/2026-27\/\d{6}$/);
    expect(q.netAmountPaise).toBe(10_50_000_00);
    expect(q.validUntil.slice(0, 10)).toBe('2026-11-09');
    const pdf = await http.get(`/quotations/${q.id}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    await http.post(`/quotations/${q.id}/status`, { status: 'sent' }).expect(200);

    await book(s, inv, [0], { quotationId: q.id, charges: [{ name: 'Club', amountPaise: 50_000_00 }] });
    expect((await http.get(`/quotations/${q.id}`).expect(200)).body.data.status).toBe('converted');
    const second = await http.post('/bookings', bookingBody(inv, [1], { quotationId: q.id }), key());
    expect(second.status).toBe(422);
    // The failed conversion rolled back: unit 2 is still available.
    const plots = (await http.get(`/projects/${inv.project.id}/plots?status=available`).expect(200)).body.data as unknown[];
    expect(plots).toHaveLength(1);
    // Quotations for unavailable units are refused.
    await http.post('/quotations', { ...qBody, leadId: undefined, prospectName: 'Walk-in' }).expect(422);
    const dash = (await http.get('/sales-dashboard?from=2026-04-01&to=2026-10-31').expect(200)).body.data;
    expect(dash.kpis).toMatchObject({ quotations: 1, quotationsConverted: 1, bookings: 1 });
  });
});

describe('post sales', () => {
  it('moves a booking through agreement, demand letters, registry and possession', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 2, 'PS');
    const http = api(s);
    const b = await book(s, inv, [0]);
    await http.post('/payments', { bookingId: b.id, amountPaise: 2_00_000_00, mode: 'neft', receivedOn: '2026-04-10' }, key()).expect(201);

    const agr = (await http.post('/post-sales/documents', { kind: 'agreement', bookingId: b.id, date: '2026-04-20', details: { stampDutyPaise: 50_000_00 } }).expect(201)).body.data;
    expect(agr).toMatchObject({ status: 'draft', amountPaise: 50_000_00 });
    expect(agr.number).toMatch(/^BBA\//);
    await http.post('/post-sales/documents', { kind: 'agreement', bookingId: b.id, date: '2026-04-21' }).expect(422); // one active agreement
    await http.patch(`/post-sales/documents/${agr.id}`, { status: 'executed' }).expect(200);
    await http.patch(`/post-sales/documents/${agr.id}`, { status: 'draft' }).expect(422);

    const demand = (await http.post('/post-sales/documents', { kind: 'demand', bookingId: b.id, date: '2026-10-25' }).expect(201)).body.data;
    expect(demand.amountPaise).toBe(8_00_000_00);
    expect(demand.details.lines).toHaveLength(2);
    expect((await http.get(`/post-sales/documents/${demand.id}/pdf`).expect(200)).headers['content-type']).toContain('pdf');

    // Registry is blocked while dues are outstanding unless overridden with a remark.
    const reg = { kind: 'registry', bookingId: b.id, date: '2026-10-26', details: { scheduledOn: '2026-11-05' } };
    await http.post('/post-sales/documents', reg).expect(422);
    await http.post('/post-sales/documents', { ...reg, overrideDues: true }).expect(422);
    await http.post('/payments', { bookingId: b.id, amountPaise: 8_00_000_00, mode: 'neft', receivedOn: '2026-10-26' }, key()).expect(201);
    const registry = (await http.post('/post-sales/documents', reg).expect(201)).body.data;
    await http.patch(`/post-sales/documents/${registry.id}`, { status: 'registered' }).expect(400); // needs deed details
    await http.patch(`/post-sales/documents/${registry.id}`, { details: { deedNumber: 'BPL/2026/1234', registeredOn: '2026-11-05', subRegistrarOffice: 'Bhopal' }, status: 'registered' }).expect(200);
    const plot = (await http.get(`/projects/${inv.project.id}/plots/${inv.plots[0]!.id}`).expect(200)).body.data;
    expect(plot.status).toBe('sold');

    const pos = (await http.post('/post-sales/documents', { kind: 'possession', bookingId: b.id, date: '2026-11-10', details: { offeredOn: '2026-11-10' } }).expect(201)).body.data;
    await http.patch(`/post-sales/documents/${pos.id}`, { status: 'handed_over' }).expect(200);
    const got = (await http.get(`/post-sales/documents/${pos.id}`).expect(200)).body.data;
    expect(got.status).toBe('handed_over');
    expect(got.details.handedOverOn).toBeTruthy();
    expect((await http.get(`/post-sales/documents/${pos.id}/pdf`).expect(200)).headers['content-type']).toContain('pdf');
    const list = (await http.get('/post-sales/documents?kind=registry').expect(200)).body.data as { status: string }[];
    expect(list[0]!.status).toBe('registered');
  });

  it('lists dues with aging, logs follow-ups, issues bulk demand letters and tracks allotment letters', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 3, 'DUE');
    const http = api(s);
    const b1 = await book(s, inv, [0]);
    const b2 = await book(s, inv, [1]);
    await http.post('/payments', { bookingId: b2.id, amountPaise: 10_00_000_00, mode: 'neft', receivedOn: '2026-10-01' }, key()).expect(201);
    const dues = (await http.get('/post-sales/dues').expect(200)).body.data as { bookingId: string; overduePaise: number; daysOverdue: number }[];
    expect(dues).toHaveLength(1);
    expect(dues[0]).toMatchObject({ bookingId: b1.id, overduePaise: 10_00_000_00 });
    expect(dues[0]!.daysOverdue).toBeGreaterThan(90);
    const summary = (await http.get('/post-sales/dues/summary').expect(200)).body.data;
    expect(summary.aging['90_plus']).toMatchObject({ bookings: 1, amountPaise: 10_00_000_00 });
    await http.post('/post-sales/follow-ups', { bookingId: b1.id, type: 'call', note: 'Promised by Friday', promisedAmountPaise: 2_00_000_00, nextFollowUpOn: '2026-10-01' }).expect(201);
    expect(((await http.get('/post-sales/dues?followUp=due').expect(200)).body.data as unknown[]).length).toBe(1);
    expect(((await http.get('/post-sales/dues?followUp=none').expect(200)).body.data as unknown[]).length).toBe(0);

    const bulk = (await http.post('/post-sales/documents/demand/bulk', { projectId: inv.project.id, date: '2026-10-25' }).expect(200)).body.data;
    expect(bulk).toEqual({ created: 1, skipped: 0 });
    expect((await http.post('/post-sales/documents/demand/bulk', { projectId: inv.project.id, date: '2026-10-25' }).expect(200)).body.data).toEqual({ created: 0, skipped: 1 });

    expect((await http.get('/post-sales/allotments/summary').expect(200)).body.data).toEqual({ issued: 0, pending: 2 });
    await http.post(`/post-sales/bookings/${b1.id}/allotment`, { issued: true, via: 'email' }).expect(200);
    const issued = (await http.get('/post-sales/allotments?issued=true').expect(200)).body.data as { id: string; units: string[] }[];
    expect(issued.map((i) => i.id)).toEqual([b1.id]);
    expect(issued[0]!.units).toEqual(['1']);

    await http.post(`/bookings/${b2.id}/cancel`, { reason: 'Relocating', cancellationChargePaise: 1_00_000_00 }).expect(200);
    const cancels = (await http.get('/post-sales/cancellations?refund=pending').expect(200)).body.data as { refundablePaise: number }[];
    expect(cancels[0]!.refundablePaise).toBe(9_00_000_00);
    expect((await http.get('/post-sales/cancellations/summary').expect(200)).body.data).toMatchObject({ count: 1, chargesPaise: 1_00_000_00, pendingRefundPaise: 9_00_000_00 });
  });
});

describe('account', () => {
  it('creates bank accounts with opening balances', async () => {
    const s = await registerCompany();
    const http = api(s);
    const acc = (
      await http
        .post('/cash-bank-accounts', { kind: 'bank', name: 'HDFC RERA Collection', bankName: 'HDFC Bank', accountNumber: '50200012345678', ifsc: 'HDFC0001234', isReraAccount: true, openingBalancePaise: 5_00_000_00 })
        .expect(201)
    ).body.data;
    expect(acc.code).toBe('1011');
    await http.post('/cash-bank-accounts', { kind: 'bank', name: 'Bad', ifsc: 'HDFC1234' }).expect(400);
    const list = (await http.get('/cash-bank-accounts').expect(200)).body.data as { name: string; balancePaise: number; kind: string }[];
    expect(list.find((a) => a.name === 'HDFC RERA Collection')).toMatchObject({ balancePaise: 5_00_000_00, kind: 'bank' });
    expect(list.map((a) => a.kind).sort()).toEqual(['bank', 'bank', 'cash']);
    await http.patch(`/cash-bank-accounts/${list.find((a) => a.kind === 'cash')!['id' as never]}`, { isActive: false }).expect(422);
    expect(await balanced(s)).toBe(true);
  });

  it('records a receipt only when a post-dated cheque clears, exactly once', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 1, 'PDC');
    const http = api(s);
    const b = await book(s, inv);
    const chq = { bookingId: b.id, chequeNumber: '123456', bankName: 'SBI', chequeDate: '2026-10-20', amountPaise: 3_00_000_00 };
    const pdc = (await http.post('/pdcs', chq).expect(201)).body.data;
    await http.post('/pdcs', chq).expect(409);
    await http.post('/pdcs', { ...chq, chequeNumber: '123457', amountPaise: 8_00_000_00 }).expect(422); // exceeds outstanding with cheques on hand
    expect((await http.get('/pdcs/summary').expect(200)).body.data.dueForDeposit).toEqual({ count: 1, amountPaise: 3_00_000_00 });
    await http.post(`/pdcs/${pdc.id}/deposit`, { depositedOn: '2026-10-21' }).expect(200);
    const clears = await Promise.all([1, 2].map(() => http.post(`/pdcs/${pdc.id}/clear`, { clearedOn: '2026-10-23' }, key())));
    expect(clears.filter((r) => r.status === 200)).toHaveLength(1);
    const booking = (await http.get(`/bookings/${b.id}`).expect(200)).body.data;
    expect(booking.receivedPaise).toBe(3_00_000_00);
    const list = (await http.get('/pdcs?status=cleared').expect(200)).body.data as { paymentId: { number: string } }[];
    expect(list[0]!.paymentId.number).toMatch(/^RCPT\//);
    const bounced = (await http.post('/pdcs', { ...chq, chequeNumber: '654321', amountPaise: 1_00_000_00 }).expect(201)).body.data;
    await http.post(`/pdcs/${bounced.id}/bounce`, { bouncedOn: '2026-10-24', reason: 'Insufficient funds' }).expect(200);
    await http.post(`/pdcs/${bounced.id}/clear`, { clearedOn: '2026-10-25' }, key()).expect(422);
    expect(await balanced(s)).toBe(true);
  });

  it('posts credit and debit notes against installments and unwinds them on cancellation', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 1, 'ADJ');
    const http = api(s);
    const b = await book(s, inv);
    await http.post('/payments', { bookingId: b.id, amountPaise: 2_00_000_00, mode: 'neft', receivedOn: '2026-04-10' }, key()).expect(201);

    await http.post('/ledger-adjustments', { bookingId: b.id, type: 'credit', reason: 'waiver', amountPaise: 9_00_000_00, date: '2026-10-25', narration: 'Too much' }, key()).expect(422);
    const credit = (await http.post('/ledger-adjustments', { bookingId: b.id, type: 'credit', reason: 'discount', amountPaise: 60_000_00, date: '2026-10-25', narration: 'Festive discount' }, key()).expect(201)).body.data;
    expect(credit.number).toMatch(/^ADJ\//);
    let inst = await installments(s, b.id);
    expect(inst.find((i) => i.name === 'Final')!.amountPaise).toBe(4_40_000_00);
    const debit = (await http.post('/ledger-adjustments', { bookingId: b.id, type: 'debit', reason: 'late_fee', amountPaise: 5_000_00, date: '2026-10-25', narration: 'Late payment' }, key()).expect(201)).body.data;
    inst = await installments(s, b.id);
    expect(inst.find((i) => i.name.startsWith('Late fee'))!.amountPaise).toBe(5_000_00);
    let booking = (await http.get(`/bookings/${b.id}`).expect(200)).body.data;
    expect(booking.netAmountPaise).toBe(10_00_000_00 - 60_000_00 + 5_000_00);
    expect(booking.adjustmentsPaise).toBe(-55_000_00);
    expect(await balanced(s)).toBe(true);
    const tb = (await http.get('/accounting/reports/trial-balance').expect(200)).body.data.rows as { code: string; debitPaise: number; creditPaise: number }[];
    expect(tb.find((r) => r.code === '1100')!.debitPaise).toBe(10_00_000_00 - 2_00_000_00 - 60_000_00 + 5_000_00);
    expect(tb.find((r) => r.code === '5300')!.debitPaise).toBe(60_000_00);
    expect(tb.find((r) => r.code === '4200')!.creditPaise).toBe(5_000_00);

    await http.post(`/ledger-adjustments/${debit.id}/reverse`, { reason: 'Waived after call' }).expect(200);
    await http.post(`/ledger-adjustments/${debit.id}/reverse`, { reason: 'again' }).expect(422);
    inst = await installments(s, b.id);
    expect(inst.find((i) => i.name.startsWith('Late fee'))!.status).toBe('cancelled');

    // Manual vouchers still cannot touch receivables.
    const recv = await accountId(s, 'customer_receivable');
    const cash = await accountId(s, 'cash');
    await http.post('/accounting/journal-entries', { date: '2026-10-25', narration: 'hack', lines: [{ accountId: recv, creditPaise: 100 }, { accountId: cash, debitPaise: 100 }] }).expect(422);

    await http.post(`/bookings/${b.id}/cancel`, { reason: 'Exit' }).expect(200);
    const adjs = (await http.get(`/ledger-adjustments?bookingId=${b.id}`).expect(200)).body.data as { status: string }[];
    expect(adjs.every((a) => a.status === 'reversed')).toBe(true);
    const after = (await http.get('/accounting/reports/trial-balance').expect(200)).body.data.rows as { code: string; debitPaise: number; creditPaise: number }[];
    const recvRow = after.find((r) => r.code === '1100');
    expect(recvRow?.debitPaise ?? 0).toBe(0);
    expect(recvRow?.creditPaise ?? 0).toBe(0);
    booking = (await http.get(`/bookings/${b.id}`).expect(200)).body.data;
    expect(booking.refundablePaise).toBe(2_00_000_00);
    expect(credit.status).toBe('posted');
  });

  it('posts GST vouchers with CGST/SGST or IGST and summarises net tax', async () => {
    const s = await registerCompany();
    const http = api(s);
    const vendor = (await http.post('/vendors', { name: 'Cement Co', category: 'material' }).expect(201)).body.data;
    const income = await accountId(s, 'other_income');
    const expense = await accountId(s, 'development_expense');
    const sale = (
      await http
        .post('/gst-vouchers', { direction: 'output', date: '2026-10-05', invoiceNumber: 'MNT/001', partyName: 'Resident Welfare', description: 'Maintenance', taxableValuePaise: 1_00_000_00, rateBp: 1800, accountId: income, mode: 'neft' }, key())
        .expect(201)
    ).body.data;
    expect(sale).toMatchObject({ cgstPaise: 9_000_00, sgstPaise: 9_000_00, igstPaise: 0, totalPaise: 1_18_000_00 });
    const purchase = (
      await http
        .post(
          '/gst-vouchers',
          { direction: 'input', date: '2026-10-06', invoiceNumber: 'CC/77', partyName: 'Cement Co', partyGstin: '23ABCDE1234F1Z5', interState: true, description: 'Cement', taxableValuePaise: 50_000_00, rateBp: 2800, accountId: expense, vendorId: vendor.id },
          key(),
        )
        .expect(201)
    ).body.data;
    expect(purchase).toMatchObject({ igstPaise: 14_000_00, totalPaise: 64_000_00 });
    await http.post('/gst-vouchers', { direction: 'output', date: '2026-10-05', invoiceNumber: 'X', partyName: 'X', description: 'X', taxableValuePaise: 100, rateBp: 1800, accountId: expense }, key()).expect(400);
    await http.post('/gst-vouchers', { direction: 'output', date: '2026-10-05', invoiceNumber: 'X', partyName: 'X', description: 'X', taxableValuePaise: 100, rateBp: 1300, accountId: income }, key()).expect(400);
    const summary = (await http.get('/gst-vouchers/summary?from=2026-10-01&to=2026-10-31').expect(200)).body.data;
    expect(summary.net).toEqual({ cgstPaise: 9_000_00, sgstPaise: 9_000_00, igstPaise: -14_000_00 });
    expect(summary.netPayablePaise).toBe(4_000_00);
    const vendorDetail = (await http.get(`/vendors/${vendor.id}`).expect(200)).body.data;
    expect(vendorDetail.payableBalancePaise ?? vendorDetail.payablePaise).toBe(64_000_00);
    await http.post(`/gst-vouchers/${sale.id}/reverse`, { reason: 'Wrong rate' }).expect(200);
    expect((await http.get('/gst-vouchers/summary?from=2026-10-01&to=2026-10-31').expect(200)).body.data.totals.output.count).toBe(0);
    expect(await balanced(s)).toBe(true);
  });

  it('lists vendor payments across vendors', async () => {
    const s = await registerCompany();
    const inv = await setupInventory(s, 1, 'VP');
    const http = api(s);
    const vendor = (await http.post('/vendors', { name: 'Electricals Ltd', category: 'electrical' }).expect(201)).body.data;
    const account = await accountId(s, 'development_expense');
    await http.post('/expenses', { projectId: inv.project.id, vendorId: vendor.id, expenseAccountId: account, date: '2026-10-01', amountPaise: 2_00_000_00, description: 'Cabling', settlement: 'payable' }, key()).expect(201);
    await http.post(`/vendors/${vendor.id}/payments`, { amountPaise: 1_50_000_00, paidOn: '2026-10-05', mode: 'neft', projectId: inv.project.id }, key()).expect(201);
    const res = await http.get('/vendor-payments').expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.headers['x-total-amount']).toBe(String(1_50_000_00));
  });
});

describe('scoping on new modules', () => {
  it('hides other projects’ parking, cheques and documents from restricted users', async () => {
    const owner = await registerCompany('Scope Two');
    const inv1 = await setupInventory(owner, 1, 'T1');
    const inv2 = await setupInventory(owner, 1, 'T2');
    const http = api(owner);
    const roles = (await http.get('/roles').expect(200)).body.data as { id: string; systemKey?: string }[];
    const accountant = roles.find((r) => r.systemKey === 'accountant')!;
    const { testOutbox } = await import('../src/utils/mailer');
    await http.post('/invitations', { email: 'acct@example.com', roleId: accountant.id, projectAccess: { mode: 'restricted', projectIds: [inv1.project.id] } }).expect(201);
    const token = /token=([\w-]+)/.exec(testOutbox.filter((m) => m.to === 'acct@example.com').at(-1)!.text)![1];
    const accepted = await request(getApp()).post('/api/v1/auth/accept-invite').send({ token, name: 'Scoped Accountant', password: 'Str0ngPassw0rd!' }).expect(201);
    const u = api({ token: accepted.body.data.accessToken as string });

    await http.post('/parking', { projectId: inv2.project.id, code: 'X-1', type: 'open' }).expect(201);
    const b2 = await book(owner, inv2);
    const pdc = (await http.post('/pdcs', { bookingId: b2.id, chequeNumber: '111111', bankName: 'ICICI', chequeDate: '2026-10-30', amountPaise: 1_00_000_00 }).expect(201)).body.data;
    await http.post('/post-sales/documents', { kind: 'demand', bookingId: b2.id, date: '2026-10-25' }).expect(201);

    expect((await u.get('/parking').expect(200)).body.data).toHaveLength(0);
    expect((await u.get('/pdcs').expect(200)).body.data).toHaveLength(0);
    await u.post(`/pdcs/${pdc.id}/deposit`, { depositedOn: '2026-10-30' }).expect(404);
    expect((await u.get('/post-sales/documents?kind=demand').expect(200)).body.data).toHaveLength(0);
    await u.post('/pdcs', { bookingId: b2.id, chequeNumber: '222222', bankName: 'ICICI', chequeDate: '2026-10-30', amountPaise: 100 }).expect(404);
    await u.get(`/post-sales/dues?projectId=${inv2.project.id}`).expect(404);
    await u.post('/ledger-adjustments', { bookingId: b2.id, type: 'credit', reason: 'waiver', amountPaise: 100, date: '2026-10-25', narration: 'x' }, key()).expect(404);
    // Masters are company-wide but need the masters permission.
    await u.get('/parties').expect(200);
    await u.post('/parties', { kind: 'partner', name: 'Nope' }).expect(403);
  });
});
