// Loads YouTube's IFrame Player API once.
import { t } from "./i18n";

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

let loading: Promise<any> | null = null;

export function loadYouTube(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { loading = null; reject(new Error(t("无法加载 YouTube 播放器，请检查网络或代理"))); };
    document.head.appendChild(script);
  });
  return loading;
}
