export type MailSender = {
  id: string;
  fromEmail: string;
  provider: string;
  isDefault: boolean;
};
export type ComposeValue = {
  to: string;
  subject: string;
  inReplyTo?: string;
  smtpConfigId?: string;
};
export type OutgoingAttachment = {
  filename: string;
  content: string;
  contentType: string;
  size: number;
};
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export function resolveMailSender(
  senders: MailSender[] | undefined,
  chosen: string,
) {
  // A disconnected reply sender must never silently become a different identity.
  return chosen
    ? senders?.find((sender) => sender.id === chosen)
    : (senders?.find((sender) => sender.isDefault) ?? senders?.[0]);
}

export function replySubject(subject: string) {
  return /^re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

export async function readMailAttachments(
  files: File[],
  existing: OutgoingAttachment[],
) {
  if (files.length + existing.length > MAX_ATTACHMENTS)
    throw new Error("Attach up to 10 files per message.");
  const total =
    existing.reduce((sum, file) => sum + file.size, 0) +
    files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ATTACHMENT_BYTES)
    throw new Error(
      "Attachments must total 3 MiB or less. Remove a file or choose a smaller one.",
    );
  for (const file of files) {
    if (
      !file.name.trim() ||
      file.name.trim() !== file.name ||
      file.name === "." ||
      file.name === ".." ||
      new TextEncoder().encode(file.name).length > 255 ||
      /[\/\\\p{Cc}\p{Cf}]/u.test(file.name)
    ) {
      throw new Error(
        "Rename files to remove paths, hidden characters, or names longer than 255 bytes.",
      );
    }
  }
  return Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return {
        filename: file.name,
        content: btoa(binary),
        contentType: file.type || "application/octet-stream",
        size: bytes.length,
      };
    }),
  );
}
