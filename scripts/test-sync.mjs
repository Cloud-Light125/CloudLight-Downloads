import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { loadConfig,validateConfig } from './config.mjs';
import { syncAll,chooseRelease,selectAssets,mirrorTag,channelOf,buildIndex,saveIndex,MANIFEST,expectedDownloadUrl } from './mirror.mjs';
import { validateIndex } from './index-schema.mjs';
import { GitHub,ApiError } from './github.mjs';
const config=await loadConfig();
const names=JSON.parse(await readFile(new URL('./fixtures/approved-names.json',import.meta.url),'utf8'));
const bytes=Buffer.from('MOCK INSTALLER BYTES - never a real publication');
const sha=b=>createHash('sha256').update(b).digest('hex');
class MockGitHub {
 constructor(){this.rows=[];this.blobs=new Map();this.id=1;this.uploads=0;this.downloads=0;this.checked=[];this.failUpload=false;this.failDownload=false;}
 asset(name,b=bytes){const id=this.id++;this.blobs.set(id,b);return {id,name,size:b.length,digest:'sha256:'+sha(b),state:'uploaded',url:'https://api.github.com/mock/'+id,browser_download_url:''};}
 async releases(repo,{authenticated=true}={}){this.checked.push(repo);return this.rows.filter(r=>r.repo===repo&&(authenticated||!r.draft));}
 async assets(repo,id){return this.rows.find(r=>r.repo===repo&&r.id===id)?.assets??[];}
 async download(a,file){this.downloads++;if(this.failDownload){this.failDownload=false;throw Error('download interrupted');}const b=this.blobs.get(a.id);await writeFile(file,b,{flag:'wx'});return {size:b.length,sha256:sha(b)};}
 async upload(r,file,name){if(this.failUpload){this.failUpload=false;throw Error('upload failed');}this.uploads++;const a=this.asset(name,await readFile(file));a.browser_download_url='https://github.com/'+config.targetRepository+'/releases/download/'+encodeURIComponent(r.draft?'untagged-'+r.id:r.tag_name)+'/'+encodeURIComponent(name);r.assets.push(a);return a;}
 async json(route,{method='GET',body}={}){
  if(method==='DELETE'){const id=Number(route.split('/').at(-1));for(const row of this.rows)row.assets=row.assets.filter(a=>a.id!==id);return null;}
  if(method==='POST'){const r={...body,id:this.id++,repo:config.targetRepository,upload_url:'https://uploads.github.com/mock',assets:[]};this.rows.push(r);return r;}
  if(method==='PATCH'){
   const r=this.rows.find(r=>r.id===Number(route.split('/').at(-1)));Object.assign(r,body,{published_at:'2026-10-15T12:00:00Z'});
   if(!r.draft)for(const a of r.assets)a.browser_download_url='https://github.com/'+config.targetRepository+'/releases/download/'+encodeURIComponent(r.tag_name)+'/'+encodeURIComponent(a.name);
   return r;
  }
  const tag=decodeURIComponent(route.split('/').at(-1));const r=this.rows.find(r=>r.tag_name===tag&&!r.draft);if(!r)throw new ApiError('mock',404,new Headers());return r;
 }
 add(s,{tag='v1.0.0',date='2026-10-01T00:00:00Z',prerelease=false,assets=names[s.projectId]}={}){const r={id:this.id++,repo:s.repository,tag_name:tag,published_at:date,prerelease,draft:false,assets:assets.map(n=>this.asset(n))};this.rows.push(r);return r;}
}
const empty=()=>({schemaVersion:1,generatedAt:null,projects:Object.fromEntries(config.sources.map(s=>[s.projectId,{latestVersion:null,releases:[]}]))});
test('CloudLight Clash only mirrors Windows x64 Setup and Portable packages',()=>{
 const source=config.sources.find(s=>s.projectId==='cloudlight-clash');
 const rejected=['SHA256SUMS.txt','SOURCE.zip','logs.zip','CloudLight-Clash-1.0.0-Windows-x64-Debug.zip','CloudLight-Clash-1.0.0-Windows-arm64-Portable.zip','CloudLight-Clash-1.0.0-Windows-x64-Portable.zip.sha256','other.zip'];
 const assets=[...names[source.projectId],...rejected].map(name=>({name,size:100}));
 const {selected,skipped}=selectAssets(source,{assets});
 assert.deepEqual(selected.map(item=>item.asset.name),names[source.projectId]);
 assert.ok(selected.every(item=>item.platform==='windows'&&item.arch==='x64'));
 assert.deepEqual(skipped.map(item=>item.name),rejected);
});
async function run(source,target,previous=empty(),failIndex=false){let index=previous;const summary=await syncAll({config,sourceClient:source,targetClient:target,previous,writeIndex:async i=>{if(failIndex)throw Error('disk/index failure');index=i;}});return {summary,index};}
test('16 mappings, latest RC/date ordering, filtering and limits',async()=>{
 assert.deepEqual(validateConfig(config),[]);assert.equal(config.sources.length,16);
 const s=config.sources.find(s=>s.projectId==='cloudlight-startup');const client=new MockGitHub();const stable=client.add(s,{tag:'v10.0.0'});const rc=client.add(s,{tag:'v0.2.0-rc.1',date:'2026-10-02T00:00:00Z',prerelease:true});
 assert.equal(chooseRelease([stable,rc],s.selection),rc);assert.equal(chooseRelease([stable,rc],'stable-only'),stable);assert.equal(chooseRelease([{...rc,draft:true}],s.selection),undefined);
 assert.throws(()=>chooseRelease([{...rc,published_at:null}],s.selection));
 const assets=[...rc.assets,client.asset('CloudLight-Startup-Symbols-1.0.0-x64.zip'),client.asset('CloudLightStartupService.exe'),{...rc.assets[0],name:'CloudLight-Startup-Setup-99-x64.exe',size:2**31}];
 assert.equal(selectAssets(s,{assets}).selected.length,1);assert.equal(selectAssets(s,{assets}).skipped.length,3);
 assert.notEqual(mirrorTag(s.projectId,'v1/2'),mirrorTag(s.projectId,'v1-2'));
 assert.equal(channelOf('v1.0.0-dev.1',false),'unknown');assert.equal(channelOf('v1.0.0-rc.1',false),'rc');
 assert.equal(expectedDownloadUrl(config.targetRepository,'cloudlight-startup--v1.0.1','安装包 +#.exe'),'https://github.com/Cloud-Light125/CloudLight-Downloads/releases/download/cloudlight-startup--v1.0.1/%E5%AE%89%E8%A3%85%E5%8C%85%20%2B%23.exe');
 assert.throws(()=>expectedDownloadUrl('other/repository','tag','Setup.exe'),/invalid target/);
});
test('all 16 sources, multiplatform, idempotency, missing asset repair, history',async()=>{
 const source=new MockGitHub(),target=new MockGitHub();for(const s of config.sources)source.add(s);
 let {summary,index}=await run(source,target);assert.equal(summary.filter(r=>r.status==='MIRRORED').length,16);assert.equal(source.checked.length,16);assert.deepEqual(validateIndex(index,config.sources.map(s=>s.projectId)),[]);
 const uploads=target.uploads,downloads=source.downloads;const again=await run(source,target,index);assert.deepEqual(again.index,index);assert.equal(target.uploads,uploads);assert.equal(source.downloads,downloads);
 const start=config.sources.find(s=>s.projectId==='cloudlight-startup');const r=target.rows.find(r=>r.tag_name.startsWith(start.projectId+'--'));r.assets=r.assets.filter(a=>a.name===MANIFEST);
 const repaired=await run(source,target,index);assert.equal(repaired.summary.filter(r=>r.status==='ERROR').length,0);assert.equal(target.uploads,uploads+1);
 source.add(start,{tag:'v0.2.0-rc.1',date:'2026-10-03T00:00:00Z',prerelease:true});const updated=await run(source,target,repaired.index);assert.equal(updated.index.projects[start.projectId].releases[0].channel,'rc');assert.equal(updated.index.projects[start.projectId].releases.length,2);
});
test('no release and latest lacking installers never relabel older versions',async()=>{
 const source=new MockGitHub(),target=new MockGitHub(),s=config.sources[1];source.add(s);source.add(s,{tag:'v2.0.0',date:'2026-10-02T00:00:00Z',assets:['symbols.zip']});
 const result=await run(source,target);assert.equal(result.summary.filter(r=>r.status==='NO_RELEASE').length,15);assert.equal(result.summary[1].status,'ERROR');assert.equal(target.rows.length,0);assert.equal(result.index.projects[s.projectId].latestVersion,null);
});
test('download/upload failures keep draft and retry safely; one source failure does not stop others',async()=>{
 for(const failure of ['failDownload','failUpload']){const source=new MockGitHub(),target=new MockGitHub();source.add(config.sources[0]);source.add(config.sources[1]);(failure==='failDownload'?source:target)[failure]=true;
 const first=await run(source,target);assert.equal(first.summary[0].status,'ERROR');assert.equal(first.summary[1].status,'MIRRORED');assert.equal(first.index.projects[config.sources[0].projectId].releases.length,0);assert.ok(target.rows.find(r=>r.draft));
 const next=await run(source,target,first.index);assert.equal(next.summary.filter(r=>r.status==='ERROR').length,0);assert.equal(target.rows.filter(r=>r.draft).length,0);}
});
test('index write failure recovers without upload; changed same-name bytes refused',async()=>{
 const source=new MockGitHub(),target=new MockGitHub(),s=config.sources[1];const r=source.add(s);const first=await run(source,target,empty(),true);assert.equal(first.index.projects[s.projectId].releases.length,0);assert.ok(first.summary.some(r=>r.projectId==='INDEX'&&r.status==='ERROR'));
 const uploads=target.uploads;const recovered=await run(source,target);assert.equal(target.uploads,uploads);assert.equal(recovered.index.projects[s.projectId].releases.length,1);
 r.assets=[source.asset(r.assets[0].name,Buffer.from('changed bytes'))];const conflict=await run(source,target,recovered.index);assert.equal(conflict.summary[1].status,'ERROR');assert.equal(target.uploads,uploads);assert.deepEqual(conflict.index.projects,recovered.index.projects);
});
test('index atomic write, URL allowlist, source digest/redirect security and HTTP errors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cloudlight-test-'));try{const file=join(dir,'index.json');await saveIndex(file,empty());assert.deepEqual(JSON.parse(await readFile(file,'utf8')),empty());
 const seen=[];const github=new GitHub('never-print-this',{fetcher:async(url,options)=>{seen.push(options);return seen.length===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/mock'}}):new Response(bytes);}});
 const result=await github.download({url:'https://api.github.com/repos/x/y/releases/assets/1',size:bytes.length,digest:'sha256:'+sha(bytes)},join(dir,'download'));assert.equal(result.sha256,sha(bytes));assert.ok(seen[0].headers.Authorization);assert.equal(seen[1].headers,undefined);
 for(const status of [401,403,404]){const client=new GitHub('x',{fetcher:async()=>new Response(null,{status})});await assert.rejects(()=>client.json('/repos/x/y/releases'),e=>e.status===status);}
 const bad=new GitHub('x',{fetcher:async()=>new Response(bytes)});await assert.rejects(()=>bad.download({url:'https://api.github.com/mock',size:bytes.length,digest:'sha256:'+'0'.repeat(64)},join(dir,'bad')),/digest mismatch/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('second installer upload failure never publishes a partially complete release',async()=>{
 const source=new MockGitHub(),target=new MockGitHub();source.add(config.sources[0]);
 const upload=target.upload.bind(target);let calls=0;target.upload=async(...args)=>{if(++calls===2)throw Error('second upload interrupted');return upload(...args);};
 const first=await run(source,target);assert.equal(first.summary[0].status,'ERROR');assert.equal(first.index.projects[config.sources[0].projectId].releases.length,0);assert.equal(target.rows[0].draft,true);assert.equal(target.rows[0].assets.length,1);
 const failed=target.asset(names[config.sources[0].projectId][1],Buffer.alloc(0));failed.state='starter';target.rows[0].assets.push(failed);
 const second=await run(source,target,first.index);assert.equal(second.summary[0].status,'MIRRORED');assert.equal(target.rows[0].draft,false);assert.equal(target.rows[0].assets.length,3);
});

test('recover 16 existing untagged drafts without downloading or uploading installers again',async()=>{
 const source=new MockGitHub(),target=new MockGitHub(),installerIds=new Map();
 for(const s of config.sources){
  const release=source.add(s);
  const draft=await target.json('/repos/'+config.targetRepository+'/releases',{method:'POST',body:{tag_name:mirrorTag(s.projectId,release.tag_name),draft:true,prerelease:false}});
  for(const a of release.assets){const existing=target.asset(a.name,source.blobs.get(a.id));existing.browser_download_url='https://github.com/'+config.targetRepository+'/releases/download/untagged-'+draft.id+'/'+encodeURIComponent(a.name);draft.assets.push(existing);}
  installerIds.set(draft.id,draft.assets.map(a=>a.id));
 }
 assert.deepEqual(await buildIndex(config,target,empty()),empty());
 const upload=target.upload.bind(target),json=target.json.bind(target);let manifests=0,publicChecks=0;
 target.upload=async(r,file,name)=>{
  assert.equal(name,MANIFEST,'existing installers must be reused');assert.equal(r.draft,true);
  const m=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(validateIndex({schemaVersion:1,generatedAt:'2026-10-15T12:00:00Z',projects:{[m.projectId]:{latestVersion:m.release.version,releases:[m.release]}}}),[]);
  for(const expected of m.release.assets){const actual=r.assets.find(a=>a.name===expected.name);assert.match(actual.browser_download_url,/\/untagged-/);assert.equal(actual.digest,'sha256:'+expected.sha256);assert.equal(actual.size,expected.size);assert.ok(!expected.downloadUrl.includes('/untagged-'));}
  manifests++;return upload(r,file,name);
 };
 target.json=async(route,options={})=>{
  if(options.method==='POST')assert.fail('retry must not create another release');
  if(options.method==='DELETE')assert.fail('retry must not delete existing drafts or assets');
  if(options.method==='PATCH'){const draft=target.rows.find(r=>r.id===Number(route.split('/').at(-1)));assert.ok(draft.assets.some(a=>a.name===MANIFEST));}
  const result=await json(route,options);if(options.authenticated===false){assert.equal(result.draft,false);publicChecks++;}return result;
 };
 const first=await run(source,target);assert.equal(first.summary.filter(r=>r.status==='MIRRORED').length,16);assert.equal(publicChecks,16);assert.equal(manifests,16);assert.equal(source.downloads,0);assert.equal(target.rows.length,16);
 for(const r of target.rows){assert.equal(r.draft,false);assert.deepEqual(r.assets.filter(a=>a.name!==MANIFEST).map(a=>a.id),installerIds.get(r.id));}
 for(const p of Object.values(first.index.projects)){assert.equal(p.releases.length,1);for(const a of p.releases[0].assets)assert.ok(!a.downloadUrl.includes('/untagged-'));}
 const again=await run(source,target,first.index);assert.deepEqual(again.index,first.index);assert.equal(again.summary.filter(r=>r.status==='MIRRORED').length,16);assert.equal(target.rows.length,16);assert.equal(manifests,16);assert.equal(source.downloads,0);
});

test('published URL mismatch cannot enter the index and recovers without reupload',async()=>{
 const source=new MockGitHub(),target=new MockGitHub();source.add(config.sources[1]);
 const json=target.json.bind(target);target.json=async(route,options={})=>{const r=await json(route,options);if(options.method==='PATCH')r.assets[0].browser_download_url='https://github.com/'+config.targetRepository+'/releases/download/untagged-stale/'+r.assets[0].name;return r;};
 const failed=await run(source,target);assert.match(failed.summary[1].error,/public release verification: published asset missing\/URL mismatch/);assert.ok(failed.summary.some(r=>r.projectId==='INDEX'&&r.status==='ERROR'));assert.deepEqual(failed.index,empty());assert.equal(target.rows[0].draft,false);
 const uploads=target.uploads,downloads=source.downloads;const published=target.rows[0];for(const a of published.assets)a.browser_download_url=expectedDownloadUrl(config.targetRepository,published.tag_name,a.name);
 const recovered=await run(source,target);assert.equal(recovered.summary[1].status,'MIRRORED');assert.equal(recovered.index.projects[config.sources[1].projectId].releases.length,1);assert.equal(target.uploads,uploads);assert.equal(source.downloads,downloads);assert.equal(target.rows.length,1);
});
