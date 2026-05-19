import { SessionManager } from '../../src/services/session.manager.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('SessionManager', () => {
    let sessionManager: SessionManager;
    let dataDir: string;

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'whatsapp-pi-session-'));
        sessionManager = new SessionManager(dataDir);
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
    });

    it('should initialize with logged-out status', () => {
        expect(sessionManager.getStatus()).toBe('logged-out');
    });

    it('should set and get status', async () => {
        await sessionManager.setStatus('connected');
        expect(sessionManager.getStatus()).toBe('connected');
    });

    it('should clear session directory and recreate auth folder', async () => {
        const authDir = sessionManager.getAuthStateDir();
        sessionManager.setStatus('connected');
        
        await sessionManager.deleteAuthState();
        
        expect(sessionManager.getStatus()).toBe('logged-out');
        
        let exists = true;
        try {
            await access(authDir);
        } catch {
            exists = false;
        }
        expect(exists).toBe(true);
    });

    it('should remember auth state once credentials exist on disk', async () => {
        await mkdir(sessionManager.getAuthStateDir(), { recursive: true });
        await writeFile(join(sessionManager.getAuthStateDir(), 'creds.json'), '{}');
        await sessionManager.markAuthStateAvailable();
        expect(await sessionManager.isRegistered()).toBe(true);
    });

    it('should not trust stale config when credentials are missing from disk', async () => {
        await sessionManager.markAuthStateAvailable();

        expect(await sessionManager.isRegistered()).toBe(false);
    });

    it('should not save stale missing auth state when credentials exist on disk', async () => {
        await mkdir(sessionManager.getAuthStateDir(), { recursive: true });
        await writeFile(join(sessionManager.getAuthStateDir(), 'creds.json'), '{}');

        await sessionManager.setStatus('disconnected');

        const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf-8'));
        expect(config.hasAuthState).toBe(true);
        expect(await sessionManager.isRegistered()).toBe(true);
    });

    it('should recover and rewrite a config file with trailing data', async () => {
        const configPath = join(dataDir, 'config.json');
        await writeFile(configPath, [
            '{',
            '  "allowList": [{ "number": "+1234567890", "name": "Ana" }, { "number": "120363012345@g.us", "name": "Team" }],',
            '  "allowedGroups": [],',
            '  "ignoredNumbers": [],',
            '  "status": "connected",',
            '  "hasAuthState": false,',
            '  "openaiKey": "",',
            '  "visionModel": "gpt-4o"',
            '} trailing-data'
        ].join('\n'));

        await sessionManager.ensureInitialized();

        expect(sessionManager.getAllowList()).toEqual([{ number: '+1234567890', name: 'Ana' }]);
        expect(sessionManager.getAllowedGroups()).toEqual([{ number: '120363012345@g.us', name: 'Team' }]);
        expect(sessionManager.getStatus()).toBe('disconnected');
        const rewrittenConfig = await readFile(configPath, 'utf-8');
        expect(() => JSON.parse(rewrittenConfig)).not.toThrow();
    });

    it('should manage allowed groups separately from allowed numbers', async () => {
        const groupJid = '120363012345@g.us';
        await sessionManager.addAllowedGroup(groupJid, 'Team');

        expect(sessionManager.isAllowedGroup(groupJid)).toBe(true);
        expect(sessionManager.isConversationAllowed(groupJid)).toBe(true);
        expect(sessionManager.isAllowed(groupJid)).toBe(false);
        expect(sessionManager.getAllowList()).toEqual([]);
        expect(sessionManager.getAllowedGroups()).toEqual([{ number: groupJid, name: 'Team' }]);

        await sessionManager.removeAllowedGroup(groupJid);
        expect(sessionManager.isAllowedGroup(groupJid)).toBe(false);
    });

    it('should store and retrieve contact names', async () => {
        const num = '+1234567890';
        const name = 'John Doe';
        
        await sessionManager.addNumber(num, name);
        const allowList = sessionManager.getAllowList();
        
        expect(allowList).toHaveLength(1);
        expect(allowList[0].number).toBe(num);
        expect(allowList[0].name).toBe(name);
    });

    it('should add and remove an alias for an existing allowed number', async () => {
        const num = '+1234567890';
        const alias = 'My Contact';

        await sessionManager.addNumber(num);
        await sessionManager.setAllowedContactAlias(num, alias);

        let allowList = sessionManager.getAllowList();
        expect(allowList[0].name).toBe(alias);

        await sessionManager.removeAllowedContactAlias(num);
        allowList = sessionManager.getAllowList();
        expect(allowList[0].name).toBeUndefined();
    });

    it('should add and remove an alias for an existing allowed group', async () => {
        const groupJid = '120363012345@g.us';
        const alias = 'Team Chat';

        await sessionManager.addAllowedGroup(groupJid);
        await sessionManager.setAllowedGroupAlias(groupJid, alias);

        let allowedGroups = sessionManager.getAllowedGroups();
        expect(allowedGroups[0].name).toBe(alias);

        await sessionManager.removeAllowedGroupAlias(groupJid);
        allowedGroups = sessionManager.getAllowedGroups();
        expect(allowedGroups[0].name).toBeUndefined();
    });

    it('should ignore legacy passive reaction mode when loading groups', async () => {
        const configPath = join(dataDir, 'config.json');
        await writeFile(configPath, JSON.stringify({
            allowList: [],
            allowedGroups: [{ number: '120363012345@g.us', name: 'Team', reactionMode: 'passive' }],
            ignoredNumbers: [],
            status: 'connected',
            hasAuthState: false,
            openaiKey: '',
            visionModel: 'gpt-4o'
        }, null, 2));

        await sessionManager.ensureInitialized();

        expect(sessionManager.getAllowedGroups()).toEqual([{ number: '120363012345@g.us', name: 'Team' }]);
    });

    // === PERSISTENCE CYCLE TESTS (Phase 5 — would have caught config overwrite bugs) ===

    it('should persist contacts across save → reload cycle', async () => {
        await sessionManager.addNumber('+5511999998888', 'Ana');

        // Create a new SessionManager reading the same config directory
        const sm2 = new SessionManager(dataDir);
        await sm2.ensureInitialized();

        const allowList = sm2.getAllowList();
        expect(allowList).toHaveLength(1);
        expect(allowList[0].number).toBe('+5511999998888');
        expect(allowList[0].name).toBe('Ana');
    });

    it('should persist removed contacts across save → reload cycle', async () => {
        await sessionManager.addNumber('+5511999998888');
        await sessionManager.removeNumber('+5511999998888');

        const sm2 = new SessionManager(dataDir);
        await sm2.ensureInitialized();

        expect(sm2.getAllowList()).toEqual([]);
    });

    it('should persist groups across save → reload cycle', async () => {
        await sessionManager.addAllowedGroup('120363012345@g.us', 'Team');

        const sm2 = new SessionManager(dataDir);
        await sm2.ensureInitialized();

        const groups = sm2.getAllowedGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0].number).toBe('120363012345@g.us');
        expect(groups[0].name).toBe('Team');
    });

    it('should persist 3 rapid additions as a single write', async () => {
        // Rapid additions — each calls flushConfig() directly now (no debounce)
        await sessionManager.addNumber('+111');
        await sessionManager.addNumber('+222');
        await sessionManager.addNumber('+333');

        const sm2 = new SessionManager(dataDir);
        await sm2.ensureInitialized();

        // All 3 must survive
        expect(sm2.getAllowList()).toHaveLength(3);
        const numbers = sm2.getAllowList().map(c => c.number);
        expect(numbers).toContain('+111');
        expect(numbers).toContain('+222');
        expect(numbers).toContain('+333');
    });

    // === DOUBLE-INIT GUARD TESTS ===

    it('should not lose contacts when ensureInitialized() is called twice', async () => {
        await sessionManager.ensureInitialized();
        await sessionManager.addNumber('+5511999998888');

        // Second init — must be a no-op, NOT reload from disk
        await sessionManager.ensureInitialized();

        expect(sessionManager.getAllowList()).toHaveLength(1);
        expect(sessionManager.getAllowList()[0].number).toBe('+5511999998888');
    });

    it('should not lose in-memory state when ensureInitialized() races with mutation', async () => {
        await sessionManager.ensureInitialized();
        await sessionManager.addNumber('+5511999998888');

        // Simulate second init (like a session event trigger)
        await sessionManager.ensureInitialized();

        // State must be preserved — contact still there
        expect(sessionManager.getAllowList()).toHaveLength(1);

        // Config on disk must also have the contact
        const sm2 = new SessionManager(dataDir);
        await sm2.ensureInitialized();
        expect(sm2.getAllowList()).toHaveLength(1);
    });

    // === CONNECTION STATE TESTS ===

    it('should persist connection state across set → reload cycle', async () => {
        await sessionManager.ensureInitialized();
        await sessionManager.setConnectionState({
            status: 'connected',
            connectedSince: Date.now(),
            reconnectAttempts: 3
        });

        // Drain debounce — setConnectionState uses saveConfig (debounced 200ms)
        await (sessionManager as any).flushPendingSave();

        const sm2 = new SessionManager(dataDir);
        await sm2.ensureInitialized();

        const state = sm2.getConnectionState();
        // Status resets to disconnected (transient status logic in loadConfig)
        expect(state.status).toBe('disconnected');
        // But reconnectAttempts should survive
        expect(state.reconnectAttempts).toBe(3);
    });

    // === CONFIG RECOVERY TESTS ===

    it('should recover from missing config file with defaults', async () => {
        // No config written — ensureInitialized should not throw
        await sessionManager.ensureInitialized();
        // syncAuthStateFromDisk forces 'disconnected' when no creds exist
        expect(sessionManager.getStatus()).toBe('disconnected');
        expect(sessionManager.getAllowList()).toEqual([]);
        expect(sessionManager.getAllowedGroups()).toEqual([]);
    });

    it('should recover from empty config file without throwing', async () => {
        const configPath = join(dataDir, 'config.json');
        await writeFile(configPath, '');

        // Should not throw
        await sessionManager.ensureInitialized();
        expect(sessionManager.getAllowList()).toEqual([]);
    });

    it('should unroll deeply nested number objects', async () => {
        await sessionManager.addNumber({
            number: { number: { number: '+5511999998888' } }
        });

        const allowList = sessionManager.getAllowList();
        expect(allowList).toHaveLength(1);
        expect(allowList[0].number).toBe('+5511999998888');
    });

    it('should correctly route group JIDs to allowedGroups even from addNumber', async () => {
        await sessionManager.addNumber('120363012345@g.us', 'Test Group');

        // Should NOT be in allowList
        expect(sessionManager.getAllowList()).toEqual([]);
        // Should be in allowedGroups
        expect(sessionManager.getAllowedGroups()).toHaveLength(1);
        expect(sessionManager.getAllowedGroups()[0].number).toBe('120363012345@g.us');
        expect(sessionManager.getAllowedGroups()[0].name).toBe('Test Group');
    });
});
