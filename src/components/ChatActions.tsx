// Actions on Q&A messages (copy three ways, retry, edit, delete) and the conversation history sheet.
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, History, Pencil, RefreshCw, Trash2, Download } from "lucide-react";
import type { ChatMessage, Episode } from "../lib/api";
import { date } from "../lib/format";
import { t } from "../lib/i18n";
import { showName } from "../lib/picks";
import { selectionFeedback } from "../lib/feedback";
import { useStore } from "../store";
import { MobileSheet } from "./MobileSheet";

export interface ArchivedChat { id: string; at: number; messages: ChatMessage[] }

const STAMP = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
const RANGE_OR_STAMP = /\s*\[\d{1,2}:\d{2}(?::\d{2})?\](?:\s*[-–~至]\s*\[\d{1,2}:\d{2}(?::\d{2})?\])?/g;
const secs = (c: string) => c.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);

/** Markdown answer → text that pastes cleanly into chat apps and notes. */
function plain(md: string): string {
  return md
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type CopyKind = "stamps" | "plain" | "markdown";

export function copyText(md: string, kind: CopyKind, ep: Episode): string {
  if (kind === "plain") return plain(md.replace(RANGE_OR_STAMP, "")).replace(/[ \t]+([，。；、,.;])/g, "$1");
  if (kind === "stamps") return plain(md);
  // Markdown with a source line; on a video episode each timestamp links to that moment on YouTube.
  const body = ep.videoId ? md.replace(STAMP, (_, c: string) => `[${c}](https://youtu.be/${ep.videoId}?t=${secs(c)})`) : md;
  const src = ep.videoId ? `https://youtu.be/${ep.videoId}` : ep.link;
  const show = ep.showTitle ? `${showName(ep.showTitle)} · ` : "";
  return `${body.trim()}\n\n${t("来源：")}${show}${ep.title}${src ? `\n${src}` : ""}`;
}

async function toClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); useStore.getState().notify(t("已复制")); }
  catch { useStore.getState().notify(t("复制失败，请重试")); }
}

function Act({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className="msg-act" title={label} aria-label={label} onClick={onClick}>{icon}</button>;
}

/** Copy button with a mobile sheet for copy variants: with timestamps, without, or Markdown with source. */
function CopyMenu({ text, ep }: { text: string; ep: Episode }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const copy = (kind: CopyKind) => {
    setOpen(false);
    selectionFeedback();
    void toClipboard(copyText(text, kind, ep));
    setDone(true);
    window.setTimeout(() => setDone(false), 1400);
  };
  return (
    <div className="msg-copy">
      <button type="button" className="msg-act" title={t("复制（带时间戳）")} aria-label={t("复制（带时间戳）")} onClick={() => copy("stamps")}>{done ? <Check size={15} /> : <Copy size={15} />}</button>
      <button type="button" className="msg-act caret" title={t("更多复制方式")} aria-label={t("更多复制方式")} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><ChevronDown size={13} /></button>
      {open && (
        <MobileSheet title={t("更多复制方式")} onClose={() => setOpen(false)}>
          <button onClick={() => copy("stamps")}><Copy size={18} /><span>{t("复制，保留时间戳")}</span></button>
          <button onClick={() => copy("plain")}><Copy size={18} /><span>{t("复制，去掉时间戳")}</span></button>
          <button onClick={() => copy("markdown")}><Copy size={18} /><span>{ep.videoId ? t("复制为 Markdown，时间戳链到 YouTube") : t("复制为 Markdown，附出处")}</span></button>
        </MobileSheet>
      )}
    </div>
  );
}

export function AnswerActions({ text, ep, onRetry, onDelete }: { text: string; ep: Episode; model?: string; onRetry?: () => void; onDelete: () => void }) {
  return (
    <div className="msg-actions">
      <CopyMenu text={text} ep={ep} />
      {onRetry && <Act icon={<RefreshCw size={15} />} label={t("重新回答")} onClick={onRetry} />}
      <Act icon={<Trash2 size={15} />} label={t("删除这一问一答")} onClick={onDelete} />
    </div>
  );
}

export function QuestionActions({ text, onEdit, onDelete }: { text: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="msg-actions user">
      <Act icon={<Copy size={14} />} label={t("复制")} onClick={() => void toClipboard(text)} />
      <Act icon={<Pencil size={14} />} label={t("编辑后重新提问")} onClick={onEdit} />
      <Act icon={<Trash2 size={14} />} label={t("删除这一问一答")} onClick={onDelete} />
    </div>
  );
}

export function exportChat(messages: ChatMessage[], ep: Episode): string {
  const head = `# ${ep.title}\n`;
  const body = messages.map((m) => (m.role === "user" ? `**${t("问")}：**${m.content}` : copyText(m.content, "markdown", ep).split(`\n\n${t("来源：")}`)[0])).join("\n\n");
  return `${head}\n${body}\n\n${t("来源：")}${ep.showTitle ? `${showName(ep.showTitle)} · ` : ""}${ep.title}${ep.videoId ? `\nhttps://youtu.be/${ep.videoId}` : ep.link ? `\n${ep.link}` : ""}`;
}

/** Earlier conversations about this episode: restore, copy the current one, or delete. */
export function HistoryMenu({ archive, ep, current, onRestore, onDelete }: { archive: ArchivedChat[]; ep: Episode; current: ChatMessage[]; onRestore: (id: string) => void; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!archive.length && !current.length) return null;
  const titleOf = (m: ChatMessage[]) => m.find((x) => x.role === "user")?.content.slice(0, 40) ?? t("空对话");
  return (
    <div className="mp">
      <button type="button" className="icon-btn sm" title={t("对话历史")} aria-label={t("对话历史")} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><History size={18} /></button>
      {open && (
        <MobileSheet title={t("这一集的对话")} onClose={() => setOpen(false)} className="history-sheet">
          {!archive.length && <p className="sheet-status">{t("点「新对话」后，之前的对话会保存在这里")}</p>}
          {archive.map((c) => (
            <div key={c.id} className="hist-sheet-row">
              <button type="button" className="hist-sheet-open" onClick={() => { setOpen(false); selectionFeedback(); onRestore(c.id); }}>
                <span className="hist-title clamp1">{titleOf(c.messages)}</span>
                <span className="hist-meta">{t("{n} 问", { n: c.messages.filter((m) => m.role === "user").length })} · {date(c.at)}</span>
              </button>
              <button type="button" className="icon-btn" aria-label={t("删除这段对话")} onClick={() => { selectionFeedback(); onDelete(c.id); }}><Trash2 size={16} /></button>
            </div>
          ))}
          {current.length > 0 && <button type="button" onClick={() => { setOpen(false); selectionFeedback(); void toClipboard(exportChat(current, ep)); }}><Download size={18} /><span>{t("复制当前对话为 Markdown")}</span></button>}
        </MobileSheet>
      )}
    </div>
  );
}
