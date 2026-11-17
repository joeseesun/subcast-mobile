# SubCast Mobile · 声渡手机版

SubCast 桌面版（`../subcast`）的 iOS / Android 版本：同一套 React 界面和 Rust 后端，用 Tauri 2 打包成手机 App。

## 和桌面版的区别

| | 桌面版 | 手机版 |
|---|---|---|
| 语音识别 | 本机 Qwen3-ASR / Whisper，或云端 | **只用云端**：DeepSeek（默认，和问答共用 Key）、豆包、硅基流动、Groq、OpenAI、智谱、阶跃… |
| AI 模型 | API Key，或本机 Claude Code / Codex 等 | **只用 API Key**（没有本机 AI 工具，也隐藏了 Ollama / LM Studio） |
| YouTube 播放 / 取音频 | yt-dlp | InnerTube 直链（iOS 客户端给 HLS，音频按 8 MB 分段下载） |
| API Key 存放 | 系统钥匙串 | iOS 钥匙串；Android 应用私有目录（`keys.json`，权限 600） |
| 界面 | 侧栏 + 三栏 | 底部标签栏；单集页上方播放器、下方「字幕 / 精读 / 导读 / 问答 / 简介」 |
| 后台播放 | — | iOS：AVAudioSession + 锁屏/控制中心；Android：前台服务 + 媒体通知 |
| 金句海报、导出 OPML | 存到「下载」 | 系统分享面板 |
| 自动更新 | Tauri updater + 界面热更新 | 走应用商店 / TestFlight（暂无热更新） |
| 快捷键、YouTube 浏览器登录导入 | 有 | 没有（文件导入 OPML / Takeout 仍可用） |

其余功能保留：订阅（YouTube / Apple Podcasts / 小宇宙 / RSS）、搜索、官方字幕、共享字幕、双语翻译（谷歌免费或自己的模型）、乔木精读与豆包朗读、AI 导读、AI 问答、收藏连播、离线下载、收听统计、四种界面语言。

## 目录

```
src/                 前端（从桌面版复制后改造；mobile.css 是手机布局）
src/components/MobileNav.tsx   底部标签栏、订阅页
src/lib/nowplaying.ts          锁屏 / 通知栏播放信息与按钮
src/lib/share.ts               系统分享
src/lib/devnav.ts              仅开发：用 public/__nav.json 驱动模拟器
src-tauri/           Rust 后端（去掉了 whisper、yt-dlp、本机 agent、更新器）
plugins/mobile/      原生插件：iOS Swift、Android Kotlin
```

## 开发

需要：Node 20+、Rust（`rustup target add aarch64-apple-ios aarch64-apple-ios-sim aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android`）、Xcode、Android SDK + NDK（`ANDROID_HOME`、`NDK_HOME`）、JDK 17+。

```bash
npm install
npm run ios        # tauri ios dev，iPhone 模拟器
npm run android    # tauri android dev，Android 模拟器
npx tauri ios build            # 真机 .ipa（需要 Apple 开发者团队，见下）
npx tauri android build --apk  # Android 安装包
```

检查：`npx tsc --noEmit -p .`、`npm run i18n -- --strict`、`cd src-tauri && cargo test --lib`。

### 开发时驱动模拟器

`npm run ios` 期间，写 `public/__nav.json` 就能让 App 跳转或执行一段脚本，WebView 的 console 输出会写进 `/tmp/subcast-webview.log`：

```bash
echo '{"n":1,"go":{"kind":"discover"}}' > public/__nav.json
echo '{"n":2,"episode":0}' > public/__nav.json     # 打开第一集
echo '{"n":3,"click":".m-ep-top .play-btn"}' > public/__nav.json
```

`n` 每次要变。只在 `vite dev` 下生效，正式包里没有。

## 发布前要做的

- iOS 签名：`src-tauri/tauri.conf.json` 里设 `bundle.iOS.developmentTeam`（或环境变量 `APPLE_DEVELOPMENT_TEAM`），然后 `npx tauri ios build --export-method app-store-connect`，上传 TestFlight。
- Android 签名：生成 keystore，在 `src-tauri/gen/android/app/build.gradle.kts` 配 `signingConfigs`（密钥不要进仓库）。
- 图标：`npx tauri icon assets/icon.png` 会生成 iOS / Android 全套尺寸。
- 应用商店审核：App 内含 YouTube 播放（官方内嵌播放器 + 直链回退），上架前要评估直链回退和离线下载 YouTube 音频是否符合商店政策，必要时在商店版里关闭这两项。

## 许可

AGPL-3.0-only，同桌面版。
