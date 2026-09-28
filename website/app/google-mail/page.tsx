import Link from "next/link";
import { PrivacyLayout } from "@/components/privacy-layout";
import { privacyMetadata } from "@/lib/privacy";

export const metadata = privacyMetadata(
  "Google mail & your data",
  "Xem’s limited-test Gmail and Google Workspace connector: mailbox permissions, workspace access, saved data and disconnection.",
  "/google-mail",
);

export default function GoogleMailPage() {
  return (
    <PrivacyLayout
      eyebrow="Connected mail · limited testing"
      title="Bring your mailbox. Know what you share."
      description="A Gmail or Google Workspace connection lets Xem act as an email client for the mailbox you choose. Public hosted availability is pending Google review."
      summary={
        <>
          <p className="font-medium">Before connecting a mailbox</p>
          <p className="mt-3">
            Mailbox access is shared with your Xem workspace under its
            permissions. Connect an account you are authorized to share. Signing
            into Xem with Google does not, by itself, connect your Gmail inbox.
          </p>
        </>
      }
      sections={[
        {
          id: "features",
          title: "What the test connector does",
          content: (
            <>
              <p>
                Browse folders, search and read messages, view attachments,
                change read and star flags, and send messages and replies from
                the linked address. You can select that sender for workflows you
                configure. Google’s sending limits still apply; a connection
                does not authorize unsolicited bulk mail.
              </p>
              <p>
                The current connector does not provide Google Workspace
                domain-wide delegation, private mailboxes for individual
                members, or an inbox backup service. Access to one mailbox does
                not connect every user in a Google Workspace organization.
              </p>
            </>
          ),
        },
        {
          id: "permission",
          title: "The Google permission",
          content: (
            <>
              <p>
                The current limited-test implementation requests{" "}
                <code>https://mail.google.com/</code> for Google’s IMAP and SMTP
                protocols. Google’s consent screen describes broad email access,
                including operations Xem does not currently offer. Permanent
                deletion is not a feature of this connector.
              </p>
              <p>
                We are reviewing narrower Gmail API permissions before public
                release. We will not describe a broad permission as read-only or
                imply Google verification is complete. You can decline consent
                and continue using other Xem features.
              </p>
            </>
          ),
        },
        {
          id: "flow",
          title: "How data moves",
          content: (
            <>
              <ol>
                <li>
                  You choose to connect Google from Xem’s mailbox settings and
                  grant access on Google’s consent screen.
                </li>
                <li>
                  Google returns a one-time authorization result. Xem’s backend
                  exchanges it and stores encrypted credentials so the
                  connection can work without asking you to sign in for each
                  message.
                </li>
                <li>
                  When you open the inbox, Xem fetches requested messages from
                  Google and displays them in your browser. It does not mirror
                  the complete inbox into its database.
                </li>
                <li>
                  When you send, Xem records the outgoing message and submits it
                  through the linked sender. Saved records may include
                  recipients, subject, body, attachments and delivery status.
                </li>
              </ol>
              <p>
                Optional AI writing can receive your current draft, and
                assistant tools can return outgoing message data. Read{" "}
                <Link href="/privacy#ai">the AI disclosure</Link> before using
                those features. Connection credentials are not shared with the
                writing service.
              </p>
            </>
          ),
        },
        {
          id: "control",
          title: "Disconnecting and deleting",
          content: (
            <>
              <p>
                Disconnecting in Xem disables the linked inbox and sender and
                clears its stored credential from the active database. Revoking
                the grant in your{" "}
                <a href="https://myaccount.google.com/connections">
                  Google Account
                </a>{" "}
                is a separate action. Neither action automatically deletes saved
                Xem messages or copies held by recipients.
              </p>
              <p>
                Use <Link href="/data-deletion">the data-deletion guide</Link>{" "}
                to request removal of saved data. Read the{" "}
                <Link href="/privacy">draft privacy policy</Link> for workspace
                sharing and proposed retention commitments.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
