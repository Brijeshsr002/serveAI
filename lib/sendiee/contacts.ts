import { sendieeRequest } from "./client";

export type UpsertContactInput = {
  phone: string;
  contactName?: string;
  email?: string;
  city?: string;
};

/** POST /v2.0/contacts (upsert by phone). Scope: contacts:write */
export async function upsertContact(input: UpsertContactInput) {
  const res = await sendieeRequest<{ data: { _id: string; phone: string; contactName: string; isNew: boolean } }>(
    "/v2.0/contacts",
    { method: "POST", body: input },
  );
  return res.data;
}

/** POST /v2.0/contacts/phone. Scope: contacts:read */
export async function getContactByPhone(phone: string) {
  const res = await sendieeRequest<{ data: { _id: string; phone: string; contactName: string | null } }>(
    "/v2.0/contacts/phone",
    { method: "POST", body: { phone } },
  );
  return res.data;
}
