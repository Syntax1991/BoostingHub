import { useEffect, type RefObject } from "react";

/** Opens a native <dialog> on mount as a modal and calls onClose when it closes. */
export function useModalDialog(dialogRef: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  useEffect(() => {
    dialogRef.current?.showModal();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onDialogClose = () => onClose();
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [dialogRef, onClose]);
}
