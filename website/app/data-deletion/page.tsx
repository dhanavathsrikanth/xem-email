import Link from "next/link";
import { PrivacyLayout } from "@/components/privacy-layout";
import {
  deletionEmailLink,
  privacyContact,
  privacyEmailLink,
  privacyMetadata,
} from "@/lib/privacy";

export const metadata = privacyMetadata(
  "Delete your data — draft",
  "How to disconnect Google mail, revoke access, and request deletion of your Xem data. Proposed deletion and backup timelines.",
  "/data-deletion",
);

export default function DataDeletionPage() {
  return (
    <PrivacyLayout
      eyebrow="A clear way out"
      title="Your data. Your next move."
      description="Disconnect a mailbox, remove a saved conversation, or ask us to delete your data. These are different actions, and each should be clear."
      summary={
        <>
          <p className="font-medium">Start a deletion request</p>
          <p className="mt-3 text-ink/80">
            Email us from your account address with the workspace name and what
            you want removed. We will verify your identity and authority before
            making irreversible changes.
          </p>
          <a
            href={deletionEmailLink}
            className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-iris px-5 py-3 text-sm font-medium text-white hover:bg-iris/90"
          >
            Email {privacyContact}
          </a>
          <p className="mt-3 text-xs text-muted">
            Opens your email app. Nothing is sent automatically. Do not include
            passwords, tokens or message attachments.
          </p>
        </>
      }
      sections={[
        {
          id: "disconnect",
          title: "Stop Google mailbox access",
          content: (
            <>
              <ol>
                <li>
                  In Xem, open Settings → IMAP and find the connected Google
                  mailbox. A workspace administrator can select Disconnect.
                </li>
                <li>
                  Xem disables the linked inbox and sender and clears the saved
                  authorization secret from its active database. Requests
                  already in flight may finish; disconnecting cannot recall
                  delivered mail.
                </li>
                <li>
                  To revoke Google’s grant as well, open{" "}
                  <a href="https://myaccount.google.com/connections">
                    Google Account connections
                  </a>
                  , select Xem or the consent-app name shown during connection,
                  and remove access.
                </li>
              </ol>
              <p>
                Revocation can affect other Xem connections or Google sign-in
                that use the same Google app. Have another way to sign in before
                revoking it. Reconnecting later requires a new authorization.
              </p>
              <p>
                Disconnecting or revoking does not erase existing Gmail
                messages, Xem’s saved outgoing messages and attachments, the
                connection’s address, or backup copies.
              </p>
            </>
          ),
        },
        {
          id: "request",
          title: "Tell us what to remove",
          content: (
            <>
              <p>
                Send your request to{" "}
                <a href={deletionEmailLink}>{privacyContact}</a>. Include your
                account email, workspace name and whether you want a specific
                connected mailbox’s saved data, your account, assistant history,
                or the whole workspace removed. You do not need to send message
                contents.
              </p>
              <p>
                We will check identity and authority through the account or
                another proportionate method, confirm the affected data, and
                explain any impact on other members. An individual member cannot
                authorize deletion of an organization’s entire workspace. Export
                anything you need before confirming permanent deletion.
              </p>
              <p>
                If you received a campaign sent by another organization, use
                that sender’s unsubscribe option for future campaigns and
                contact the organization about your contact record. You may also
                contact us for help routing a request.
              </p>
            </>
          ),
        },
        {
          id: "timing",
          title: "The proposed timelines",
          content: (
            <>
              <p>
                Our proposed hosted-service commitment is to complete a verified
                deletion request within <strong>30 calendar days</strong>.
                Residual copies in backups would expire within{" "}
                <strong>90 calendar days after active-system deletion</strong>.
                The backup period is additional; it does not start when you
                first email us.
              </p>
              <p>
                Backups are for recovery, not normal product access. Deleted
                data must be removed again before a restored backup returns to
                service. Any legally required or security-related exception must
                be limited to the relevant records, documented and explained
                when permitted.
              </p>
              <p>
                These timelines are not yet in effect. We are validating
                deletion coverage and backup expiry before making the commitment
                active. A request can still be sent to our privacy contact now.
              </p>
            </>
          ),
        },
        {
          id: "history",
          title: "Assistant history and providers",
          content: (
            <>
              <p>
                Deleting a saved assistant conversation removes the
                application’s active conversation and its pending proposals.
                Conversations otherwise expire seven days after their last save.
                Deleting history does not undo actions already approved and
                performed, recall sent messages, or delete other workspace
                resources.
              </p>
              <p>
                AI-provider logs and recovery backups are separate from
                application history. Their retention and deletion terms must be
                confirmed before the proposed hosted policy takes effect. Ask
                for provider-side deletion to be included in your request where
                applicable.
              </p>
            </>
          ),
        },
        {
          id: "limits",
          title: "What Xem cannot delete for you",
          content: (
            <>
              <p>
                A Xem deletion request does not delete your Google Account or
                independently erase mail held by Google, a recipient, or an
                integration you connected. Those providers have their own
                controls and obligations. Deleting an account also does not
                automatically delete content an organization is entitled or
                required to retain.
              </p>
              <p>
                For a self-hosted installation, contact its operator. They
                control its database, credentials, backups and configured
                service providers. The hosted-service deadlines above do not
                automatically apply to independently operated installations.
              </p>
            </>
          ),
        },
        {
          id: "help",
          title: "Need help or a correction?",
          content: (
            <p>
              Write to <a href={privacyEmailLink}>{privacyContact}</a>. You can
              request access, export or correction instead of deletion. Read the{" "}
              <Link href="/privacy">full draft privacy policy</Link> for the
              proposed commitments and how connected email is handled.
            </p>
          ),
        },
      ]}
    />
  );
}
