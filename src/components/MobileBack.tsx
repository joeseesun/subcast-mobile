import { ChevronLeft } from "lucide-react";
import { useStore } from "../store";
import { t } from "../lib/i18n";

export function MobileBack({ trailing }: { trailing?: React.ReactNode }) {
  const back = useStore((s) => s.back);
  return <header className="mobile-back-bar"><button onClick={back}><ChevronLeft />{t("返回")}</button>{trailing}</header>;
}
