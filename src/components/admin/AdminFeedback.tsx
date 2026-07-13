"use client";

export function AdminNotice({
  message,
  kind = "info"
}: {
  message: string;
  kind?: "info" | "success" | "error";
}) {
  if (!message) return null;
  return (
    <div className={`admin-notice ${kind}`} role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"}>
      {message}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  danger = false,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  danger?: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  if (!open) return null;
  return (
    <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onCancel();
    }}>
      <section className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title" aria-describedby="admin-confirm-description">
        <span className="admin-dialog-kicker">Confirm action</span>
        <h2 id="admin-confirm-title">{title}</h2>
        <p id="admin-confirm-description">{description}</p>
        <div className="btn-row">
          <button className="btn ghost" type="button" disabled={pending} onClick={onCancel}>取消</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} type="button" disabled={pending} autoFocus onClick={onConfirm}>
            {pending ? "处理中…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
