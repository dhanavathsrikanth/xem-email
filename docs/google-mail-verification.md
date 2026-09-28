# Google mailbox verification and release checklist

Status: public hosted availability is gated. Code tests, a configured OAuth client, or a successful authorization URL do not constitute Google approval. Keep `GOOGLE_MAIL_ACCESS=testing` until all applicable external review is complete.

## Scope justification draft

Xem connects a user-selected Gmail or Google Workspace mailbox as an email client. Users can list folders, search and read messages and attachments, change read/star flags, and send messages and replies using the linked sender. The same sender can be selected for user-configured scheduled messages and other sending workflows, subject to Google limits and policies. Mailbox access is shared with the user's Xem workspace under its existing permissions; administrators see this disclosure before connecting.

The implementation uses Google's documented IMAP/SMTP XOAUTH2 protocol. That protocol requires `https://mail.google.com/`. Gmail API scopes such as `gmail.readonly` and `gmail.send` cannot authenticate this IMAP/SMTP implementation. Xem uses the Gmail profile endpoint to verify the authorized mailbox address. Mailbox OAuth is separate from ordinary Google sign-in, and the mailbox tokens stay on the backend.

Use the email-client category that matches this implementation. Remove unrelated backup, reporting, or monitoring categories unless corresponding functionality exists and is included in the review. Review this draft against Google's current permitted-use requirements before submitting it.

## Required consent demonstration

Record the actual test flow, without revealing passwords, client secrets, refresh tokens, or unrelated mailbox contents:

1. Show the application's public homepage and privacy policy, the selected project's branding, and the exact OAuth client and callback configuration.
2. Sign into the isolated test workspace. Show the workspace-wide access notice and the Google connect control.
3. Show Google's complete consent screen, account selection and scope grant, then the return to the Xem callback and linked mailbox/sender.
4. Open a folder containing only controlled test messages, search, inspect an attachment, and toggle read/star flags.
5. Send a uniquely titled message with a harmless attachment to a controlled recipient. Confirm receipt at the provider and reply from Xem; show the resulting thread.
6. Demonstrate a refreshed access token continuing to work without exposing token values. Verify revocation/reconnect messaging and disconnect the mailbox.

Upload an unlisted demonstration video only after checking that it contains the required evidence and no unrelated private information. No demonstration video has been produced for this release yet.

## Before submission

- Confirm the OAuth app name, logo, support address, homepage, authorized domains and redirect URIs. Preserve existing sign-in redirects when reusing a client.
- Verify domain ownership and publish an accurate privacy policy describing the actual collection, storage, workspace sharing, retention/deletion, and optional AI flows. Include the applicable Google API Services User Data Policy/Limited Use disclosure. Policy statements need to match actual operating practices.
- Verify which restricted-scope security assessment applies to the hosted service. Complete it with the approved assessor when required; do not mark it complete on the strength of local security tests.
- Supply the actual demo URL and scope justification, submit through Google Auth Platform, and resolve reviewer requests.
- Keep allowlisted testing enabled until Google and any applicable assessor provide approval. Google review has external timing and cannot be guaranteed by this checklist.

## Evidence still needed

Real consent, refresh, inbox, send/receipt/reply, disconnect/revocation, visual checks at desktop and mobile in both themes, the demo video, applicable assessment and Google review remain release requirements. The local API has been checked for the selected client, exact local redirect, offline access and PKCE; that does not validate a completed grant.

Cloudflare acceptance is separate: Workers Paid, an authenticated sending domain, a suitably scoped token, and provider/recipient delivery evidence are required. The current REST integration has no delivery-event reconciliation for queued outcomes. Inbound routing, private/delegated mailboxes and paid collaboration workflows remain separate implementation work.

Sources: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [XOAUTH2](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
