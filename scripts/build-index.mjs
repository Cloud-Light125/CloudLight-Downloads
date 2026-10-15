import { clients,readIndex,INDEX_FILE } from './runtime.mjs';
import { buildIndex,saveIndex } from './mirror.mjs';
try{const {config,targetClient}=await clients();await saveIndex(INDEX_FILE,await buildIndex(config,targetClient,await readIndex()));console.log('Index verified and updated');}catch(e){console.error('public index update: '+e.message);process.exitCode=1;}
