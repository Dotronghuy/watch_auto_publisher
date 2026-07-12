import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { liveLog } from '../utils/liveLog.js';

const execAsync = util.promisify(exec);

export async function runAdbCommand(command) {
    try {
        const { stdout } = await execAsync(`adb ${command}`);
        return stdout;
    } catch (e) {
        throw new Error(`Lỗi lệnh ADB (${command}): ${e.message}`);
    }
}

export async function checkAdbDevice() {
    try {
        const out = await runAdbCommand('devices');
        const lines = out.split('\n').filter(line => line.trim() !== '' && !line.startsWith('*') && !line.startsWith('List'));
        if (lines.length === 0) {
            throw new Error('Không tìm thấy thiết bị giả lập nào kết nối qua ADB. Vui lòng bật LDPlayer/Nox và bật "ADB Debugging".');
        }
        liveLog(`✅ [ADB] Thiết bị khả dụng: ${lines[0].split('\t')[0]}`, 'info', 'System');
        return lines[0].split('\t')[0];
    } catch (e) {
        throw e;
    }
}

export async function dumpUI() {
    try {
        const fileName = `window_dump_${Date.now()}.xml`;
        const localPath = path.join(process.cwd(), fileName);
        
        await runAdbCommand('shell uiautomator dump /sdcard/window_dump.xml');
        await runAdbCommand(`pull /sdcard/window_dump.xml "${localPath}"`);
        
        const xmlContent = fs.readFileSync(localPath, 'utf8');
        fs.unlinkSync(localPath);
        
        return xmlContent;
    } catch (e) {
        liveLog(`❌ [ADB] Lỗi Dump UI: ${e.message}`, 'error', 'System');
        return '';
    }
}

export function parseBounds(boundsStr) {
    const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (match) {
        const x1 = parseInt(match[1]);
        const y1 = parseInt(match[2]);
        const x2 = parseInt(match[3]);
        const y2 = parseInt(match[4]);
        return {
            x: Math.floor((x1 + x2) / 2),
            y: Math.floor((y1 + y2) / 2)
        };
    }
    return null;
}

export async function findNodeByKeyword(xml, keywords) {
    if (!Array.isArray(keywords)) keywords = [keywords];
    
    const nodeRegex = /<node\s+([^>]+)>/g;
    let match;
    
    while ((match = nodeRegex.exec(xml)) !== null) {
        const attrStr = match[1];
        const textMatch = attrStr.match(/text="([^"]*)"/);
        const descMatch = attrStr.match(/content-desc="([^"]*)"/);
        const boundsMatch = attrStr.match(/bounds="([^"]*)"/);
        
        const text = textMatch ? textMatch[1] : '';
        const desc = descMatch ? descMatch[1] : '';
        const bounds = boundsMatch ? boundsMatch[1] : '';
        
        for (const kw of keywords) {
            if (text.toLowerCase().includes(kw.toLowerCase()) || desc.toLowerCase().includes(kw.toLowerCase())) {
                const center = parseBounds(bounds);
                if (center) {
                    return center;
                }
            }
        }
    }
    return null;
}

export async function tap(x, y) {
    await runAdbCommand(`shell input tap ${x} ${y}`);
    await sleep(500);
}

export async function inputText(text) {
    if (text === 'Mua ở đây') {
        // Android shell input text space needs to be %s
        await runAdbCommand(`shell input text "Mua\\%sở\\%sđây"`);
    } else {
        const safeText = text.replace(/&/g, '\\&');
        await runAdbCommand(`shell input text "${safeText}"`);
    }
    await sleep(500);
}

export async function swipe(x1, y1, x2, y2, durationMs = 500) {
    await runAdbCommand(`shell input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`);
    await sleep(500);
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
