// Shared public index contract. Keep the website copy byte-identical.
export const TARGET_REPOSITORY = 'Cloud-Light125/CloudLight-Downloads';
export const CHANNELS = ['stable','rc','beta','alpha','unknown'];
export const PLATFORMS = ['windows','macos','linux'];
export const ARCHITECTURES = ['x64','arm64','x86','universal','unknown'];
export const CHANNEL_LABELS = {stable:'Stable · 正式版',rc:'Release Candidate · 预发布',beta:'Beta · 测试版',alpha:'Alpha · 测试版',unknown:'发布类型未确认 / 其他预发布'};
export const PLATFORM_LABELS = {windows:'Windows',macos:'macOS',linux:'Linux'};
export const ARCH_LABELS = {x64:'x64',arm64:'ARM64',x86:'x86',universal:'Universal',unknown:'架构未确认'};
export const validFilename = n => typeof n === 'string' && n.length > 0 && n.length <= 240 && !/[\x00-\x1f\x7f/\\]/.test(n) && n !== '.' && n !== '..' && !/[. ]$/.test(n);
export const validVersion = v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v);
export const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(d) && Number.isFinite(Date.parse(d));
export const sortReleases = rs => [...rs].sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt) || a.version.localeCompare(b.version,'en',{numeric:true}));
export const formatBytes = b => b < 1024 ? b+' B' : b < 1048576 ? (b/1024).toFixed(1)+' KiB' : b < 1073741824 ? (b/1048576).toFixed(1)+' MiB' : (b/1073741824).toFixed(2)+' GiB';
export const assetLabel = a => /\.dmg$/i.test(a.name) ? 'macOS 安装包' : /\.msi$/i.test(a.name) || /(?:setup|installer).*\.exe$/i.test(a.name) ? 'Windows 安装程序' : /\.exe$/i.test(a.name) ? 'Windows 便携版' : /portable/i.test(a.name) ? '便携版压缩包' : '压缩包';
export function allowedDownloadUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'github.com' && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/Cloud-Light125\/CloudLight-Downloads\/releases\/download\/[^/]+\/[^/]+$/.test(u.pathname); } catch { return false; }
}
export function validateIndex(index, allowedIds) {
  const errors = []; const fail = m => errors.push(m);
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const fields = (v, keys) => Object.keys(v).every(k => keys.includes(k));
  if (!obj(index) || index.schemaVersion !== 1 || !obj(index.projects)) return ['invalid index schema'];
  if (!fields(index,['schemaVersion','generatedAt','projects'])) fail('unexpected index field');
  if (index.generatedAt !== null && !validDate(index.generatedAt)) fail('invalid generatedAt');
  const urls = new Set(); let count = 0;
  for (const [id,p] of Object.entries(index.projects)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || allowedIds && !allowedIds.includes(id)) fail('unknown project: '+id);
    if (!obj(p) || !Array.isArray(p.releases) || !fields(p,['latestVersion','releases'])) { fail(id+': invalid project'); continue; }
    const versions = new Set(), tags = new Set();
    for (const r of p.releases) {
      count++;
      if (!obj(r)) {fail(id+': invalid release');continue;}
      if (!fields(r,['version','sourceTag','tag','channel','prerelease','sourcePrerelease','publishedAt','assets'])) fail(id+': unexpected release field');
      if (!validVersion(r.version) || !validVersion(r.sourceTag) || typeof r.tag !== 'string' || !r.tag.startsWith(id+'--') || !/^[a-zA-Z0-9._-]+$/.test(r.tag)) fail(id+': invalid version/tag');
      if (typeof r.sourceTag === 'string' && r.version !== r.sourceTag.replace(/^v(?=\d)/,'')) fail(id+': source version mismatch');
      if (versions.has(r.version) || tags.has(r.tag)) fail(id+': duplicate release'); versions.add(r.version); tags.add(r.tag);
      if (!CHANNELS.includes(r.channel) || typeof r.prerelease !== 'boolean' || typeof r.sourcePrerelease !== 'boolean' || r.sourcePrerelease && !r.prerelease || !validDate(r.publishedAt)) fail(id+': invalid channel/date');
      const detected = /(?:^|[.\/_-])(rc|beta|alpha)(?:[.\d_-]|$)/i.exec(r.version)?.[1].toLowerCase();
      if (detected && (r.channel !== detected || !r.prerelease) || r.channel === 'stable' && r.prerelease || ['rc','beta','alpha'].includes(r.channel) && !r.prerelease) fail(id+': misleading prerelease channel');
      if (!Array.isArray(r.assets) || !r.assets.length) { fail(id+': assets required'); continue; }
      const names = new Set();
      for (const a of r.assets) {
        if (!obj(a)) {fail(id+': invalid asset');continue;}
        if (!fields(a,['name','size','sha256','platform','arch','downloadUrl'])) fail(id+': unexpected asset field');
        if (!validFilename(a.name) || !/\.(exe|msi|zip|dmg)$/i.test(a.name) || /(?:symbols?|debug|source|fixture|\.pdb|(?:^|[-_.])(?:service|agent)(?:[-_.]|$))/i.test(a.name)) fail(id+': invalid installer');
        if (names.has(a.name)) fail(id+': duplicate asset name'); names.add(a.name);
        if (!Number.isSafeInteger(a.size) || a.size <= 0 || a.size >= 2**31 || !/^[a-f0-9]{64}$/.test(a.sha256)) fail(id+': invalid size/SHA-256');
        if (!PLATFORMS.includes(a.platform) || !ARCHITECTURES.includes(a.arch) || a.arch === 'universal' && a.platform !== 'macos' || a.platform === 'macos' && a.arch === 'x86') fail(id+': invalid platform/architecture');
        if (/\.(exe|msi)$/i.test(a.name) && a.platform !== 'windows' || /\.dmg$/i.test(a.name) && a.platform !== 'macos') fail(id+': platform/extension mismatch');
        if (!allowedDownloadUrl(a.downloadUrl)) fail(id+': unapproved asset URL');
        else {const u = new URL(a.downloadUrl); try { if (decodeURIComponent(u.pathname.split('/').at(-2)) !== r.tag || decodeURIComponent(u.pathname.split('/').at(-1)) !== a.name) fail(id+': asset URL mismatch'); } catch {fail(id+': invalid URL encoding');}}
        if (urls.has(a.downloadUrl)) fail(id+': duplicate global asset URL'); urls.add(a.downloadUrl);
      }
    }
    if (p.latestVersion !== (sortReleases(p.releases.filter(r=>obj(r)&&validDate(r.publishedAt)&&validVersion(r.version)))[0]?.version ?? null)) fail(id+': latestVersion mismatch');
  }
  if (count && !validDate(index.generatedAt)) fail('published index requires generatedAt');
  if (allowedIds) for (const id of allowedIds) if (!Object.hasOwn(index.projects,id)) fail('missing project: '+id);
  return errors;
}
