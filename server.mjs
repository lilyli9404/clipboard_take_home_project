import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { CRM,hash } from './lib/source.mjs';
import { Store } from './lib/store.mjs';
import { scan,decide,summary } from './lib/service.mjs';
import { executionPreview } from './lib/review-model.mjs';
const root=import.meta.dirname,port=Number(process.env.PORT||8765);
const store=new Store(process.env.DATA_DIR||path.join(root,'data'));
const csrf=randomBytes(24).toString('hex');let crm=null;
function connect(token) {
  const fingerprint=hash(token),existing=store.get('token_fingerprint');
  if(existing&&existing!==fingerprint)throw new Error('This data folder belongs to a different CRM token. Start with a separate DATA_DIR.');
  crm=new CRM(token);store.set('token_fingerprint',fingerprint);
}
if(process.env.CRM_TOKEN)connect(process.env.CRM_TOKEN);
async function body(req) {let s='';for await(const chunk of req){s+=chunk;if(s.length>20000)throw new Error('Request too large');}return JSON.parse(s||'{}');}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try {
    if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host))return send(403,{error:'Localhost only'});
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(req.method==='POST') {
      if(req.headers['x-review-csrf']!==csrf)return send(403,{error:'Invalid local session'});
      if(req.headers.origin&&!['http://localhost:'+port,'http://127.0.0.1:'+port].includes(req.headers.origin))return send(403,{error:'Cross-origin request blocked'});
    }
    if(req.method==='GET'&&url.pathname==='/api/state')return send(200,{...summary(store),connected:!!crm});
    if(req.method==='GET'&&url.pathname==='/api/export') {res.setHeader('Content-Disposition','attachment; filename="review-audit.json"');return send(200,summary(store));}
    if(req.method==='POST'&&url.pathname==='/api/connect') {
      const b=await body(req);if(!String(b.token||'').startsWith('bh_'))throw new Error('Enter your personal CRM token');
      const test=new CRM(b.token);await test.call('/me');connect(b.token);return send(200,{connected:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/scan') {if(!crm)throw new Error('Connect your token first');await scan(store,crm);return send(200,summary(store));}
    if(req.method==='POST'&&url.pathname==='/api/preview') {const b=await body(req),p=store.row(b.id);if(!p)throw new Error('Proposal not found');return send(200,executionPreview(p,b.selection||{}));}
    if(req.method==='POST'&&url.pathname==='/api/decide') {if(!crm)throw new Error('Connect your token first');const b=await body(req);return send(200,await decide(store,crm,b.id,b.decision,String(b.note||'').slice(0,2000),b.selection||{}));}
    if(req.method==='GET'&&url.pathname==='/api/account') {if(!crm)throw new Error('Connect first');return send(200,await crm.get(url.searchParams.get('id')));}
    if(req.method==='GET'&&['/','/app.js','/style.css','/review.css','/review-filters.mjs'].includes(url.pathname)) {
      const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
      let content=fs.readFileSync(path.join(root,'public',file),'utf8');
      if(file==='index.html')content=content.replace('__CSRF__',csrf);
      res.writeHead(200,{'Content-Type':file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});return res.end(content);
    }
    return send(404,{error:'Not found'});
  } catch(e){return send(400,{error:e.message});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Bellhaven review: http://127.0.0.1:${port}`));
process.on('SIGINT',()=>server.close(()=>{store.close();process.exit();}));
