import fs from 'node:fs';
import path from 'node:path';
import { scrape, parseLocation, request, hash } from './source.mjs';
import { buildPlan, protectedBilling, evidence } from './match.mjs';
import { buildReviewPlan,prepareDecision,CATEGORIES,executionPreview,signals } from './review-model.mjs';
import { measureDistance } from './distance.mjs';
const business=a=>Object.fromEntries(Object.entries(a).filter(([k])=>!['updated_at','parent_name','created_by_candidate'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const matches=(a,patch)=>Object.entries(patch).every(([k,v])=>String(a[k]??'')===String(v));
const sourceIdentity=l=>({name:l.name,street:l.street,city:l.city,state:l.state,zip:l.zip,care:l.care_offerings,phone:l.phone,administrator:l.administrator});
export async function scan(store,crm) {
  return store.locked(async()=>{
    if(crm.token) {
      const fingerprint=hash(crm.token),existing=store.get('token_fingerprint');
      if(existing&&existing!==fingerprint)throw new Error('CRM token differs from the owner of this data folder. Use a separate DATA_DIR.');
      store.set('token_fingerprint',fingerprint);
    }
    const website=await scrape();
    const accounts=await crm.list(),contacts=await crm.list('contacts');
    let plan=buildReviewPlan(website.locations,accounts,contacts,website.coverage,{distances:store.get('distances')||{}});
    const need=plan.proposals.flatMap(p=>p.candidates.filter(c=>c.categories.includes('distance_unknown')).map(c=>({l:p.source,a:c.account})));
    for(const pair of need.slice(0,10))await measureDistance(store,pair.l,pair.a);
    if(need.length)plan=buildReviewPlan(website.locations,accounts,contacts,website.coverage,{distances:store.get('distances')||{}});
    const at=new Date().toISOString();
    const run={...plan,accounts,contacts,locations:website.locations,coverage:website.coverage,at};
    const stamp=at.replaceAll(':','-');
    fs.mkdirSync(path.join(store.dir,'snapshots'),{recursive:true});
    fs.writeFileSync(path.join(store.dir,'snapshots',stamp+'.json'),JSON.stringify({website,accounts,contacts},null,2));
    store.saveRun(run);store.audit(null,'scan',{coverage:run.coverage,new_proposals:run.new_proposals});
    return run;
  });
}
export async function decide(store,crm,id,decision,note='',selection={}) {
  if(!['approve','reject'].includes(decision))throw new Error('Invalid decision');
  return store.locked(async()=>{
    let p=store.row(id);if(!p)throw new Error('Proposal not found');
    if(['approved','rejected'].includes(p.status))return p;
    if(!['pending','failed','applying'].includes(p.status))throw new Error('Proposal is no longer current. Run a scan.');
    if(decision==='reject') {
      if(Object.keys(p.progress).length)throw new Error('A write may already have started; reconcile or resume this proposal instead of rejecting it.');
      store.status(id,'rejected',note);store.audit(id,'rejected',{note});return store.row(id);
    }
    store.audit(id,'approval_requested',{note});
    const progress=p.progress;
    const saveProgress=()=>store.progress(id,progress);
    try {
      if(progress.selection)selection=progress.selection;
      p=prepareDecision(p,selection);
      const latest=(store.get('runs_by_scope')||{})[p.scope]||store.get('latest'); if(!latest)throw new Error('Run the pipeline first');
      if(p.source) {
        const html=await (await request(p.source.source_url)).text();
        const fresh=parseLocation(html,p.source.source_url);
        if(!same(sourceIdentity(fresh),sourceIdentity(p.source)))throw new Error('Website evidence changed. Rescan and review the new proposal.');
      } else {
        const fresh=await scrape();
        if(fresh.locations.some(l=>signals(l,p.before,latest.contacts).possible))throw new Error('Account is now listed on website or has a plausible candidate. Rescan.');
      }
      const beforeAccounts=[...(p.review_accounts|| (p.before?[p.before]:[])),...(p.duplicate_accounts||[])];
      for(const old of beforeAccounts) {
        const now=await crm.get(old.account_id);
        const isDuplicate=(p.duplicate_accounts||[]).some(a=>a.account_id===old.account_id);
        const desired=isDuplicate?{status:'Inactive',duplicate_of_account:progress.created_id||p.before.account_id}:p.kind==='chow'&&progress.created_id?{chow_current_account:progress.created_id}:p.patch;
        if(progress['patch_'+old.account_id]&&matches(now,desired))continue;
        if(p.kind==='chow'&&progress.created_id&&now.chow_current_account===progress.created_id)continue;
        if(!same(business(old),business(now)))throw new Error(`CRM account ${old.account_id} changed since review. Rescan before writing.`);
        if(p.kind==='update'&&p.patch.parent_id&&protectedBilling(now))throw new Error('Billing safeguard now requires CHOW. Rescan.');
      }
      // The only write path is reached after an explicit approval and fresh validation.
      if(p.version===2&&!progress.selection){progress.selection=p.selection||selection;saveProgress();}
      store.status(id,'applying',note);
      store.audit(id,'approved_execution_plan',{preview:p.version===2?executionPreview(store.row(id),progress.selection):null});
      const patchOne=async(old,patch)=>{
        const key='patch_'+old.account_id;
        let current=await crm.get(old.account_id);
        if(progress[key]&&matches(current,patch))return current;
        progress[key]='started';saveProgress();
        const result=await crm.update(old.account_id,patch);
        current=await crm.get(old.account_id);
        if(!matches(current,patch))throw new Error('CRM did not persist all requested fields');
        // Verify fields outside the approved patch were not altered.
        const excluded=new Set([...Object.keys(patch),'updated_at',...(Object.hasOwn(patch,'parent_id')?['parent_name']:[])]);
        for(const [key,value] of Object.entries(old))if(!excluded.has(key)&&!same(current[key],value))throw new Error(`Unexpected CRM mutation in ${key}; inspect account before continuing.`);
        progress['patch_'+old.account_id]='done';saveProgress();store.audit(id,'patch_verified',{account_id:old.account_id,patch,after:current});return result;
      };
      if(['create','chow'].includes(p.kind)) {
        const marker=`[bellhaven-review:${id}]`;
        const accounts=await crm.list();
        const previous=accounts.filter(a=>String(a.note||'').includes(marker));
        if(previous.length>1)throw new Error('Multiple records have this operation marker. Manual reconciliation required.');
        if(previous.length) {
          if(!matches(previous[0],p.patch))throw new Error('Previously created account differs from approved payload. Inspect manually.');
          progress.created_id=previous[0].account_id;saveProgress();
        }
        if(!progress.created_id) {
          if(progress.create_started)throw new Error('Prior create has an uncertain outcome; no marker found. Refusing to retry POST automatically. Inspect CRM and audit.');
          const reviewedDuplicates=new Set((p.duplicate_accounts||[]).map(a=>a.account_id));
          const existing=accounts.filter(a=>a.account_id!==p.before?.account_id&&!reviewedDuplicates.has(a.account_id)&&!a.chow_current_account&&!a.duplicate_of_account&&evidence(p.source,a,latest.contacts).confident);
          if(existing.length)throw new Error('Another matching account now exists. Rescan instead of creating a duplicate.');
          progress.create_started=true;saveProgress();
          const created=await crm.create({...p.patch,note:`${marker} Source: ${p.source.source_url}. ${p.reason}`});
          if(!created.account_id)throw new Error('Create response missing account_id; inspect before retrying');
          progress.created_id=created.account_id;saveProgress();
          const verified=await crm.get(created.account_id);
          if(!matches(verified,p.patch))throw new Error('Created account did not retain approved fields');
          store.audit(id,'create_verified',{account_id:created.account_id,after:verified});
        }
        if(p.kind==='chow')await patchOne(p.before,{chow_current_account:progress.created_id});
      } else if(p.kind==='ambiguous') {
        for(const old of p.review_accounts)await patchOne(old,p.patch);
      } else {
        if(p.kind==='duplicate') {
          const survivor=await crm.get(p.survivor.account_id);
          if(survivor.status==='Inactive'||survivor.duplicate_of_account||survivor.chow_current_account)throw new Error('Duplicate survivor is no longer current. Rescan.');
          if(!evidence(p.source,survivor,latest.contacts).confident)throw new Error('Survivor identity changed.');
        }
        if(Object.keys(p.patch).length)await patchOne(p.before,p.patch);
      }
      for(const old of p.duplicate_accounts||[]){
        const survivor=progress.created_id||p.before.account_id;
        await patchOne(old,{status:'Inactive',duplicate_of_account:survivor,note:`Reviewer confirmed duplicate. Survivor: ${survivor}`});
      }
      store.status(id,'approved',note);store.audit(id,'approved',{note,progress});return store.row(id);
    } catch(e) {
      store.status(id,'failed',note,e.message);store.audit(id,'failed',{error:e.message,progress});throw e;
    }
  });
}
export function summary(store) {
  const latest=store.get('latest'),proposals=store.rows();
  const scopes=Object.values(store.get('runs_by_scope')||{});
  const parents=[...new Map((latest?.accounts||[]).filter(a=>!a.parent_id&&/parent account/i.test(a.name)).map(a=>[a.account_id,{id:a.account_id,name:a.name}])).values()];
  return {run:latest?{at:latest.at,coverage:latest.coverage,parent:latest.parent,account_count:latest.accounts.length,matches:latest.matches,new_proposals:latest.new_proposals}:null,scopes:scopes.map(s=>({id:s.parent.account_id,name:s.parent.name,at:s.at})),parents,categories:CATEGORIES,proposals,audit:store.history()};
}
