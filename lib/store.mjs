import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
export class Store {
  constructor(dir) {
    fs.mkdirSync(dir,{recursive:true});this.dir=dir;
    this.db=new DatabaseSync(path.join(dir,'review.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,status TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,decided_at TEXT,reviewer_note TEXT NOT NULL DEFAULT '',progress TEXT NOT NULL DEFAULT '{}',error TEXT);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,proposal_id TEXT,event TEXT NOT NULL,detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY,at TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locks(name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
  }
  close(){this.db.close();}
  get(key){const r=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return r?JSON.parse(r.value):null;}
  set(key,value){this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key,JSON.stringify(value));}
  audit(id,event,detail={}){this.db.prepare('INSERT INTO audit(at,proposal_id,event,detail) VALUES(?,?,?,?)').run(new Date().toISOString(),id,event,JSON.stringify(detail));}
  row(id){const p=this.db.prepare('SELECT * FROM proposals WHERE id=?').get(id);return p?{...JSON.parse(p.body),status:p.status,created_at:p.created_at,decided_at:p.decided_at,reviewer_note:p.reviewer_note,progress:JSON.parse(p.progress),error:p.error}:null;}
  rows(){return this.db.prepare('SELECT id FROM proposals ORDER BY created_at,id').all().map(r=>this.row(r.id));}
  progress(id,progress){this.db.prepare('UPDATE proposals SET progress=? WHERE id=?').run(JSON.stringify(progress),id);}
  status(id,status,note='',error=null){this.db.prepare('UPDATE proposals SET status=?,decided_at=?,reviewer_note=?,error=? WHERE id=?').run(status,['approved','rejected'].includes(status)?new Date().toISOString():null,note,error,id);}
  saveRun(run) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current=new Set(run.proposals.map(p=>p.id));
      for(const p of this.rows())if(p.status==='pending'&&(!p.scope||p.scope===run.scope)&&!current.has(p.id))this.status(p.id,'superseded');
      let added=0;
      for(const p of run.proposals) {
        p.observed_at=run.at;
        const old=this.row(p.id);
        if(!old) {this.db.prepare('INSERT INTO proposals(id,status,body,created_at) VALUES(?,?,?,?)').run(p.id,'pending',JSON.stringify(p),run.at);added++;}
        else if(['pending','superseded'].includes(old.status))this.db.prepare('UPDATE proposals SET body=?,status=? WHERE id=?').run(JSON.stringify(p),'pending',p.id);
      }
      run.new_proposals=added;
      const scopes=this.get('runs_by_scope')||{};scopes[run.scope||run.parent?.account_id||'default']=run;this.set('runs_by_scope',scopes);
      this.set('latest',run);this.db.prepare('INSERT INTO runs(at,body) VALUES(?,?)').run(run.at,JSON.stringify({at:run.at,coverage:run.coverage,account_count:run.accounts.length,new_proposals:added}));
      this.db.exec('COMMIT');return added;
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  async locked(fn) {
    const owner=crypto.randomUUID(),now=Date.now();
    this.db.prepare('DELETE FROM locks WHERE expires<?').run(now);
    try{this.db.prepare('INSERT INTO locks VALUES(?,?,?)').run('operation',owner,now+600000);}catch{throw new Error('Another scan or approval is running. Retry after it finishes.');}
    try{return await fn();}finally{this.db.prepare('DELETE FROM locks WHERE owner=?').run(owner);}
  }
  history(){return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 500').all().map(r=>({...r,detail:JSON.parse(r.detail)}));}
}
