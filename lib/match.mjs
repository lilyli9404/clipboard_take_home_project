import { hash } from './source.mjs';
export const norm = s => String(s??'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export function street(s) {
  const aliases={street:'st',road:'rd',avenue:'ave',boulevard:'blvd',drive:'dr',lane:'ln',court:'ct',place:'pl',parkway:'pkwy',pike:'pk',north:'n',south:'s',east:'e',west:'w',northwest:'nw',northeast:'ne',southwest:'sw',southeast:'se'};
  return norm(s).split(' ').map(w=>aliases[w]||w).join(' ');
}
const phone=s=>String(s||'').replace(/\D/g,'').slice(-10);
export function care(value) {
  const values=Array.isArray(value)?value:String(value||'').split(/;|,|\|/);
  return [...new Set(values.map(v=>norm(v)).filter(Boolean).map(v=>({'memory support':'Memory Care','memory care':'Memory Care','short term rehabilitation and nursing':'Skilled Nursing','skilled nursing':'Skilled Nursing','assisted living':'Assisted Living','independent living':'Independent Living'}[v]||v)))].sort();
}
export const protectedBilling=a=>Number(a.lifetime_revenue)>0&&Number(a.outstanding_ar)>0;
export function evidence(l,a,contacts=[]) {
  const e={same_state:norm(l.state)===norm(a.billing_state),same_city:norm(l.city)===norm(a.billing_city),same_street:street(l.street)===street(a.billing_street),same_zip:l.zip.slice(0,5)===String(a.billing_zip).slice(0,5),same_name:norm(l.name)===norm(a.name),same_phone:!!phone(l.phone)&&phone(l.phone)===phone(a.phone),same_administrator:contacts.some(c=>c.account_id===a.account_id&&c.is_active&&norm(c.name)===norm(l.administrator))};
  e.confident=e.same_state&&e.same_city&&(e.same_street||(e.same_name&&(e.same_phone||e.same_administrator)));
  e.possible=e.same_state&&e.same_city&&(e.same_name||e.same_phone||e.same_administrator);
  e.score=+e.same_street*50 + +e.same_name*15 + +e.same_city*10 + +e.same_state*5 + +e.same_zip*5 + +e.same_phone*10 + +e.same_administrator*15;
  return e;
}
function desired(l,parent) {return {name:l.name,parent_id:parent,billing_street:l.street,billing_city:l.city,billing_state:l.state,billing_zip:l.zip,care_type:care(l.care_offerings).join('; ')};}
function delta(a,d) {
  return Object.fromEntries(Object.entries(d).filter(([k,v])=>{
    if(k==='billing_street')return street(a[k])!==street(v);
    if(k==='care_type')return JSON.stringify(care(a[k]))!==JSON.stringify(care(v));
    return String(a[k]??'')!==String(v);
  }));
}
export function buildPlan(locations,accounts,contacts=[],coverage={}) {
  const parents=accounts.filter(a=>norm(a.name)==='bellhaven senior living parent account'&&!a.parent_id);
  if(parents.length!==1)throw new Error('Cannot uniquely identify Bellhaven parent');
  const parent=parents[0], proposals=[],matches=[],used=new Set();
  function add(kind,l,a,patch,reason,candidates=[],extra={}) {
    const identity={kind,source:l?.source_url||null,account:a?.account_id||null,patch,review_accounts:extra.review_accounts?.map(a=>a.account_id).sort(),survivor:extra.survivor?.account_id};
    proposals.push({id:hash(identity),kind,title:l?.name||a.name,source:l||null,before:a||null,patch,reason,candidates,...extra});
  }
  for(const l of locations) {
    const candidates=accounts.filter(a=>a.account_id!==parent.account_id&&!a.chow_current_account&&!a.duplicate_of_account).map(a=>({account:a,evidence:evidence(l,a,contacts)})).filter(c=>c.evidence.confident||c.evidence.possible).sort((a,b)=>b.evidence.score-a.evidence.score||a.account.account_id.localeCompare(b.account.account_id));
    const high=candidates.filter(c=>c.evidence.confident);
    if(!high.length) {
      if(candidates.length) {
        for(const c of candidates)used.add(c.account.account_id);
        const reason='Identity is uncertain: name/locality agree but street or independent identity evidence does not. Do not re-parent or create a possible duplicate without investigation.';
        add('ambiguous',l,candidates[0].account,{status:'Needs Review',note:reason},reason,candidates,{review_accounts:candidates.map(c=>c.account)});
        matches.push({location:l,classification:'Ambiguous',candidates});
      } else {
        const excluded=accounts.filter(a=>norm(a.name)===norm(l.name)).map(a=>({account:a,evidence:evidence(l,a,contacts)}));
        add('create',l,null,{...desired(l,parent.account_id),status:'Active',phone:l.phone},'No defensible match across the complete CRM. Similar names at different addresses/locations are not identity evidence.',excluded);
        matches.push({location:l,classification:'Missing CRM account',candidates:excluded});
      }
      continue;
    }
    let chosen=high[0];
    if(high.length>1) {
      const corroborated=high.filter(c=>c.evidence.same_phone||c.evidence.same_administrator);
      if(corroborated.length!==1) {
        high.forEach(c=>used.add(c.account.account_id));
        const reason='Multiple same-address candidates; no unique website phone or active administrator match identifies a survivor. Preserve all records and flag Needs Review instead of guessing a duplicate winner.';
        add('ambiguous',l,chosen.account,{status:'Needs Review',note:reason},reason,high,{review_accounts:high.map(c=>c.account)});
        matches.push({location:l,classification:'Ambiguous',candidates:high});continue;
      }
      chosen=corroborated[0];
      for(const c of high.filter(c=>c!==chosen)) {
        used.add(c.account.account_id);
        const duplicate=norm(c.account.name)===norm(chosen.account.name)&&c.evidence.same_street&&c.evidence.same_city&&c.evidence.same_state;
        if(duplicate&&!protectedBilling(c.account)) {
          add('duplicate',l,c.account,{status:'Inactive',duplicate_of_account:chosen.account.account_id,note:`Duplicate of ${chosen.account.account_id}; identical name and normalized address. Survivor matches website phone/administrator. No records deleted or contacts moved.`},'Same name/address plus a uniquely corroborated survivor. Preserve the losing record with an explicit duplicate link.',high,{survivor:chosen.account});
        } else {
          add('ambiguous',l,c.account,{status:'Needs Review',note:'Possible duplicate. Preserve billing history and investigate identity before inactivating.'},'Potential duplicate requires additional review.',high,{review_accounts:[c.account]});
        }
      }
    }
    const a=chosen.account;used.add(a.account_id);
    const patch=delta(a,desired(l,parent.account_id));
    if(a.status==='Inactive')patch.status='Active';
    if(Object.keys(patch).length) {
      if(patch.parent_id&&protectedBilling(a)) {
        add('chow',l,a,{...desired(l,parent.account_id),status:'Active',phone:l.phone},'Parent changes AND lifetime revenue > 0 AND outstanding AR > 0. Create a new current account; preserve ALL old fields except chow_current_account.',candidates);
      } else {
        add('update',l,a,patch,patch.parent_id?'Matched facility belongs under Bellhaven. Direct re-parent is allowed because revenue history or outstanding AR is zero.':'Match is supported by identity evidence; correct only substantive differences and the official name.',candidates);
      }
      matches.push({location:l,classification:'Needs correction',account_id:a.account_id,candidates});
    } else matches.push({location:l,classification:'Confident match',account_id:a.account_id,candidates});
  }
  for(const a of accounts.filter(a=>a.parent_id===parent.account_id&&!used.has(a.account_id)&&!a.chow_current_account&&!a.duplicate_of_account)) {
    const reason=`Not found in the complete website crawl (${coverage.detail_count??locations.length} communities). Absence alone does not prove closure or new ownership. Preserve parent and financial history; investigate before any ownership change.`;
    if(a.status!=='Needs Review'||a.note!==reason)add('not_listed',null,a,{status:'Needs Review',note:reason},reason);
  }
  return {parent,proposals,matches};
}
