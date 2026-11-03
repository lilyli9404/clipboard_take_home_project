import { CRM } from './lib/source.mjs';
import { Store } from './lib/store.mjs';
import { scan } from './lib/service.mjs';
import path from 'node:path';
const store=new Store(process.env.DATA_DIR||path.join(import.meta.dirname,'data'));
try {const run=await scan(store,new CRM(process.env.CRM_TOKEN));console.log(JSON.stringify({at:run.at,coverage:run.coverage,accounts:run.accounts.length,new_proposals:run.new_proposals,proposals:run.proposals.length},null,2));}
catch(e){console.error(e.message);process.exitCode=1;}finally{store.close();}
