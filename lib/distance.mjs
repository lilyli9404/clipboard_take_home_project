import { hash } from './source.mjs';
import { addresses,distanceKey,region,zip } from './review-model.mjs';
import { norm,street } from './match.mjs';
export function straightMiles(a,b){
 const rad=d=>d*Math.PI/180,dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon);
 const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;
 return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export async function geocode(address,fetcher=fetch){
 const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/address');
 for(const [k,v] of Object.entries({...address,benchmark:'Public_AR_Current',format:'json'}))url.searchParams.set(k,String(v??''));
 try{
  const r=await fetcher(url,{signal:AbortSignal.timeout(6500)});if(!r.ok)throw new Error('Geocoder HTTP '+r.status);
  const body=await r.json(),list=body.result?.addressMatches||[];
  if(list.length!==1)return {reliable:false,reason:list.length?'Multiple geocoding matches':'Address not found'};
  const m=list[0],c=m.addressComponents||{},matchedStreet=String(m.matchedAddress||'').split(',')[0];
  const reliable=street(matchedStreet)===street(address.street)&&norm(c.city)===norm(address.city)&&region(c.state)===region(address.state)&&zip(c.zip)===zip(address.zip)&&Number.isFinite(m.coordinates?.x)&&Number.isFinite(m.coordinates?.y);
  return {reliable,lat:m.coordinates?.y,lon:m.coordinates?.x,matched_address:m.matchedAddress,reason:reliable?'Census street-range coordinate estimate':'Geocoding result differs from the full input address'};
 }catch(e){return {reliable:false,reason:'Geocoding service unavailable: '+e.message};}
}
export async function measureDistance(store,l,a){
 const key=distanceKey(l,a),cache=store.get('distances')||{};
 if(cache[key]&&Date.now()-Date.parse(cache[key].at)<86400000)return cache[key];
 const pair=addresses(l,a),points=await Promise.all(pair.map(x=>geocode(x)));
 const reliable=points.every(p=>p.reliable),result={reliable,miles:reliable?straightMiles(...points):null,points,addresses:pair,provider:'US Census Geocoder',method:'Haversine; interpolated street coordinates',at:new Date().toISOString()};
 const latest=store.get('distances')||{};latest[key]=result;store.set('distances',latest);return result;
}
