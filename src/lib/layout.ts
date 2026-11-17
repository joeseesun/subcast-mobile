import { create } from "zustand";

/** Column widths the viewer sets by dragging. Kept in localStorage: a per-device convenience, not data. */
export const SIDEBAR = { min: 180, max: 320, def: 220, snap: 130 };
export const PANEL = { min: 340, max: 760, def: 460, snap: 260 };

interface Layout { sidebar: number; sideOpen: boolean; panel: number; panelOpen: boolean }
const KEY = "subcast-layout";
const read = (): Layout => {
  try { return { sidebar: SIDEBAR.def, sideOpen: true, panel: PANEL.def, panelOpen: true, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; }
  catch { return { sidebar: SIDEBAR.def, sideOpen: true, panel: PANEL.def, panelOpen: true }; }
};

export const useLayout = create<Layout & { put: (p: Partial<Layout>) => void }>((set, get) => ({
  ...read(),
  put: (p) => {
    set(p);
    const { sidebar, sideOpen, panel, panelOpen } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ sidebar, sideOpen, panel, panelOpen })); } catch { /* private mode */ }
  },
}));
