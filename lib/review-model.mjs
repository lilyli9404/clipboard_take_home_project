import { hash } from './source.mjs';
import { norm,street,care,protectedBilling } from './match.mjs';

export const CATEGORIES=[
 ['format','1. Formatting normalization'],['service_phone','2. Care / phone confirmation'],['rename','3. Possible name change'],
 ['move_city','4. Possible same-city move'],['move_near','5. Possible nearby move (≤20 miles)'],['fill_missing','6. Fill missing CRM fields'],
 ['verify_existing','7. Verify CRM-only information'],['zip','8. ZIP confirmation'],['move_far','9. Remote move / incorrect match'],
 ['duplicates','10. Multiple accounts / duplicates'],['create','11. New facility review'],['not_listed','12. Facility existence review'],
 ['parent','Parent ownership confirmation'],['chow','CHOW billing preservation'],['distance_unknown','Distance unavailable'],['identity','Identity confirmation']
].map(([id,label])=>({id,label}));
const LABELS=Object.fromEntries(CATEGORIES.map(c=>[c.id,c.label]));
export const blank=v=>v===null||v===undefined||(Array.isArray(v)?v.length===0:String(v).trim()==='');
export const zip=v=>String(v??'').trim().replace(/^(\d{4})$/,'0$1').slice(0,5);
export const telephone=v=>String(v||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
const stateNames={ohio:'oh',michigan:'mi',indiana:'in',pennsylvania:'pa',colorado:'co',california:'ca','new york':'ny','new jersey':'nj',texas:'tx',florida:'fl',illinois:'il',wisconsin:'wi',massachusetts:'ma',connecticut:'ct',kentucky:'ky',tennessee:'tn',virginia:'va','west virginia':'wv','north carolina':'nc','south carolina':'sc',georgia:'ga',alabama:'al',alaska:'ak',arizona:'az',arkansas:'ar',delaware:'de',hawaii:'hi',idaho:'id',iowa:'ia',kansas:'ks',louisiana:'la',maine:'me',maryland:'md',minnesota:'mn',mississippi:'ms',missouri:'mo',montana:'mt',nebraska:'ne',nevada:'nv','new hampshire':'nh','new mexico':'nm','north dakota':'nd',oklahoma:'ok',oregon:'or','rhode island':'ri','south dakota':'sd',utah:'ut',vermont:'vt',washington:'wa',wyoming:'wy','district of columbia':'dc'};
export const region=v=>stateNames[norm(v)]||norm(v);
export const nameKey=v=>norm(v).replace(/\bhealth care\b/g,'healthcare').replace(/\bcentre\b/g,'center').replace(/\brehab\b/g,'rehabilitation').replace(/\b(the|at|of)\b/g,' ').replace(/\s+/g,' ').trim();
function editDistance(a,b){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const curr=[i];for(let j=1;j<=b.length;j++)curr[j]=Math.min(curr[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=curr;}return prev[b.length];}
export function similar(a,b,normalize=norm){const x=normalize(a),y=normalize(b);if(!x||!y)return false;if(x===y)return true;return Math.min(x.length,y.length)>=8&&(x.match(/\d+/g)||[]).join('|')===(y.match(/\d+/g)||[]).join('|')&&editDistance(x,y)<=1;}
export function addresses(l,a){return [{street:l.street,city:l.city,state:l.state,zip:l.zip},{street:a.billing_street,city:a.billing_city,state:a.billing_state,zip:a.billing_zip}];}
export const distanceKey=(l,a)=>hash(addresses(l,a));
export function signals(l,a,contacts=[]){
 const e={same_name:similar(l.name,a.name,nameKey),same_street:similar(l.street,a.billing_street,street),same_city:similar(l.city,a.billing_city),same_state:!!region(l.state)&&region(l.state)===region(a.billing_state),same_zip:!!zip(l.zip)&&zip(l.zip)===zip(a.billing_zip),same_phone:!!telephone(l.phone)&&telephone(l.phone)===telephone(a.phone),same_administrator:!!norm(l.administrator)&&contacts.some(c=>c.account_id===a.account_id&&c.is_active&&norm(c.name)===norm(l.administrator))};
 e.confident=e.same_state&&e.same_city&&(e.same_street||(e.same_name&&(e.same_phone||e.same_administrator)));
 // Cross-state/same-name records remain candidates to review, never silent matches.
 e.possible=e.confident||e.same_name||(e.same_state&&e.same_city&&(e.same_phone||e.same_administrator));
 e.score=+e.same_street*50 + +e.same_name*20 + +e.same_city*10 + +e.same_state*5 + +e.same_zip*5 + +e.same_phone*10 + +e.same_administrator*15;
 return e;
}
export function compare(l,a,parent,contacts=[],distances={}){
 const e=signals(l,a,contacts),distance=distances[distanceKey(l,a)]||null,changes=[],categories=new Set();
 const movement=!blank(l.state)&&!blank(a.billing_state)&&!e.same_state?'move_far':e.same_city?'move_city':distance?.reliable?(distance.miles<=20?'move_near':'move_far'):'distance_unknown';
 const desired={name:l.name,billing_street:l.street,billing_city:l.city,billing_state:l.state,billing_zip:l.zip,care_type:blank(l.care_offerings)?'':care(l.care_offerings).join('; '),phone:l.phone};
 const sameKey={name:e.same_name,billing_street:e.same_street,billing_city:e.same_city,billing_state:e.same_state,billing_zip:e.same_zip,care_type:JSON.stringify(care(l.care_offerings))===JSON.stringify(care(a.care_type)),phone:e.same_phone};
 const fieldType={name:'rename',billing_street:movement,billing_city:movement,billing_state:'move_far',billing_zip:'zip',care_type:'service_phone',phone:'service_phone'};
 for(const [field,after] of Object.entries(desired)){
  const before=a[field]??'';if(blank(before)&&blank(after))continue;
  if(String(before)===String(after))continue;
  let category=blank(before)?'fill_missing':blank(after)?'verify_existing':sameKey[field]?'format':fieldType[field];
  categories.add(category);changes.push({field,before,after,category,write:category!=='verify_existing'});
 }
 if(a.parent_id!==parent.account_id){categories.add('parent');changes.push({field:'parent_id',before:a.parent_id||'',after:parent.account_id,category:'parent',write:true});if(protectedBilling(a))categories.add('chow');}
 if(a.status==='Inactive'){categories.add('identity');changes.push({field:'status',before:a.status,after:'Active',category:'identity',write:true});}
 const identity_required=!e.confident||categories.has('move_city')||categories.has('move_near')||categories.has('move_far')||categories.has('distance_unknown')||categories.has('identity');
 if(!e.confident)categories.add('identity');
 return {account:a,evidence:e,changes,categories:[...categories],distance,identity_required,patch:Object.fromEntries(changes.filter(c=>c.write).map(c=>[c.field,c.after]))};
}
export function newAccount(l,parent){return Object.fromEntries(Object.entries({name:l.name,parent_id:parent.account_id,billing_street:l.street,billing_city:l.city,billing_state:l.state,billing_zip:l.zip,care_type:care(l.care_offerings).join('; '),phone:l.phone,status:'Active'}).filter(([,v])=>!blank(v)));}
function priority(categories){const order=['not_listed','chow','duplicates','move_far','distance_unknown','identity','parent','create','move_city','move_near','zip','rename','service_phone','verify_existing','fill_missing','format'];const first=order.findIndex(c=>categories.includes(c));const rank=first<0?99:first;return {priority:rank,important:rank<=5,priority_reason:rank<99?LABELS[order[rank]]:''};}
export function buildReviewPlan(locations,accounts,contacts=[],coverage={},options={}){
 const parent=options.parent_id?accounts.find(a=>a.account_id===options.parent_id):accounts.find(a=>nameKey(a.name)==='bellhaven senior living parent account'&&!a.parent_id);
 if(!parent)throw new Error('Target parent account is not configured');
 const distances=options.distances||{},used=new Set(),proposals=[],matches=[];
 const eligible=accounts.filter(a=>a.account_id!==parent.account_id&&!a.chow_current_account&&!a.duplicate_of_account&&!/\(parent account\)/i.test(a.name));
 const add=(source,candidates,categories,kind,extra={})=>{
  categories=[...new Set(categories)];const before=candidates.length===1?candidates[0].account:null;
  const patch=kind==='create'?newAccount(source,parent):before?candidates[0].patch:{};
  const proposal={version:2,scope:parent.account_id,kind,title:source?.name||extra.before?.name,source,before,patch,candidates,categories,target_parent:{id:parent.account_id,name:parent.name},current_parents:[...new Map(candidates.map(c=>[c.account.parent_id||'__none__',{id:c.account.parent_id||'__none__',name:c.account.parent_name||'No parent assigned'}])).values()],...extra};
  if(!source&&proposal.before)proposal.current_parents=[{id:proposal.before.parent_id||'__none__',name:proposal.before.parent_name||'No parent assigned'}];
  const ids=candidates.map(c=>c.account.account_id).sort();
  proposal.id=hash({version:2,scope:proposal.scope,source:source?.source_url||null,kind,account:proposal.before?.account_id||null,candidates:ids,changes:candidates.map(c=>({id:c.account.account_id,changes:c.changes})),patch:proposal.patch});
  Object.assign(proposal,priority(categories));proposals.push(proposal);return proposal;
 };
 for(const l of locations){
  const candidates=eligible.map(a=>compare(l,a,parent,contacts,distances)).filter(c=>c.evidence.possible).sort((a,b)=>b.evidence.score-a.evidence.score||a.account.account_id.localeCompare(b.account.account_id));
  candidates.forEach(c=>used.add(c.account.account_id));
  if(!candidates.length){add(l,[],['create'],'create');matches.push({location:l,classification:'New facility to review',candidates:[]});continue;}
  const cats=candidates.flatMap(c=>c.categories);
  if(candidates.length>1)cats.push('duplicates');
  if(cats.length){add(l,candidates,cats,candidates.length>1?'group':'review');matches.push({location:l,classification:candidates.length>1?'Multiple candidates to review':'Field differences to review',account_id:candidates.length===1?candidates[0].account.account_id:undefined,candidates});}
  else matches.push({location:l,classification:'Consistent; no changes',account_id:candidates[0].account.account_id,candidates});
 }
 for(const a of eligible.filter(a=>a.parent_id===parent.account_id&&!used.has(a.account_id))){
  const reason=`Complete source crawl (${coverage.detail_count??locations.length} facilities) contains no corresponding facility. Verify existence and ownership; absence is not proof of closure.`;
  if(a.status==='Needs Review'&&a.note===reason)continue;
  add(null,[],['not_listed'],'not_listed',{before:a,patch:{status:'Needs Review',note:reason},reason});
 }
 return {version:2,scope:parent.account_id,parent,proposals,matches};
}
export function prepareDecision(p,selection={}){
 if(p.version!==2)return p;
 if(['create','not_listed'].includes(p.kind))return {...p,selection};
 if(selection.primary_id==='__new__'){
  if(selection.identity_confirmed!==true)throw new Error('Confirm that none of the candidates represents this facility before creating an account.');
  if(selection.duplicate_ids?.length)throw new Error('Creating a new facility cannot also inactivate candidate accounts.');
  return {...p,kind:'create',before:null,patch:newAccount(p.source,{account_id:p.target_parent.id}),selection,identity_required:true};
 }
 const id=selection.primary_id||(p.candidates.length===1?p.candidates[0].account.account_id:null);
 const c=p.candidates.find(c=>c.account.account_id===id);if(!c)throw new Error('Select the corresponding / surviving CRM account first.');
 if((c.identity_required||p.candidates.length>1)&&selection.identity_confirmed!==true)throw new Error('Confirm that the selected account and website facility represent the same entity.');
 const allowed=c.changes.filter(x=>x.write),fields=selection.fields??allowed.map(x=>x.field);
 if(!Array.isArray(fields)||fields.some(f=>!allowed.some(c=>c.field===f)))throw new Error('Selected fields are not part of the displayed proposal.');
 const patch=Object.fromEntries(allowed.filter(c=>fields.includes(c.field)).map(c=>[c.field,c.after]));
 const duplicateIds=[...new Set(selection.duplicate_ids||[])];
 if(duplicateIds.includes(id)||duplicateIds.some(id=>!p.candidates.some(c=>c.account.account_id===id)))throw new Error('Invalid duplicate account selection.');
 const duplicates=p.candidates.filter(c=>duplicateIds.includes(c.account.account_id)).map(c=>c.account);
 const kind=patch.parent_id&&protectedBilling(c.account)?'chow':'update';
 return {...p,kind,before:c.account,patch:kind==='chow'?{...newAccount(p.source,{account_id:p.target_parent.id})}:patch,duplicate_accounts:duplicates,selected_categories:c.categories,selection:{...selection,primary_id:id,fields,duplicate_ids:duplicateIds},reason:kind==='chow'?'Billing SOP: create a new account; only add the CHOW pointer to the old account.':'Execute only the selected field and duplicate operations in the preview.'};
}
export function executionPreview(p,selection){const x=prepareDecision(p,selection),ops=[];
 if(x.kind==='create'||x.kind==='chow')ops.push({action:'CREATE',account:'New account',before:null,after:x.patch});
 if(x.kind==='chow')ops.push({action:'PATCH',account:x.before.account_id,before:{chow_current_account:x.before.chow_current_account},after:{chow_current_account:'New account ID returned after creation'}});
 if(!['create','chow'].includes(x.kind)&&Object.keys(x.patch).length)ops.push({action:'PATCH',account:x.before.account_id,before:Object.fromEntries(Object.keys(x.patch).map(k=>[k,x.before[k]??''])),after:x.patch});
 for(const a of x.duplicate_accounts||[])ops.push({action:'PATCH duplicate',account:a.account_id,before:{status:a.status,duplicate_of_account:a.duplicate_of_account},after:{status:'Inactive',duplicate_of_account:x.kind==='chow'?'New account ID':x.before.account_id,note:`Reviewer confirmed duplicate. Survivor: ${x.kind==='chow'?'new current account':x.before.account_id}`}});
 return {operations:ops,selection:x.selection,decision_only:ops.length===0,chow:x.kind==='chow'};}
