import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkedConfig, ROOT } from './config.mjs';
import { GitHub } from './github.mjs';
export const INDEX_FILE=join(ROOT,'data/releases.json');
export const readIndex=async()=>JSON.parse(await readFile(INDEX_FILE,'utf8'));
export async function clients({source=false}={}){const config=await checkedConfig();if(!process.env.GITHUB_TOKEN)throw Error('PENDING_MANUAL: GITHUB_TOKEN with target repository Contents: write is required');if(source&&!process.env.SOURCE_RELEASES_READ_TOKEN)throw Error('PENDING_MANUAL: SOURCE_RELEASES_READ_TOKEN (selected sources Contents: read) is required');const targetClient=new GitHub(process.env.GITHUB_TOKEN),sourceClient=new GitHub(process.env.SOURCE_RELEASES_READ_TOKEN);const target=await targetClient.json('/repos/'+config.targetRepository);if(target.private!==false)throw Error('target repository must be Public');return {config,targetClient,sourceClient};}
