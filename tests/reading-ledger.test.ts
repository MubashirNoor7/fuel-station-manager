import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { correctReading, readingId, readingCash, closingInput, updateNozzleMeters, expenseFromCollectedCash, remainingCashForReading } from '../src/logic/readingLedger';
import type { NozzleReadingRecord } from '../src/types';
import { buildOperationDraft } from '../src/logic/operationDraft';
import { calculateFuelStock, calculateFuelSalesForDate } from '../src/logic/fuelStock';
import { calculateCumulativeClosedTotals } from '../src/logic/calculations';
const require = createRequire(import.meta.url);
const { BusinessStore } = require('../electron/business-store.cjs');
const { validateReadingLedger } = require('../electron/reading-ledger.cjs');
const reading = (id = 'r1', nozzleId = 'n1'): NozzleReadingRecord => ({ readingId: id, nozzleId, pumpId: 'p1', pumpNameSnapshot: 'Pump 1', nozzleNameSnapshot: 'Nozzle 1', employeeId: 'e1', employeeNameSnapshot: 'Ali', shiftId: 's1', shiftNameSnapshot: 'Day', readingSequence: 1, meterOrder: 1, openingMeter: 100, closingMeter: 110, rate: 278.25, quantitySold: 10, salesAmount: 2782.5, fuelType: 'PETROL', closingAccepted: true, closingAcceptedAt: '2026-10-06T01:00:00Z' });
const operation = () => ({ id: 'day1', businessDate: '2026-10-06', status: 'OPEN', nozzleReadings: [reading(), reading('r2','n2')], cashDeposits: [], expenses: [] });

test('manual daily summary stock and cumulative reports carry quantities without fabricated nozzle readings',()=>{
  const op:any={...operation(),businessDate:'2026-10-12',status:'CLOSED',nozzleReadings:[],grossSales:1000,totalQuantity:10,totalExpenses:100,expectedNet:700,actualCollection:700,variance:0,
    manualSummary:{fuel:{PETROL:{quantity:10,amount:1000}},cashCollected:700}};
  const stock:any=[{id:'opening',businessDate:'2026-10-11',fuelType:'PETROL',openingStock:100,supplyRecords:[]},
    {id:'supply',businessDate:'2026-10-12',fuelType:'PETROL',supplyRecords:[{id:'delivery',businessDate:'2026-10-12',fuelType:'PETROL',quantity:20,createdAt:'2026-10-14T00:00:00Z'}]}];
  assert.equal(calculateFuelStock('2026-10-13','PETROL',[op],stock).remainingStock,110);
  assert.equal(calculateFuelStock('2026-10-11','PETROL',[op],stock).remainingStock,100);
  assert.equal(calculateFuelSalesForDate([op],'2026-10-12','PETROL'),10);
  assert.equal(calculateFuelSalesForDate([op],'2026-10-13','PETROL'),0);
  const cumulative=calculateCumulativeClosedTotals([op]);
  assert.equal(cumulative.grossSales,1000);
  assert.equal(cumulative.totalPetrolQuantity,10);
  assert.equal(cumulative.totalPetrolSales,1000);
});

test('screenshot totals include legacy 550 and new 1000; deletion recalculates and stale drafts cannot resurrect', () => {
  const s=new BusinessStore(':memory:');
  try {
    const op={...operation(),nozzleReadings:[{...reading(),rate:1953.3,salesAmount:19533}],
      expenses:[{id:'legacy',amount:550,description:'First',paidBy:'manager'},{id:'new',amount:1000,description:'Second',collectedCashUsed:1000}],
      cashDeposits:[{id:'cash',readingId:'r1',nozzleId:'n1',fuelType:'PETROL',amount:19533,timestamp:'now'}],
      grossSales:19533,totalExpenses:1550,expectedNet:18533,actualCollection:18533};
    s.petrolStatePut({kind:'operation',item:op});
    // Simulate cached totals from an older release without changing the source entries.
    s.db.prepare("UPDATE petrol_records SET data=? WHERE kind='operation' AND id=?").run(JSON.stringify(op),op.id);
    let loaded=s.petrolStateLoad().operations[0];
    assert.equal(loaded.expectedNet,17983);
    assert.equal(loaded.actualCollection,17983);
    assert.equal(loaded.totalExpenses,1550);
    s.petrolStatePut({kind:'operation',item:{...loaded,expenses:loaded.expenses.filter((e:any)=>e.id!=='legacy')}});
    loaded=s.petrolStateLoad().operations[0];
    assert.equal(loaded.totalExpenses,1000);
    assert.equal(loaded.expectedNet,18533);
    assert.equal(loaded.actualCollection,18533);
    assert.throws(()=>s.petrolStatePut({kind:'operation',item:op}),/deleted expense/);
    const report=require('../electron/fuel-workspace.cjs').daily(s,op.businessDate);
    assert.equal(report.expected,1853300);
    assert.equal(report.cashRemaining,1853300);
    assert.equal(s.petrolStateLoad().operations[0].expenses.length,1);
  } finally {s.close();}
});

test('fully spent or fully credited days use zero cash instead of requiring a positive receipt', () => {
  const args={operationId:'zero',businessDate:'2026-10-06',cycleNumber:1,startTime:'now',petrolRate:100,cngRate:100,
    rows:[{readingId:'r1',nozzleId:'n1',pumpId:'p1',shiftId:'s1',shiftNameSnapshot:'Day',readingSequence:1,meterOrder:1,employeeId:'e1',openingMeter:100,closingMeterStr:'200',closingAccepted:true}],
    cashDeposits:[],closingNotes:'',nozzleMap:new Map(),pumpMap:new Map(),employeeMap:new Map()};
  for(const credit of [0,10000]) {
    const draft=buildOperationDraft({...args,udhaarTotal:credit,expenses:credit?[]:[{id:'e',amount:10000,description:'Expense',category:'Other',dateTime:'now'}]});
    assert.equal(draft.expectedNet,0);
    assert.equal(draft.actualCollection,0);
    assert.equal(draft.variance,0);
    assert.equal(draft.reconciliationStatus,'BALANCED');
  }
});

for (const before of [0, 300, 10000]) test(`expense reconciles when cash received before expense is ${before}`, () => {
  const s=new BusinessStore(':memory:');
  try {
    const receipt=(id:string,amount:number)=>({id,readingId:'r1',nozzleId:'n1',fuelType:'PETROL' as const,amount,timestamp:'2026-10-06T02:00:00Z'});
    const deposits=before ? [receipt('first',before)] : [];
    const expense={id:'expense',description:'Tea',category:'Tea/Food' as const,amount:500,dateTime:'2026-10-06T03:00:00Z',collectedCashUsed:expenseFromCollectedCash(500,[],deposits)};
    assert.equal(expense.collectedCashUsed,Math.min(before,500));
    const args={operationId:'expense-day',businessDate:'2026-10-06',cycleNumber:1,startTime:'2026-10-06T00:00:00Z',petrolRate:100,cngRate:100,
      rows:[{readingId:'r1',nozzleId:'n1',pumpId:'p1',shiftId:'s1',shiftNameSnapshot:'Day',readingSequence:1,meterOrder:1,employeeId:'e1',openingMeter:100,closingMeterStr:'200',closingAccepted:true}],
      closingNotes:'',udhaarTotal:0,nozzleMap:new Map(),pumpMap:new Map(),employeeMap:new Map()};
    s.petrolStatePut({kind:'operation',item:buildOperationDraft({...args,expenses:[],cashDeposits:deposits})});
    const remaining=9500-(before-expense.collectedCashUsed);
    const receipts=[...deposits,...(remaining>0?[receipt('last',remaining)]:[])];
    const draft=buildOperationDraft({...args,expenses:[expense],cashDeposits:receipts});
    assert.equal(draft.expectedNet,9500);
    assert.equal(draft.actualCollection,9500);
    assert.equal(draft.variance,0);
    assert.equal(remainingCashForReading(10000,receipts.reduce((n,d)=>n+d.amount,0),0),0);
    s.petrolStatePut({kind:'operation',item:draft});
    s.petrolStatePut({kind:'operation',item:draft});
    const balance=(a:string)=>s.db.prepare('SELECT COALESCE(SUM(amount),0) n FROM postings WHERE account=?').get(a).n;
    assert.equal(balance('cash-FUEL'),0);
    assert.equal(balance('cash-manager'),950000);
    const report=require('../electron/fuel-workspace.cjs').daily(s,draft.businessDate);
    assert.equal(report.expected,950000);
    assert.equal(report.cashRemaining,950000);
    assert.equal(report.difference,0);
    const extra={...draft,cashDeposits:[...receipts,receipt('excess',1)]};
    assert.throws(()=>s.petrolStatePut({kind:'operation',item:extra}),/exceed/);
  } finally {s.close();}
});

test('reading cash collection respects shared day balance without hiding overpayments', () => {
  assert.equal(remainingCashForReading(5000,2000,1000),1000);
  assert.equal(remainingCashForReading(5000,2000,0),0);
  assert.equal(remainingCashForReading(5000,5100,0),-100);
  assert.equal(expenseFromCollectedCash(200,[{amount:100,collectedCashUsed:100} as any],[{amount:150} as any]),50);
});

test('simple expense reduces expected cash once and reconciles credit plus net handover', () => {
  const expense = {id:'expense-simple',description:'Tea',category:'Tea/Food' as const,amount:500,dateTime:'2026-10-06T01:00:00Z'};
  const draft = buildOperationDraft({
    operationId:'simple',businessDate:'2026-10-06',cycleNumber:1,startTime:'2026-10-06T00:00:00Z',petrolRate:100,cngRate:100,
    rows:[{readingId:'r1',nozzleId:'n1',pumpId:'p1',shiftId:'s1',shiftNameSnapshot:'Day',readingSequence:1,meterOrder:1,employeeId:'e1',openingMeter:100,closingMeterStr:'200',closingAccepted:true}],
    expenses:[expense],cashDeposits:[{id:'cash-simple',readingId:'r1',nozzleId:'n1',fuelType:'PETROL',amount:8500,timestamp:'2026-10-06T02:00:00Z'}],
    closingNotes:'',udhaarTotal:1000,nozzleMap:new Map(),pumpMap:new Map(),employeeMap:new Map(),
  });
  assert.equal(draft.grossSales,10000);
  assert.equal(draft.totalExpenses,500);
  assert.equal(draft.expectedNet,8500);
  assert.equal(draft.variance,0);
  assert.equal('paidBy' in draft.expenses[0],false);
  const s=new BusinessStore(':memory:');
  try {
    const customer=s.command({type:'master',kind:'customer',business:'FUEL',name:'Test customer'});
    s.petrolStatePut({kind:'operation',item:draft});
    s.addUdhaar({customer,day:draft.businessDate,amount:1000});
    s.petrolStatePut({kind:'operation',item:draft}); // Retry must not deduct twice.
    const balance=(account:string)=>s.db.prepare('SELECT COALESCE(SUM(amount),0) n FROM postings WHERE account=?').get(account).n;
    assert.equal(balance('cash-FUEL'),0);
    assert.equal(balance('cash-manager'),850000);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM documents WHERE kind='EXPENSE'").get().n,1);
  } finally {s.close();}
});

test('meter dates preserve newer days and allow latest corrections, including legacy nozzles', () => {
  const nozzle = {id:'n1',pumpId:'p1',name:'N1',fuelType:'PETROL' as const,isActive:true,lastClosingMeter:110};
  const op = {...operation(), nozzleReadings:[reading()]} as any;
  const saved = updateNozzleMeters(op,[nozzle],[])[0];
  assert.equal(saved.lastClosingDay,'2026-10-06');
  const corrected = {...op,nozzleReadings:[correctReading(reading(),105,'Typo','2026-10-06T03:00:00Z')]};
  assert.equal(updateNozzleMeters(corrected,[saved],[op])[0].lastClosingMeter,105);
  const older = {...op,id:'older',businessDate:'2026-10-05',nozzleReadings:[{...reading(),closingMeter:999}]};
  assert.equal(updateNozzleMeters(older,[saved],[op])[0].lastClosingMeter,110);
  assert.equal(updateNozzleMeters(older,[nozzle],[op])[0].lastClosingMeter,110);
  const next = {...op,id:'next',businessDate:'2026-10-07',nozzleReadings:[{...reading(),openingMeter:0,closingMeter:5}]};
  assert.equal(updateNozzleMeters(next,[saved],[op])[0].lastClosingMeter,5);
});

test('new zero-rate readings fail but historical zero-rate readings remain valid', () => {
  const old = {...operation(),nozzleReadings:[{...reading(),rate:0,salesAmount:0}]};
  assert.throws(()=>validateReadingLedger(null,old),/rate/);
  assert.doesNotThrow(()=>validateReadingLedger(old,old));
});

test('closed petrol days reject all content changes and reopen with reason before saving', () => {
  const s=new BusinessStore(':memory:');
  try {
    const op={...operation(),status:'CLOSED',notes:'Saved',grossSales:5565,expectedNet:5565};
    const put=(item:any)=>s.petrolStatePut({kind:'operation',item});
    put(op);
    put(Object.fromEntries(Object.entries(op).reverse()));
    for(const change of [{businessDate:'2026-10-07'},{grossSales:1},{expectedNet:1},{notes:'Changed'},{countedCash:10},{status:'OPEN'},{expenses:[{id:'e',amount:10}]}]) {
      assert.throws(()=>put({...op,...change}),/closed/);
    }
    assert.throws(()=>s.command({type:'reopen',business:'FUEL',day:op.businessDate,reason:''}),/Reason/);
    s.command({type:'reopen',business:'FUEL',day:op.businessDate,reason:'Correct entry'});
    const reopened=s.petrolStateLoad().operations[0];
    assert.equal(reopened.status,'OPEN');
    assert.equal(reopened.reopenReason,'Correct entry');
    put({...reopened,notes:'Corrected'});
    assert.equal(s.petrolStateLoad().operations[0].notes,'Corrected');
  } finally {s.close();}
});

test('draft totals exclude pending sales while preserving input; acceptance includes the sale once', () => {
  const row = (id: string, accepted: boolean, closing: string) => ({ readingId: id, nozzleId: id, pumpId: 'p1', shiftId: 's1', shiftNameSnapshot: 'Day', readingSequence: 1, meterOrder: accepted ? 1 : 0, employeeId: 'e1', openingMeter: 100, closingMeterStr: closing, closingAccepted: accepted });
  const args: Parameters<typeof buildOperationDraft>[0] = {
    operationId:'test-day',businessDate:'2026-10-07',cycleNumber:1,startTime:'2026-10-07T00:00:00Z',petrolRate:10,cngRate:20,
    rows:[row('n1',true,'110'),row('n2',false,'150')],
    expenses:[{id:'staff',description:'Staff tea',category:'Tea/Food',amount:10,dateTime:'now',paidBy:'staff'}, {id:'manager',description:'Manager expense',category:'Other',amount:40,dateTime:'now',paidBy:'manager'}],
    cashDeposits:[{id:'receipt',amount:70,timestamp:'now'}],closingNotes:'',udhaarTotal:20,
    nozzleMap:new Map(),pumpMap:new Map(),employeeMap:new Map(),
  };
  const draft = buildOperationDraft(args);
  assert.equal(draft.nozzleReadings.length,2);
  assert.equal(draft.nozzleReadings[1].closingMeter,150);
  assert.equal(draft.nozzleReadings[1].closingAccepted,false);
  assert.equal(draft.grossSales,100);
  assert.equal(draft.totalQuantity,10);
  assert.equal(draft.totalExpenses,50);
  assert.equal(draft.expectedNet,30); // sale - ALL expenses - credit
  assert.equal(draft.actualCollection,30); // collected cash less legacy manager expense
  assert.equal(draft.variance,0);
  const accepted = buildOperationDraft({...args,rows:[args.rows[0],row('n2',true,'150')]});
  assert.equal(accepted.grossSales,600);
  assert.equal(accepted.totalQuantity,60);
  assert.equal(accepted.expectedNet,530);
  const invalidPending = buildOperationDraft({...args,rows:[args.rows[0],row('n2',false,'90')]});
  assert.equal(invalidPending.expectedNet,30);
  const onlyPending = buildOperationDraft({...args,rows:[row('n2',false,'150')],expenses:[],cashDeposits:[],udhaarTotal:0});
  assert.equal(onlyPending.grossSales,0);
  assert.equal(onlyPending.totalQuantity,0);
  assert.equal(onlyPending.expectedNet,0);
});

test('empty closing survives draft reload without copying opening into the input', () => {
  const legacy = { ...reading(), closingAccepted: false, closingMeter: 100 };
  assert.equal(closingInput(legacy), '');
  assert.equal(closingInput({ ...legacy, closingEntered: false, closingMeter: 110 }), '');
  assert.equal(closingInput({ ...legacy, closingEntered: true, closingMeter: 112 }), '112');
  assert.equal(closingInput({ ...legacy, closingMeter: 112 }), '112');
  assert.equal(closingInput({ ...legacy, closingEntered: true }), '100');
  assert.equal(closingInput({ ...legacy, closingAccepted: true }), '100');
});

test('new accepted closing must exceed opening; existing zero-sale history stays intact', () => {
  const zero = { ...reading(), closingMeter: 100, quantitySold: 0, salesAmount: 0 };
  const old = {nozzleReadings:[zero],cashDeposits:[]};
  validateReadingLedger(old,structuredClone(old));
  for (const closingMeter of [99,100,NaN,Infinity]) {
    assert.throws(()=>validateReadingLedger(null,{nozzleReadings:[{...zero,closingMeter}]}),/greater than/);
  }
  validateReadingLedger(null,{nozzleReadings:[reading()]});
  assert.throws(()=>correctReading(reading(),100,'typo','now'),/greater than/);
});

test('correction leaves source locked and preserves names, rate, other rows, and prior history', () => {
  const before = operation(), snapshot = structuredClone(before);
  const after = correctReading(before.nozzleReadings[0], 112.1234, 'Meter typo', '2026-10-06T02:00:00Z');
  assert.deepEqual(before, snapshot);
  assert.equal(after.closingAccepted, true);
  assert.equal(after.quantitySold, 12.123);
  assert.equal(after.salesAmount, 3373.22);
  assert.equal(after.nozzleNameSnapshot, 'Nozzle 1');
  assert.equal(after.corrections?.[0].previousClosing, 110);
  validateReadingLedger(before, { ...before, nozzleReadings: [after, before.nozzleReadings[1]] });
});

test('invalid corrections do not mutate a saved reading', () => {
  for (const closing of [-1, 99, Infinity, NaN, 2000000]) assert.throws(() => correctReading(reading(), closing, 'reason', 'now'));
  assert.throws(() => correctReading(reading(), 111, ' ', 'now'));
});

test('cash is isolated by reading ID; older nozzle cash is reported separately', () => {
  const one = reading(), two = { ...reading('r2'), readingSequence: 2 };
  const cash = [{ id: 'c1', nozzleId:'n1', readingId: 'r1', amount: 10.25, timestamp: 'now' }, { id: 'c2', nozzleId: 'n1', readingId: 'r2', amount: 20, timestamp: 'now' }, { id: 'legacy', nozzleId:'n1', amount: 7, timestamp: 'before' }];
  assert.deepEqual(readingCash(one,cash), {received:10.25,legacy:7});
  assert.deepEqual(readingCash(two,cash), {received:20,legacy:7});
});

test('legacy reading identity survives adding an explicit ID', () => {
  const old = { ...reading(), readingId: undefined };
  validateReadingLedger({nozzleReadings:[old]}, {nozzleReadings:[{...old,readingId:readingId(old)}]});
});

test('stale whole-day writes cannot unlock, drop, rename or overwrite saved readings', () => {
  const before = operation();
  for (const rows of [[], [before.nozzleReadings[0]], before.nozzleReadings.map(r=>({...r,closingAccepted:false})), [{...before.nozzleReadings[0],nozzleNameSnapshot:'Renamed'},before.nozzleReadings[1]], [{...before.nozzleReadings[0],closingMeter:115},before.nozzleReadings[1]]]) {
    assert.throws(()=>validateReadingLedger(before,{...before,nozzleReadings:rows}));
  }
  const corrected = {...before,nozzleReadings:[correctReading(before.nozzleReadings[0],111,'typo','now'),before.nozzleReadings[1]]};
  assert.throws(()=>validateReadingLedger(corrected,before));
});

test('saved receipts cannot vanish or change; new cash must target its accepted reading', () => {
  const before = {...operation(),cashDeposits:[{id:'cash1',nozzleId:'n1',readingId:'r1',fuelType:'PETROL',amount:20,timestamp:'now'}]};
  assert.throws(()=>validateReadingLedger(before,{...before,cashDeposits:[]}));
  assert.throws(()=>validateReadingLedger(before,{...before,cashDeposits:[{...before.cashDeposits[0],amount:21}]}));
  for (const patch of [{readingId:'missing'}, {nozzleId:'n2'}, {amount:Infinity}, {amount:0}]) assert.throws(()=>validateReadingLedger(null,{...before,cashDeposits:[{...before.cashDeposits[0],...patch}]}));
});

test('database commits correction and cash atomically, rejects stale drafts and reloads intact', () => {
  const store = new BusinessStore(':memory:');
  try {
    const put = (item:any) => store.petrolStatePut({kind:'operation',item});
    const before = operation();
    assert.throws(()=>put({...before,nozzleReadings:[{...reading(),closingMeter:100,quantitySold:0,salesAmount:0}]}),/greater than/);
    assert.equal(store.petrolStateLoad().operations.length,0);
    put(before);
    const corrected = {...before,nozzleReadings:[correctReading(before.nozzleReadings[0],112,'Entry correction','2026-10-06T02:00:00Z'),before.nozzleReadings[1]],cashDeposits:[{id:'receipt1',readingId:'r1',nozzleId:'n1',fuelType:'PETROL',amount:123.45,timestamp:'now'}]};
    put(corrected);
    assert.throws(()=>put(before));
    const loaded=store.petrolStateLoad().operations[0];
    for (const [key,value] of Object.entries(corrected)) assert.deepEqual(loaded[key],value);
    const audit = store.db.prepare("SELECT data FROM audit WHERE action='PETROL_READING_CORRECTION'").all();
    assert.equal(audit.length,1);
    assert.equal(JSON.parse(audit[0].data).before.closingMeter,110);
    const receipts = store.db.prepare("SELECT amount,data FROM documents WHERE kind='COLLECTION'").all();
    assert.equal(receipts.length,1);
    assert.equal(receipts[0].amount,12345);
    assert.equal(JSON.parse(receipts[0].data).readingId,'r1');
    put(corrected); // Retry of the same saved snapshot cannot double-post cash.
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM documents WHERE kind='COLLECTION'").get().n,1);
  } finally {store.close();}
});
