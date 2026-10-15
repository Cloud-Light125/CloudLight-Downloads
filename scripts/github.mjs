import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
export class ApiError extends Error { constructor(stage,status,headers) { super(stage+': HTTP '+status+(status===404?' (repository/release absent OR token cannot read it)':'')+([401,403].includes(status)?' (authentication/permission/rate limit)':'')+(headers?.get('x-ratelimit-remaining')==='0'?' rate limit exhausted; reset='+headers.get('x-ratelimit-reset'):'')); this.status=status; } }
const pause = ms => new Promise(r=>setTimeout(r,ms));
export const digestOf = a => /^sha256:([a-f0-9]{64})$/i.exec(a?.digest ?? '')?.[1].toLowerCase();
export async function hashFile(file) {const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(file)){size+=chunk.length;hash.update(chunk);}return {size,sha256:hash.digest('hex')};}
export class GitHub {
  constructor(token, {fetcher=fetch}={}) { this.token=token; this.fetcher=fetcher; }
  async request(url,{method='GET',body,accept='application/vnd.github+json',size,authenticated=true,timeout=120000,stage='GitHub API'}={}) {
    const u=new URL(url.startsWith('/')?'https://api.github.com'+url:url);
    if (!['api.github.com','uploads.github.com'].includes(u.hostname) || u.protocol!=='https:') throw new Error('untrusted authenticated API URL');
    for(let attempt=0;;attempt++) {
      try {
        const headers={Accept:accept,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'CloudLight-Downloads'};
        if(authenticated && this.token) headers.Authorization='Bearer '+this.token;
        if(body) headers['Content-Type']=typeof body==='function'?'application/octet-stream':'application/json';
        if(size!==undefined) headers['Content-Length']=String(size);
        const res=await this.fetcher(u,{method,headers,body:typeof body==='function'?body():body?JSON.stringify(body):undefined,duplex:'half',redirect:'manual',signal:AbortSignal.timeout(timeout)});
        if((res.status>=500 || res.status===429) && attempt<2 && method==='GET'){await res.body?.cancel();await pause(Math.min(Number(res.headers.get('retry-after')||1)*1000,5000));continue;}
        if(!res.ok && ![301,302,303,307,308].includes(res.status)) {await res.body?.cancel();throw new ApiError(stage,res.status,res.headers);}
        return res;
      } catch(e) {if(!(e instanceof ApiError) && method==='GET' && attempt<2){await pause(500*(attempt+1));continue;}throw e;}
    }
  }
  async json(route,options={}) {const res=await this.request(route,options);if(!res.ok)throw new Error('unexpected API redirect');if(res.status===204)return null;return this.smallJson(res);}
  async smallJson(res) {let size=0;const chunks=[];for await(const c of res.body){size+=c.length;if(size>8*1024*1024)throw new Error('API metadata too large');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  async list(route,options={}) {const rows=[];for(let page=1;;page++){const data=await this.json(route+(route.includes('?')?'&':'?')+'per_page=100&page='+page,options);if(!Array.isArray(data))throw new Error('expected paginated array');rows.push(...data);if(data.length<100)break;if(page>1000)throw new Error('pagination limit');}return rows;}
  releases(repo,options={}) {return this.list('/repos/'+repo+'/releases',options);}
  assets(repo,id) {return this.list('/repos/'+repo+'/releases/'+id+'/assets');}
  async download(asset,file,{maxBytes=2**31-1}={}) {
    let currentUrl=asset.url;
    let res=await this.request(asset.url,{accept:'application/octet-stream',timeout:30*60000,stage:'asset download'});
    for(let redirect=0;[301,302,303,307,308].includes(res.status);redirect++) {
      if(redirect>=5)throw new Error('asset redirect limit');
      const location=new URL(res.headers.get('location'),currentUrl);await res.body?.cancel();
      if(location.protocol!=='https:' || location.username || location.password || !/^(?:[a-z0-9-]+\.)*(?:githubusercontent\.com|github\.com)$/.test(location.hostname))throw new Error('unsafe asset redirect');
      // Never forward any Authorization header to the signed download host.
      currentUrl=location.href;
      res=await this.fetcher(location,{redirect:'manual',signal:AbortSignal.timeout(30*60000)});
    }
    if(!res.ok)throw new ApiError('asset download',res.status,res.headers);
    const hash=createHash('sha256');let size=0;
    await pipeline(Readable.fromWeb(res.body),new Transform({transform(chunk,_enc,done){size+=chunk.length;if(size>maxBytes){done(new Error('asset exceeds byte limit'));return;}hash.update(chunk);done(null,chunk);}}),createWriteStream(file,{flags:'wx'}));
    const sha256=hash.digest('hex');
    if(size!==asset.size)throw new Error('download size mismatch');
    if(digestOf(asset) && digestOf(asset)!==sha256)throw new Error('source/target digest mismatch');
    return {size,sha256};
  }
  async upload(release,file,name) {
    const {size}=await stat(file);const base=release.upload_url.split('{')[0];const url=new URL(base);url.searchParams.set('name',name);
    return this.json(url.href,{method:'POST',body:()=>createReadStream(file),size,timeout:30*60000,stage:'asset upload'});
  }
}
