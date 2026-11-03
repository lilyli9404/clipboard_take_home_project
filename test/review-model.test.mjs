import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compare,buildReviewPlan,prepareDecision,executionPreview,distanceKey,blank} from '../lib/review-model.mjs';
import {straightMiles,geocode} from '../lib/distance.mjs';
import {filterProposals,dateKey,affiliation} from '../public/review-filters.mjs';
import {Store} from '../lib/store.mjs';
import {decide} from '../lib/service.mjs';
import {parseLocation,BASE} from '../lib/source.mjs';
const html='<h1>Bellhaven Test</h1><dl><dt>Address</dt><dd>12 Main Street<br>Testville, OH 01234</dd><dt>Care Offerings</dt><dd><span>Assisted Living</span></dd><dt>Phone</dt><dd>555-111-2222</dd></dl>';
const l=parseLocation(html,BASE+'/communities/test');
const parent={account_id:'P',name:'Bellhaven Senior Living (Parent Account)',parent_id:''};
const a={account_id:'A',name:l.name,parent_id:'P',parent_name:parent.name,billing_street:l.street,billing_city:l.city,billing_state:l.state,billing_zip:l.zip,care_type:'Assisted Living',phone:l.phone,status:'Active',lifetime_revenue:0,outstanding_ar:0,chow_current_account:'',duplicate_of_account:'',note:''};
const cats=(change,source=l,distances={})=>compare(source,{...a,...change},parent,[],distances).categories;
test('categories 1/2/6/7 distinguish equivalent, changed and missing values',()=>{
 assert.deepEqual(cats({billing_street:'12 Main St',billing_zip:'1234'}),['format']);
 assert.deepEqual(cats({phone:'555-999-9999'}),['service_phone']);
 assert.deepEqual(cats({phone:''}),['fill_missing']);
 assert.deepEqual(cats({}, {...l,phone:''}),['verify_existing']);
 assert.equal(compare({...l,phone:''},a,parent).patch.phone,undefined);
 assert.equal(blank(0),false);assert.equal(blank(false),false);
});
test('one candidate can carry name, phone and missing-field labels simultaneously',()=>{
 const c=cats({name:'Former Facility',phone:'555-222-3333',care_type:''});
 for(const k of ['rename','service_phone','fill_missing'])assert.ok(c.includes(k));
});
test('ZIP-only and same-city street-plus-ZIP remain separate review labels',()=>{
 assert.deepEqual(cats({billing_zip:'99999'}),['zip']);
 const c=cats({billing_street:'99 Other Rd',billing_zip:'99999'});assert.ok(c.includes('move_city'));assert.ok(c.includes('zip'));
});
test('20-mile boundary, remote move, interstate conflict and unknown distance',()=>{
 const other={...a,billing_street:'99 Other Rd',billing_city:'Elsewhere'};
 const key=distanceKey(l,other);
 assert.ok(cats(other,l,{[key]:{reliable:true,miles:20}}).includes('move_near'));
 assert.ok(cats(other,l,{[key]:{reliable:true,miles:20.01}}).includes('move_far'));
 assert.ok(cats(other).includes('distance_unknown'));
 assert.ok(cats({billing_state:'CO'}).includes('move_far'));
 const p=buildReviewPlan([l],[parent,{...a,billing_state:'CO'}]).proposals[0];
 assert.equal(p.kind,'review');assert.throws(()=>prepareDecision(p),/Confirm/);
});
test('all duplicate candidates share one record; survivor and duplicates are explicit choices',()=>{
 const p=buildReviewPlan([l],[parent,a,{...a,account_id:'B',parent_id:'OTHER'}]).proposals[0];
 assert.equal(p.kind,'group');assert.equal(p.candidates.length,2);assert.ok(p.categories.includes('duplicates'));
 assert.throws(()=>prepareDecision(p),/Select/);
 assert.throws(()=>prepareDecision(p,{primary_id:'A'}),/Confirm/);
 const s={primary_id:'A',identity_confirmed:true,fields:[],duplicate_ids:['B']};
 assert.equal(executionPreview(p,s).operations.length,1);
 assert.deepEqual(prepareDecision(p,{...s,duplicate_ids:[]}).duplicate_accounts,[]);
 assert.throws(()=>prepareDecision(p,{...s,duplicate_ids:['OUTSIDE']}),/Invalid/);
 assert.throws(()=>prepareDecision(p,{...s,fields:['lifetime_revenue']}),/fields/);
});
test('missing whole account creates; website absence is important without destructive assumptions',()=>{
 assert.equal(buildReviewPlan([l],[parent]).proposals[0].kind,'create');
 const p=buildReviewPlan([],[parent,a]).proposals[0];assert.equal(p.important,true);assert.equal(p.priority,0);
 assert.deepEqual(Object.keys(p.patch).sort(),['note','status']);
});
test('filters inspect all parents in a group, preserve multi-label matching and prioritize red items',()=>{
 const base={status:'pending',created_at:'2026-11-03T02:00:00Z',categories:['rename','zip'],current_parents:[{id:'P',name:'Bellhaven'},{id:'Q',name:'Other'}],target_parent:{id:'P'}};
 const p={...base,id:'a',title:'Mixed',important:true,priority:0},q={...base,id:'b',title:'Normal',important:false,created_at:'2026-11-04T02:00:00Z'};
 assert.equal(affiliation(p,'P'),'mixed');
 assert.equal(filterProposals([p],{parent:'Q',category:'zip',affiliation:'mixed',bellhavenId:'P'}).length,1);
 assert.equal(filterProposals([p],{parent:'Z'}).length,0);
 assert.equal(filterProposals([q,p],{sort:'newest'})[0].id,'a');
 assert.equal(dateKey('2026-11-03T02:00:00Z'),'2026-11-02');
 assert.equal(filterProposals([p,q],{from:'2026-11-02',to:'2026-11-02'}).length,1);
});
test('distance calculation is geometric and failed geocoding cannot imply nearby',async()=>{
 assert.equal(straightMiles({lat:0,lon:0},{lat:0,lon:0}),0);
 assert.ok(Math.abs(straightMiles({lat:0,lon:0},{lat:0,lon:1})-69.09)<.1);
 const r=await geocode({street:'12 Main St'},async()=>new Response(JSON.stringify({result:{addressMatches:[]}})));
 assert.equal(r.reliable,false);assert.equal(r.lat,undefined);
});
function storeFor(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-v2-')),store=new Store(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return store;}
function save(store,accounts,options={}){const plan=buildReviewPlan([l],[parent,...accounts],[],{detail_count:1},options);store.saveRun({...plan,at:new Date().toISOString(),accounts,contacts:[],coverage:{detail_count:1},locations:[l]});return plan;}
test('v2 rejection writes nothing, repeat scan preserves decision, other scopes remain pending',async t=>{
 const store=storeFor(t),p=save(store,[{...a,phone:'old'}]).proposals[0];
 await decide(store,{update(){assert.fail('no CRM writes allowed')}},p.id,'reject');
 save(store,[{...a,phone:'old'}]);assert.equal(store.row(p.id).status,'rejected');assert.equal(store.get('latest').new_proposals,0);
 const other=save(store,[{...a,account_id:'Q',name:'Other (Parent Account)',parent_id:''}],{parent_id:'Q'}).proposals[0];
 save(store,[a]);assert.equal(store.row(other.id).status,'pending');
});
test('v2 grouped CHOW preserves old fields and modifies only selected duplicate',async t=>{
 const store=storeFor(t),oldFetch=globalThis.fetch;t.after(()=>globalThis.fetch=oldFetch);globalThis.fetch=async()=>new Response(html);
 const old={...a,parent_id:'OLD',lifetime_revenue:100,outstanding_ar:10},dup={...a,account_id:'B'},untouched={...a,account_id:'C',billing_street:'88 Elsewhere',billing_city:'Different',phone:'other'};
 const p=save(store,[old,dup,untouched]).proposals[0];
 const crm={data:structuredClone([old,dup,untouched]),writes:[],async get(id){return structuredClone(this.data.find(x=>x.account_id===id))},async list(){return structuredClone(this.data)},async update(id,patch){this.writes.push(id);Object.assign(this.data.find(x=>x.account_id===id),patch);return this.get(id)},async create(body){const n={...a,...body,account_id:'NEW'};this.data.push(n);this.writes.push('NEW');return n}};
 await decide(store,crm,p.id,'approve','test',{primary_id:'A',identity_confirmed:true,fields:['parent_id'],duplicate_ids:['B']});
 assert.deepEqual(await crm.get('A'),{...old,chow_current_account:'NEW'});
 assert.equal((await crm.get('B')).duplicate_of_account,'NEW');assert.deepEqual(await crm.get('C'),untouched);
 assert.deepEqual(crm.writes,['NEW','A','B']);
 await decide(store,crm,p.id,'approve');assert.equal(crm.writes.length,3);
});
