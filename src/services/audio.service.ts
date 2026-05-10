import { downloadContentFromMessage } from 'baileys';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { t } from '../i18n.js';

const execAsync = promisify(exec);

export class AudioService {
    private readonly mediaDir = join(homedir(), '.pi', 'whatsapp-medias');
    private readonly whisperPath = process.platform === 'win32' ? 'python -m whisper' : join(homedir(), '.local', 'bin', 'whisper');

    constructor() {
        if (!existsSync(this.mediaDir)) {
            mkdir(this.mediaDir, { recursive: true }).catch(() => {});
        }
    }

    async transcribe(audioMessage: any): Promise<string> {
        try {
            const filename = `audio_${Date.now()}`;
            const inputPath = join(this.mediaDir, `${filename}.ogg`);

            // Download audio content
            const stream = await downloadContentFromMessage(audioMessage, 'audio');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            await writeFile(inputPath, buffer);

            // Transcribe using Whisper
            // Using small model for better accuracy
            const command = `${this.whisperPath} "${inputPath}" --model small --language pt --output_format txt --output_dir "${this.mediaDir}" --fp16 False`;
            
            await execAsync(command);

            const txtPath = join(this.mediaDir, `${filename}.txt`);
            if (existsSync(txtPath)) {
                const fs = await import('node:fs/promises');
                const text = await fs.readFile(txtPath, 'utf8');
                return text.trim();
            }

            return t('audio.emptyTranscription');
        } catch (error) {
            console.error(t('audio.transcriptionError'), error);
            return t('audio.transcriptionErrorResult', { error: error instanceof Error ? error.message : String(error) });
        }
    }
}
