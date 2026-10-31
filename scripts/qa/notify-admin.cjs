// Tell the admins about the QA tour, through the site's own notifications
// (kind qa_report, templates notifications.qa_report.{found,fixed} in fr/ar;
// the stored title/body is the French fallback shown until those templates
// are deployed). Admin kinds never go out by SMS or e-mail.
//   node notify-admin.cjs found <found> <critical>
//   node notify-admin.cjs fixed <fixed> <left>
const qa = require("./qa-lib.cjs");
const [variant, a, b] = process.argv.slice(2);
const n1 = Number(a), n2 = Number(b);
if (!["found", "fixed"].includes(variant) || !Number.isFinite(n1) || !Number.isFinite(n2)) {
  console.error("usage: node notify-admin.cjs found <found> <critical> | fixed <fixed> <left>");
  process.exit(1);
}
const title = variant === "found" ? "Tour de contrôle du site" : "Tour de contrôle : corrections en ligne";
const body =
  variant === "found"
    ? `${n1} problème${n1 > 1 ? "s" : ""} trouvé${n1 > 1 ? "s" : ""} (${n2} critique${n2 > 1 ? "s" : ""}). Les corrections sont en cours : vous serez prévenu quand elles seront en ligne.`
    : `${n1} problème${n1 > 1 ? "s" : ""} corrigé${n1 > 1 ? "s" : ""} et publié${n1 > 1 ? "s" : ""}. ${n2 === 0 ? "Rien ne reste à traiter." : `${n2} point${n2 > 1 ? "s" : ""} reste${n2 > 1 ? "nt" : ""} à traiter.`}`;
const vars = variant === "found" ? { variant, found: n1, critical: n2 } : { variant, fixed: n1, left: n2 };
(async () => {
  const { data, error } = await qa.svc.rpc("_notify_admins", { p_kind: "qa_report", p_title: title, p_body: body, p_link: "/admin", p_payload: { vars } });
  if (error) throw error;
  console.log(`notified ${data} admin(s): ${title} — ${body}`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
