"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inferMailProvider, MailProviderIcon } from "./mail-provider-icon";

export type MailboxOption = {
  id: string;
  username: string;
  host: string;
  provider?: string;
};

export function MailboxSelect({
  value,
  mailboxes,
  onChange,
  disabled,
}: {
  value: string;
  mailboxes: MailboxOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected =
    mailboxes.find((mailbox) => mailbox.id === value) ?? mailboxes[0];
  const selectedProvider = selected
    ? inferMailProvider({ provider: selected.provider, host: selected.host })
    : null;
  return (
    <Select
      value={selected?.id}
      onValueChange={onChange}
      disabled={disabled || !selected}
    >
      <SelectTrigger
        aria-label="Mailbox"
        className="h-auto min-h-[44px] w-full min-w-0 rounded-lg border-border bg-background px-2.5 py-2"
      >
        {selected ? (
          <span
            className="min-w-0 flex-1 items-center gap-2 overflow-hidden text-left"
            style={{ display: "flex" }}
          >
            <MailProviderIcon
              provider={selected.provider}
              host={selected.host}
            />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs font-medium">
                {selected.username}
              </strong>
              <small className="block truncate text-[9px] text-muted-foreground">
                {selectedProvider?.label}
              </small>
            </span>
          </span>
        ) : (
          <SelectValue placeholder="Choose a mailbox" />
        )}
      </SelectTrigger>
      <SelectContent className="max-w-[min(360px,calc(100vw-24px))]">
        {mailboxes.map((mailbox) => (
          <SelectItem key={mailbox.id} value={mailbox.id}>
            <span className="flex min-w-0 items-center gap-2">
              <MailProviderIcon
                provider={mailbox.provider}
                host={mailbox.host}
              />
              <span className="min-w-0">
                <strong className="block truncate text-xs font-medium">
                  {mailbox.username}
                </strong>
                <small className="block text-[9px] text-muted-foreground">
                  {
                    inferMailProvider({
                      provider: mailbox.provider,
                      host: mailbox.host,
                    }).label
                  }
                </small>
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
