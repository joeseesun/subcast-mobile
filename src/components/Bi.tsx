import { useZh } from "../lib/zh";

/** A title shown Chinese-first with the original underneath (or just the original when it is already Chinese). */
export function BiTitle({ text, as: Tag = "p", className = "", subClassName = "", zh }: { text: string; as?: "p" | "h1" | "h2" | "span"; className?: string; subClassName?: string; zh?: string }) {
  const auto = useZh(zh ? undefined : text);
  const cn = zh ?? auto;
  if (!cn || cn === text) return <Tag className={className}>{text}</Tag>;
  return (
    <>
      <Tag className={className}>{cn}</Tag>
      <span className={`orig-line ${subClassName}`}>{text}</span>
    </>
  );
}

/** Chinese if available, else the original: for tight places like the sidebar. */
export function ZhText({ text, zh }: { text: string; zh?: string }) {
  const auto = useZh(zh ? undefined : text);
  return <>{zh ?? auto ?? text}</>;
}
