export function dateKey(value){if(!value)return '';const d=new Date(String(value).replace(' ','T'));if(!Number.isFinite(d.getTime()))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
export function proposalTime(p,field='created'){if(field==='scan')return p.observed_at||p.created_at;if(field==='crm'){const dates=[p.before?.updated_at,...(p.candidates||[]).map(c=>c.account.updated_at)].filter(Boolean);return dates.sort().at(-1)||'';}return p.created_at;}
export function affiliation(p,bellhavenId){const parents=p.current_parents||[];if(!parents.length)return 'new';if(parents.every(x=>x.id==='__none__'))return 'none';if(parents.every(x=>x.id===bellhavenId))return 'bellhaven';if(parents.some(x=>x.id===bellhavenId))return 'mixed';return 'other';}
export function filterProposals(proposals,f={}){
 const filtered=proposals.filter(p=>{
  if(f.status==='pending'&&!['pending','failed','applying'].includes(p.status))return false;
  if(f.status&&f.status!=='all'&&f.status!=='pending'&&p.status!==f.status)return false;
  if(f.category&&!(p.categories||[]).includes(f.category))return false;
  if(f.parent&&!p.current_parents?.some(x=>x.id===f.parent))return false;
  if(f.target&&p.target_parent?.id!==f.target)return false;
  if(f.affiliation&&affiliation(p,f.bellhavenId)!==f.affiliation)return false;
  if(f.important&&!p.important)return false;
  const date=dateKey(proposalTime(p,f.timeField));if(f.from&&(!date||date<f.from))return false;if(f.to&&(!date||date>f.to))return false;
  if(f.search){const q=f.search.toLowerCase(),h=[p.title,p.before?.account_id,...(p.categories||[]),...(p.current_parents||[]).map(x=>x.name),...(p.candidates||[]).flatMap(c=>[c.account.name,c.account.account_id,c.account.billing_city])].join(' ').toLowerCase();if(!h.includes(q))return false;}
  return true;
 });
 return filtered.sort((a,b)=>{const important=Number(!!b.important)-Number(!!a.important);if(important)return important;if((f.sort||'priority')==='priority'&&(a.priority??99)!==(b.priority??99))return (a.priority??99)-(b.priority??99);const ta=Date.parse(String(proposalTime(a,f.timeField)||'').replace(' ','T'))||0,tb=Date.parse(String(proposalTime(b,f.timeField)||'').replace(' ','T'))||0;return (f.sort==='oldest'?ta-tb:tb-ta)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id);});
}
