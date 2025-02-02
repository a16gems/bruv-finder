import * as anchor from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';

const OUTPUT_FILE = path.join(process.cwd(), 'precalculated-bruv.json');
const SAVE_INTERVAL = 1; // Сохраняем каждый найденный адрес
const STATS_SAVE_INTERVAL = 300000; // Сохраняем статистику каждые 5 минут
const TARGET_SUFFIX = 'bruv';
const PROGRAM_ID = "GsxaG11BPNpbkBkzJgW7GkRRJ3o3bjJEqAqhsv814N2s";
const BATCH_SIZE = 1000; // Проверяем по 1000 nonce за раз

// Предварительно вычисляем часто используемые значения
const TOKEN_MINT_BUFFER = Buffer.from("token_mint");
const TARGET_SUFFIX_BASE58 = Buffer.from([0x05, 0x15, 0x1d, 0x1c]); // 'bruv' в base58

interface SavedData {
    lastNonce: string;
    addresses: Array<{
        nonce: string;
        address: string;
        timestamp: string;
    }>;
    stats: {
        totalChecked: number;
        totalFound: number;
        lastUpdate: string;
    };
}

function loadExistingData(): SavedData {
    try {
        if (fs.existsSync(OUTPUT_FILE)) {
            const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
            console.log(`Loaded ${data.addresses.length} existing addresses`);
            console.log(`Last nonce: ${data.lastNonce}`);
            console.log(`Total checked: ${data.stats.totalChecked}`);
            return data;
        }
    } catch (error) {
        console.error('Error loading existing data:', error);
    }

    return {
        lastNonce: '0',
        addresses: [],
        stats: {
            totalChecked: 0,
            totalFound: 0,
            lastUpdate: new Date().toISOString()
        }
    };
}

function saveData(data: SavedData) {
    try {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
        console.log(`\nSaved ${data.addresses.length} addresses to ${OUTPUT_FILE}`);
        console.log(`Last nonce: ${data.lastNonce}`);
        console.log(`Total checked: ${data.stats.totalChecked}`);
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

async function findAddresses() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    
    console.log(`Using wallet authority: ${provider.wallet.publicKey.toBase58()}`);

    let data = loadExistingData();
    let nonce = new anchor.BN(data.lastNonce);
    let startTime = Date.now();
    let lastStatsTime = startTime;
    let lastProgressUpdate = startTime;
    const walletBuffer = provider.wallet.publicKey.toBuffer();
    const programId = new PublicKey(PROGRAM_ID);

    console.log('\nStarting address search...');
    console.log(`Target suffix: ${TARGET_SUFFIX}`);
    console.log('Press Ctrl+C to stop and save progress\n');

    while (true) {
        // Генерируем пакет nonce значений
        const nonceBatch = Array(BATCH_SIZE).fill(0)
            .map((_, i) => nonce.add(new anchor.BN(i)));
        
        // Проверяем пакет адресов
        for (let currentNonce of nonceBatch) {
            const nonceBuffer = currentNonce.toArrayLike(Buffer, 'le', 8);
            const [mintPDA] = PublicKey.findProgramAddressSync(
                [TOKEN_MINT_BUFFER, walletBuffer, nonceBuffer],
                programId
            );

            data.stats.totalChecked++;

            // Оптимизированная проверка суффикса
            const addressBytes = mintPDA.toBytes();
            const lastFourBytes = addressBytes.slice(-4);
            if (Buffer.compare(lastFourBytes, TARGET_SUFFIX_BASE58) === 0) {
                console.log(`\n🎯 Found address: ${mintPDA.toBase58()} with nonce: ${currentNonce.toString()}`);
                
                data.addresses.push({
                    nonce: currentNonce.toString(),
                    address: mintPDA.toBase58(),
                    timestamp: new Date().toISOString()
                });
                data.stats.totalFound++;

                // Сохраняем сразу при находке адреса
                if (data.addresses.length % SAVE_INTERVAL === 0) {
                    data.lastNonce = currentNonce.toString();
                    data.stats.lastUpdate = new Date().toISOString();
                    saveData(data);
                }
            }
        }

        // Обновляем nonce для следующего пакета
        nonce = nonce.add(new anchor.BN(BATCH_SIZE));

        // Обновляем прогресс каждые 5 секунд
        const now = Date.now();
        if (now - lastProgressUpdate >= 5000) {
            const checksPerSecond = data.stats.totalChecked / ((now - startTime) / 1000);
            console.log(`Checked: ${data.stats.totalChecked}, Found: ${data.stats.totalFound}, Speed: ${checksPerSecond.toFixed(0)}/s`);
            lastProgressUpdate = now;
        }

        // Сохраняем статистику каждые 5 минут
        if (now - lastStatsTime >= STATS_SAVE_INTERVAL) {
            data.lastNonce = nonce.toString();
            data.stats.lastUpdate = new Date().toISOString();
            saveData(data);
            lastStatsTime = now;
        }
    }
}

// Start the search
findAddresses().catch(console.error); 