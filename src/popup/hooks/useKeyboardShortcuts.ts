import { useEffect, useCallback } from "react";

interface ShortcutHandlers {
  onSave?: () => void;
  onSelectAll?: () => void;
  onClose?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow Escape to still work
        if (event.key === "Escape" && handlers.onClose) {
          handlers.onClose();
        }
        return;
      }

      // Enter = Save
      if (event.key === "Enter" && handlers.onSave) {
        event.preventDefault();
        handlers.onSave();
        return;
      }

      // Ctrl+A or Cmd+A = Select All
      if ((event.ctrlKey || event.metaKey) && event.key === "a") {
        event.preventDefault();
        handlers.onSelectAll?.();
        return;
      }

      // Escape = Close popup
      if (event.key === "Escape" && handlers.onClose) {
        handlers.onClose();
        return;
      }
    },
    [handlers]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
