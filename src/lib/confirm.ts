// An in-app confirmation dialog. window.confirm does nothing in the macOS webview (WKWebView shows no panel and
// returns false), so every "are you sure?" goes through this instead.
import { create } from "zustand";

export interface ConfirmRequest { title: string; message?: string; ok: string; danger?: boolean; resolve: (yes: boolean) => void }
export const useConfirm = create<{ req: ConfirmRequest | null }>(() => ({ req: null }));

export function ask(o: { title: string; message?: string; ok: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().req?.resolve(false);
    useConfirm.setState({ req: { ...o, resolve } });
  });
}

export function answer(yes: boolean) {
  const { req } = useConfirm.getState();
  useConfirm.setState({ req: null });
  req?.resolve(yes);
}
