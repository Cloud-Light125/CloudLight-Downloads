# CloudLight Downloads

269332.xyz 的公开安装包镜像。源码继续留在各自仓库；本仓库只维护来源白名单、同步代码、公开索引和文档。安装包只作为 Release Assets，不进入 Git 文件树。

公开仓库已创建。安装包同步状态：PENDING_MANUAL，需配置来源只读 Secret 并首次运行工作流。data/releases.json 的 15 个项目均无公开版本。测试夹具全部为 MOCK，不可作为安装包使用。

## 本地命令（Node 24，无额外依赖）

~~~powershell
npm run validate
npm test
npm run sync
npm run build:index
npm run verify -- --remote
npm run import:local -- --plan 'D:\code\website\269332-site\.downloads\plans\cloudlight-startup-1.0.1.json'
~~~

sync / build:index 需要相应凭据；verify --remote 只读检查公开API，无需私有Token（受匿名限流）。import:local 默认只核验用户明确选择的本地计划；加 --publish 才发布。本站首次迁移不自动上传任何文件。

见 [配置与运行](docs/setup.md)。

## 结构

- config/sources.json：15 个核实的来源映射及安装包文件名白名单。
- scripts/github.mjs：流式下载/上传、重定向隔离、超时与有限重试。
- scripts/mirror.mjs：最新 Published Release 选择、Draft 镜像、SHA-256、历史索引与恢复。
- scripts/sync-releases.mjs：遍历来源并汇总；单项目错误后继续其他项目，最终以失败退出。
- scripts/build-index.mjs：从已公开且已验证的目标 Release 重建索引。
- scripts/import-local.mjs：明确选择旧本地计划进行核验/可选迁移。
- scripts/index-schema.mjs：公开索引契约，网站保留同一份校验逻辑。
- scripts/test-sync.mjs、scripts/fixtures/：隔离 Mock 测试，未连接真实 GitHub。
- data/releases.json：网站浏览器读取的唯一版本索引。
- .github/workflows/sync-releases.yml：每六小时与手动触发。
