import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { SessionManager } from './src/services/session.manager.js';
import type { SessionStatus } from './src/models/whatsapp.types.js';
import { WhatsAppService } from './src/services/whatsapp.service.js';
import { MenuHandler } from './src/ui/menu.handler.js';
import { RecentsService } from './src/services/recents.service.js';
import { AudioService } from './src/services/audio.service.js';
import { extractIncomingText } from './src/services/incoming-message.resolver.js';
import { IncomingMediaService } from './src/services/incoming-media.service.js';
import { WhatsAppPiLogger } from './src/services/whatsapp-pi.logger.js';
import { initI18n, t } from './src/i18n.js';

export default function (pi: ExtensionAPI) {
    initI18n(pi);

    // Register WhatsApp-specific verbose flag (NOT Pi's built-in --verbose)
    pi.registerFlag("whatsapp-verbose", {
        description: "Enable WhatsApp-Pi verbose mode (show Baileys trace logs)",
        type: "boolean",
        default: false
    });

    pi.registerFlag("whatsapp-pi-online", {
        description: "Enable WhatsApp-Pi on startup",
        type: "boolean",
        default: false
    });

    pi.registerFlag("whatsapp-group", {
        description: "Bind this agent to a specific WhatsApp group JID (e.g. 120363012345@g.us). When set, only messages from this group are processed.",
        type: "string",
        default: ""
    });

    const sessionManager = new SessionManager();
    const whatsappService = new WhatsAppService(sessionManager);
    const recentsService = new RecentsService(sessionManager);
    const audioService = new AudioService();
    const logger = new WhatsAppPiLogger(false);
    const incomingMediaService = new IncomingMediaService(audioService, logger);
    const menuHandler = new MenuHandler(whatsappService, sessionManager, recentsService);
    let _ctx: ExtensionContext | undefined;



    // Initial status setup
    pi.on("session_start", async (_event, ctx) => {
        _ctx = ctx;
        logger.log('[WhatsApp-Pi] ========================================');
        logger.log('[WhatsApp-Pi] session_start: initializing...');

        // Check verbose mode via Pi's flag system
        const isVerbose = pi.getFlag("whatsapp-verbose") === true;
        logger.log(`[WhatsApp-Pi] --whatsapp-verbose: ${isVerbose}`);

        whatsappService.setVerboseMode(isVerbose);
        logger.setVerbose(isVerbose);

        if (isVerbose) {
            logger.log('[WhatsApp-Pi] Verbose mode enabled - Baileys trace logs will be shown');
        }

        // Check startup flags
        const isWhatsappPiOn = pi.getFlag("whatsapp-pi-online") === true;
        const boundGroupJid = (pi.getFlag("whatsapp-group") as string) || "";
        logger.log(`[WhatsApp-Pi] --whatsapp-pi-online: ${isWhatsappPiOn}`);
        logger.log(`[WhatsApp-Pi] --whatsapp-group: ${boundGroupJid || '(not set)'}`);

        // Push initial status — uses getEffectiveStatus() which checks socket reality
        const pushStatusToTui = (label: string) => {
            ctx.ui.setStatus('whatsapp', label);
        };
        pushStatusToTui('| WhatsApp: Disconnected');
        whatsappService.setStatusCallback(pushStatusToTui);

        // Set up group binding if configured
        if (boundGroupJid) {
            whatsappService.setGroupBinding(boundGroupJid);
            sessionManager.setGroupJidForAuth(boundGroupJid);
            logger.log(`[WhatsApp-Pi] Group-only mode: bound to ${boundGroupJid}`);
        }

        logger.log('[WhatsApp-Pi] Loading session state from disk...');
        await sessionManager.ensureInitialized();
        await recentsService.ensureInitialized();

        // Reset connection state — status from previous session is not inherited
        const loadedState = sessionManager.getConnectionState();
        logger.log(`[WhatsApp-Pi] Loaded state: status=${loadedState.status}`);
        whatsappService.setIncomingMessageRecorder(async (message) => {
            const isGroup = message.remoteJid.endsWith('@g.us');
            const senderNumber = isGroup
                ? message.remoteJid
                : `+${message.remoteJid.split('@')[0]}`;
            await recentsService.recordMessage({
                messageId: message.id,
                senderNumber,
                senderName: message.pushName,
                text: message.text || '',
                direction: 'incoming',
                timestamp: message.timestamp
            });
        });

        // Restore allow-list from Pi session state
        const savedStateEntry = [...ctx.sessionManager.getEntries()]
            .reverse()
            .find(entry => entry.type === "custom" && entry.customType === "whatsapp-state");
        const registered = await sessionManager.isRegistered();
        logger.log(`[WhatsApp-Pi] isRegistered: ${registered}`);

        if (savedStateEntry) {
            const data = (savedStateEntry as { data?: any }).data;
            if (data.status) {
                const restoredStatus: SessionStatus = data.status === 'connected' && !(isWhatsappPiOn && registered)
                    ? 'disconnected'
                    : data.status;
                await sessionManager.setConnectionState({ status: restoredStatus });
            }
            if (Array.isArray(data.allowList)) {
                for (const n of data.allowList) {
                    const num = typeof n === "string" ? n : n.number;
                    const name = typeof n === "string" ? undefined : n.name;
                    if (SessionManager.isGroupJid(num)) {
                        await sessionManager.addAllowedGroup(num, name);
                    } else {
                        await sessionManager.addNumber(num, name);
                    }
                }
            }
            if (Array.isArray(data.allowedGroups)) {
                for (const g of data.allowedGroups) {
                    const groupJid = typeof g === "string" ? g : g.number;
                    const name = typeof g === "string" ? undefined : g.name;
                    await sessionManager.addAllowedGroup(groupJid, name);
                }
            }
        }

        // Auto-connect if flag is set and credentials exist
        if (isWhatsappPiOn && registered) {
            logger.log('[WhatsApp-Pi] Auto-connect: credentials found, starting connection...');
            ctx.ui.setStatus('whatsapp', '| WhatsApp: Auto-connecting...');

            let attempts = 0;
            const maxAttempts = 4; // Initial + 3 retries

            const tryConnect = async (): Promise<boolean> => {
                attempts++;
                logger.log(`[WhatsApp-Pi] Connection attempt ${attempts}/${maxAttempts}`);
                try {
                    await sessionManager.setConnectionState({ status: 'connecting' });
                    await whatsappService.start({ allowPairingOnAuthFailure: false });
                    logger.log('[WhatsApp-Pi] Connection SUCCESS');
                    return true;
                } catch (error) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    logger.error(`[WhatsApp-Pi] Connection attempt ${attempts} FAILED: ${errMsg}`);
                    await sessionManager.setConnectionState({
                        status: 'error',
                        lastError: errMsg,
                        lastErrorTime: Date.now()
                    });

                    if (attempts < maxAttempts) {
                        ctx.ui.notify(`WhatsApp: Attempt ${attempts}/${maxAttempts} failed. Retrying in 3s...`, 'warning');
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        return tryConnect();
                    } else {
                        logger.error(`[WhatsApp-Pi] All ${maxAttempts} connection attempts FAILED`);
                        ctx.ui.notify('WhatsApp: Auto-connect failed after all attempts. Check logs for details.', 'error');
                        ctx.ui.setStatus('whatsapp', '| WhatsApp: Connection Failed');
                        await sessionManager.setConnectionState({ status: 'error' });
                        return false;
                    }
                }
            };

            const connected = await tryConnect();
            if (connected) {
                logger.log('[WhatsApp-Pi] Auto-connect: SUCCESS — WhatsApp is now online');
            } else {
                logger.error('[WhatsApp-Pi] Auto-connect: FAILED after all retries');
            }
        } else if (isWhatsappPiOn) {
            logger.log('[WhatsApp-Pi] Auto-connect: no saved credentials — manual QR pairing required');
            ctx.ui.notify('WhatsApp: Auto-connect requested, but no saved WhatsApp credentials were found. Use Connect WhatsApp once to scan the QR code.', 'warning');
        } else {
            logger.log('[WhatsApp-Pi] Auto-connect: flag not set — use /whatsapp to connect manually');
            ctx.ui.notify('WhatsApp: Use Connect / Reconnect WhatsApp. QR code will appear only if pairing is needed.', 'info');
        }

        logger.log('[WhatsApp-Pi] session_start: initialization complete');
        logger.log('[WhatsApp-Pi] ========================================');
    });

    // Track whether send_wa_message tool already sent a reply this turn
    let toolSentToJid: string | null = null;

    // Handle incoming messages by injecting them as user prompts
    whatsappService.setMessageCallback(async (m) => {
        const msg = m.messages?.[0];
        if (!msg?.message) return;

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid?.endsWith('@g.us') || false;
        const participant = isGroup ? (msg.key.participant?.split('@')[0] || 'unknown') : (remoteJid?.split('@')[0] || 'unknown');
        const sender = remoteJid?.split('@')[0] || "unknown";
        const pushName = msg.pushName || "WhatsApp User";

        // Mark as read and start typing indicator immediately
        if (remoteJid && msg.key.id) {
            whatsappService.markRead(remoteJid, msg.key.id, msg.key.fromMe);
            whatsappService.sendPresence(remoteJid, 'composing');
        }

        // Reset tool-sent flag for this new incoming message
        toolSentToJid = null;

        const resolved = extractIncomingText(msg.message);
        if (resolved.kind === 'system') {
            logger.log(`[WhatsApp-Pi] ${pushName} (${sender}): ${resolved.text}`);
            return;
        }

        const { text, imageBuffer, imageMimeType } = await incomingMediaService.process(resolved, pushName);

        // Format message header with group context when applicable
        const messageHeader = isGroup
            ? `Message from ${pushName} (${participant}) in group ${remoteJid}:`
            : `Message from ${pushName} (${sender}):`;

        logger.log(`[WhatsApp-Pi] ${messageHeader} ${text}`);

        // Use a standard delivery for ALL messages to ensure TUI consistency
        if (imageBuffer && imageMimeType) {
            pi.sendUserMessage([
                { type: "text", text: `${messageHeader} ${text}` },
                { type: "image", data: imageBuffer.toString('base64'), mimeType: imageMimeType }
            ], { deliverAs: "followUp" });
        } else {
            pi.sendUserMessage(`${messageHeader} ${text}`, { deliverAs: "followUp" });
        }

        // Handle commands
        if (text.trim().toLowerCase().startsWith('/compact')) {
            logger.log(`[WhatsApp-Pi] Session compact requested by ${pushName}.`);

            if (_ctx) {
                _ctx.compact();
                await whatsappService.sendMessage(remoteJid!, "Session compacted successfully! ✅");
            }
            return;
        }

        if (text.trim().toLowerCase().startsWith('/abort')) {
            logger.log(`[WhatsApp-Pi] Abort requested by ${pushName}.`);
            if (_ctx) {
                _ctx.abort();
                await whatsappService.sendMessage(remoteJid!, "Aborted! ✅");
            }
            return;
        }

        
    });

    // Register send_wa_message tool (LLM-callable)
    pi.registerTool({
        name: "send_wa_message",
        label: "Send WhatsApp Message",
        description: "Send a WhatsApp message to a contact or group. The 'jid' parameter is the WhatsApp JID (e.g. 5511999998888@s.whatsapp.net for contacts, or 120363012345@g.us for groups). If omitted, replies to the last conversation.",
        promptSnippet: "send_wa_message(jid, message) - Send a WhatsApp message. jid is required (e.g. 5511999998888@s.whatsapp.net or 120363012345@g.us). IMPORTANT: After calling this tool, do NOT generate any follow-up text or confirmation — the message is already delivered to WhatsApp. Your entire response to the user should be sent ONLY through this tool, not repeated in chat.",
        parameters: Type.Object({
            jid: Type.Optional(Type.String({ description: "WhatsApp JID of the recipient" })),
            recipient_jid: Type.Optional(Type.String({ description: "Alternative name for jid" })),
            message: Type.String({ minLength: 1, description: "Plain-text message content to send" })
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            // Resolve JID: jid > recipient_jid > lastRemoteJid > operatorJid (QR-scanned number)
            const resolvedJid = params.jid || params.recipient_jid || whatsappService.getLastRemoteJid() || whatsappService.getOperatorJid();
            if (!resolvedJid) {
                return {
                    isError: true,
                    details: undefined,
                    content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "No JID provided and no active conversation to reply to", attempts: 0 }) }]
                };
            }

            if (whatsappService.getEffectiveStatus() !== 'connected') {
                const state = sessionManager.getConnectionState();
                const detailMsg = state.lastError
                    ? ` (status: ${state.status}, last error: ${state.lastError})`
                    : ` (status: ${state.status})`;
                return {
                    isError: true,
                    details: undefined,
                    content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `${t("tool.error.notConnected")}${detailMsg}`, attempts: 0 }) }]
                };
            }

            const formattedMessage = params.message
                .split('\n')
                .map((line) => `    ${line}`)
                .join('\n');

            console.log([
                t("log.outgoing.title"),
                t("log.outgoing.to", { jid: params.jid }),
                t("log.outgoing.message"),
                formattedMessage
            ].join('\n'));

            const result = await whatsappService.sendMessage(resolvedJid, params.message);

            if (result.success) {
                // Mark that tool already sent to this JID — prevents message_end from re-sending
                toolSentToJid = resolvedJid;
                const isGroupJid = resolvedJid.endsWith('@g.us');
                const senderNumber = isGroupJid ? resolvedJid : `+${resolvedJid.split('@')[0]}`;
                await recentsService.recordMessage({
                    messageId: result.messageId!,
                    senderNumber,
                    text: params.message,
                    direction: 'outgoing',
                    timestamp: Date.now()
                });
                console.log([
                    t("log.result.title"),
                    t("log.outgoing.to", { jid: params.jid }),
                    t("log.result.status.sent"),
                    t("log.result.messageId", { messageId: result.messageId ?? t("log.unknownMessageId") })
                ].join('\n'));
            } else {
                console.log([
                    t("log.result.title"),
                    t("log.outgoing.to", { jid: params.jid }),
                    t("log.result.status.failed"),
                    t("log.result.error", { error: result.error ?? t("log.unknownError") })
                ].join('\n'));
            }

            return {
                isError: !result.success,
                details: undefined,
                content: [{ type: "text" as const, text: JSON.stringify({ success: result.success, messageId: result.messageId, error: result.error, attempts: result.attempts }) }]
            };
        }
    });

    // Suppress automatic message_end reply when tool already sent
    // This is checked by the message_end handler below

    // Register commands
    pi.registerCommand("whatsapp", {
        description: t("command.whatsapp.description"),
        handler: async (args, ctx) => {
            _ctx = ctx;
            await menuHandler.handleCommand(ctx);

            // Persist state after changes
            pi.appendEntry("whatsapp-state", {
                status: sessionManager.getStatus(),
                allowList: sessionManager.getAllowList(),
                allowedGroups: sessionManager.getAllowedGroups()
            });
        }
    });

    // WhatsApp connection status & diagnostics command
    pi.registerCommand("whatsapp-status", {
        description: "Show WhatsApp connection status and diagnostics",
        handler: async (_args, ctx) => {
            const state = sessionManager.getConnectionState();
            const effectiveStatus = whatsappService.getEffectiveStatus();
            const socket = whatsappService.getSocket();
            const uptimeSec = effectiveStatus === 'connected' ? Math.floor(whatsappService.getUptimeMs() / 1000) : 0;

            const lines = [
                `📱 WhatsApp-Pi Status Report`,
                `================================`,
                `Config Status:      ${state.status}`,
                `Effective Status:   ${effectiveStatus}`,
                `Socket Active:      ${socket ? '✅ YES' : '❌ NO'}`,
                `Credentials:        ${await sessionManager.isRegistered() ? '✅ VALID' : '❌ MISSING'}`,
                `Operator JID:       ${sessionManager.getOperatorJid() || '(not set)'}`,
            ];

            if (effectiveStatus === 'connected') {
                lines.push(``);
                lines.push(`Connected Since:    ${state.connectedSince ? new Date(state.connectedSince).toISOString() : 'unknown'}`);
                lines.push(`Uptime:             ${uptimeSec}s (${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s)`);
                lines.push(`Reconnect Attempts: ${state.reconnectAttempts}`);
            }

            if (state.status === 'error' || effectiveStatus === 'disconnected') {
                lines.push(``);
                lines.push(`Last Error:         ${state.lastError || '(none)'}`);
                if (state.lastErrorTime) {
                    lines.push(`Last Error Time:    ${new Date(state.lastErrorTime).toISOString()}`);
                }
            }

            lines.push(``);
            lines.push(`Last Msg Received:  ${state.lastMessageReceived ? new Date(state.lastMessageReceived).toISOString() : 'never'}`);
            lines.push(`Bound Group:        ${whatsappService.getBoundGroupJid() || '(none)'}`);
            lines.push(`Verbose Mode:       ${whatsappService.isVerbose() ? 'ON' : 'OFF'}`);

            ctx.ui.notify(lines.join('\n'), 'info');
        }
    });

    // Handle outgoing messages (Agent -> WhatsApp)
    pi.on("agent_start", async (_event, _ctx) => {
        if (whatsappService.getEffectiveStatus() !== 'connected') return;
        const lastJid = whatsappService.getLastRemoteJid();
        if (lastJid) {
            await whatsappService.sendPresence(lastJid, 'composing');
        }
    });

    pi.on("message_end", async (event, ctx) => {
        if (whatsappService.getEffectiveStatus() !== 'connected') return;

        const { message } = event;
        // Only reply if it's the assistant and we have a valid target
        if (message.role === "assistant") {
            const lastJid = whatsappService.getLastRemoteJid();
            const text = message.content.filter(c => c.type === "text").map(c => c.text).join("\n");

            // Skip if send_wa_message tool already sent a reply to this JID
            if (toolSentToJid === lastJid) {
                toolSentToJid = null;
                return;
            }

            if (lastJid && text) {
                try {
                    const result = await whatsappService.sendMessage(lastJid, text);
                    if (result.success) {
                        await recentsService.recordMessage({
                            messageId: result.messageId ?? `${Date.now()}`,
                            senderNumber: `+${lastJid.split('@')[0]}`,
                            text,
                            direction: 'outgoing',
                            timestamp: Date.now()
                        });
                        ctx.ui.notify(t("notify.replySent"), 'info');
                    } else {
                        ctx.ui.notify(t("notify.replyFailed"), 'error');
                    }
                } catch {
                    ctx.ui.notify(t("notify.replyFailed"), 'error');
                }
            }
        }
    });

    pi.on("session_shutdown", async () => {
        logger.log("[WhatsApp-Pi] Session shutdown detected. Stopping WhatsApp service...");
        await whatsappService.stop();
        await sessionManager.flushPendingSave();
    });
}
