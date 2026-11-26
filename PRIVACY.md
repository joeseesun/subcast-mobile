# SubCast 隐私政策 / Privacy Policy

更新日期 / Last updated: 2026-11-26

[中文](#中文) · [English](#english)

## 中文

SubCast（声渡）是一个播客和视频的双语字幕播放器。我们不需要你注册账号，不放广告，不接入任何广告、统计或追踪 SDK，也不出售任何数据。

### 保存在你手机上的数据

- 订阅列表、收听进度、收藏、划线、设置、下载的播客音频、字幕和 AI 生成的内容，都只存在本机。删除 App 即全部删除。
- 你填写的 API Key 保存在 iOS 钥匙串里，只发给你自己选择的服务商。

### 会连接到哪些服务

| 用途 | 发送的内容 | 接收方 |
|---|---|---|
| 订阅和收听播客 | 节目的 RSS 地址和音频请求 | 节目的托管方（各播客平台） |
| 观看 YouTube 视频 | 视频编号 | YouTube 官方嵌入播放器（适用 Google 隐私政策） |
| 读取字幕、视频简介 | 视频编号 | YouTube |
| 「乔木精读」节目 | 节目请求 | `*.qiaomu.ai` |
| 共享字幕（读取） | 单集的标识（如音频地址的摘要） | `subcast.qiaomu.ai` |
| 共享字幕（上传，可关闭） | 生成的字幕、译文和导读文本，以及一个随机安装编号；不含音频，不含任何个人信息 | `subcast.qiaomu.ai` |
| 远程配置 | 无（只下载一份签名的配置文件，不含代码） | `subcast.qiaomu.ai` |
| 语音转文字（可选） | 该集播客音频 | 你选择并填写 Key 的服务商，如豆包语音、硅基流动、Groq、DeepSeek |
| AI 导读、问答、翻译、精读（可选） | 字幕文本和你的提问 | 你选择并填写 Key 的服务商，如 DeepSeek、OpenAI、Google Gemini |
| 朗读（可选） | 要朗读的文字 | 豆包语音（火山引擎） |

可选服务只在你填写 Key 并使用相应功能时才会发送数据，它们按各自的隐私政策处理数据。

「匿名分享我生成的字幕、译文和导读」默认开启，可在 设置 › 共享 里关闭。上传的是公开节目的文字内容，用来让其他听众免去重复识别；随机安装编号仅用于防止滥用，无法关联到你本人。

### 儿童

SubCast 不面向 13 岁以下儿童，也不会有意收集儿童的信息。

### 联系

有问题请在 GitHub 提交 Issue：<https://github.com/joeseesun/subcast-mobile/issues>

## English

SubCast is a bilingual-subtitle player for podcasts and videos. There is no account, no ads, no advertising, analytics or tracking SDK, and we never sell data.

### Data kept on your phone

- Subscriptions, listening progress, favorites, highlights, settings, downloaded podcast audio, subtitles and AI-generated text stay on the device. Deleting the app deletes them.
- API keys you enter are stored in the iOS Keychain and are sent only to the provider you chose.

### Services the app connects to

| Purpose | What is sent | To whom |
|---|---|---|
| Subscribing to and playing podcasts | Feed addresses and audio requests | The podcast's host |
| Watching YouTube videos | The video ID | YouTube's official embedded player (Google's privacy policy applies) |
| Captions and video descriptions | The video ID | YouTube |
| 乔木精读 shows | Episode requests | `*.qiaomu.ai` |
| Shared subtitles (reading) | An episode identifier (e.g. a hash of the audio address) | `subcast.qiaomu.ai` |
| Shared subtitles (uploading, can be turned off) | Generated subtitles, translations and guides (text only) and a random install ID; no audio, no personal information | `subcast.qiaomu.ai` |
| Remote configuration | Nothing (a signed configuration file is downloaded; it contains no code) | `subcast.qiaomu.ai` |
| Speech-to-text (optional) | The episode's audio | The provider you chose and gave a key to, e.g. Doubao Speech, SiliconFlow, Groq, DeepSeek |
| AI guide, Q&A, translation, articles (optional) | Subtitle text and your questions | The provider you chose and gave a key to, e.g. DeepSeek, OpenAI, Google Gemini |
| Read aloud (optional) | The text being read | Doubao Speech (Volcengine) |

Optional services receive data only after you add a key and use the feature; they handle it under their own privacy policies.

Sharing is on by default and can be turned off in Settings › Sharing. What is uploaded is text about public episodes, so other listeners don't have to transcribe them again; the random install ID only guards against abuse and cannot identify you.

### Children

SubCast is not directed to children under 13 and does not knowingly collect their information.

### Contact

Open an issue on GitHub: <https://github.com/joeseesun/subcast-mobile/issues>
