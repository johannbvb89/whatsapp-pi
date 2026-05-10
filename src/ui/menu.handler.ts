import { WhatsAppService } from '../services/whatsapp.service.js';
import { SessionManager, type Contact } from '../services/session.manager.js';
import { validatePhoneNumber, type RecentConversationMessage, type RecentConversationSummary } from '../models/whatsapp.types.js';
import { RecentsService } from '../services/recents.service.js';
import { showMessageDetailView } from './message-detail.view.js';
import { showMessageReplyView } from './message-reply.view.js';
import * as qrcode from 'qrcode-terminal';
import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent';
import { t } from '../i18n.js';

interface HistoryOptionEntry {
    label: string;
    message: RecentConversationMessage;
}

export class MenuHandler {
    private readonly printedAllowedNumbers: string[] = [];

    constructor(
        private readonly whatsappService: WhatsAppService,
        private readonly sessionManager: SessionManager,
        private readonly recentsService: RecentsService
    ) {}

    async handleCommand(ctx: ExtensionCommandContext) {
        const status = this.whatsappService.getEffectiveStatus();
        const registered = await this.sessionManager.isRegistered();
        const title = t('menu.whatsapp.title', { status });
        const recentsLabel = t('menu.root.recents');
        const allowedNumbersLabel = t('menu.root.allowedNumbers');
        const blockedNumbersLabel = t('menu.root.blockedNumbers');
        const disconnectWhatsAppLabel = t('menu.root.disconnectWhatsApp');
        const connectWhatsAppLabel = t('menu.root.connectWhatsApp');
        const logoffDeleteSessionLabel = t('menu.root.logoffDeleteSession');
        const backLabel = t('menu.root.back');
        const options: string[] = [];

        if (status === 'connected') {
            options.push(recentsLabel);
            options.push(allowedNumbersLabel);
            options.push(blockedNumbersLabel);
            options.push(disconnectWhatsAppLabel);
        } else {
            options.push(connectWhatsAppLabel);
        }

        if (registered) {
            options.push(logoffDeleteSessionLabel);
        }

        options.push(backLabel);

        const choice = await ctx.ui.select(title, options);

        switch (choice) {
            case connectWhatsAppLabel:
                if (status === 'connected') {
                    ctx.ui.notify(t('menu.root.alreadyConnected'), 'info');
                    break;
                }
                this.whatsappService.setQRCodeCallback((qr) => {
                    qrcode.generate(qr, { small: true });
                });
                await this.whatsappService.start();
                ctx.ui.notify(registered ? t('menu.root.reconnectStarted') : t('menu.root.pairingStarted'), 'info');
                break;
            case disconnectWhatsAppLabel:
                if (status !== 'connected') {
                    ctx.ui.notify(t('menu.root.alreadyDisconnected'), 'info');
                    break;
                }
                await this.whatsappService.stop();
                ctx.ui.notify(t('menu.root.agentDisconnected'), 'warning');
                break;
            case logoffDeleteSessionLabel:
                const confirmLogoff = await ctx.ui.confirm(t('menu.root.logoffTitle'), t('menu.root.logoffConfirmMessage'));
                if (confirmLogoff) {
                    await this.whatsappService.logout();
                    ctx.ui.notify(t('menu.root.loggedOffAndDeleted'), 'info');
                }
                break;
            case allowedNumbersLabel:
                await this.manageAllowList(ctx);
                break;
            case blockedNumbersLabel:
                await this.manageBlockList(ctx);
                break;
            case recentsLabel:
                await this.manageRecents(ctx);
                break;
        }
    }

    private async manageAllowList(ctx: ExtensionCommandContext) {
        const list = this.sortContactsAlphabetically(this.sessionManager.getAllowList());
        const title = t('menu.allowed.title');
        const addNumberLabel = t('menu.allowed.addNumber');
        const backLabel = t('menu.root.back');
        const options = [...list.map(contact => this.formatAllowedContactOption(contact)), addNumberLabel, backLabel];

        const choice = await ctx.ui.select(title, options);

        if (choice === addNumberLabel) {
            const num = await ctx.ui.input(t('menu.allowed.enterNumber'));
            if (num && validatePhoneNumber(num)) {
                await this.sessionManager.addNumber(num);
                ctx.ui.notify(t('menu.allowed.addedToAllowList', { number: num }), 'info');
            } else {
                ctx.ui.notify(t('menu.allowed.invalidNumber'), 'error');
            }
            await this.manageAllowList(ctx);
            return;
        }

        if (choice === backLabel || !choice) {
            await this.handleCommand(ctx);
            return;
        }

        const selectedContact = list.find(contact => this.formatAllowedContactOption(contact) === choice);
        if (!selectedContact) {
            await this.manageAllowList(ctx);
            return;
        }

        await this.manageAllowedContact(ctx, selectedContact);
    }

    private async manageAllowedContact(ctx: ExtensionCommandContext, contact: Contact) {
        const displayName = this.formatAllowedContactOption(contact);
        const title = t('menu.allowed.contact.title', { displayName });
        const historyLabel = t('menu.allowed.contact.history');
        const sendMessageLabel = t('menu.allowed.contact.sendMessage');
        const printNumberLabel = t('menu.allowed.contact.printNumber');
        const removeAliasLabel = t('menu.allowed.contact.removeAlias');
        const addAliasLabel = t('menu.allowed.contact.addAlias');
        const removeNumberLabel = t('menu.allowed.contact.removeNumber');
        const backLabel = t('menu.allowed.contact.back');
        const options = [historyLabel, sendMessageLabel, printNumberLabel];
        if (contact.name) {
            options.push(removeAliasLabel);
        } else {
            options.push(addAliasLabel);
        }
        options.push(removeNumberLabel, backLabel);

        const choice = await ctx.ui.select(title, options);

        if (choice === sendMessageLabel) {
            await this.sendMessageToAllowedNumber(ctx, contact);
            await this.manageAllowedContact(ctx, contact);
            return;
        }

        if (choice === historyLabel) {
            await this.showConversationHistoryForNumber(ctx, contact.number, displayName);
            await this.manageAllowedContact(ctx, contact);
            return;
        }

        if (choice === printNumberLabel) {
            this.printAllowedNumber(ctx, contact.number);
            await this.manageAllowedContact(ctx, contact);
            return;
        }

        if (choice === addAliasLabel) {
            const alias = await ctx.ui.input(t('menu.allowed.enterAlias', { number: contact.number }));
            const trimmedAlias = alias?.trim() || '';

            if (!trimmedAlias) {
                ctx.ui.notify(t('menu.allowed.pleaseEnterAlias'), 'error');
                await this.manageAllowedContact(ctx, contact);
                return;
            }

            await this.sessionManager.setAllowedContactAlias(contact.number, trimmedAlias);
            ctx.ui.notify(t('menu.allowed.aliasAdded', { number: contact.number }), 'info');
            await this.manageAllowedContact(ctx, { ...contact, name: trimmedAlias });
            return;
        }

        if (choice === removeAliasLabel) {
            await this.sessionManager.removeAllowedContactAlias(contact.number);
            ctx.ui.notify(t('menu.allowed.aliasRemoved', { number: contact.number }), 'info');
            await this.manageAllowedContact(ctx, { ...contact, name: undefined });
            return;
        }

        if (choice === removeNumberLabel) {
            const ok = await ctx.ui.confirm(t('menu.allowed.removeConfirmTitle'), t('menu.allowed.removeConfirmMessage', { displayName }));
            if (ok) {
                await this.sessionManager.removeNumber(contact.number);
                ctx.ui.notify(t('menu.allowed.removed', { displayName }), 'info');
            }
            await this.manageAllowList(ctx);
            return;
        }

        await this.manageAllowList(ctx);
    }

    private printAllowedNumber(ctx: ExtensionCommandContext, number: string) {
        this.printedAllowedNumbers.push(number);
        const output = this.printedAllowedNumbers
            .map((entry) => `  • ${entry}`)
            .join('\n');
        console.log([
            t('menu.allowed.printAllowedNumbersTitle'),
            output
        ].join('\n'));
        ctx.ui.notify(this.printedAllowedNumbers.join('\n'), 'info');
    }

    private async manageBlockList(ctx: ExtensionCommandContext) {
        const list = [...this.sessionManager.getBlockList()].reverse();
        const title = t('menu.blocked.title');
        const backLabel = t('menu.blocked.back');

        if (list.length === 0) {
            ctx.ui.notify(t('menu.blocked.empty'), 'info');
            await this.handleCommand(ctx);
            return;
        }

        const options = [...list.map(c => c.name ? `${c.name} (${c.number})` : c.number), backLabel];
        const choice = await ctx.ui.select(title, options);

        if (choice && choice !== backLabel) {
            await this.manageBlockedNumber(ctx, this.parseContactNumberOption(choice));
        } else {
            await this.handleCommand(ctx);
        }
    }

    private async manageBlockedNumber(ctx: ExtensionCommandContext, number: string) {
        const title = t('menu.blocked.manageTitle', { number });
        const allowLabel = t('menu.blocked.allow');
        const deleteLabel = t('menu.blocked.delete');
        const backLabel = t('menu.blocked.back');
        const action = await ctx.ui.select(title, [allowLabel, deleteLabel, backLabel]);

        if (action === allowLabel) {
            const ok = await ctx.ui.confirm(t('menu.blocked.allowConfirmTitle'), t('menu.blocked.allowConfirmMessage', { number }));
            if (ok) {
                await this.sessionManager.unblockAndAllow(number);
                ctx.ui.notify(t('menu.blocked.allowed', { number }), 'info');
            }
            await this.manageBlockList(ctx);
        } else if (action === deleteLabel) {
            const ok = await ctx.ui.confirm(t('menu.blocked.deleteConfirmTitle'), t('menu.blocked.deleteConfirmMessage', { number }));
            if (ok) {
                await this.sessionManager.unblockNumber(number);
                ctx.ui.notify(t('menu.blocked.deleted', { number }), 'info');
            }
            await this.manageBlockList(ctx);
        } else {
            await this.manageBlockList(ctx);
        }
    }

    private async manageRecents(ctx: ExtensionCommandContext) {
        const recentConversations = await this.recentsService.getRecentConversations();
        const title = t('menu.recents.title');
        const backLabel = t('menu.root.back');

        if (recentConversations.length === 0) {
            ctx.ui.notify(t('menu.recents.empty'), 'info');
            await this.handleCommand(ctx);
            return;
        }

        const options = [
            ...recentConversations.map(conversation => this.formatRecentConversationOption(conversation)),
            backLabel
        ];

        const choice = await ctx.ui.select(title, options);
        if (!choice || choice === backLabel) {
            await this.handleCommand(ctx);
            return;
        }

        const selectedConversation = recentConversations.find(conversation =>
            this.formatRecentConversationOption(conversation) === choice
        );

        if (!selectedConversation) {
            await this.manageRecents(ctx);
            return;
        }

        await this.manageRecentConversation(ctx, selectedConversation);
    }

    private async manageRecentConversation(ctx: ExtensionCommandContext, conversation: RecentConversationSummary) {
        const displayName = this.getConversationDisplayName(conversation);
        const allowedContact = this.sessionManager.getAllowedContact(conversation.senderNumber);
        const title = t('menu.recents.contact.title', { displayName });
        const historyLabel = t('menu.recents.contact.history');
        const allowNumberLabel = t('menu.recents.contact.allowNumber');
        const sendMessageLabel = t('menu.recents.contact.sendMessage');
        const removeAliasLabel = t('menu.recents.contact.removeAlias');
        const backLabel = t('menu.recents.contact.back');
        const options: string[] = [historyLabel];

        if (!allowedContact) {
            options.push(allowNumberLabel);
        }

        options.push(sendMessageLabel);

        if (allowedContact?.name) {
            options.push(removeAliasLabel);
        }

        options.push(backLabel);

        const choice = await ctx.ui.select(title, options);

        if (choice === allowNumberLabel) {
            if (this.sessionManager.isAllowed(conversation.senderNumber)) {
                ctx.ui.notify(t('menu.recents.alreadyAllowed', { number: conversation.senderNumber }), 'info');
            } else {
                await this.sessionManager.addNumber(conversation.senderNumber, conversation.senderName);
                ctx.ui.notify(t('menu.recents.addedToAllowList', { number: conversation.senderNumber }), 'info');
            }
            await this.manageRecentConversation(ctx, conversation);
            return;
        }

        if (choice === removeAliasLabel) {
            await this.sessionManager.removeAllowedContactAlias(conversation.senderNumber);
            ctx.ui.notify(t('menu.recents.aliasRemoved', { number: conversation.senderNumber }), 'info');
            await this.manageRecentConversation(ctx, {
                ...conversation,
                senderName: undefined
            });
            return;
        }

        if (choice === sendMessageLabel) {
            await this.sendMessageFromRecents(ctx, conversation);
            await this.manageRecentConversation(ctx, conversation);
            return;
        }

        if (choice === historyLabel) {
            await this.showConversationHistory(ctx, conversation);
            await this.manageRecentConversation(ctx, conversation);
            return;
        }

        await this.manageRecents(ctx);
    }

    private async sendMessageFromRecents(ctx: ExtensionCommandContext, conversation: RecentConversationSummary) {
        await this.sendPromptedMenuMessage(ctx, {
            displayName: this.getConversationDisplayName(conversation),
            senderNumber: conversation.senderNumber,
            senderName: conversation.senderName,
            appendPiSuffix: false
        });
    }

    private async sendMessageToAllowedNumber(ctx: ExtensionCommandContext, contact: Contact) {
        await this.sendPromptedMenuMessage(ctx, {
            displayName: this.formatAllowedContactOption(contact),
            senderNumber: contact.number,
            senderName: contact.name,
            appendPiSuffix: true
        });
    }

    private async sendPromptedMenuMessage(
        ctx: ExtensionCommandContext,
        options: {
            displayName: string;
            senderNumber: string;
            senderName?: string;
            appendPiSuffix: boolean;
        }
    ) {
        const { displayName, senderNumber, senderName, appendPiSuffix } = options;
        for (let attempt = 0; attempt < 2; attempt++) {
            const inputText = (await ctx.ui.input(t('menu.allowed.sendPrompt', { displayName })))?.trim() || '';

            if (!inputText) {
                ctx.ui.notify(t('menu.allowed.messageRequired'), 'error');
                continue;
            }

            const messageText = appendPiSuffix ? `${inputText} π` : inputText;
            const result = await this.whatsappService.sendMenuMessage(this.toJid(senderNumber), messageText);
            if (result.success) {
                await this.recentsService.recordMessage({
                    messageId: result.messageId ?? `${Date.now()}`,
                    senderNumber,
                    senderName,
                    text: messageText,
                    direction: 'outgoing',
                    timestamp: Date.now()
                });
                ctx.ui.notify(t('menu.allowed.sendSuccess', { displayName }), 'info');
            } else {
                ctx.ui.notify(t('menu.allowed.sendFailure', { displayName, error: result.error ?? 'Unknown error' }), 'error');
            }
            return;
        }
    }

    private async showConversationHistory(ctx: ExtensionCommandContext, conversation: RecentConversationSummary) {
        await this.showConversationHistoryForNumber(
            ctx,
            conversation.senderNumber,
            this.getConversationDisplayName(conversation),
            conversation.senderName
        );
    }

    private async showConversationHistoryForNumber(
        ctx: ExtensionCommandContext,
        senderNumber: string,
        displayName: string,
        senderName?: string
    ) {
        const history = await this.recentsService.getConversationHistory(senderNumber);

        if (history.length === 0) {
            ctx.ui.notify(t('menu.recents.history.empty'), 'info');
            return;
        }

        const historyOptions = this.buildHistoryOptions(this.sortHistoryByMostRecent(history));
        const choice = await ctx.ui.select(t('menu.recents.history.title', { displayName }), [
            ...historyOptions.map(option => option.label),
            t('menu.root.back')
        ]);

        if (!choice || choice === t('menu.root.back')) {
            return;
        }

        const selectedMessage = this.resolveHistorySelection(choice, historyOptions);
        if (!selectedMessage) {
            return;
        }

        const detailAction = await showMessageDetailView(ctx, {
            title: t('menu.recents.history.messageTitle', { displayName }),
            messageId: selectedMessage.messageId,
            senderNumber: selectedMessage.senderNumber,
            senderName,
            text: selectedMessage.text,
            direction: selectedMessage.direction,
            timestamp: selectedMessage.timestamp
        });

        if (detailAction === 'reply') {
            await showMessageReplyView(ctx, {
                selectedMessage: {
                    messageId: selectedMessage.messageId,
                    senderNumber: selectedMessage.senderNumber,
                    senderName,
                    text: selectedMessage.text,
                    direction: selectedMessage.direction,
                    timestamp: selectedMessage.timestamp
                },
                whatsappService: this.whatsappService,
                recentsService: this.recentsService
            });
        }
    }

    private buildHistoryOptions(history: RecentConversationMessage[]): HistoryOptionEntry[] {
        return history.map(message => ({
            label: this.formatHistoryOption(message.timestamp, message.direction, message.text),
            message
        }));
    }

    private resolveHistorySelection(choice: string, options: HistoryOptionEntry[]): RecentConversationMessage | undefined {
        return options.find(option => option.label === choice)?.message;
    }

    private formatRecentConversationOption(conversation: RecentConversationSummary): string {
        const displayName = this.getConversationDisplayName(conversation);
        const time = this.formatDateTime(conversation.lastMessageTime);
        return `${displayName} • ${time} • ${conversation.lastMessagePreview}`;
    }

    private formatAllowedContactOption(contact: Contact): string {
        const isGroup = SessionManager.isGroupJid(contact.number);
        const prefix = isGroup ? '[Group] ' : '';
        return contact.name ? `${prefix}${contact.name} (${contact.number})` : `${prefix}${contact.number}`;
    }

    private sortContactsAlphabetically(contacts: Contact[]): Contact[] {
        return [...contacts].sort((left, right) => {
            const leftLabel = this.formatAllowedContactSortKey(left);
            const rightLabel = this.formatAllowedContactSortKey(right);
            return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base' });
        });
    }

    private formatAllowedContactSortKey(contact: Contact): string {
        return contact.name ? `${contact.name} ${contact.number}` : contact.number;
    }

    private parseContactNumberOption(choice: string): string {
        if (!choice.includes('(')) {
            return choice;
        }

        const match = choice.match(/\((.*?)\)/);
        return match?.[1] ?? choice;
    }

    private sortHistoryByMostRecent<T extends { timestamp: number }>(history: T[]): T[] {
        return [...history].sort((left, right) => {
            const dayComparison = this.getDayStart(right.timestamp) - this.getDayStart(left.timestamp);
            if (dayComparison !== 0) {
                return dayComparison;
            }

            return this.getTimeOfDay(right.timestamp) - this.getTimeOfDay(left.timestamp);
        });
    }

    private getTimeOfDay(timestamp: number): number {
        const date = new Date(timestamp);
        return date.getHours() * 60 * 60 * 1000
            + date.getMinutes() * 60 * 1000
            + date.getSeconds() * 1000
            + date.getMilliseconds();
    }

    private getDayStart(timestamp: number): number {
        const date = new Date(timestamp);
        return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    }

    private formatHistoryOption(timestamp: number, direction: string, text: string): string {
        const marker = direction === 'outgoing' ? t('menu.recents.history.sent') : t('menu.recents.history.received');
        const displayText = this.truncate(text, 60) || t('menu.recents.history.noText');
        return `${this.formatDateTimeWithSeconds(timestamp)} • ${marker} • ${displayText}`;
    }

    private getConversationDisplayName(conversation: RecentConversationSummary): string {
        const allowedContact = this.sessionManager.getAllowedContact(conversation.senderNumber);
        const displayName = allowedContact?.name || conversation.senderName;
        const isGroup = SessionManager.isGroupJid(conversation.senderNumber);
        const prefix = isGroup ? '[Group] ' : '';
        return displayName ? `${prefix}${displayName} (${conversation.senderNumber})` : `${prefix}${conversation.senderNumber}`;
    }

    private formatDateTime(timestamp: number): string {
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(new Date(timestamp));
    }

    private formatDateTimeWithSeconds(timestamp: number): string {
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'short',
            timeStyle: 'medium'
        }).format(new Date(timestamp));
    }

    private truncate(value: string, maxLength: number): string {
        const normalized = value.trim().replace(/\s+/g, ' ');
        if (!normalized) {
            return '';
        }
        if (normalized.length <= maxLength) {
            return normalized;
        }
        return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
    }

    private toJid(number: string): string {
        if (number.includes('@')) {
            return number;
        }

        const normalized = number.startsWith('+') ? number.slice(1) : number;
        return `${normalized}@s.whatsapp.net`;
    }
}
