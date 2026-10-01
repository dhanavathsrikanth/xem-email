export interface IMAPEmail {
  id?: string;
  uid?: number;
  uidValidity?: number;
  providerMessageId?: string;
  warning?: string;
  reply_to?: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  body: string;
  date: string;
  messageId: string;
  flags: string[] | null;
  attachments: {
    Filename: string;
    MIMEType?: string;
    Size?: number;
    AttachmentID?: string;
    Data?: string;
  }[];
}

export interface IMAPEmailResponse {
  emails: IMAPEmail[];
  total_emails: number;
  next_before_uid?: number;
  next_page_token?: string;
  history_id?: string;
  total_is_estimate?: boolean;
  uidValidity?: number;
  limit: number;
  offset: number;
}
