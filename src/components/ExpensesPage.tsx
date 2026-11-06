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

type Category = { id: string; name: string; active?: boolean };

type Row = {
  id: string;
  day: string;
  kind: string;
  amount: number;
  reversed: number;
  data: { note?: string; category?: string | null; categoryName?: string | null };
};

const rs = (paisa: number) =>
  `Rs. ${(Number(paisa || 0) / 100).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const todayIso = () => getPakistanLocalDate();
const monthStart = () => todayIso().slice(0, 8) + '01';

export function ExpensesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [entryDay, setEntryDay] = useState(todayIso());
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const [reverseRow, setReverseRow] = useState<Row | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await request({ type: 'snapshot', from, to, kinds: ['EXPENSE'] });
      setRows(snap.rows || []);
      setCategories((snap.masters?.category || []).filter((c: Category) => c.active !== false));
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Could not load expenses.' });
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(
    () => rows.filter((r) => !r.reversed).reduce((sum, r) => sum + r.amount, 0),
    [rows],
  );

  const submitExpense = async () => {
    const amt = Number(amount);
    if (!description.trim()) {
      setMessage({ type: 'error', text: 'Enter what the expense was for.' });
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
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
        kind: 'EXPENSE',
        business: 'FUEL',
        account: 'cash-FUEL',
        category: categoryId || undefined,
        amount: amt,
        day: entryDay,
        note: description.trim(),
      });
      setMessage({ type: 'success', text: 'Expense saved.' });
      setDescription('');
      setAmount('');
      setEntryDay(todayIso());
      await load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Expense was NOT saved.' });
    } finally {
      setSaving(false);
    }
  };

  const submitCategory = async () => {
    if (!newCategory.trim()) return;
    setSaving(true);
    try {
      const id = await request({
        type: 'master',
        kind: 'category',
        business: 'FUEL',
        name: newCategory.trim(),
      });
      setNewCategory('');
      await load();
      setCategoryId(String(id));
      setMessage({ type: 'success', text: 'Category added.' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Category was NOT added.' });
    } finally {
      setSaving(false);
    }
  };

  const submitReverse = async () => {
    if (!reverseRow || !reverseReason.trim()) return;
    setSaving(true);
    try {
      await request({ type: 'reverse', document: reverseRow.id, reason: reverseReason.trim() });
      setMessage({ type: 'success', text: 'Expense reversed.' });
      setReverseRow(null);
      setReverseReason('');
      await load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Expense was NOT reversed.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Expenses</h1>
        <p className="mt-1 text-base font-medium text-slate-500">
          Money spent from the counter cash. Total in this period: {rs(total)}
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
          <button type="button" onClick={() => setMessage(null)} className="ml-3 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Add expense */}
      <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-black text-slate-900">Add expense</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_220px_160px_180px_auto]">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was it for?"
            className="min-w-0 rounded-xl border-2 border-slate-200 px-4 py-2.5 text-base font-medium outline-none focus:border-emerald-500"
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="min-w-0 rounded-xl border-2 border-slate-200 px-4 py-2.5 text-base font-medium outline-none focus:border-emerald-500"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (Rs.)"
            className="min-w-0 rounded-xl border-2 border-slate-200 px-4 py-2.5 text-base font-medium outline-none focus:border-emerald-500"
          />
          <input
            type="date"
            value={entryDay}
            onChange={(e) => setEntryDay(e.target.value)}
            className="min-w-0 rounded-xl border-2 border-slate-200 px-4 py-2.5 text-base font-medium outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={() => void submitExpense()}
            disabled={saving}
            className="whitespace-nowrap rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
          >
            {saving ? 'Saving…' : 'Save expense'}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category name"
            className="rounded-xl border-2 border-slate-200 px-4 py-2 text-sm font-medium outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={() => void submitCategory()}
            disabled={saving || !newCategory.trim()}
            className="rounded-xl border-2 border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
          >
            Add category
          </button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
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
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm font-medium text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm font-medium text-slate-500">
            No expenses in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200 text-slate-500">
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2">Category</th>
                  <th className="py-2 pr-2 text-right">Amount</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-slate-100 ${r.reversed ? 'text-slate-400 line-through' : 'text-slate-900'}`}
                  >
                    <td className="py-2.5 pr-2 font-medium">{r.day}</td>
                    <td className="py-2.5 pr-2 font-bold">
                      {r.data.note || ''}
                      {r.reversed ? ' (Reversed)' : ''}
                    </td>
                    <td className="py-2.5 pr-2 font-medium">{r.data.categoryName || '—'}</td>
                    <td className="py-2.5 pr-2 text-right font-mono font-bold">{rs(r.amount)}</td>
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
      </div>

      {/* Reverse expense modal */}
      {reverseRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-1 text-lg font-black text-slate-900">Reverse expense</h3>
            <p className="mb-4 text-sm font-medium text-slate-500">
              {reverseRow.day} · {reverseRow.data.note || ''} · {rs(reverseRow.amount)}
            </p>
            <label className="block text-sm font-bold text-slate-700">
              Reason
              <textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                rows={3}
                placeholder="Why is this expense being reversed?"
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
                {saving ? 'Reversing…' : 'Reverse expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
