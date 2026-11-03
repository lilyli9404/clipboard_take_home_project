import { createHash } from 'node:crypto';
export const BASE = 'https://analyst-assessment-production.up.railway.app';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function text(html='') {
  return html.replace(/<[^>]*>/g,' ').replace(/&#x([a-f\d]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&(amp|nbsp|quot|apos|lt|gt|ndash|mdash);/g,(_,n)=>({amp:'&',nbsp:' ',quot:'"',apos:"'",lt:'<',gt:'>',ndash:'–',mdash:'—'}[n])).replace(/\s+/g,' ').trim();
}
export async function request(url, options={}) {
  const response = await fetch(url,{...options,signal:AbortSignal.timeout(25000)});
  if(!response.ok) throw new Error(`HTTP ${response.status} ${new URL(url).pathname}`);
  return response;
}
export function links(html,url) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(m=>{const u=new URL(m[1].replaceAll('&amp;','&'),url);if(u.pathname==='/communities'&&u.searchParams.get('page')==='1')u.search='';return u.href;}).filter(u=>new URL(u).origin===BASE);
}
export function parseLocation(html,url) {
  const fields={};
  for(const m of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) fields[text(m[1])]=m[2];
  const parts=(fields.Address||'').split(/<br\s*\/?>/i).map(text);
  const locality=parts.slice(1).join(' ').match(/^(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  const name=text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const care=[...(fields['Care Offerings']||'').matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map(m=>text(m[1]));
  if(!name||!parts[0]||!locality||!care.length) throw new Error(`Incomplete community detail: ${url}`);
  const notices=[...html.matchAll(/<div\b[^>]*class=["'][^"']*notice[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].map(m=>text(m[1]));
  return {source_url:url,name,street:parts[0],city:locality[1],state:locality[2],zip:locality[3],care_offerings:care,phone:text(fields.Phone),administrator:text(fields.Administrator),notices,source_text:text(html.slice(html.indexOf('<body>'))),source_hash:hash(html)};
}
export async function scrape(get=async url=>(await request(url)).text()) {
  const queue=[BASE+'/',BASE+'/communities',BASE+'/about'];
  const seen=new Set(), detailURLs=new Set(), directoryURLs=new Set(), snapshots=[];
  let expected=null;
  while(queue.length) {
    const url=queue.shift(); if(seen.has(url))continue; seen.add(url);
    if(seen.size>100)throw new Error('Unexpected crawl size; stop for review');
    const html=await get(url); snapshots.push({url,html});
    if(new URL(url).pathname==='/communities') {
      directoryURLs.add(url);
      const count=html.match(/(\d+) communities listed/);
      if(count) {if(expected!==null&&expected!==+count[1])throw new Error('Directory count changed during crawl');expected=+count[1];}
    }
    if(/^\/communities\/[^/]+$/.test(new URL(url).pathname)) detailURLs.add(url);
    for(const link of links(html,url)) {
      if(/^\/communities(?:\/[^/]+)?$/.test(new URL(link).pathname)&&!seen.has(link)&&!queue.includes(link))queue.push(link);
    }
  }
  const directoryDetails=new Set();
  for(const s of snapshots.filter(s=>directoryURLs.has(s.url)))for(const u of links(s.html,s.url))if(/^\/communities\//.test(new URL(u).pathname))directoryDetails.add(u);
  if(expected===null||directoryDetails.size!==expected) throw new Error(`Incomplete directory: expected ${expected}, got ${directoryDetails.size}`);
  const locations=snapshots.filter(s=>detailURLs.has(s.url)).map(s=>parseLocation(s.html,s.url));
  if(!locations.length)throw new Error('No locations; refusing to generate absence proposals');
  return {locations,snapshots,coverage:{directory_expected:expected,directory_found:directoryDetails.size,detail_count:locations.length,directory_pages:directoryURLs.size,extra_locations:locations.filter(l=>!directoryDetails.has(l.source_url)).map(l=>l.source_url)},fetched_at:new Date().toISOString()};
}
export class CRM {
  constructor(token,base=BASE) { if(!token)throw new Error('Set CRM_TOKEN or enter the token in the local app.');this.token=token;this.base=base; }
  async call(path,method='GET',body) {
    return (await request(this.base+'/api/v1'+path,{method,headers:{Authorization:'Bearer '+this.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})).json();
  }
  async list(resource='accounts') {
    const all=[]; let expected=null;
    for(let page=1;page<=100;page++) {
      const r=await this.call(`/${resource}?page=${page}&page_size=50`);
      if(!Array.isArray(r.data)||!Number.isInteger(r.total))throw new Error('Unexpected CRM list response');
      expected ??= r.total; if(expected!==r.total)throw new Error('CRM changed during pagination; rerun');
      all.push(...r.data);
      if(all.length>=expected) {if(all.length!==expected||new Set(all.map(a=>a[resource==='contacts'?'contact_id':'account_id'])).size!==expected)throw new Error('Incomplete/duplicate CRM pagination');return all;}
      if(!r.data.length)throw new Error('CRM pagination ended early');
    }
    throw new Error('CRM pagination limit');
  }
  async get(id){const r=await this.call('/accounts/'+encodeURIComponent(id));return r.data??r;}
  async create(body){const r=await this.call('/accounts','POST',body);return r.data??r;}
  async update(id,body){const r=await this.call('/accounts/'+encodeURIComponent(id),'PATCH',body);return r.data??r;}
}
