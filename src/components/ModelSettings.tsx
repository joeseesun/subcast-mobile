import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api, type Provider } from "../lib/api";
import { GROUPS } from "../lib/settings";
import { providerIcon } from "../lib/providerIcons";
import { useStore } from "../store";
import { t, tr } from "../lib/i18n";
import { SettingGroup, SettingSelect } from "./SettingRows";

function Mark({ id, name }: { id: string; name: string }) {
  const icon = providerIcon(id);
  if (icon) return <span className="ms-mark has-icon" aria-hidden dangerouslySetInnerHTML={{ __html: icon }} />;
  return <span className="ms-mark" aria-hidden>{name.trim().slice(0, 1).toUpperCase()}</span>;
}

const RECOMMENDED = ["deepseek", "siliconflow", "openrouter"];

export function ModelSettings({ ProviderEditor, editing, setEditing }: {
  ProviderEditor: (props: { p: Provider; onChange: (p: Provider) => void }) => React.ReactElement;
  editing: string | null;
  setEditing: (provider: string) => void;
}) {
  const { settings, saveSettings } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings })));
  const [more, setMore] = useState(false);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const providers = useMemo(() => Object.values(settings.providers).filter((p) => p.protocol !== "cli" && p.group !== "local"), [settings.providers]);
  const providerIds = providers.filter((p) => p.needsKey).map(({ id }) => id).join(",");
  useEffect(() => {
    if (editing) return;
    let active = true;
    void Promise.all(providerIds.split(",").filter(Boolean).map(async (id) =>
      [id, await api.hasApiKey(id).catch(() => false)] as const)).then((matches) => {
      if (active) setKeys(Object.fromEntries(matches));
    });
    return () => { active = false; };
  }, [providerIds, editing]);

  const ready = (p: Provider) => !p.needsKey || keys[p.id];
  const inUse = (id: string) => settings.chatProvider === id || settings.translateProvider === id;
  const rank = (p: Provider) => inUse(p.id) ? 0 : keys[p.id] ? 1 : RECOMMENDED.includes(p.id) ? 2 + RECOMMENDED.indexOf(p.id) : 9;
  const mine = providers.filter((p) => p.id !== "custom" && rank(p) < 9).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  const rest = providers.filter((p) => !mine.includes(p) && p.id !== "custom");
  const custom = providers.find((item) => item.id === "custom");
  const p = providers.find((item) => item.id === editing);
  const nameOf = (id: string) => {
    const provider = providers.find((item) => item.id === id);
    return provider ? tr(provider.name) : t("没有设置");
  };
  const google = settings.translateMode === "google";
  const translateName = google ? t("谷歌翻译（免费）") : nameOf(settings.translateProvider);
  const split = google || settings.chatProvider !== settings.translateProvider;
  const [advanced, setAdvanced] = useState(split);
  const choices = providers.filter(ready).map((p) => [p.id, tr(p.name)] as const);
  const withCurrent = (id: string) => choices.some(([key]) => key === id) ? choices : [[id, nameOf(id)] as const, ...choices];

  const row = (provider: Provider) => <button className="ios-setting-action provider-row" key={provider.id} onClick={() => setEditing(provider.id)}>
    <Mark id={provider.id} name={tr(provider.name)} />
    <span>{tr(provider.name)}</span>
    <small>{inUse(provider.id) ? t("默认") : keys[provider.id] ? t("已填 Key") : ""}</small>
    <ChevronRight size={16} aria-hidden />
  </button>;

  if (p) return <div className="settings-model">
    <div className="ms-head">
      <Mark id={p.id} name={tr(p.name)} />
      <div><p className="ms-title">{tr(p.name)}</p>{p.needsKey && <p className="muted small">{t("API Key 存于本机钥匙串")}</p>}</div>
    </div>
    <ProviderEditor p={p} onChange={(next) => {
      const latest = useStore.getState().settings;
      void saveSettings({ providers: { ...latest.providers, [next.id]: next }, ...(next.id === latest.chatProvider && next.model !== p.model ? { chatModel: "" } : {}) });
    }} />
  </div>;

  return <div className="settings-model">
    <SettingGroup
      title={t("当前模型")}
      footer={split ? t("问答：{a} · 字幕翻译：{b}", { a: nameOf(settings.chatProvider), b: translateName }) : undefined}
    >
      <button className="ios-setting-action" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
        {nameOf(settings.chatProvider)}<ChevronDown size={16} className={advanced ? "flip" : ""} />
      </button>
      {advanced && <>
        <SettingSelect label={t("问答和导读")} value={settings.chatProvider} options={withCurrent(settings.chatProvider)}
          onChange={(chatProvider) => void saveSettings({ chatProvider, chatModel: "", modelChosen: true })} />
        <SettingSelect label={t("字幕翻译")} value={google ? "google" : settings.translateProvider}
          options={[["google", t("谷歌翻译（免费）")], ...withCurrent(settings.translateProvider)]}
          onChange={(provider) => void saveSettings(provider === "google" ? { translateMode: "google" } : { translateMode: "auto", translateProvider: provider, modelChosen: true })} />
        {!google && <SettingSelect label={t("翻译方式")} value={settings.translateQuality} options={[["fast", t("快速")], ["best", t("精翻")]]}
          onChange={(translateQuality) => void saveSettings({ translateQuality })} />}
      </>}
    </SettingGroup>

    <SettingGroup title={t("API 模型")} footer={t("填 Key 使用，按量付费")}>
      {mine.map(row)}
      {custom && row(custom)}
      {rest.length > 0 && <button className="ios-setting-action" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? t("收起") : t("更多服务商（{n}）", { n: rest.length })}<ChevronDown size={16} className={more ? "flip" : ""} />
      </button>}
    </SettingGroup>
    {more && GROUPS.map((group) => {
      const list = rest.filter((provider) => (provider.group ?? "provider") === group.id);
      return list.length ? <SettingGroup title={t(group.name)} key={group.id}>{list.map(row)}</SettingGroup> : null;
    })}
  </div>;
}
