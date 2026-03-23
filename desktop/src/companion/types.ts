import type { ReactNode } from "react";

/** Tool definition — each maps to an optional embedded URL */
export interface ToolDef {
  id: string;
  nameKey: string;
  descKey: string;
  icon: ReactNode;
  url?: string;
  status: "active" | "available" | "installing" | "disabled";
}
