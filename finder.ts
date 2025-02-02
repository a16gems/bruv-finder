import * as anchor from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';

const OUTPUT_FILE = path.join(process.cwd(), 'precalculated-bruv.json');
const SAVE_INTERVAL = 5; // Save every 5 found addresses
const TARGET_SUFFIX = 'bruv';
const PROGRAM_ID = "GsxaG11BPNpbkBkzJgW7GkRRJ3o3bjJEqAqhsv814N2s";  // Mainnet program ID

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
    // Setup anchor provider
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    
    console.log(`Using wallet authority: ${provider.wallet.publicKey.toBase58()}`);

    // Load existing data
    let data = loadExistingData();
    let nonce = new anchor.BN(data.lastNonce);
    let startTime = Date.now();
    let lastSaveTime = startTime;
    let lastProgressUpdate = startTime;

    // Handle Ctrl+C
    process.on('SIGINT', () => {
        console.log('\nReceived SIGINT. Saving current progress...');
        data.lastNonce = nonce.toString();
        data.stats.lastUpdate = new Date().toISOString();
        saveData(data);
        process.exit();
    });

    console.log('\nStarting address search...');
    console.log(`Target suffix: ${TARGET_SUFFIX}`);
    console.log('Press Ctrl+C to stop and save progress\n');

    while (true) {
        const [mintPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("token_mint"),
                provider.wallet.publicKey.toBuffer(),
                nonce.toArrayLike(Buffer, 'le', 8)
            ],
            new PublicKey(PROGRAM_ID)
        );

        data.stats.totalChecked++;

        // Update progress every second
        const now = Date.now();
        if (now - lastProgressUpdate >= 1000) {
            const checksPerSecond = data.stats.totalChecked / ((now - startTime) / 1000);
            console.log(`Checked: ${data.stats.totalChecked}, Found: ${data.stats.totalFound}, Speed: ${checksPerSecond.toFixed(0)}/s`);
            lastProgressUpdate = now;
        }

        if (mintPDA.toBase58().endsWith(TARGET_SUFFIX)) {
            console.log(`\n🎯 Found address: ${mintPDA.toBase58()} with nonce: ${nonce.toString()}`);
            
            data.addresses.push({
                nonce: nonce.toString(),
                address: mintPDA.toBase58(),
                timestamp: new Date().toISOString()
            });
            data.stats.totalFound++;

            // Save periodically
            if (data.addresses.length % SAVE_INTERVAL === 0) {
                data.lastNonce = nonce.toString();
                data.stats.lastUpdate = new Date().toISOString();
                saveData(data);
                lastSaveTime = now;
            }
        }

        nonce = nonce.add(new anchor.BN(1));
    }
}

// Start the search
findAddresses().catch(console.error); 