import { t } from "../lib/i18n";

export function PageHeading({ title, children, wordmark = false }: { title?: string; children?: React.ReactNode; wordmark?: boolean }) {
  return <header className={`page-heading ${wordmark ? "wordmark-heading" : ""}`}>
    <h1>{wordmark ? t("声渡") : title}</h1>
    {children}
  </header>;
}
