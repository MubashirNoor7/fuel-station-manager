import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPakistanLocalDate } from '../logic/calculations';

async function request(payload: any) {
  if (!window.business) {
    throw new Error('Open the Windows desktop app to connect to the SQLite database.');
  }
  const result = await window.business.request(payload);
  if (!result.ok) throw new Error(result.error || 'Database request failed.');
  return result.data;
}

type Customer = {
  id: string;
  name: string;
  phone?: string;
  fatherName?: string;
  cnic?: string;
  address?: string;
  dueDay?: number;
  active?: boolean;
  balance?: number;
};

type Row = {
  id: string;
  day: string;
  kind: string;
  amount: number;
  reversed: number;
  data: { note?: string; customerName?: string };
};

const rs = (paisa: number) =>
  `Rs. ${(Number(paisa || 0) / 100).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const todayIso = () => getPakistanLocalDate();
const monthStart = () => todayIso().slice(0, 8) + '01';

export function CustomersPage({ onCustomersChanged, refreshSignal }: { onCustomersChanged?: () => void; refreshSignal?: number }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [opening, setOpening] = useState(0);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', fatherName: '', cnic: '', address: '', dueDay: '1' });

  const [entryOpen, setEntryOpen] = useState<'credit' | 'payment' | null>(null);
  const [amount, setAmount] = useState('');
  const [entryDay, setEntryDay] = useState(todayIso());
  const [note, setNote] = useState('');

  const [reverseRow, setReverseRow] = useState<Row | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [saving, setSaving] = useState(false);

  const loadCustomers = useCallback(async () => {
    const snap = await request({ type: 'snapshot', from: monthStart(), to: todayIso() });
    setCustomers((snap.masters?.customer || []).filter((c: Customer) => c.active !== false));
  }, []);

  const loadStatement = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const snap = await request({
          type: 'snapshot',
          from,
          to,
          kinds: ['CREDIT', 'PAYMENT'],
          customer: id,
        });
        setRows(snap.rows || []);
        setOpening(snap.statementOpening || 0);
      } catch (e: any) {
        setMessage({ type: 'error', text: e?.message || 'Could not load the statement.' });
      } finally {
        setLoading(false);
      }
    },
    [from, to],
  );

  useEffect(() => {
    void loadCustomers();
    // Reload whenever the tab is reopened, so balances never go stale
    // (a credit given on the Daily Operation tab used to show Rs. 0 here
    // until the app was restarted).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCustomers, refreshSignal]);

  useEffect(() => {
    if (selectedId) void loadStatement(selectedId);
  }, [selectedId, loadStatement]);

  const selected = useMemo(
    () => customers.find((c) => c.id === selectedId) || null,
    [customers, selectedId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.name, c.phone, c.cnic].some((v) => (v || '').toLowerCase().includes(q)),
    );
  }, [customers, search]);

  // Rows come newest-first; running balance is computed oldest-first.
  const rowsWithBalance = useMemo(() => {
    let balance = opening;
    const byId = new Map<string, number>();
    for (const r of [...rows].reverse()) {
      if (r.reversed) continue;
      balance += r.kind === 'CREDIT' ? r.amount : r.kind === 'PAYMENT' ? -r.amount : 0;
      byId.set(r.id, balance);
    }
    return rows.map((r) => ({ ...r, balanceAfter: byId.get(r.id) ?? null }));
  }, [rows, opening]);

  const totalDue = useMemo(
    () => customers.reduce((sum, c) => sum + (c.balance || 0), 0),
    [customers],
  );

  const refresh = async () => {
    await loadCustomers();
    if (selectedId) await loadStatement(selectedId);
    onCustomersChanged?.();
  };

  const submitCustomer = async () => {
    if (!form.name.trim()) {
      setMessage({ type: 'error', text: 'Enter the customer name.' });
      return;
    }
    setSaving(true);
    try {
      const id = await request({
        type: 'master',
        kind: 'customer',
        business: 'FUEL',
        name: form.name.trim(),
        phone: form.phone.trim(),
        fatherName: form.fatherName.trim(),
        cnic: form.cnic.trim(),
        address: form.address.trim(),
        dueDay: Number(form.dueDay) || 1,
      });
      setMessage({ type: 'success', text: 'Customer saved.' });
      setShowAdd(false);
      setForm({ name: '', phone: '', fatherName: '', cnic: '', address: '', dueDay: '1' });
      await refresh();
      setSelectedId(String(id));
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Customer was NOT saved.' });
    } finally {
      setSaving(false);
    }
  };

  const submitEntry = async () => {
    const amt = Number(amount);
    if (!selectedId || !Number.isFinite(amt) || amt <= 0) {
      setMessage({ type: 'error', text: 'Enter a valid amount.' });
      return;
    }
    if (entryDay > todayIso()) {
      setMessage({ type: 'error', text: 'Entries cannot be future dated.' });
      return;
    }
    setSaving(true);
    try {
      await request({
        type: 'post',
        kind: entryOpen === 'credit' ? 'CREDIT' : 'PAYMENT',
        business: 'FUEL',
        customer: selectedId,
        amount: amt,
        day: entryDay,
        account: 'cash-FUEL',
        note: note.trim(),
      });
      setMessage({
        type: 'success',
        text: entryOpen === 'credit' ? 'Credit given and saved.' : 'Payment received and saved.',
      });
      setEntryOpen(null);
      setAmount('');
      setNote('');
      setEntryDay(todayIso());
      await refresh();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Entry was NOT saved.' });
    } finally {
      setSaving(false);
    }
  };

  const submitReverse = async () => {
    if (!reverseRow || !reverseReason.trim()) return;
    setSaving(true);
    try {
      await request({ type: 'reverse', document: reverseRow.id, reason: reverseReason.trim() });
      setMessage({ type: 'success', text: 'Entry reversed.' });
      setReverseRow(null);
      setReverseReason('');
      await refresh();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Entry was NOT reversed.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Customers</h1>
        <p className="mt-1 text-base font-medium text-slate-500">
          Credit accounts (udhaar). Total due from all customers: {rs(totalDue)}
        </p>
      </div>

      {message && (
        <div
          role={message.type === 'error' ? 'alert' : 'status'}
          className={`rounded-2xl border-2 px-5 py-4 text-sm font-bold ${
            message.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {message.text}
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="ml-3 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Customer list */}
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-black text-slate-900">All customers</h2>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
            >
              Add customer
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone or CNIC"
            className="mb-4 w-full rounded-xl border-2 border-slate-200 px-4 py-2.5 text-base outline-none focus:border-emerald-500"
          />
          <div className="max-h-[560px] space-y-2 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm font-medium text-slate-500">
                No customers yet. Add the first one above.
              </p>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`w-full rounded-xl border-2 px-4 py-3 text-left transition ${
                  c.id === selectedId
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <span className="block text-base font-bold text-slate-900">{c.name}</span>
                {c.phone && (
                  <span className="block text-sm font-medium text-slate-500">{c.phone}</span>
                )}
                <span
                  className={`block text-sm font-bold ${
                    (c.balance || 0) > 0 ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  Due: {rs(c.balance || 0)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Statement */}
        <div className="min-w-0 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          {!selected ? (
            <p className="py-16 text-center text-base font-medium text-slate-500">
              Select a customer to see their credit statement.
            </p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-slate-900">{selected.name}</h2>
                  <p className="text-sm font-medium text-slate-500">
                    {selected.phone || ''}
                    {selected.phone && selected.cnic ? ' · ' : ''}
                    {selected.cnic || ''}
                  </p>
                  <p className="mt-1 text-lg font-black text-red-700">
                    Balance due: {rs(selected.balance || 0)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEntryOpen('credit');
                      setEntryDay(todayIso());
                    }}
                    className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-700"
                  >
                    Give credit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEntryOpen('payment');
                      setEntryDay(todayIso());
                    }}
                    className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
                  >
                    Receive payment
                  </button>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="text-sm font-bold text-slate-700">
                  From{' '}
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="rounded-lg border-2 border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="text-sm font-bold text-slate-700">
                  To{' '}
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="rounded-lg border-2 border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <span className="text-sm font-medium text-slate-500">
                  Opening balance: {rs(opening)}
                </span>
              </div>

              {loading ? (
                <p className="py-8 text-center text-sm font-medium text-slate-500">Loading…</p>
              ) : rowsWithBalance.length === 0 ? (
                <p className="py-8 text-center text-sm font-medium text-slate-500">
                  No credit or payment entries in this period.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b-2 border-slate-200 text-slate-500">
                        <th className="py-2 pr-2">Date</th>
                        <th className="py-2 pr-2">Type</th>
                        <th className="py-2 pr-2">Note</th>
                        <th className="py-2 pr-2 text-right">Amount</th>
                        <th className="py-2 pr-2 text-right">Balance</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rowsWithBalance.map((r) => (
                        <tr
                          key={r.id}
                          className={`border-b border-slate-100 ${r.reversed ? 'text-slate-400 line-through' : 'text-slate-900'}`}
                        >
                          <td className="py-2.5 pr-2 font-medium">{r.day}</td>
                          <td className="py-2.5 pr-2 font-bold">
                            {r.kind === 'CREDIT' ? 'Credit given' : 'Payment received'}
                            {r.reversed ? ' (Reversed)' : ''}
                          </td>
                          <td className="py-2.5 pr-2 font-medium">{r.data.note || ''}</td>
                          <td className="py-2.5 pr-2 text-right font-mono font-bold">
                            {r.kind === 'CREDIT' ? '+' : '-'}
                            {rs(r.amount)}
                          </td>
                          <td className="py-2.5 pr-2 text-right font-mono font-bold">
                            {r.balanceAfter == null ? '—' : rs(r.balanceAfter)}
                          </td>
                          <td className="py-2.5 text-right">
                            {!r.reversed && (
                              <button
                                type="button"
                                onClick={() => setReverseRow(r)}
                                className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
                              >
                                Reverse
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add customer modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-black text-slate-900">Add customer</h3>
            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-700">
                Name
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                Phone
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                Father name
                <input
                  type="text"
                  value={form.fatherName}
                  onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                  className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                CNIC
                <input
                  type="text"
                  value={form.cnic}
                  onChange={(e) => setForm({ ...form, cnic: e.target.value })}
                  className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                Address
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                Due day of month (1–28)
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.dueDay}
                  onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
                  className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-xl border-2 border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitCustomer()}
                disabled={saving}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
              >
                {saving ? 'Saving…' : 'Save customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Give credit / receive payment modal */}
      {entryOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-1 text-lg font-black text-slate-900">
              {entryOpen === 'credit' ? 'Give credit' : 'Receive payment'} — {selected.name}
            </h3>
            <p className="mb-4 text-sm font-medium text-slate-500">
              Balance due: {rs(selected.balance || 0)}
            </p>
            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-700">
                Amount (Rs.)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                Date
                <input
                  type="date"
                  value={entryDay}
                  onChange={(e) => setEntryDay(e.target.value)}
                  className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                Note
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEntryOpen(null)}
                className="rounded-xl border-2 border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitEntry()}
                disabled={saving}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse entry modal */}
      {reverseRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-1 text-lg font-black text-slate-900">Reverse entry</h3>
            <p className="mb-4 text-sm font-medium text-slate-500">
              {reverseRow.day} ·{' '}
              {reverseRow.kind === 'CREDIT' ? 'Credit given' : 'Payment received'} ·{' '}
              {rs(reverseRow.amount)}
            </p>
            <label className="block text-sm font-bold text-slate-700">
              Reason
              <textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                rows={3}
                placeholder="Why is this entry being reversed?"
                className="mt-1 block w-full rounded-lg border-2 border-slate-200 p-3 text-base font-medium outline-none focus:border-emerald-500"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReverseRow(null)}
                className="rounded-xl border-2 border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitReverse()}
                disabled={saving || !reverseReason.trim()}
                className="rounded-xl bg-red-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-800 disabled:bg-slate-300"
              >
                {saving ? 'Reversing…' : 'Reverse entry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
