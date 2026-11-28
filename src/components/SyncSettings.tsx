// Cross-device sync settings inside Settings › 通用: iCloud Drive and WebDAV.
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Check, Cloud, FolderOpen, Globe, Loader2, RefreshCw } from "lucide-react";
import { api, errorText, type BackendSyncSummary, type ICloudStatus } from "../lib/api";
import { IS_MAC, t, tr } from "../lib/i18n";
import { DEFAULT_SYNC, type SyncSettings as SyncCfg } from "../lib/settings";
import { useSyncState } from "../lib/sync";
import { useStore } from "../store";
import { KeyRow, SettingGroup, SettingsSwitch, SettingText } from "./SettingRows";

const WEBDAV_ACCOUNT = "sync.webdav";

const WEBDAV_PRESETS: { id: string; label: string; url: string }[] = [
  { id: "jianguoyun", label: "坚果云", url: "https://dav.jianguoyun.com/dav/" }, // i18n-ignore
  { id: "nextcloud", label: "Nextcloud", url: "https://your-server/remote.php/dav/files/username/" },
  { id: "infinicloud", label: "InfiniCLOUD", url: "https://your-host.teracloud.jp/dav/" },
];

function formatSyncTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return t("刚刚");
  if (diff < 3_600_000) return t("{n} 分钟前", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("{n} 小时前", { n: Math.floor(diff / 3_600_000) });
  return new Date(ms).toLocaleDateString();
}

function SyncSummaryLine({ summary }: { summary?: BackendSyncSummary | null }) {
  if (!summary) return null;
  if (summary.error) {
    return <p className="sync-status-line error-text small">{t("上次同步失败：{err}", { err: tr(summary.error) })}</p>;
  }
  const parts: string[] = [];
  if (summary.addedShows > 0) parts.push(t("新增 {n} 个订阅", { n: summary.addedShows }));
  if (summary.removedShows > 0) parts.push(t("移除 {n} 个订阅", { n: summary.removedShows }));
  if (summary.updatedEpisodes > 0) parts.push(t("更新 {n} 集进度", { n: summary.updatedEpisodes }));
  if ((summary.updatedContent ?? 0) > 0) parts.push(t("更新 {n} 集导读/问答", { n: summary.updatedContent }));
  const detail = parts.length ? ` · ${parts.join(" · ")}` : summary.uploaded ? ` · ${t("已上传到云端")}` : "";
  return (
    <p className="sync-status-line muted small">
      <Check size={12} className="ok-text" /> {t("上次同步：{time}", { time: formatSyncTime(summary.syncedAt) })}{detail}
    </p>
  );
}

export function SyncSettings() {
  const { settings, saveSettings, notify } = useStore(useShallow((s) => ({
    settings: s.settings,
    saveSettings: s.saveSettings,
    notify: s.notify,
  })));
  const { busy, status, refreshStatus, run } = useSyncState(useShallow((s) => ({
    busy: s.busy,
    status: s.status,
    refreshStatus: s.refreshStatus,
    run: s.run,
  })));
  const sync: SyncCfg = { ...DEFAULT_SYNC, ...(settings.sync ?? {}) };
  const [tab, setTab] = useState<"icloud" | "webdav">(() =>
    sync.webdavEnabled && !sync.icloudEnabled ? "webdav" : IS_MAC ? "icloud" : "webdav",
  );

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const patchSync = (patch: Partial<SyncCfg>) =>
    saveSettings({ sync: { ...sync, ...patch } });

  const icloud = status?.icloud;
  const icloudBadge = !icloud
    ? ""
    : !icloud.available
      ? t("不可用")
      : sync.icloudEnabled
        ? t("已开启")
        : t("未开启");
  const webdavBadge = sync.webdavEnabled ? t("已开启") : t("未开启");

  return (
    <>
      <SettingGroup
        title={t("跨设备同步（与桌面版互通）")}
        footer={t("在手机与电脑之间同步订阅列表、自定义节目名、播放进度以及导读、精读与问答。")}
      >
        <div className="sync-panel-wrap">
          <div className="engine-switch sync-cards">
            <button
              type="button"
              className={`engine ${tab === "icloud" ? "on" : ""}`}
              onClick={() => setTab("icloud")}
            >
              <Cloud size={18} />
              <div>
                <p className="sync-card-title">
                  <span>{t("iCloud 云盘")}</span>
                  {icloudBadge && <span className={`sync-badge ${sync.icloudEnabled && icloud?.available ? "on" : ""}`}>{icloudBadge}</span>}
                </p>
                <p className="muted small">{t("适合 Mac 与 iPhone / iPad")}</p>
              </div>
            </button>
            <button
              type="button"
              className={`engine ${tab === "webdav" ? "on" : ""}`}
              onClick={() => setTab("webdav")}
            >
              <Globe size={18} />
              <div>
                <p className="sync-card-title">
                  <span>WebDAV</span>
                  <span className={`sync-badge ${sync.webdavEnabled ? "on" : ""}`}>{webdavBadge}</span>
                </p>
                <p className="muted small">{t("坚果云、Nextcloud 等，全平台互通")}</p>
              </div>
            </button>
          </div>
        </div>

        {tab === "icloud" ? (
          <ICloudPanel
            sync={sync}
            icloud={icloud}
            lastSummary={status?.lastIcloud}
            busy={busy != null}
            onPatch={patchSync}
            onRefreshStatus={refreshStatus}
            onSync={() => void run("icloud")}
            onNotify={notify}
          />
        ) : (
          <WebdavPanel
            sync={sync}
            lastSummary={status?.lastWebdav}
            busy={busy != null}
            onPatch={patchSync}
            onSync={() => void run("webdav")}
          />
        )}
      </SettingGroup>

      <SettingGroup>
        <SettingsSwitch
          label={t("同时同步播放进度与已看状态")}
          value={sync.syncProgress}
          onChange={(syncProgress) => void patchSync({ syncProgress })}
        />
        <SettingsSwitch
          label={t("同时同步导读、精读与问答")}
          value={sync.syncContent}
          onChange={(syncContent) => void patchSync({ syncContent })}
        />
        <SettingsSwitch
          label={t("启动、切回前台或内容变更时自动同步")}
          value={sync.autoSync}
          onChange={(autoSync) => void patchSync({ autoSync })}
        />
      </SettingGroup>
    </>
  );
}

function ICloudPanel({
  sync,
  icloud,
  lastSummary,
  busy,
  onPatch,
  onRefreshStatus,
  onSync,
  onNotify,
}: {
  sync: SyncCfg;
  icloud?: ICloudStatus;
  lastSummary?: BackendSyncSummary | null;
  busy: boolean;
  onPatch: (patch: Partial<SyncCfg>) => Promise<void>;
  onRefreshStatus: () => Promise<unknown>;
  onSync: () => void;
  onNotify: (msg: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  if (!IS_MAC) {
    return (
      <div className="sync-panel-wrap">
        <p className="muted small">{t("iCloud 云盘仅支持 iPhone / iPad 与 Mac；安卓请使用 WebDAV 与桌面版互通。")}</p>
      </div>
    );
  }

  const pickFolder = async () => {
    setPicking(true);
    try {
      const next = await api.syncIcloudPickFolder();
      if (next) await onRefreshStatus();
    } catch (e) {
      onNotify(errorText(e));
    } finally {
      setPicking(false);
    }
  };

  const clearFolder = async () => {
    try {
      await api.syncIcloudClearFolder();
      await onRefreshStatus();
    } catch (e) {
      onNotify(errorText(e));
    }
  };

  const isContainer = icloud?.mode === "container";
  const canSync = !!icloud?.available && (isContainer || !!icloud?.configured);

  return (
    <>
      <SettingsSwitch
        label={t("开启 iCloud 云盘同步")}
        value={sync.icloudEnabled}
        onChange={(icloudEnabled) => void onPatch({ icloudEnabled })}
      />
      {icloud && !icloud.available ? (
        <div className="sync-panel-wrap">
          <p className="muted small">
            {t("未检测到 iCloud 云盘，请在系统「设置 › Apple 账号 › iCloud › 云盘」开启「同步此 iPhone」。")}
          </p>
        </div>
      ) : isContainer ? (
        <div className="sync-panel-wrap">
          <p className="muted small">
            {t("已连接原生 iCloud 容器（SubCast），开启开关即可自动与 Mac 同步。")}
          </p>
          <SyncSummaryLine summary={lastSummary} />
          <div className="row-actions">
            <button
              type="button"
              className="btn sm primary"
              disabled={busy || !canSync}
              onClick={onSync}
            >
              {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {t("立即同步")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="ios-setting-action" disabled={picking || busy} onClick={() => void pickFolder()}>
            <FolderOpen size={18} />
            <span className="sync-folder-label">
              {icloud?.configured
                ? t("同步文件夹：{name}", { name: icloud.path || t("默认 iCloud 目录") })
                : t("选择 iCloud 同步文件夹…")}
            </span>
            {picking && <Loader2 size={15} className="spin" />}
          </button>
          <div className="sync-panel-wrap">
            <p className="muted small">
              {t("请选择 iCloud 云盘里的「SubCast」文件夹（与桌面版同一个文件夹）即可自动互通。")}
            </p>
            <SyncSummaryLine summary={lastSummary} />
            <div className="row-actions">
              <button
                type="button"
                className="btn sm primary"
                disabled={busy || !canSync}
                onClick={onSync}
              >
                {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {t("立即同步")}
              </button>
              {icloud?.mode === "folder" && (
                <button type="button" className="btn ghost sm" disabled={busy || picking} onClick={() => void clearFolder()}>
                  {t("重选文件夹")}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function WebdavPanel({
  sync,
  lastSummary,
  busy,
  onPatch,
  onSync,
}: {
  sync: SyncCfg;
  lastSummary?: BackendSyncSummary | null;
  busy: boolean;
  onPatch: (patch: Partial<SyncCfg>) => Promise<void>;
  onSync: () => void;
}) {
  const [password, setPassword] = useState("");
  const [hasPass, setHasPass] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void api.hasApiKey(WEBDAV_ACCOUNT).then(setHasPass).catch(() => setHasPass(false));
  }, []);

  const savePass = async () => {
    await api.setApiKey(WEBDAV_ACCOUNT, password.trim());
    setHasPass(!!password.trim());
    setPassword("");
  };

  const testConn = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      if (password.trim()) await savePass();
      const msg = await api.syncWebdavTest(sync.webdavUrl, sync.webdavPath, sync.webdavUsername);
      setTestMsg({ ok: true, text: tr(msg) });
    } catch (e) {
      setTestMsg({ ok: false, text: errorText(e) });
    } finally {
      setTesting(false);
    }
  };

  const syncNow = async () => {
    setTestMsg(null);
    if (password.trim()) await savePass();
    onSync();
  };

  const isJianguoyun = sync.webdavUrl.toLowerCase().includes("jianguoyun.com");

  return (
    <>
      <SettingsSwitch
        label={t("开启 WebDAV 同步")}
        value={sync.webdavEnabled}
        onChange={(webdavEnabled) => void onPatch({ webdavEnabled })}
      />
      <div className="sync-panel-wrap">
        <div className="model-chips">
          {WEBDAV_PRESETS.map((p) => {
            const active = sync.webdavUrl.trim() === p.url;
            return (
              <button
                key={p.id}
                type="button"
                className={`chip sm ${active ? "on" : ""}`}
                onClick={() => { setTestMsg(null); void onPatch({ webdavUrl: p.url }); }}
              >
                {p.id === "jianguoyun" ? t("坚果云") : p.label}
              </button>
            );
          })}
        </div>
        {isJianguoyun && (
          <p className="muted small">{t("坚果云请在网页端「账户信息 › 安全选项」生成第三方应用密码，不要填登录密码。")}</p>
        )}
      </div>
      <SettingText
        label={t("服务器地址")}
        type="url"
        value={sync.webdavUrl}
        placeholder="https://dav.jianguoyun.com/dav/"
        onCommit={(webdavUrl) => void onPatch({ webdavUrl })}
      />
      <SettingText
        label={t("同步目录")}
        value={sync.webdavPath}
        placeholder="/SubCast"
        onCommit={(webdavPath) => void onPatch({ webdavPath: webdavPath || "/SubCast" })}
      />
      <SettingText
        label={t("用户名")}
        value={sync.webdavUsername}
        placeholder={t("邮箱或账号")}
        onCommit={(webdavUsername) => void onPatch({ webdavUsername })}
      />
      <div className="ios-setting-field">
        <span className="small muted">{t("密码")}</span>
        <KeyRow
          has={hasPass}
          value={password}
          onValue={setPassword}
          placeholder={t("输入密码或应用密码")}
          onSave={savePass}
          onDelete={async () => {
            await api.setApiKey(WEBDAV_ACCOUNT, "");
            setHasPass(false);
          }}
        />
      </div>
      <div className="sync-panel-wrap">
        <SyncSummaryLine summary={lastSummary} />
        <div className="row-actions">
          <button type="button" className="btn sm" disabled={testing || busy} onClick={() => void testConn()}>
            {testing && <Loader2 size={13} className="spin" />} {t("测试连接")}
          </button>
          <button type="button" className="btn sm primary" disabled={busy || testing} onClick={() => void syncNow()}>
            {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {t("立即同步")}
          </button>
          {testMsg && <span className={testMsg.ok ? "ok-text small" : "error-text small"}>{testMsg.text}</span>}
        </div>
      </div>
    </>
  );
}
