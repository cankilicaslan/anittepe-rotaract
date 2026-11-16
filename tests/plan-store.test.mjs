// Gelecek dönemi planla — demo store plan modu testleri — node --test tests/plan-store.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.location = { search: '?demo' };

const { createStore } = await import('../uye/js/store.js');

async function login(store, role) {
  const accts = await store.demoAccounts();
  const all = await store.listMembers().catch(() => null);
  // demoAccounts yalnızca e-posta verir; rolü profilden bul
  for (const a of accts) {
    const p = await store.signIn(a.email, store.demoPassword);
    if ((p.roles || []).includes(role)) return p;
  }
  throw new Error('rol yok: ' + role);
}

let store;
beforeEach(async () => { mem.clear(); store = await createStore(); });

test('başkan plan dönemini açamaz', async () => {
  await login(store, 'baskan');
  await assert.rejects(() => store.ensurePlanTerm());
});

test('asbaşkan plan dönemi 2027-28 açar, idempotent', async () => {
  await login(store, 'asbaskan');
  const a = await store.ensurePlanTerm();
  const b = await store.ensurePlanTerm();
  assert.equal(a.name, '2027-28');
  assert.equal(a.start_date, '2027-07-01');
  assert.equal(a.is_current, false);
  assert.equal(a.id, b.id);
});

test('plan modunda taksit borç üretmez ve bugünkü listede görünmez', async () => {
  const me = await login(store, 'asbaskan');
  const plan = await store.ensurePlanTerm();
  store.setViewTerm(plan);
  assert.equal((await store.getTerm()).id, plan.id);
  const d = await store.createDue({ label: '__x', period: '2027-07', amount: 1, due_date: '2027-07-15', member_ids: [me.id] });
  assert.equal((await store.listCharges()).filter(c => c.due_id === d.id).length, 0);
  assert.deepEqual((await store.listDues()).map(x => x.label), ['__x']);
  store.setViewTerm(null);
  assert.ok(!(await store.listDues()).some(x => x.label === '__x'));
  assert.notEqual((await store.getTerm()).id, plan.id);
});

test('plan modunda proje ve kasa kaydı yalnızca plan döneminde', async () => {
  await login(store, 'asbaskan');
  const plan = await store.ensurePlanTerm();
  store.setViewTerm(plan);
  await store.saveProject({ title: '__p', date: '2027-09-01', kind: 'hizmet', status: 'planlandi' });
  await store.addTransaction({ date: '2027-08-01', kind: 'gider', category: 'Bağış – PolioPlus', description: '__t', amount: 10 });
  assert.deepEqual((await store.listCalendarProjects()).map(p => p.title), ['__p']);
  assert.equal((await store.listTransactions()).length, 1);
  store.setViewTerm(null);
  assert.ok(!(await store.listCalendarProjects()).some(p => p.title === '__p'));
  assert.ok(!(await store.listTransactions()).some(t => t.description === '__t'));
  assert.ok(!(await store.listDonations()).some(d => d.note === '__t'));
});

test('YK planı kaydedilir ve geri okunur', async () => {
  await login(store, 'asbaskan');
  await store.ensurePlanTerm();
  assert.deepEqual((await store.getBoardPlan()).slots, {});
  await store.saveBoardPlan({ baskan: { kind: 'member', id: 'm1' } });
  assert.deepEqual((await store.getBoardPlan()).slots, { baskan: { kind: 'member', id: 'm1' } });
});
