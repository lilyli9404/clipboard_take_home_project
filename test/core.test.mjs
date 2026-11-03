import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BASE,CRM,parseLocation,scrape } from '../lib/source.mjs';
import { buildPlan,street,care,evidence,protectedBilling } from '../lib/match.mjs';
import { Store } from '../lib/store.mjs';
import { decide } from '../lib/service.mjs';
const html='<body><h1>Bellhaven Test</h1><dl><dt>Address</dt><dd>12 NW Main Street<br>Testville, OH 12345</dd><dt>Care Offerings</dt><dd><span>Assisted Living</span></dd><dt>Administrator</dt><dd>Jane Sample</dd><dt>Phone</dt><dd>555-111-2222</dd></dl></body>';
const loc=parseLocation(html,BASE+'/communities/test');
const parent={account_id:'P',name:'Bellhaven Senior Living (Parent Account)',parent_id:''};
const account=(extra={})=>({account_id:'A',name:loc.name,parent_id:'P',parent_name:parent.name,billing_street:'12 Northwest Main St',billing_city:loc.city,billing_state:loc.state,billing_zip:loc.zip,care_type:'Assisted Living',status:'Active',phone:loc.phone,lifetime_revenue:0,outstanding_ar:0,chow_current_account:'',duplicate_of_account:'',note:'',...extra});
function tempStore(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bellhaven-test-'));const store=new Store(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return store;}
function fakeCRM(accounts){return {data:structuredClone(accounts),writes:[],async list(){return structuredClone(this.data)},async get(id){const a=this.data.find(a=>a.account_id===id);if(!a)throw new Error('missing');return structuredClone(a)},async update(id,patch){this.writes.push({method:'PATCH',id,patch});Object.assign(this.data.find(a=>a.account_id===id),patch);return this.get(id)},async create(body){this.writes.push({method:'POST',body});const a=account({...body,account_id:'NEW'+this.data.length,lifetime_revenue:0,outstanding_ar:0});this.data.push(a);return structuredClone(a)}};}
function seed(store,accounts){const p=buildPlan([loc],[parent,...accounts],[],{detail_count:1});store.saveRun({...p,accounts,contacts:[],coverage:{detail_count:1},at:new Date().toISOString(),locations:[loc]});return p.proposals[0];}
function mockWebsite(t){const old=globalThis.fetch;globalThis.fetch=async()=>new Response(html,{status:200});t.after(()=>{globalThis.fetch=old;});}
test('address normalization preserves meaningful differences and maps care labels',()=>{
  assert.equal(street('1250 Northwest Franklin Street'),street('1250 NW Franklin St'));
  assert.notEqual(street('12 Main St Suite 1'),street('12 Main St Suite 2'));
  assert.deepEqual(care(['Memory Support','Assisted Living']),['Assisted Living','Memory Care']);
  assert.deepEqual(care('Short-Term Rehabilitation & Nursing'),['Skilled Nursing']);
});
test('names and locality alone cannot merge different facilities',()=>{
  assert.equal(evidence(loc,account({billing_state:'CO'})).confident,false);
  const plan=buildPlan([loc],[parent,account({billing_street:'100 Other Rd',phone:'different',name:'Similar Senior Living'})]);
  assert.equal(plan.proposals[0].kind,'create');
});
test('CHOW AND condition covers all four financial combinations',()=>{
  for(const [rev,ar,chow] of [[0,0,false],[100,0,false],[0,100,false],[100,100,true]]) {
    const a=account({parent_id:'OTHER',lifetime_revenue:rev,outstanding_ar:ar});
    assert.equal(protectedBilling(a),chow);
    assert.equal(buildPlan([loc],[parent,a]).proposals[0].kind,chow?'chow':'update');
  }
});
test('same address ambiguous candidates are all preserved, unique corroboration selects duplicate survivor',()=>{
  let p=buildPlan([loc],[parent,account({phone:'1'}),account({account_id:'B',phone:'2'})]);
  assert.equal(p.proposals[0].kind,'ambiguous');assert.equal(p.proposals[0].review_accounts.length,2);
  p=buildPlan([loc],[parent,account(),account({account_id:'B',phone:'2'})]);
  assert.equal(p.proposals[0].kind,'duplicate');assert.equal(p.proposals[0].patch.duplicate_of_account,'A');
});
test('PO box address can be corrected with exact name/location and phone corroboration',()=>{
  const p=buildPlan([loc],[parent,account({billing_street:'PO Box 123'})]);
  assert.equal(p.proposals[0].patch.billing_street,loc.street);
});
test('absence preserves parent, revenue and AR',()=>{
  const p=buildPlan([], [parent,account({lifetime_revenue:100,outstanding_ar:50})],[],{detail_count:35});
  assert.deepEqual(Object.keys(p.proposals[0].patch).sort(),['note','status']);
  assert.equal(p.proposals[0].patch.status,'Needs Review');
});
test('crawl follows homepage-only detail and pagination; incomplete listings fail closed',async()=>{
  const pages={
    [BASE+'/']:'<a href="/communities/extra">Extra</a>',
    [BASE+'/about']:'About',
    [BASE+'/communities']:'1 communities listed<a href="/communities/test">Test</a><a href="/communities?page=1">Previous</a>',
    [BASE+'/communities/test']:html,
    [BASE+'/communities/extra']:html.replace('Bellhaven Test','Extra')
  };
  const s=await scrape(async u=>pages[u]);assert.equal(s.locations.length,2);assert.equal(s.coverage.directory_pages,1);
  pages[BASE+'/communities']='2 communities listed<a href="/communities/test">Test</a>';
  await assert.rejects(scrape(async u=>pages[u]),/Incomplete directory/);
});
test('CRM pagination returns all pages and rejects duplicate account IDs',async t=>{
  const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);let calls=0;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[{account_id:'A'+(++calls)}],total:2}));
  assert.equal((await new CRM('test').list()).length,2);
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[{account_id:'A'}],total:2}));
  await assert.rejects(new CRM('test').list(),/duplicate CRM pagination/);
});
test('reject performs zero writes and identical daily scan never re-proposes it',async t=>{
  const store=tempStore(t),a=account({name:'Old name'}),p=seed(store,[a]),crm=fakeCRM([a]);
  await decide(store,crm,p.id,'reject','Keep for investigation');assert.equal(crm.writes.length,0);
  seed(store,[a]);assert.equal(store.row(p.id).status,'rejected');assert.equal(store.get('latest').new_proposals,0);
});
test('approve update reads back, second approval is no-op, approved state disappears from next plan',async t=>{
  mockWebsite(t);const store=tempStore(t),a=account({name:'Old name'}),p=seed(store,[a]),crm=fakeCRM([a]);
  await decide(store,crm,p.id,'approve');await decide(store,crm,p.id,'approve');
  assert.equal(crm.writes.length,1);assert.equal(store.row(p.id).status,'approved');
  assert.equal(buildPlan([loc],[parent,...crm.data]).proposals.length,0);
});
test('CHOW preserves every original business field except pointer and resumes after PATCH failure without another POST',async t=>{
  mockWebsite(t);const store=tempStore(t),a=account({parent_id:'OLD',name:loc.name,lifetime_revenue:1000,outstanding_ar:100});
  const p=seed(store,[a]),crm=fakeCRM([a]),update=crm.update;
  crm.update=async function(){throw new Error('simulated network failure')};
  await assert.rejects(decide(store,crm,p.id,'approve'),/simulated/);
  assert.equal(crm.writes.filter(w=>w.method==='POST').length,1);
  crm.update=update;await decide(store,crm,p.id,'approve');
  assert.equal(crm.writes.filter(w=>w.method==='POST').length,1);
  const result=await crm.get('A'),pointer=result.chow_current_account;delete result.chow_current_account;
  const expected={...a};delete expected.chow_current_account;assert.deepEqual(result,expected);assert.ok(pointer);
});
test('unknown POST failure blocks blind retry when no marker exists',async t=>{
  mockWebsite(t);const store=tempStore(t),p=seed(store,[]),crm=fakeCRM([]);let posts=0;
  crm.create=async()=>{posts++;throw new Error('timeout')};
  await assert.rejects(decide(store,crm,p.id,'approve'),/timeout/);
  await assert.rejects(decide(store,crm,p.id,'approve'),/uncertain outcome/);assert.equal(posts,1);
});
test('stale CRM prevents writes',async t=>{
  mockWebsite(t);const store=tempStore(t),a=account({name:'Old name'}),p=seed(store,[a]),crm=fakeCRM([{...a,outstanding_ar:100}]);
  await assert.rejects(decide(store,crm,p.id,'approve'),/changed since review/);assert.equal(crm.writes.length,0);
});
