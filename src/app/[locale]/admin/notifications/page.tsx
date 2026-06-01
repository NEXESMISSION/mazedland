import { AdminNotificationsClient } from "./AdminNotificationsClient";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

/**
 * Admin notification control center.
 *
 * Two surfaces in one client island:
 *   - Compose: write a custom notification and broadcast to all, a role,
 *     or specific user IDs. Includes a "send test to me" button.
 *   - Queue: paginated inspector across every notification platform-wide
 *     with filters (kind / user / unread / search) and delete.
 *
 * The component is fully client-side because it needs interactive forms
 * and live refreshes after sending. RLS + same-origin checks on the
 * /api/admin/notifications/* routes block non-admin access.
 */
export default function AdminNotificationsPage() {
  return (
    <div>
      <AdminPageHeader
        eyebrow="Outils admin"
        title="Notifications"
        description="Composer un message ponctuel ou inspecter la file complète des notifications envoyées."
      />

      <div className="mt-5">
        <AdminNotificationsClient />
      </div>
    </div>
  );
}
