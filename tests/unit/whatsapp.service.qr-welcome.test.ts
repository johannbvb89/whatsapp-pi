import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetI18n } from '../../src/i18n.ts';

const SELF_JID_NORMALIZED = '5511999998888@s.whatsapp.net';

const baileysMocks = vi.hoisted(() => {
    const sockets: any[] = [];

    const createSocket = () => {
        const handlers = new Map<string, (event: any) => Promise<void>>();
        const socket = {
            handlers,
            user: { id: '5511999998888:0@s.whatsapp.net' },
            sendMessage: vi.fn().mockResolvedValue(undefined),
            ev: {
                on: vi.fn((event: string, handler: (event: any) => Promise<void>) => {
                    handlers.set(event, handler);
                }),
                removeAllListeners: vi.fn()
            },
            end: vi.fn()
        };
        sockets.push(socket);
        return socket;
    };

    return {
        sockets,
        makeWASocket: vi.fn(() => createSocket()),
        fetchLatestBaileysVersion: vi.fn().mockResolvedValue({ version: [2, 3000, 0] }),
        makeCacheableSignalKeyStore: vi.fn((_keys: any, _logger: any) => _keys),
        reset() {
            sockets.length = 0;
            this.makeWASocket.mockReset().mockImplementation(() => createSocket());
            this.fetchLatestBaileysVersion.mockReset().mockResolvedValue({ version: [2, 3000, 0] });
            this.makeCacheableSignalKeyStore.mockReset().mockImplementation((_keys: any, _logger: any) => _keys);
        }
    };
});

vi.mock('baileys', () => ({
    makeWASocket: baileysMocks.makeWASocket,
    fetchLatestBaileysVersion: baileysMocks.fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore: baileysMocks.makeCacheableSignalKeyStore,
    DisconnectReason: {
        loggedOut: 401,
        badSession: 500,
        connectionReplaced: 440
    }
}));

const createSessionManager = () => ({
    getAuthState: vi.fn().mockResolvedValue({
        state: { creds: {}, keys: {} },
        saveCreds: vi.fn().mockResolvedValue(undefined)
    }),
    markAuthStateAvailable: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue('connected'),
    setStatus: vi.fn().mockResolvedValue(undefined),
    setConnectionState: vi.fn().mockResolvedValue(undefined),
    getConnectionState: vi.fn().mockReturnValue({ status: 'connected', reconnectAttempts: 0, uptimeMs: 0 }),
    deleteAuthState: vi.fn().mockResolvedValue(undefined),
    isAllowed: vi.fn().mockReturnValue(true),
    isConversationAllowed: vi.fn().mockReturnValue(true),
    getAllowList: vi.fn().mockReturnValue([{ number: '+5511999998888' }]),
    getAllowedGroups: vi.fn().mockReturnValue([]),
    getOperatorJid: vi.fn().mockReturnValue(''),
    setOperatorJid: vi.fn().mockResolvedValue(undefined)
});

describe('WhatsAppService QR welcome message', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        resetI18n();
        baileysMocks.reset();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('sends welcome self-message and logs qrConnected after QR pairing', async () => {
        const { WhatsAppService } = await import('../../src/services/whatsapp.service.ts');
        const sessionManager = createSessionManager();
        const service = new WhatsAppService(sessionManager as any);

        await service.start();
        const socket = baileysMocks.sockets[0];

        await socket.handlers.get('connection.update')!({ qr: 'some-qr-string' });
        await socket.handlers.get('connection.update')!({ connection: 'open' });
        await Promise.resolve();

        expect(logSpy).toHaveBeenCalledWith('WhatsApp connected');
        expect(socket.sendMessage).toHaveBeenCalledOnce();
        expect(socket.sendMessage).toHaveBeenCalledWith(
            SELF_JID_NORMALIZED,
            expect.objectContaining({ text: expect.stringContaining('get started') })
        );

        await service.stop();
    });

    it('does not send welcome when connecting from saved credentials (no QR event)', async () => {
        const { WhatsAppService } = await import('../../src/services/whatsapp.service.ts');
        const sessionManager = createSessionManager();
        const service = new WhatsAppService(sessionManager as any);

        await service.start();
        const socket = baileysMocks.sockets[0];

        await socket.handlers.get('connection.update')!({ connection: 'open' });
        await Promise.resolve();

        expect(socket.sendMessage).not.toHaveBeenCalled();
        const welcomeCalls = logSpy.mock.calls.filter(args => args[0] === 'WhatsApp connected');
        expect(welcomeCalls).toHaveLength(0);

        await service.stop();
    });

    it('does not send welcome on a second connection open after initial QR pairing', async () => {
        const { WhatsAppService } = await import('../../src/services/whatsapp.service.ts');
        const sessionManager = createSessionManager();
        const service = new WhatsAppService(sessionManager as any);

        await service.start();
        const socket = baileysMocks.sockets[0];

        await socket.handlers.get('connection.update')!({ qr: 'some-qr-string' });
        await socket.handlers.get('connection.update')!({ connection: 'open' });
        await Promise.resolve();

        expect(socket.sendMessage).toHaveBeenCalledOnce();

        await socket.handlers.get('connection.update')!({ connection: 'open' });
        await Promise.resolve();

        expect(socket.sendMessage).toHaveBeenCalledOnce();

        await service.stop();
    });

    it('session stays connected when sendQrWelcome send fails', async () => {
        const { WhatsAppService } = await import('../../src/services/whatsapp.service.ts');
        const sessionManager = createSessionManager();
        const service = new WhatsAppService(sessionManager as any);

        await service.start();
        const socket = baileysMocks.sockets[0];
        socket.sendMessage.mockRejectedValue(new Error('network error'));

        await socket.handlers.get('connection.update')!({ qr: 'some-qr-string' });
        await socket.handlers.get('connection.update')!({ connection: 'open' });
        await Promise.resolve();

        expect(sessionManager.setConnectionState).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected' }));

        await service.stop();
    });
});
