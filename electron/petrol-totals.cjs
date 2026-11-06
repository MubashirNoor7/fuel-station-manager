// Derived values are rebuilt from source entries, never from cached totals.
function operationTotals(op, credit = 0) {
  const round = (n) => Math.round(n * 100) / 100;
  const readings = (op.nozzleReadings || []).filter((r) => r.closingAccepted);
  const summary = op.manualSummary;
  const summaryFuel = Object.values(summary?.fuel || {});
  const grossSales = round(summary ? summaryFuel.reduce((n,r)=>n+Number(r.amount || 0),0) : readings.reduce((n, r) => n + Number(r.salesAmount || 0), 0));
  const expenses = op.expenses || [];
  const totalExpenses = round(expenses.reduce((n, e) => n + Number(e.amount || 0), 0));
  const spentCollected = round(expenses.reduce((n, e) => n + Number(e.collectedCashUsed ?? (e.paidBy === 'manager' ? e.amount : 0)), 0));
  const expectedNet = round(grossSales - totalExpenses - credit);
  const deposits = op.cashDeposits || [];
  const actualCollection = summary ? Number(summary.cashCollected) : deposits.length ? round(deposits.reduce((n, d) => n + Number(d.amount || 0), 0) - spentCollected) : expectedNet === 0 ? 0 : null;
  const variance = actualCollection === null ? null : round(actualCollection - expectedNet);
  const reconciliationStatus = variance === null ? 'PENDING' : variance === 0 ? 'BALANCED' : variance < 0 ? 'SHORT' : 'EXCESS';
  const reconciliationText = variance === null ? 'PENDING' : variance === 0 ? 'BALANCED' : `${reconciliationStatus === 'SHORT' ? 'SHORT' : 'EXCESS'} BY Rs. ${Math.abs(variance).toLocaleString('en-US', {maximumFractionDigits:2})}`;
  return {...op, grossSales, totalQuantity:summary ? summaryFuel.reduce((n,r)=>n+Number(r.quantity || 0),0) : readings.reduce((n,r)=>n+Number(r.quantitySold || 0),0), totalExpenses, udhaarTotal:credit, expectedNet, actualCollection, variance, reconciliationStatus, reconciliationText};
}
module.exports = { operationTotals };
