import { IMAPConfigSchema } from "@/lib/validations/imap-provider";
import { formSchema } from "@/lib/validations/smtp-provider";

test("IMAP keeps write-only passwords on edits and requires one for a new connection", () => {
  const values = {host:"imap.example.com",port:993,username:"mail@example.com"};
  expect(IMAPConfigSchema.safeParse(values).success).toBe(false);
  expect(IMAPConfigSchema.parse({...values,id:"existing"}).password).toBe("");
  expect(IMAPConfigSchema.parse({...values,password:"new-password"}).password).toBe("new-password");
});

test("SMTP keeps write-only passwords on edits and requires one for a new connection", () => {
  const values = {provider:"CUSTOM",host:"smtp.example.com",port:465,username:"mail@example.com",fromEmail:"mail@example.com",maxSendRate:10};
  expect(formSchema.safeParse(values).success).toBe(false);
  expect(formSchema.parse({...values,id:"existing"}).password).toBe("");
  expect(formSchema.parse({...values,password:"new-password"}).password).toBe("new-password");
});
