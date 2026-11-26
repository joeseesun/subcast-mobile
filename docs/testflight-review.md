# TestFlight external testing: what we submit

What goes into App Store Connect for Beta App Review, kept here so later submissions stay consistent.
Builds for review are the store edition (`scripts/testflight.sh`, see `src/lib/edition.ts`).

## Test information (per language)

**Privacy Policy URL:** https://github.com/joeseesun/subcast-mobile/blob/main/PRIVACY.md
**Marketing URL:** https://github.com/joeseesun/subcast-mobile

### Beta App Description — English (en-US)

SubCast is a podcast player with bilingual (Chinese–English) subtitles. Subscribe to any podcast by RSS or by
search, play it with subtitles that follow along, read a structured guide or a long-form article written from the
episode, save the lines you like, and ask questions about an episode. YouTube channels can be followed too; their
videos play in YouTube's official player. AI features are optional and use the listener's own API key.

### Beta App Description — 简体中文 (zh-Hans)

声渡（SubCast）是一个带中英双语字幕的播客播放器。可以通过 RSS 或搜索订阅任何播客，边听边看跟随播放的字幕，阅读根据单集整理的导读和长文精读，划线保存喜欢的句子，还可以就一期节目提问。也可以关注 YouTube 频道，视频在 YouTube 官方播放器里播放。AI 功能都是可选的，使用听众自己的 API Key。

## What to Test (build notes)

**English:** Subscribe to a podcast from Discover, play an episode and check the bilingual subtitles, the 导读
(guide) and 精读 (article) tabs, highlights (划线), offline downloads of podcast audio, and the listening stats.
Please report anything that doesn't play.

**简体中文：** 在「发现」里订阅一个播客，播放一集，看看双语字幕、导读和精读是否正常；试试划线、离线下载播客音频和收听统计。遇到播放不了的节目请反馈给我们。

## Beta App Review information

- Sign-in required: **No** (the app has no accounts).
- Contact: the account holder (name, phone, email filled in App Store Connect, not stored here).

### Notes for the reviewer (English)

```
SubCast is a podcast client. No account or sign-in is needed.

Quick tour without any setup:
1. Open the "发现" (Discover) tab and tap "词元之外 Next Token". Open any episode.
2. Tap play. The "字幕" (Subtitles) tab shows subtitles following the audio (this show is in Chinese;
   English shows get Chinese–English subtitles).
3. The "导读" (Guide) and "精读" (Article) tabs show a guide and a long-form article for the episode.

Content and rights:
- Podcast audio comes from each show's public RSS feed (the publisher's own enclosure URLs), as in any podcast
  app. Offline downloads apply to these RSS episodes only.
- YouTube videos play only in YouTube's official embedded player (IFrame Player API). The app does not download,
  convert or save YouTube media, and does not extract YouTube streams.
- Subtitles come from the publisher (podcast transcripts, YouTube captions), from shared subtitles other
  listeners generated, or from a speech-to-text service the user chooses with their own API key.

Optional AI features (transcription, translation, Q&A, read-aloud) need the user's own API key for a provider
they choose (e.g. DeepSeek, OpenAI, Doubao). Keys are stored in the iOS Keychain and sent only to that provider.
These features are not required to use the app.

Privacy: no ads, no analytics or tracking SDKs, no data sold. Details:
https://github.com/joeseesun/subcast-mobile/blob/main/PRIVACY.md
```
