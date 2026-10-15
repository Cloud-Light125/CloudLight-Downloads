import { readFile } from 'node:fs/promises';
import { basename,resolve } from 'node:path';
import { checkedConfig } from './config.mjs';
import { hashFile } from './github.mjs';
import { validDate } from './index-schema.mjs';
import { clients,readIndex,INDEX_FILE } from './runtime.mjs';
import { mirrorRelease,mirrorTag,channelOf,buildIndex,saveIndex,selectAssets } from './mirror.mjs';
const args=process.argv.slice(2);const get=k=>args[args.indexOf(k)+1];
try{
 if(!args.includes('--plan')||!get('--plan'))throw Error('Usage: npm run import:local -- --plan <explicit-plan.json> [--channel stable|rc|beta|alpha] [--published-at ISO8601] [--publish]');
 const plan=JSON.parse(await readFile(resolve(get('--plan')),'utf8'));const config=await checkedConfig();const source=config.sources.find(s=>s.projectId===plan.projectId);if(!source)throw Error('project not whitelisted');
 const channel=args.includes('--channel')?get('--channel'):plan.channel;if(!['stable','rc','beta','alpha'].includes(channel))throw Error('channel unconfirmed: provide --channel only after verifying release evidence');
 if(!plan.version||!Array.isArray(plan.assets)||!plan.assets.length)throw Error('invalid explicit local plan');
 const files=new Map(),assets=[];
 for(const a of plan.assets){if(!a.file||basename(a.file)!==a.filename)throw Error('plan filename/local path mismatch');const file=resolve(a.file);const data=await hashFile(file);if(data.size!==a.bytes||data.sha256!==a.sha256)throw Error('file changed since prepare: '+a.filename);const rule=source.assetRules.find(r=>new RegExp(r.pattern,'i').test(a.filename));if(!rule||rule.platform!==a.platform||rule.arch!==a.arch)throw Error('local plan platform/architecture is not approved by source rule');files.set(a.filename,file);assets.push({name:a.filename,size:data.size,digest:'sha256:'+data.sha256});}
 const tag=plan.version.startsWith('v')?plan.version:'v'+plan.version;
 // Legacy plan dates were proposed R2 migration dates, never source publication evidence.
 const date=args.includes('--published-at')?get('--published-at'):null;
 if(args.includes('--publish')&&!validDate(date))throw Error('PENDING_MANUAL: provide --published-at with a verified ISO8601 release timestamp; legacy plan date is ignored');
 const release={tag_name:tag,draft:false,prerelease:channel!=='stable',published_at:date,assets};
 if(channelOf(tag,release.prerelease)!==channel)throw Error('version/channel mismatch');
 if(selectAssets(source,release).selected.length!==assets.length)throw Error('every explicit file must be an eligible installer');
 console.log(JSON.stringify({state:'LOCAL_VERIFIED_NOT_PUBLISHED',publishedAt:date,projectId:source.projectId,tag:mirrorTag(source.projectId,tag),assets},null,2));
 // Historical R2 key/url fields are ignored. Only explicitly named files are uploaded.
 if(args.includes('--publish')){const ctx=await clients();await mirrorRelease({...ctx,source,release,localFiles:files});await saveIndex(INDEX_FILE,await buildIndex(config,ctx.targetClient,await readIndex()));console.log('PUBLIC_RELEASE_AND_LOCAL_INDEX_UPDATED: commit/push index separately');}
}catch(e){console.error(e.message);process.exitCode=1;}
