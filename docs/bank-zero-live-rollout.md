# Bank Zero shared receiver rollout

## Ownership

Both people can forward to `bankzero@automations.klingbiel.org`.
The authenticated HTTP receiver resolves ownership from outer email headers:

- Gustav: `gustav+bankzero@klingbiel.org`, `gustav@klingbiel.org`.
- Cara: `cara.finance@klingbiel.org`, `cara@klingbiel.org`.

A known manual forwarding sender wins over the delivery recipient. For automatic
forwards, Gmail forwarding metadata and original delivery/recipient headers
identify the profile. Quoted body text and display names do not establish ownership.
Ambiguous mailboxes and token/owner conflicts remain unresolved.

`INGEST_OWNER_PROFILES` controls which detected profiles become routable. The
initial rollout enables Gustav only. Cara's mail is retained on the unresolved
path until her historical baseline and account aliases are verified. Existing
unrouted statement handling remains available.

Ownership identifies the person; account aliases and account numbers identify
their individual sub-accounts. The shared automation address is not an owner.

## Publication

Successful routed email processing wakes the existing publication queue directly.
Incomplete statement chunks wait for the final chunk before waking publication.
A publication batch schedules a follow-up when it creates pending projections or
fills its batch, so a single receipt can reach both FinWise and Supabase without
waiting for another email. Empty batches stop.

Queue wake failures are logged without retrying completed evidence processing.
The minute cron remains the recovery mechanism for missed wakes and delayed
retries. An outcome-unknown remote create is held by the existing outbox rules;
it is not blindly retried.

## Production activation

Enabling mailbox routing alone does not enable publication. In Supabase, verify
the route, activate genuine account aliases, reconcile each account's existing
FinWise history, and complete its baseline before enabling message capabilities.

Historical adoption links existing FinWise IDs to importer movements; it must
preserve the source amount, currency, date and original counterparty evidence.
Record exceptions and a snapshot hash. It must not create remote transactions.

The initial Gustav trial enables receipts, payments, proofs and statements.
Card purchases, refunds, payment returns and standalone fee alerts remain
deferred. Proofs without a unique account stay in review and cannot independently
create transactions. Classification remains separate from ingestion.

## Small live trial

Replay the original RFC822 messages through the authenticated webhook, preserving
their Message-IDs and attachments. Check the deployed receiver, evidence records,
account resolution, outbox, FinWise IDs and Supabase projection. Repeat selected
messages and confirm the movement and remote transaction counts stay constant.

Normal Gmail forwarding does not backfill old mail. Automatic delivery must also
be checked using a fresh matching message after the Gmail filter is enabled.
Keep raw emails, credentials and replay payloads outside the repository.
