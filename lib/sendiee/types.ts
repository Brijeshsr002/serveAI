// Shapes taken from https://docs.sendiee.com (v2.0).

export type SendTemplateInput = {
  to: string;
  templateName: string;
  language?: string;
  bodyParameters?: string[];
};

export type FreeformType = "text" | "image" | "document" | "audio" | "video";

export type FreeformContent =
  | { body: string }
  | { link: string; caption?: string; filename?: string };

export type SendResult = { messageId: string; status: string; recipient: string };

export type ConversationSummary = {
  conversationId: string;
  phone: string;
  contactName: string | null;
  brandNumber: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isArchived: boolean;
};

export type ChatHistoryMessage = {
  messageId: string;
  wamid: string | null;
  direction: "inbound" | "outbound";
  internal: boolean;
  status: string | null;
  type: string;
  text: string | null;
  createdAt: string;
};

export type ChatHistory = {
  data: ChatHistoryMessage[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
  contact: { phone: string; window: { open: boolean; lastInboundAt: string | null; closesAt: string | null } };
};

export type ConversationLocator = { conversationId: string } | { phone: string };
