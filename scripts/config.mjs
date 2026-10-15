import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PLATFORMS, ARCHITECTURES } from './index-schema.mjs';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const loadConfig=async()=>JSON.parse(await readFile(join(ROOT,'config/sources.json'),'utf8'));
export function validateConfig(c) {
 const errors=[],ids=new Set(),repos=new Set();
 if(c.schemaVersion!==1||c.targetRepository!=='Cloud-Light125/CloudLight-Downloads'||!Array.isArray(c.sources))return ['invalid config'];
 for(const s of c.sources){if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.projectId)||ids.has(s.projectId))errors.push('invalid/duplicate projectId');ids.add(s.projectId);if(!/^Cloud-Light125\/[\w.-]+$/.test(s.repository)||s.repository===c.targetRepository||repos.has(s.repository.toLowerCase()))errors.push('invalid/duplicate repository');repos.add(s.repository.toLowerCase());if(typeof s.enabled!=='boolean'||!['latest-published','stable-only'].includes(s.selection)||!s.displayName)errors.push(s.projectId+': invalid selection/name');if(!Array.isArray(s.assetRules)||!s.assetRules.length)errors.push(s.projectId+': explicit rules required');for(const r of s.assetRules??[]){try{new RegExp(r.pattern,'i');if(!r.pattern.startsWith('^')||!r.pattern.endsWith('$')||!PLATFORMS.includes(r.platform)||!ARCHITECTURES.includes(r.arch))throw Error();}catch{errors.push(s.projectId+': invalid asset rule');}}}
 return errors;
}
export async function checkedConfig(){const c=await loadConfig();const errors=validateConfig(c);if(errors.length)throw Error(errors.join('\n'));return c;}
