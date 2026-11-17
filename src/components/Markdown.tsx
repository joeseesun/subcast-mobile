import { Fragment, type ReactNode } from "react";
import { parseClock } from "../lib/format";
import { t } from "../lib/i18n";

// A small Markdown renderer for model answers: headings, lists, bold, inline code, and [mm:ss] timestamps that seek.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[\d{1,2}:\d{2}(?::\d{2})?\](?:\s*[-–~至]\s*\[\d{1,2}:\d{2}(?::\d{2})?\])?)/g;

function inline(text: string, onSeek: (t: number) => void, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={k}>{part.slice(1, -1)}</code>;
    const stamp = part.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
    if (stamp) {
      const seconds = parseClock(stamp[1]);
      return seconds == null ? part : (
        <button key={k} className="stamp" onClick={() => onSeek(seconds)} title={t("跳到这里播放")}>{stamp[1]}</button>
      );
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
}

export function Markdown({ text, onSeek }: { text: string; onSeek: (t: number) => void }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let ordered = false;
  // A list whose every item starts with a timestamp is a timeline (chapters), drawn as one.
  let timeline = true;
  let rows: string[][] = [];
  const flushTable = () => {
    if (!rows.length) return;
    const [head, ...body] = rows;
    const k = `t${blocks.length}`;
    blocks.push(
      <div key={k} className="md-table"><table>
        <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, onSeek, `${k}h${j}`)}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c, onSeek, `${k}${i}-${j}`)}</td>)}</tr>)}</tbody>
      </table></div>,
    );
    rows = [];
  };
  const flush = () => {
    flushTable();
    const cls = timeline ? "timeline" : undefined;
    if (list.length) blocks.push(ordered ? <ol key={`l${blocks.length}`} className={cls}>{list}</ol> : <ul key={`l${blocks.length}`} className={cls}>{list}</ul>);
    list = [];
    timeline = true;
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const cells = line.trim().match(/^\|(.*)\|$/);
    if (cells) {
      if (list.length) flush();
      if (!/^[\s|:-]+$/.test(cells[1])) rows.push(cells[1].split("|").map((c) => c.trim()));
      return;
    }
    flushTable();
    const bullet = line.match(/^\s*(?:[-*•]|(\d+)[.)、])\s+(.*)$/);
    if (bullet) {
      const isOrdered = Boolean(bullet[1]);
      if (list.length && isOrdered !== ordered) flush();
      ordered = isOrdered;
      const stamped = /^\[\d{1,2}:\d{2}/.test(bullet[2]);
      timeline &&= stamped;
      list.push(<li key={i} className={stamped ? "ts-item" : undefined}>{inline(bullet[2], onSeek, `b${i}`)}</li>);
      return;
    }
    if (line.trim().startsWith(">")) { flush(); blocks.push(<blockquote key={i}>{inline(line.trim().replace(/^>\s*/, ""), onSeek, `q${i}`)}</blockquote>); return; }
    flush();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) blocks.push(heading[1].length <= 2 ? <h3 key={i}>{inline(heading[2], onSeek, `h${i}`)}</h3> : <h4 key={i}>{inline(heading[2], onSeek, `h${i}`)}</h4>);
    else if (line.trim() === "---") blocks.push(<hr key={i} />);
    else if (line.trim()) blocks.push(<p key={i}>{inline(line, onSeek, `p${i}`)}</p>);
  });
  flush();
  return <div className="markdown">{blocks}</div>;
}
