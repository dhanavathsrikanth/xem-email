import {
  readMailAttachments,
  replySubject,
  resolveMailSender,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/connected-mail";

describe("connected mail identity and attachments", () => {
  const senders = [
    {
      id: "default",
      fromEmail: "hello@example.com",
      provider: "CUSTOM",
      isDefault: true,
    },
  ];
  test("a missing reply identity cannot fall back to the workspace default", () => {
    expect(resolveMailSender(senders, "disconnected-google")).toBeUndefined();
    expect(resolveMailSender(senders, "")?.id).toBe("default");
    expect(resolveMailSender(senders, "default")?.id).toBe("default");
  });
  test("reply prefixes are case insensitive", () => {
    expect(replySubject("re: Your receipt")).toBe("re: Your receipt");
    expect(replySubject("Your receipt")).toBe("Re: Your receipt");
  });
  test("attachment budgets are cumulative and invalid names are rejected before reads", async () => {
    const file = {
      name: "receipt.pdf",
      size: 100,
      type: "application/pdf",
      arrayBuffer: jest.fn(),
    } as unknown as File;
    await expect(
      readMailAttachments(
        [file],
        [
          {
            filename: "big",
            content: "",
            contentType: "application/pdf",
            size: MAX_ATTACHMENT_BYTES,
          },
        ],
      ),
    ).rejects.toThrow("3 MiB");
    await expect(readMailAttachments(Array(11).fill(file), [])).rejects.toThrow(
      "10 files",
    );
    await expect(
      readMailAttachments([{ ...file, name: "../receipt.pdf" } as File], []),
    ).rejects.toThrow("Rename");
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });
});
