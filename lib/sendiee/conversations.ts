import { sendieeRequest } from "./client";
import type { ChatHistory, ConversationLocator, ConversationSummary } from "./types";

/** GET /v2.0/chats/conversations. Scope: chats:read */
export async function listConversations(params: { search?: string; page?: number; limit?: number } = {}) {
  const res = await sendieeRequest<{ data: ConversationSummary[] }>("/v2.0/chats/conversations", {
    query: { brandNumber: process.env.SENDIEE_BRAND_NUMBER, ...params },
  });
  return res.data;
}

/** The documented API has no get-by-id; this looks the conversation up by phone via search. */
export async function getConversation(phone: string) {
  const rows = await listConversations({ search: phone, limit: 10 });
  return rows.find((c) => c.phone === phone) ?? null;
}

/** GET /v2.0/chats/history. Unknown phones return 404 CONTACT_NOT_FOUND. Scope: chats:read */
export function getChatHistory(phone: string, params: { limit?: number; before?: string } = {}) {
  return sendieeRequest<ChatHistory>("/v2.0/chats/history", {
    query: { phone, excludeInternal: true, brandNumber: process.env.SENDIEE_BRAND_NUMBER, ...params },
  });
}

/** GET /v2.0/conversations/statuses. Scope: conversations:read */
export async function listConversationStatuses() {
  const res = await sendieeRequest<{ data: { key: string; label: string; color: string }[] }>(
    "/v2.0/conversations/statuses",
  );
  return res.data;
}

/** POST /v2.0/conversations/status. Scope: conversations:write */
export async function setConversationStatus(locator: ConversationLocator, status: string) {
  const res = await sendieeRequest<{ data: { conversationId: string; status: string; statusFrom: string } }>(
    "/v2.0/conversations/status",
    { method: "POST", body: { ...locator, status } },
  );
  return res.data;
}

/** POST /v2.0/conversations/assign. Give agentId, teamId, or both. Scope: assignments:write */
export async function assignConversation(
  locator: ConversationLocator,
  assignee: { agentId?: string; teamId?: string },
) {
  const res = await sendieeRequest<{ data: { _id: string; assignedTeamId: string | null; assignedAgentId: string | null } }>(
    "/v2.0/conversations/assign",
    { method: "POST", body: { ...locator, ...assignee } },
  );
  return res.data;
}

/** POST /v2.0/conversations/unassign. Scope: assignments:write */
export async function unassignConversation(locator: ConversationLocator) {
  const res = await sendieeRequest<{ data: { _id: string } }>("/v2.0/conversations/unassign", {
    method: "POST",
    body: locator,
  });
  return res.data;
}
