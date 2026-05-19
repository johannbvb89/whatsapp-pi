export type SessionStatus =
    | 'logged-out'      // No credentials stored
    | 'disconnected'    // Credentials exist but not connected
    | 'connecting'      // Connection attempt in progress
    | 'connected'       // Socket open, messages flowing
    | 'reconnecting'    // Connection lost, reconnect in progress
    | 'pairing'         // QR code displayed for pairing
    | 'error';          // Connection error (check lastError for details)

/** Readiness: is the system actually ready to receive and reply to messages? */
export type ReadinessStatus =
    | 'ready'           // Socket open + at least one contact OR bound group authorized
    | 'groups-only'     // Socket open + groups authorized but 0 contacts and no bound group
    | 'no-contacts'     // Socket open but allowList empty and no groups
    | 'not-connected'   // Socket not open
    | 'no-credentials'; // No WhatsApp auth stored

/**
 * Full connection state persisted to config and available via /whatsapp-status.
 * All fields are optional to maintain backward compatibility.
 */
export interface ConnectionState {
    status: SessionStatus;
    lastError?: string;
    lastErrorTime?: number;
    connectedSince?: number;       // Timestamp when last successful connection was established
    lastMessageReceived?: number;  // Timestamp of last incoming message
    reconnectAttempts: number;
    uptimeMs: number;              // How long the current connection has been alive (0 when disconnected)
}

export interface WhatsAppSession {
    id: string;
    status: SessionStatus;
    credentialsPath: string;
}

export interface AllowList {
    numbers: string[];
}

export interface IncomingMessage {
    id: string;
    remoteJid: string;
    pushName?: string;
    text?: string;
    timestamp: number;
}

export interface MessageRequest {
    recipientJid: string;
    text: string;
    options?: {
        maxRetries?: number;
        priority?: 'high' | 'normal';
    };
}

export interface MessageResult {
    success: boolean;
    messageId?: string;
    error?: string;
    attempts: number;
}

export class WhatsAppError extends Error {
    constructor(public code: string, message: string) {
        super(message);
        this.name = 'WhatsAppError';
    }
}

export function validatePhoneNumber(number: string): boolean {
    return /^\+[1-9]\d{1,14}$/.test(number);
}

export interface DocumentMetadata {
    filename: string;
    mimetype: string;
    size: number;
    savedPath: string;
    timestamp: number;
}

export type MessageDirection = 'incoming' | 'outgoing';

export interface RecentConversationMessage {
    messageId: string;
    senderNumber: string;
    text: string;
    direction: MessageDirection;
    timestamp: number;
}

export interface RecentConversationSummary {
    senderNumber: string;
    senderName?: string;
    lastMessagePreview: string;
    lastMessageTime: number;
    lastMessageDirection: MessageDirection;
    messageCount: number;
    isAllowed: boolean;
}

export interface SelectedMessageContext {
    messageId: string;
    senderNumber: string;
    senderName?: string;
    text: string;
    direction: MessageDirection;
    timestamp: number;
}

export interface ReplyDraft {
    text: string;
    targetMessageId: string;
    targetConversation: string;
}

export interface ReplySendResult {
    success: boolean;
    messageId?: string;
    error?: string;
    attempts: number;
}

export interface RecentsStore {
    conversations: RecentConversationSummary[];
    messagesBySender: Record<string, RecentConversationMessage[]>;
    updatedAt: number;
}
