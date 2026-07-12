import type { ReactNode } from "react";

interface KbdProps {
  children: ReactNode;
}

export function Kbd({ children }: KbdProps) {
  return (
    <kbd className="rounded-md bg-white/[0.08] px-1.5 py-0.5 font-sans text-white/70">
      {children}
    </kbd>
  );
}
