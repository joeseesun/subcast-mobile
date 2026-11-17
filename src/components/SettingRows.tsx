import { useEffect, useId, useState } from "react";
import { Check, ChevronsUpDown, Trash2 } from "lucide-react";
import { api, errorText } from "../lib/api";
import { ask } from "../lib/confirm";
import { t } from "../lib/i18n";

export const NO_AUTO = { autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const;

export function SettingsSwitch({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <label className="check"><input type="checkbox" role="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function SettingGroup({ title, children, footer }: { title?: string; children: React.ReactNode; footer?: string }) {
  return <section className="ios-setting-group">
    {title && <h2>{title}</h2>}
    <div className="ios-setting-rows">{children}</div>
    {footer && <p className="settings-footnote">{footer}</p>}
  </section>;
}

export function SettingSelect<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  return <label className="ios-setting-row">
    <span>{label}</span>
    <select value={value} onChange={(event) => {
      const selected = options.find(([id]) => String(id) === event.target.value);
      if (selected) onChange(selected[0]);
    }}>
      {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
    <ChevronsUpDown className="select-hint" size={15} aria-hidden />
  </label>;
}

export function SettingText({ label, value, onCommit, placeholder, type = "text" }: {
  label: string; value: string; onCommit: (value: string) => void; placeholder?: string; type?: "url" | "text";
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <label className="ios-setting-field" htmlFor={id}>
    <span>{label}</span>
    <input id={id} type={type} value={draft} placeholder={placeholder} autoCapitalize="off" autoCorrect="off" spellCheck={false}
      enterKeyHint="done" onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { if (draft.trim() !== value) onCommit(draft.trim()); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
  </label>;
}

export function KeyField({ account, placeholder }: { account: string; placeholder?: string }) {
  const [key, setKey] = useState("");
  const [has, setHas] = useState(false);
  useEffect(() => { setKey(""); api.hasApiKey(account).then(setHas).catch(() => setHas(false)); }, [account]);
  return <KeyRow key={account} has={has} value={key} onValue={setKey} placeholder={placeholder}
    onSave={async () => { await api.setApiKey(account, key); setHas(!!key.trim()); setKey(""); }}
    onDelete={async () => { await api.setApiKey(account, ""); setHas(false); }} />;
}

/** A saved key reads as saved (a tinted row with a check and masked dots), not as an empty field;
 *  「更换」 opens the field again. */
export function KeyRow({ has, value, onValue, onSave, onDelete, placeholder }: { has: boolean; value: string; onValue: (v: string) => void; onSave: () => Promise<void>; onDelete: () => Promise<void>; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setPending(true);
    try { await onSave(); setEditing(false); }
    catch (e) { setError(errorText(e)); }
    finally { setPending(false); }
  };
  if (has && !editing) {
    return (
      <div className="key-row key-saved" title={t("存于系统钥匙串")}>
        <span className="key-state"><Check size={14} /><span>{t("已保存")}</span><span className="key-dots" aria-hidden>••••••••</span></span>
        <button className="btn sm" onClick={() => setEditing(true)}>{t("更换")}</button>
        <button className="icon-btn" aria-label={t("删除 Key")} onClick={async () => {
          if (await ask({ title: t("删除 Key"), ok: t("删除"), danger: true })) await onDelete();
        }}><Trash2 size={18} /></button>
      </div>
    );
  }
  return (
    <div>
      <div className="key-row">
        <input {...NO_AUTO} type="password" autoFocus={editing} value={value} onChange={(e) => { onValue(e.target.value); setError(""); }}
          aria-label="API Key" placeholder={placeholder ?? t("粘贴 API Key")} />
        <button className="btn sm" onClick={save} disabled={pending || !value.trim()}>{t("保存")}</button>
        {has && <button className="btn ghost sm" onClick={() => { onValue(""); setError(""); setEditing(false); }}>{t("取消")}</button>}
      </div>
      {error && <p className="error-text small" role="status">{error}</p>}
    </div>
  );
}
