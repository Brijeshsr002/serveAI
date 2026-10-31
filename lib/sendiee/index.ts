import { isSendieeConfigured } from "./client";
import { getContactByPhone, upsertContact } from "./contacts";
import {
  assignConversation,
  getChatHistory,
  getConversation,
  listConversations,
  listConversationStatuses,
  setConversationStatus,
  unassignConversation,
} from "./conversations";
import { getMessageStatus, sendMessage, sendTemplate } from "./messages";

export { SendieeError, isSendieeConfigured } from "./client";

export const sendieeClient = {
  isConfigured: isSendieeConfigured,
  sendTemplate,
  sendMessage,
  getMessageStatus,
  upsertContact,
  getContactByPhone,
  listConversations,
  getConversation,
  getChatHistory,
  listConversationStatuses,
  setConversationStatus,
  assignConversation,
  unassignConversation,
};
