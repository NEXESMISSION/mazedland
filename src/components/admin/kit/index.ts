/**
 * The admin kit. Every console screen is assembled from these; nothing in
 * `src/app/[locale]/admin/**` should be hand-rolling a list, a status, a form
 * field or a fetch again.
 */
export { AdminPage, FullBleed } from "./AdminPage";
export { PageHeader } from "./PageHeader";
export { EmptyState } from "./EmptyState";
export { DataTable, Stacked, type Column, type Row } from "./DataTable";
export { InboxList, type InboxRow } from "./InboxList";
export { Toolbar, type Tab } from "./Toolbar";
export { SidePanel, PanelRow, PanelSection } from "./SidePanel";
export { StatusPill } from "./StatusPill";
export { Confirm } from "./Confirm";
export { QueueKeys } from "./QueueKeys";
export {
  TextField,
  TextareaField,
  NumberField,
  SelectField,
  ToggleField,
  FieldGrid,
} from "./Field";
export { useAdminAction } from "./useAdminAction";
export {
  statusTone,
  statusLabel,
  paymentKindLabel,
  TONE_CLASS,
  TONE_TEXT,
  PAYMENT_KIND_LABEL,
  type Tone,
} from "./tones";
export { EYEBROW, COLHEAD, NUM, PANE, RULE } from "./surface";
