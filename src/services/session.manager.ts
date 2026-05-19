import { useMultiFileAuthState } from 'baileys';
import { join } from 'path';
import { readFile, writeFile, mkdir, rm, rename } from 'fs/promises';
import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { SessionStatus, ConnectionState } from '../models/whatsapp.types.js';
import { t } from '../i18n.js';

export interface Contact {
    number: string;
    name?: string;
    sendNumber?: string;
}

export class SessionManager {
    // Data is stored in the user's home directory to persist across updates
    private readonly baseDir = join(homedir(), '.pi', 'whatsapp-pi');
    private authStateDir = join(this.baseDir, 'auth');
    private readonly configPath = join(this.baseDir, 'config.json');

    static isGroupJid(jid: string): boolean {
        return jid.endsWith('@g.us');
    }

    /**
     * Sets a group-specific auth directory so each agent bound to a group
     * registers as its own WhatsApp linked device.
     */
    setGroupJidForAuth(groupJid: string) {
        const sanitized = groupJid.replace(/[^a-zA-Z0-9]/g, '_');
        this.authStateDir = join(this.baseDir, `auth-${sanitized}`);
    }

    private connectionState: ConnectionState = {
        status: 'logged-out',
        reconnectAttempts: 0,
        uptimeMs: 0
    };
    private allowList: Contact[] = [];
    private allowedGroups: Contact[] = [];
    private ignoredNumbers: Contact[] = [];
    private hasAuthState = false;
    private openaiKey: string = '';
    private visionModel: string = 'gpt-4o';
    private operatorJid: string = '';
    private _initPromise: Promise<void> | null = null;
    private _initialized = false;
    private _saveTimer: ReturnType<typeof setTimeout> | null = null;
    private _savePending = false;

    constructor(baseDir = join(homedir(), '.pi', 'whatsapp-pi')) {
        this.baseDir = baseDir;
        this.authStateDir = join(this.baseDir, 'auth');
        this.configPath = join(this.baseDir, 'config.json');
    }

    private async ensureStorageDirectories() {
        await mkdir(this.baseDir, { recursive: true });
        await mkdir(this.authStateDir, { recursive: true });
    }

    public async ensureInitialized() {
        if (this._initialized) {
            console.warn(`[SessionManager] ensureInitialized called AGAIN (PID ${process.pid}) — skipping reload to prevent state reset`);
            return;
        }
        // Prevent concurrent initialization races
        if (this._initPromise) {
            return this._initPromise;
        }
        this._initPromise = (async () => {
            try {
                await this.ensureStorageDirectories();
                await this.loadConfig();
                await this.syncAuthStateFromDisk();
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error(`[SessionManager] ensureInitialized FAILED: ${msg}`);
            }
        })();
        try {
            await this._initPromise;
            this._initialized = true;
        } finally {
            this._initPromise = null;
        }
    }

    private async loadConfig() {
        try {
            const data = await readFile(this.configPath, 'utf-8');
            const { config, recovered } = this.parseConfig(data);
            
            const cleanContact = (item: any): Contact | null => {
                if (typeof item === 'string') return { number: item };
                if (item && typeof item === 'object') {
                    let num = item.number;
                    // Unroll nested objects if any
                    while (num && typeof num === 'object' && num.number) {
                        num = num.number;
                    }
                    if (typeof num === 'string') {
                        const sendNumber = typeof item.sendNumber === 'string' ? item.sendNumber : undefined;
                        return { number: num, name: item.name, sendNumber };
                    }
                }
                return null;
            };

            const loadedAllowList = (config.allowList || []).map(cleanContact).filter(Boolean) as Contact[];
            const loadedAllowedGroups = (config.allowedGroups || []).map(cleanContact).filter(Boolean) as Contact[];
            const migratedGroups = loadedAllowList.filter(c => SessionManager.isGroupJid(c.number));
            this.allowList = loadedAllowList.filter(c => !SessionManager.isGroupJid(c.number));
            this.allowedGroups = this.mergeContacts(loadedAllowedGroups, migratedGroups);
            this.ignoredNumbers = (config.ignoredNumbers || []).map(cleanContact).filter(Boolean) as Contact[];
            // Load connection state from config, resetting transient statuses
            const loadedStatus: SessionStatus = config.status || 'logged-out';
            const isTransientStatus = loadedStatus === 'connected' || loadedStatus === 'connecting' || loadedStatus === 'reconnecting';
            this.connectionState = {
                status: isTransientStatus ? 'disconnected' : loadedStatus,
                lastError: config.lastError || undefined,
                lastErrorTime: config.lastErrorTime || undefined,
                connectedSince: isTransientStatus ? undefined : (config.connectedSince || undefined),
                lastMessageReceived: config.lastMessageReceived || undefined,
                reconnectAttempts: config.reconnectAttempts || 0,
                uptimeMs: 0  // Always reset on load — connection is not inherited
            };
            this.hasAuthState = Boolean(config.hasAuthState);
            this.openaiKey = config.openaiKey || '';
            this.visionModel = config.visionModel || 'gpt-4o';
            this.operatorJid = config.operatorJid || '';

            if (recovered) {
                await this.flushConfig();
            }
        } catch {
            // File not found is fine
        }
    }

    private parseConfig(data: string): { config: any; recovered: boolean } {
        try {
            return { config: JSON.parse(data), recovered: false };
        } catch (error) {
            const objectEnd = this.findFirstJsonObjectEnd(data);
            if (objectEnd < 0) {
                throw error;
            }

            return {
                config: JSON.parse(data.slice(0, objectEnd + 1)),
                recovered: true
            };
        }
    }

    private findFirstJsonObjectEnd(data: string): number {
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = 0; i < data.length; i++) {
            const char = data[i];

            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }

            if (char === '"') {
                inString = true;
                continue;
            }

            if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }

        return -1;
    }

    /**
     * Debounced save — coalesces rapid writes within 200ms into a single flush.
     * Callers that need guaranteed persistence (e.g. shutdown) use flushConfig().
     */
    public async saveConfig() {
        this._savePending = true;
        if (this._saveTimer) {
            return; // Already scheduled
        }
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            void this.flushConfig();
        }, 200);
    }

    /**
     * Immediate, non-debounced config write. Used by syncAuthStateFromDisk()
     * and critical paths that must persist without delay.
     */
    private async flushConfig() {
        this._savePending = false;
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        const tempPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
        try {
            this.hasAuthState = this.hasAuthState || await this.hasCredentialsFile();
            const config = {
                allowList: this.allowList,
                allowedGroups: this.allowedGroups,
                ignoredNumbers: this.ignoredNumbers,
                status: this.connectionState.status,
                hasAuthState: this.hasAuthState,
                openaiKey: this.openaiKey,
                visionModel: this.visionModel,
                operatorJid: this.operatorJid,
                lastError: this.connectionState.lastError,
                lastErrorTime: this.connectionState.lastErrorTime,
                connectedSince: this.connectionState.connectedSince,
                lastMessageReceived: this.connectionState.lastMessageReceived,
                reconnectAttempts: this.connectionState.reconnectAttempts
            };
            await mkdir(this.baseDir, { recursive: true });
            const serialized = JSON.stringify(config, null, 2);

            // AUDIT LOG: trace every config write (sync — must not race with test cleanup)
            // Always writes to production path, never test temp dirs
            const auditDir = join(homedir(), '.pi', 'whatsapp-pi');
            const auditPath = join(auditDir, 'config-audit.log');
            const stackTrace = new Error().stack?.split('\n').slice(2, 7).map(s => s.trim()).join(' ← ') || 'no-stack';
            const auditEntry = JSON.stringify({
                ts: new Date().toISOString(),
                pid: process.pid,
                allowListLen: this.allowList.length,
                allowedGroupsLen: this.allowedGroups.length,
                status: this.connectionState.status,
                stack: stackTrace
            });
            try { mkdirSync(auditDir, { recursive: true }); appendFileSync(auditPath, auditEntry + '\n'); } catch { /* best-effort diagnostic */ }

            // Write with retry for Windows robustness
            let written = false;
            for (let attempt = 0; attempt < 3 && !written; attempt++) {
                try {
                    await writeFile(tempPath, serialized);
                    const stat = await readFile(tempPath);
                    if (stat.length === 0) {
                        throw new Error('writeFile produced zero-byte file');
                    }
                    written = true;
                } catch (writeError) {
                    if (attempt === 2) throw writeError;
                    await new Promise(r => setTimeout(r, 100));
                }
            }
            try {
                await rename(tempPath, this.configPath);
            } catch {
                // Windows EPERM: atomic rename failed (file locked). Fall back to direct write.
                console.warn(`[SessionManager] rename failed (EPERM?), falling back to direct write`);
                // Retry direct write on fallback path
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        await writeFile(this.configPath, serialized);
                        break;
                    } catch (writeError) {
                        if (attempt === 2) throw writeError;
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
                await rm(tempPath, { force: true }).catch(() => {});
            }
        } catch (error) {
            console.error(`[SessionManager] flushConfig FAILED: ${error instanceof Error ? error.message : String(error)}`);
            await rm(tempPath, { force: true }).catch(() => {});
            console.error(t('session.manager.failedSaveConfig'), error);
        }
    }

    /**
     * Ensures any pending debounced save is flushed. Call before shutdown.
     */
    async flushPendingSave(): Promise<void> {
        if (this._savePending) {
            await this.flushConfig();
        }
    }

    getAllowList(): Contact[] {
        return this.allowList;
    }

    getAllowedContact(number: string): Contact | undefined {
        return this.allowList.find(c => c.number === number);
    }

    getAllowedGroups(): Contact[] {
        return this.allowedGroups;
    }

    getAllowedGroup(groupJid: string): Contact | undefined {
        return this.allowedGroups.find(c => c.number === groupJid);
    }

    getIgnoredNumbers(): Contact[] {
        return this.ignoredNumbers;
    }

    async removeIgnoredNumber(number: string) {
        this.ignoredNumbers = this.ignoredNumbers.filter(c => c.number !== number);
        await this.saveConfig();
    }

    async addNumber(number: any, name?: string) {
        // Handle potential nested objects from legacy bugs
        let cleanNumber = number;
        while (cleanNumber && typeof cleanNumber === 'object' && cleanNumber.number) {
            cleanNumber = cleanNumber.number;
        }

        if (typeof cleanNumber !== 'string') {
            console.warn(t('session.manager.invalidNumber'), cleanNumber);
            return;
        }

        const existing = this.allowList.find(c => c.number === cleanNumber);
        if (!existing) {
            if (SessionManager.isGroupJid(cleanNumber)) {
                await this.addAllowedGroup(cleanNumber, name);
                return;
            }
            this.allowList.push({ number: cleanNumber, name });
            this.ignoredNumbers = this.ignoredNumbers.filter(c => c.number !== cleanNumber);
            await this.flushConfig();
            return;
        }

        if (name && !existing.name) {
            existing.name = name;
            await this.flushConfig();
        }
    }

    async removeNumber(number: string) {
        this.allowList = this.allowList.filter(c => c.number !== number);
        await this.flushConfig();
    }

    async addAllowedGroup(groupJid: string, name?: string) {
        if (!SessionManager.isGroupJid(groupJid)) {
            console.warn(t('session.manager.invalidNumber'), groupJid);
            return;
        }

        const existing = this.allowedGroups.find(c => c.number === groupJid);
        if (!existing) {
            this.allowedGroups.push({ number: groupJid, name });
            this.ignoredNumbers = this.ignoredNumbers.filter(c => c.number !== groupJid);
            await this.flushConfig();
            return;
        }

        if (name && !existing.name) {
            existing.name = name;
            await this.flushConfig();
        }
    }

    async removeAllowedGroup(groupJid: string) {
        this.allowedGroups = this.allowedGroups.filter(c => c.number !== groupJid);
        await this.flushConfig();
    }

    async setAllowedContactAlias(number: string, alias: string) {
        const trimmedAlias = alias.trim();
        if (!trimmedAlias) {
            return;
        }

        const contact = this.getAllowedContact(number);
        if (!contact) {
            return;
        }

        contact.name = trimmedAlias;
        await this.saveConfig();
    }

    async removeAllowedContactAlias(number: string) {
        const contact = this.getAllowedContact(number);
        if (!contact || !contact.name) {
            return;
        }

        delete contact.name;
        await this.saveConfig();
    }

    async setContactSendNumber(number: string, sendNumber: string) {
        const contact = this.getAllowedContact(number);
        if (!contact) return;
        contact.sendNumber = sendNumber.trim();
        await this.saveConfig();
    }

    async removeContactSendNumber(number: string) {
        const contact = this.getAllowedContact(number);
        if (!contact) return;
        delete contact.sendNumber;
        await this.saveConfig();
    }

    async setAllowedGroupAlias(groupJid: string, alias: string) {
        const trimmedAlias = alias.trim();
        if (!trimmedAlias) {
            return;
        }

        const group = this.getAllowedGroup(groupJid);
        if (!group) {
            return;
        }

        group.name = trimmedAlias;
        await this.saveConfig();
    }

    async removeAllowedGroupAlias(groupJid: string) {
        const group = this.getAllowedGroup(groupJid);
        if (!group || !group.name) {
            return;
        }

        delete group.name;
        await this.saveConfig();
    }

    isAllowed(number: string): boolean {
        return this.allowList.some(c => c.number === number);
    }

    isAllowedGroup(groupJid: string): boolean {
        return this.allowedGroups.some(c => c.number === groupJid);
    }

    isConversationAllowed(sender: string): boolean {
        return SessionManager.isGroupJid(sender)
            ? this.isAllowedGroup(sender)
            : this.isAllowed(sender);
    }

    async trackIgnoredNumber(number: string, name?: string) {
        // Only track if not already allowed or ignored.
        if (!this.isConversationAllowed(number) &&
            !this.ignoredNumbers.find(c => c.number === number)) {
            this.ignoredNumbers.push({ number, name });
            await this.saveConfig();
        }
    }

    private mergeContacts(primary: Contact[], secondary: Contact[]): Contact[] {
        const merged = [...primary];
        for (const contact of secondary) {
            const existing = merged.find(c => c.number === contact.number);
            if (!existing) {
                merged.push(contact);
            } else {
                if (!existing.name && contact.name) {
                    existing.name = contact.name;
                }
            }
        }
        return merged;
    }

    /**
     * Returns true if valid WhatsApp credentials (creds.json) exist on disk.
     * Does NOT depend on config.json being loaded first — checks the file directly.
     * This is the single source of truth for "can we auto-connect?".
     */
    public async isRegistered(): Promise<boolean> {
        const fileExists = await this.hasCredentialsFile();
        // Sync internal state if it drifted
        if (fileExists !== this.hasAuthState) {
            this.hasAuthState = fileExists;
        }
        return fileExists;
    }

    async markAuthStateAvailable() {
        if (!this.hasAuthState) {
            this.hasAuthState = true;
            await this.saveConfig();
        }
    }

    async getAuthState() {
        await this.ensureStorageDirectories();
        return await useMultiFileAuthState(this.authStateDir);
    }

    private async syncAuthStateFromDisk() {
        const nextHasAuthState = await this.hasCredentialsFile();
        const currentStatus = this.connectionState.status;
        // If credentials exist, keep current status; if lost, force to disconnected
        const nextStatus: SessionStatus = nextHasAuthState
            ? currentStatus
            : 'disconnected';

        if (nextHasAuthState !== this.hasAuthState || nextStatus !== currentStatus) {
            this.hasAuthState = nextHasAuthState;
            this.connectionState.status = nextStatus;
            await this.flushConfig();
        }
    }

    private async hasCredentialsFile(): Promise<boolean> {
        try {
            await readFile(join(this.authStateDir, 'creds.json'));
            return true;
        } catch {
            return false;
        }
    }

    async deleteAuthState() {
        try {
            await rm(this.authStateDir, { recursive: true, force: true });
            await mkdir(this.authStateDir, { recursive: true });
            this.connectionState = {
                status: 'logged-out',
                reconnectAttempts: 0,
                uptimeMs: 0
            };
            this.hasAuthState = false;
            await this.saveConfig();
        } catch (error) {
            console.error(t('session.manager.failedDeleteAuthState'), error);
        }
    }

    /** Full connection state with diagnostics */
    getConnectionState(): ConnectionState {
        return { ...this.connectionState };
    }

    /** Update connection state partially and persist (debounced) */
    async setConnectionState(partial: Partial<ConnectionState>) {
        this.connectionState = { ...this.connectionState, ...partial };
        try {
            await this.saveConfig();
        } catch (error) {
            console.error(`[SessionManager] setConnectionState save failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** @deprecated Use getConnectionState() for full diagnostics */
    getStatus(): SessionStatus {
        return this.connectionState.status;
    }

    /** @deprecated Use setConnectionState() for full diagnostics */
    async setStatus(status: SessionStatus) {
        this.connectionState.status = status;
        await this.flushConfig();
    }

    getOpenaiKey(): string {
        return this.openaiKey;
    }

    async setOpenaiKey(key: string) {
        this.openaiKey = key;
        await this.saveConfig();
    }

    getVisionModel(): string {
        return this.visionModel;
    }

    async setVisionModel(model: string) {
        this.visionModel = model;
        await this.saveConfig();
    }

    getOperatorJid(): string {
        return this.operatorJid;
    }

    async setOperatorJid(jid: string) {
        this.operatorJid = jid;
        await this.saveConfig();
    }

    getAuthStateDir(): string {
        return this.authStateDir;
    }
}
