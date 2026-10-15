import { checkedConfig } from './config.mjs';
import { readIndex } from './runtime.mjs';
import { GitHub } from './github.mjs';
import { validateIndex } from './index-schema.mjs';
import { buildIndex } from './mirror.mjs';
try{const config=await checkedConfig();const index=await readIndex();const errors=validateIndex(index,config.sources.map(s=>s.projectId));if(errors.length)throw Error(errors.join('\n'));if(process.argv.includes('--remote')){const targetClient=new GitHub();const remote=await buildIndex(config,targetClient,index);if(JSON.stringify(remote.projects)!==JSON.stringify(index.projects))throw Error('remote index differs; run build:index');}console.log('Index PASS: '+Object.keys(index.projects).length+' projects; '+Object.values(index.projects).reduce((n,p)=>n+p.releases.length,0)+' published versions');}catch(e){console.error(e.message);process.exitCode=1;}
