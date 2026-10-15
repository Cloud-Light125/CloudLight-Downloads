# GitHub Releases 同步配置

## 状态与人工配置

Cloud-Light125/CloudLight-Downloads 已创建并确认为 Public，本目录代码使用 main 分支。PENDING_MANUAL：配置下述来源只读 Secret 后，首次手动运行同步工作流。不要上传任何私有源码、本地 inventory、日志或含路径的 plans。

公开文件包括 sources.json 中的软件仓库名称，这是明确的同步白名单；不会复制这些仓库的源码和私有 Release 正文。displayName 仅用于目标 Release 标题，不是第二份网站 Catalog。

## 来源仓库

| Catalog ID | 已核实来源仓库 |
|---|---|
| `cloudlight-wechat` | `Cloud-Light125/CloudLight-WeChat` |
| `cloudlight-startup` | `Cloud-Light125/CloudLight-Startup` |
| `cloudlight-blizzard` | `Cloud-Light125/CloudLight-Blizzard` |
| `cloudlight-video-compressor` | `Cloud-Light125/CloudLight-Video-Compressor` |
| `cloudlight-automator` | `Cloud-Light125/cloudlight-automator` |
| `cloudlight-codex-bridge` | `Cloud-Light125/Codex-Bridge` |
| `cloudlight-xiaomi` | `Cloud-Light125/CloudLight-XiaoMi` |
| `twitter-x-media-renamer` | `Cloud-Light125/TwitterXMediaRenamer` |
| `heybox-post-exporter` | `Cloud-Light125/HeyboxPostExporter` |
| `cloudlight-overwatch-youtube-watcher` | `Cloud-Light125/CloudLight-Overwatch-YouTube-Watcher` |
| `cloudlight-soop-drops-miner` | `Cloud-Light125/cloudlight-soop-drops-miner` |
| `microsoft-pinyin-cleaner` | `Cloud-Light125/MicrosoftPinyinCleaner` |
| `power-settings-manager` | `Cloud-Light125/PowerSettingsManager` |
| `mobile-hotspot-controller` | `Cloud-Light125/MobileHotspotController` |
| `tdm-claim-toggle-patcher` | `Cloud-Light125/tdm-claim-toggle-patcher` |

以上名称与附件命名已于 2026-10-15 通过现有 gh 认证的只读 REST 查询核实，未执行任何上传。映射取自原链接审计。具体附件规则见 config/sources.json，依据真实 Release 附件和既有本地构建证据：Setup、Portable 或已确认的独立用户程序；不镜像 Symbols、Service、Agent、manifest、日志或源码包。Twitter 仅选择明确 win-x64 ZIP；YouTube 仅选择明确 x64 Setup。未知新命名会跳过并报告，不会放宽为全部 EXE/ZIP。

WeChat（Windows/macOS）、SOOP、MobileHotspotController 和 TDM patcher 的部分附件缺少可靠 CPU 架构证据，当前显式标为 unknown，网站显示“架构未确认”；这不宣称某种架构已提供。核实构建产物后可调整对应规则。增加软件先在网站 Catalog 建立身份/页面，再增加一个来源配置；发新版本无需改 Catalog。

## Token 与权限

1. GitHub 右上头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
2. Resource owner: Cloud-Light125。Repository access: Only select repositories，仅选择 sources.json 中需要读取的私有软件仓库；公开的 WeChat/Blizzard无需额外扩大私有仓库范围。
3. Repository permissions: Contents: Read-only（Metadata 会自动获得）；不授予任何源仓库写权限。设置合理过期日期并妥善保存。
4. 公开仓库 Settings → Secrets and variables → Actions → New repository secret：名称 SOURCE_RELEASES_READ_TOKEN。
5. Settings → Actions → General：允许本仓库使用 GitHub Actions；工作流声明 contents: write。组织/账户策略与分支保护仍可能限制自动提交，请按实际策略允许此仓库机器人更新 data/releases.json。无需授予它私有仓库写权限。

目标仓库的发布与索引提交使用本次运行的 GITHUB_TOKEN。普通 GITHUB_TOKEN 不能读取其它私有仓库；源 Token 仅传入同步步骤。没有 pull_request 触发器，源码 Token 不用于 checkout/push，不输出 Token。请仅允许可信维护者修改默认分支上的同步代码。

## 首次同步与后续自动化

在 Actions → Sync releases → Run workflow → main 手动运行。之后 cron 为 UTC 00:23、06:23、12:23、18:23（每六小时）；GitHub 调度可能延迟。concurrency 串行化同步，避免同时创建同一版本。

GET /repos/{owner}/{repo}/releases 分页发现已 Published 版本，跳过 Draft，按源 published_at 排序，默认包含 RC/Beta/Alpha。stable-only 仅影响该项目。没有准确日期会报错；最新版本无合格安装包会阻塞，不把旧版伪装为新发布。

sourcePrerelease 保留源API原值，prerelease记录面向公众的有效预发布状态；版本中 rc/beta/alpha 也阻止误标 Stable。其它 prerelease 标为 unknown 并保留 prerelease=true。Stable 表示源 Release 发布分类，不代表额外系统验收或安全背书。

默认首次只镜像每个项目的最新已发布版本，不批量搬迁全部历史文件。已镜像历史在目标 Release 与索引中持续保留；要迁移本地历史，逐个明确选择 import:local。

## 文件验证与恢复

Tag 通常为 projectId--原始Tag，例如 cloudlight-startup--v1.0.1。特殊原始 Tag 经安全片段+SHA-256摘要生成确定且无碰撞的命名；不使用公开仓库的全局 releases/latest。

新版本先建立 Draft，make_latest 为 false。下载真实字节到本任务专用临时目录，流式计算大小和 SHA-256；若源 API 给出 sha256 digest 必须匹配。不把 ETag 当校验值。只接受小于 2 GiB 的文件，不切割超限文件。

所有允许的安装包上传/验证完成后，上传 cloudlight-release.json 校验 manifest，再公开 Release。发布前只生成中性公开说明，不复制私有正文。索引 URL 来自目标 API 的 browser_download_url。确认 Release 可由未认证请求读取后才收录索引。

目标 API 若给出 SHA-256 digest，比较目标 digest 与实际源字节的哈希；否则流式重新下载目标并计算哈希（会增加带宽），绝不靠 ETag 推断。实际公开 URL 浏览器下载链路仍需首次人工抽样验证。

同版本同名同哈希跳过；已有且缺失的目标附件可补传；同名不同内容拒绝，不覆盖/删除。manifest 记录资产集合，已发布集合与渠道/日期的修改视为冲突；要变更发布内容应创建新源 Tag。发布不完整的 Draft 不进入索引。失败后保留目标附件重试，任务只清理自己 mkdtemp 产生的临时目录。

若公开 Release 已发布但本地索引写入/提交失败，再运行 sync 或 build:index；从目标 manifest 与实际附件重建，无需重复上传。已公开版本若缺少 manifest、附件冲突或历史被删除，会明确失败并保留旧索引。修复对应 Release 后重试。索引采用临时文件+rename；没有版本变化不刷新 generatedAt，不制造空提交。

GitHub上传失败有时留下state=starter且size=0的占位附件；仅在本工具对应Draft中、且名称为明确允许的安装包或校验manifest时，重试可删除这个未完成占位再上传。已公开附件、已上传的非零附件与历史版本一律不删除。上传超时不自动重复 POST；下次通过目标 API 对账后恢复。读取有有限重试与超时；私有附件的 API 302 跳转不会把 Authorization 转发给签名下载主机。401/403 提示认证/权限/限流；404 明确可能是缺权限，也可能资源不存在；不能单凭404认定源仓库已删除。错误汇总含项目和失败阶段。

## 本地手动迁移（可选）

网站 .downloads/local-installers.json/.md 和全部 50 个 plans 保持原样；不重新扫描/复制约6GB安装包。计划内旧 key/url 均为弃用的预期地址，导入器完全忽略它们。

~~~powershell
Set-Location -LiteralPath 'D:\code\CloudLight-Downloads'
# 只复核这一份计划的真实文件、版本、平台、大小和 SHA-256，不发布：
npm run import:local -- --plan 'D:\code\website\269332-site\.downloads\plans\cloudlight-startup-1.0.1.json'
# 确认该版本允许公开分发、日期和渠道真实后，用户再显式发布：
npm run import:local -- --plan 'D:\code\website\269332-site\.downloads\plans\cloudlight-startup-1.0.1.json' --published-at '已核实的ISO8601发布时间' --publish
~~~

unknown 渠道必须先核实，必要时 --channel stable/rc/beta/alpha；RC 标签不能改成 stable。无版本/架构依据的候选文件不能随意补成计划。旧计划 publishedAt 是拟首次 R2 迁移日期，导入器完全忽略它；真实上传必须明确传入 --published-at 的 ISO8601 时间。若首次公开该本地版本，可由用户选定当前公开发布时间；重试必须复用相同时间，不应将文件修改时间冒充源发布时间。上面占位字符串需替换成真实时间。重新计算哈希若与旧计划不符即拒绝；必须先重新审查真实构建产物，不能直接忽略冲突。

本地发布只需要目标 GITHUB_TOKEN（细粒度、仅公开目标仓库 Contents: write），不需要源只读 Token。通过当前 PowerShell 进程环境设置，避免写进命令历史中的真实值，建议由密码管理器/安全输入注入；脚本不自动读取密钥文件。可使用 node --env-file=本机私有文件 scripts/import-local.mjs ...，但该文件必须在仓库外或受 .gitignore 保护。不要将 Token 写进计划、配置、Git 或网站环境变量。

本地命令 GitHub 网络可在该 PowerShell 进程设置 HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7897，Node24 设置 NODE_USE_ENV_PROXY=1；关闭会话即还原。不要把个人代理写入仓库或永久系统设置。

本地导入后 data/releases.json 只在本地更新，用户必须检查并提交/推送到 main，网站才能读取新索引。Actions 自动流程会自行提交有变化的索引。

## 网站读取与检验

网站配置 src/data/download-source.json 默认指向 https://raw.githubusercontent.com/Cloud-Light125/CloudLight-Downloads/main/data/releases.json。每个下载页面一次跨域 fetch，无 Token，不调用各软件 Release API。初次部署网站代码后，后续每次软件发版只刷新索引，不重部署 Astro。缓存可能带来数分钟延迟。

2026-10-15 的浏览器实测：该预期 URL 为 HTTP404，但 CORS 可读取。不能据此宣称真实 JSON 已上线。创建并推送后请重新确认200、JSON解析、15项目索引及实际附件下载。未来可以将配置改成已启用的 GitHub Pages JSON地址；本轮不要求启用 Pages。

索引只含公开必要字段：schemaVersion/generatedAt/projects/latestVersion/releases，版本含 sourceTag/tag/channel/prerelease/sourcePrerelease/publishedAt；附件含 name/size/sha256/platform/arch/downloadUrl。无私有路径、正文、凭据或日志。发布历史每个项目独立按源发布时间排序。

~~~powershell
npm run validate
npm test
npm run verify -- --remote
Get-FileHash -Algorithm SHA256 -LiteralPath '明确下载的安装包路径'
~~~

将抽样下载的真实 SHA-256 与索引比较。不要运行安装程序来做同步测试。GitHub Releases 由 GitHub 提供文件服务，不通过网站代理或提交进 dist。

## 计划任务被停用

公开仓库长期无活动，计划任务可能在60天后自动停用。进入 Actions → Sync releases → Enable workflow（如界面展示停用提示），再 Run workflow；也可 gh workflow enable sync-releases.yml --repo Cloud-Light125/CloudLight-Downloads。不要为保活制造空提交。

官方依据：[Release API](https://docs.github.com/en/rest/releases/releases)、[Release Asset API](https://docs.github.com/en/rest/releases/assets)、[计划任务与60天停用](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
