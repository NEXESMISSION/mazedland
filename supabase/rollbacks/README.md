# Rollbacks

One script per migration applied since the cahier global V1 audit
(2026-10-24), to undo it on the live database. Run with the same tool as the
migrations, after a backup:

```bash
node scripts/backup-db.mjs
```

| Migration | Rollback | What is lost |
|---|---|---|
| 0193 credit note restores periods | `0193_credit_note_restores_periods.down.sql` | which payment replaced each plan period and the end it had (roll the code back first: grantPlanPeriod writes them); a credit note on an upgrade cancels its own period only again, the replaced plan stays cut short |
| 0191 QA tour, wave 2 | `0191_qa_tour_2.down.sql` | the unique indexes, the bucket limits, the admin alerts to every admin, a person's full update right on their notifications, the self-insert of payments come back; claim_listing_place returns to 0190 (roll the code back first); buyer_phone stays nullable |
| 0190 QA tour | `0190_qa_tour.down.sql` | the takedown marks on annonces; claim_listing_place (roll the code back first); the deletion cascade for accounts deleted after it stays applied; bucket limits |
| 0189 admin backup | `0189_admin_backup.down.sql` | the console's « Sauvegarde » stops; the `backups` bucket and its files stay (remove them from the dashboard) |
| 0188 prune cron history | `0188_prune_cron_history.down.sql` | nothing (the run log deleted by 0188 stays deleted; it held no business data) |
| 0177 ads | `0177_ads.down.sql` | every ad and its daily figures (images stay in storage) |
| 0176 server writes only | `0176_listings_server_writes_only.down.sql` | nothing (sellers may write their rows directly again) |
| 0175 invoices | `0175_invoices.down.sql` | every issued invoice and the numbering (reissue by hand) |
| 0174 visits and leads | `0174_visits_and_leads.down.sql` | every visit request and every shop client |
| 0173 pro shops | `0173_pro_shops.down.sql` | shops, teams, subscription periods (annonces stay, unlinked) |
| 0172 pending edit | `0172_listing_pending_edit.down.sql` | edits waiting for an admin (the annonces are untouched) |
| 0171 retire legacy roles | `0171_retire_legacy_roles.down.sql` | nothing: the six seed accounts get their old roles back |
| 0170 social publisher | `0170_social_publisher.down.sql` | every promotion request, post id and link, group, sealed token, tracking event |
| 0169 ai calls | `0169_ai_calls.down.sql` | the AI cost log |
| 0168 demandes | `0168_property_requests.down.sql` | every demande and match |

0163–0167 (Arabic notifications, free listings and auto-moderation, sale and
rent, the publish guard) were applied before this folder existed. Their
rollback is not scripted: 0166 added the enum value `rented`, which Postgres
cannot remove without rebuilding the type, and its rent columns hold sellers'
data. Undoing them means restoring a backup.
