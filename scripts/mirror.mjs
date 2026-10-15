import { mkdtemp, rm, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { digestOf, hashFile } from './github.mjs';
import { TARGET_REPOSITORY, validateIndex, sortReleases, validDate, validVersion, validFilename } from './index-schema.mjs';
export const MANIFEST='cloudlight-release.json';
export const LIMIT=2**31;
const excluded=/(?:symbols?|debug|source|fixture|\.pdb|(?:^|[-_.])(?:service|agent)(?:[-_.]|$))/i;
export function channelOf(tag,prerelease) {const c=/(?:^|[.\/_-])(rc|beta|alpha)(?:[.\d_-]|$)/i.exec(tag)?.[1].toLowerCase();return c??(prerelease||/^v?\d+(?:\.\d+)+-[0-9A-Za-z]/.test(tag)?'unknown':'stable');}
export function mirrorTag(id,tag){if(!validVersion(tag))throw Error('invalid original tag');const safe=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(tag)&&!tag.includes('..')&&!tag.endsWith('.')&&!tag.endsWith('.lock')&&!tag.includes('--sha256-');return id+'--'+(safe?tag:tag.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80)+'--sha256-'+createHash('sha256').update(tag).digest('hex'));}
export function chooseRelease(releases,selection) {
 const published=releases.filter(r=>r.draft===false);
 if(published.some(r=>!validDate(r.published_at)))throw Error('source release has no accurate published_at');
 return published.filter(r=>selection!=='stable-only'||!r.prerelease&&channelOf(r.tag_name,false)==='stable').sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)||b.id-a.id)[0];
}
export function selectAssets(source,release) {
 const selected=[],skipped=[];
 for(const a of release.assets??[]){const matches=source.assetRules.filter(r=>new RegExp(r.pattern,'i').test(a.name));
 if(excluded.test(a.name)||!validFilename(a.name)||! /\.(exe|msi|zip|dmg)$/i.test(a.name)||!matches.length){skipped.push({name:a.name,reason:'not an approved installer'});continue;}
 if(matches.length!==1)throw Error('ambiguous asset rules: '+a.name);
 if(!Number.isSafeInteger(a.size)||a.size<=0||a.size>=LIMIT){skipped.push({name:a.name,reason:'invalid size or >= 2 GiB'});continue;}
 const rule=matches[0];if(/\.(exe|msi)$/i.test(a.name)&&rule.platform!=='windows'||/\.dmg$/i.test(a.name)&&rule.platform!=='macos')throw Error('rule platform mismatch');
 if(selected.some(s=>s.asset.name===a.name))throw Error('duplicate source asset');
 selected.push({asset:a,platform:rule.platform,arch:rule.arch});}
 return {selected,skipped};
}
export async function verifyAsset(client,asset,expected,temp) {
 if(asset.state!=='uploaded'||asset.size!==expected.size)throw Error('target asset incomplete/size conflict: '+asset.name);
 const digest=digestOf(asset);if(digest){if(digest!==expected.sha256)throw Error('target SHA-256 conflict: '+asset.name);return;}
 // API digest is absent: hash the target stream once, never infer it from ETag.
 const check=await client.download(asset,join(temp,randomUUID()));if(check.sha256!==expected.sha256)throw Error('target hash conflict: '+asset.name);
}
export function expectedDownloadUrl(repository,tag,name) {
 if(repository!==TARGET_REPOSITORY||! /^[a-zA-Z0-9._-]+$/.test(tag)||!validFilename(name))throw Error('invalid target download identity');
 return 'https://github.com/'+repository+'/releases/download/'+encodeURIComponent(tag)+'/'+encodeURIComponent(name);
}
// A draft's untagged-* URL is temporary. This URL is only a publication plan
// until a fresh public API response and its assets have been verified below.
const cleanAsset=(asset,data,platform,arch,repository,tag)=>({name:asset.name,size:data.size,sha256:data.sha256,platform,arch,downloadUrl:expectedDownloadUrl(repository,tag,asset.name)});
async function verifyPublishedAssets(client,repository,release,record,temp,assets) {
 if(release.draft!==false||!validDate(release.published_at)||release.tag_name!==record.tag||release.prerelease!==record.prerelease)throw Error('target release not publicly published or identity/prerelease mismatch');
 assets??=await client.assets(repository,release.id);
 for(const expected of record.assets){const actual=assets.find(a=>a.name===expected.name);if(!actual||actual.browser_download_url!==expected.downloadUrl)throw Error('published asset missing/URL mismatch');await verifyAsset(client,actual,expected,temp);}
 if(!assets.some(a=>a.name===MANIFEST)||assets.length!==record.assets.length+1)throw Error('unexpected public assets');
}
async function readManifest(client,asset,temp){if(asset.size>1024*1024)throw Error('manifest too large');const file=join(temp,randomUUID());await client.download(asset,file,{maxBytes:1024*1024});return JSON.parse(await readFile(file,'utf8'));}
function assertRecord(config,id,record){const errors=validateIndex({schemaVersion:1,generatedAt:new Date().toISOString(),projects:{[id]:{latestVersion:record.version,releases:[record]}}});if(errors.length)throw Error(errors.join('; '));if(!config.sources.some(s=>s.projectId===id)||record.tag!==mirrorTag(id,record.sourceTag))throw Error('manifest identity mismatch');}
export async function mirrorRelease({config,source,release,sourceClient,targetClient,localFiles}) {
 const temp=await mkdtemp(join(tmpdir(),'cloudlight-mirror-'));let stage='selection';
 try {
  const {selected,skipped}=selectAssets(source,release);
  if(!selected.length)throw Error('latest published release has no approved installers; skipped='+skipped.map(s=>s.name+': '+s.reason).join(', '));
  const tag=mirrorTag(source.projectId,release.tag_name),route='/repos/'+config.targetRepository+'/releases';
  stage='target discovery';let target;
  try{target=await targetClient.json(route+'/tags/'+encodeURIComponent(tag));}catch(e){if(e.status!==404)throw e;}
  // The tag endpoint only exposes published releases. Find an existing draft
  // by its declared tag before creating anything, including on retry.
  if(!target){const matches=(await targetClient.releases(config.targetRepository)).filter(r=>r.tag_name===tag);if(matches.length>1)throw Error('multiple target releases for tag: '+tag);target=matches[0];}
  if(!target){stage='target release creation';target=await targetClient.json(route,{method:'POST',body:{tag_name:tag,name:source.displayName+' '+release.tag_name,body:'Public installation packages. SHA-256 and platform information: '+MANIFEST+'.',draft:true,prerelease:release.prerelease||channelOf(release.tag_name,release.prerelease)!=='stable',make_latest:'false'}});}
  if(target.tag_name!==tag)throw Error('target tag mismatch');
  stage='target asset discovery';let existing=await targetClient.assets(config.targetRepository,target.id);
  // GitHub may leave a zero-byte 'starter' after an interrupted upload.
  // Only these incomplete placeholders on our draft can be removed for retry.
  if(target.draft) for(const a of existing.filter(a=>a.state==='starter'&&a.size===0&&(a.name===MANIFEST||selected.some(i=>i.asset.name===a.name)))){
   stage='incomplete draft placeholder recovery';await targetClient.json('/repos/'+config.targetRepository+'/releases/assets/'+a.id,{method:'DELETE'});existing=existing.filter(x=>x.id!==a.id);
  }
  const oldManifestAsset=existing.find(a=>a.name===MANIFEST);
  const old=oldManifestAsset?await readManifest(targetClient,oldManifestAsset,temp):null;
  if(!target.draft&&!old)throw Error('published release lacks verification manifest; manual audit required');
  const record={version:release.tag_name.replace(/^v(?=\d)/,''),sourceTag:release.tag_name,tag,channel:channelOf(release.tag_name,release.prerelease),sourcePrerelease:release.prerelease,prerelease:release.prerelease||channelOf(release.tag_name,release.prerelease)!=='stable',publishedAt:release.published_at,assets:[]};
  if(old){assertRecord(config,source.projectId,old.release);if(old.projectId!==source.projectId||old.release.tag!==tag)throw Error('existing manifest conflict');
   const oldHeader={...old.release,assets:[]};if(JSON.stringify(oldHeader)!==JSON.stringify(record))throw Error('immutable release metadata conflict');
   if(old.release.assets.length!==selected.length||selected.some(i=>!old.release.assets.some(a=>a.name===i.asset.name&&a.size===i.asset.size&&a.platform===i.platform&&a.arch===i.arch&&(!digestOf(i.asset)||a.sha256===digestOf(i.asset)))))throw Error('immutable installer selection/content conflict');
  }
  for(const item of selected){const a=item.asset;let found=existing.find(x=>x.name===a.name);let data;
   if(found&&digestOf(a)&&digestOf(found)===digestOf(a)&&found.size===a.size){data={size:a.size,sha256:digestOf(a)};}
   else {stage='source asset download';const file=localFiles?.get(a.name)??join(temp,randomUUID());data=localFiles?await hashFile(file):await sourceClient.download(a,file);if(data.size!==a.size||digestOf(a)&&data.sha256!==digestOf(a))throw Error('local/source asset changed');
    if(found){stage='target asset verification';await verifyAsset(targetClient,found,data,temp);}
    else{stage='asset upload';try{found=await targetClient.upload(target,file,a.name);}catch(e){throw Error('upload failed; leave draft/objects for retry: '+e.message);}}
   }
   stage='target asset verification';await verifyAsset(targetClient,found,data,temp);record.assets.push(cleanAsset(found,data,item.platform,item.arch,config.targetRepository,tag));
  }
  record.assets.sort((a,b)=>a.name.localeCompare(b.name));assertRecord(config,source.projectId,record);
  if(old&&JSON.stringify(old.release)!==JSON.stringify(record))throw Error('immutable published manifest/content conflict');
  const expectedNames=new Set([...record.assets.map(a=>a.name),MANIFEST]);
  if(existing.some(a=>!expectedNames.has(a.name)))throw Error('unexpected target asset; refusing to publish');
  if(!old){stage='verification manifest upload';const file=join(temp,randomUUID());await writeFile(file,JSON.stringify({schemaVersion:1,projectId:source.projectId,release:record},null,2)+'\n');const result=await targetClient.upload(target,file,MANIFEST);await verifyAsset(targetClient,result,await hashFile(file),temp);}
  if(target.draft){stage='target release publication';target=await targetClient.json(route+'/'+target.id,{method:'PATCH',body:{draft:false,prerelease:record.prerelease,make_latest:'false'}});}
  stage='public release verification';const publicRelease=await targetClient.json(route+'/tags/'+encodeURIComponent(tag),{authenticated:false});if(publicRelease.id!==target.id)throw Error('public release ID mismatch');await verifyPublishedAssets(targetClient,config.targetRepository,publicRelease,record,temp);
  return {projectId:source.projectId,status:'MIRRORED',version:record.version,skipped};
 }catch(e){throw Error(stage+': '+e.message);}finally{await rm(temp,{recursive:true,force:true});}
}
export async function buildIndex(config,targetClient,previous={}) {
 const temp=await mkdtemp(join(tmpdir(),'cloudlight-index-'));
 try {
  const projects=Object.fromEntries(config.sources.map(s=>[s.projectId,{latestVersion:null,releases:[]}]))
  const published=(await targetClient.releases(config.targetRepository,{authenticated:false})).filter(r=>!r.draft);
  for(const r of published){const source=config.sources.find(s=>r.tag_name.startsWith(s.projectId+'--'));if(!source)continue;
   const assets=await targetClient.assets(config.targetRepository,r.id);const ma=assets.find(a=>a.name===MANIFEST);if(!ma)throw Error('published mirror lacks manifest: '+r.tag_name);
   const m=await readManifest(targetClient,ma,temp);if(m.schemaVersion!==1||m.projectId!==source.projectId)throw Error('invalid public manifest');assertRecord(config,m.projectId,m.release);
   await verifyPublishedAssets(targetClient,config.targetRepository,r,m.release,temp,assets);
   projects[m.projectId].releases.push(m.release);
  }
  for(const p of Object.values(projects)){p.releases=sortReleases(p.releases);p.latestVersion=p.releases[0]?.version??null;}
  // Historical releases must not disappear silently due to a transient listing or deletion.
  for(const [id,p] of Object.entries(previous.projects??{})) for(const r of p.releases??[]) if(!projects[id]?.releases.some(x=>x.tag===r.tag))throw Error('historical release disappeared: '+r.tag);
  const unchanged=JSON.stringify(previous.projects)===JSON.stringify(projects);
  const index={schemaVersion:1,generatedAt:unchanged?previous.generatedAt:new Date().toISOString(),projects};
  const errors=validateIndex(index,config.sources.map(s=>s.projectId));if(errors.length)throw Error(errors.join('; '));return index;
 }finally{await rm(temp,{recursive:true,force:true});}
}
export async function saveIndex(file,index){const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(index,null,2)+'\n',{flag:'wx'});await rename(temp,file);}finally{await rm(temp,{force:true});}}
export async function syncAll({config,sourceClient,targetClient,previous,writeIndex}) {
 const summary=[];
 for(const source of config.sources.filter(s=>s.enabled)) {let stage='source release discovery (check read access, visibility and rate limit)';try{const releases=await sourceClient.releases(source.repository);const release=chooseRelease(releases,source.selection);if(!release){summary.push({projectId:source.projectId,status:'NO_RELEASE'});continue;}stage='source asset listing';release.assets=await sourceClient.assets(source.repository,release.id);stage='mirror';summary.push(await mirrorRelease({config,source,release,sourceClient,targetClient}));}catch(e){summary.push({projectId:source.projectId,status:'ERROR',error:stage+': '+e.message});}}
 try{const index=await buildIndex(config,targetClient,previous);await writeIndex(index);}catch(e){summary.push({projectId:'INDEX',status:'ERROR',error:'public index update: '+e.message});}
 return summary;
}
