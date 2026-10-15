import { clients,readIndex,INDEX_FILE } from './runtime.mjs';
import { syncAll,saveIndex } from './mirror.mjs';
try{const ctx=await clients({source:true});const summary=await syncAll({...ctx,previous:await readIndex(),writeIndex:index=>saveIndex(INDEX_FILE,index)});for(const row of summary)console.log(JSON.stringify(row));if(summary.some(r=>r.status==='ERROR'))process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}
