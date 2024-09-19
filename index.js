import fetch from 'node-fetch';
import { connect } from 'puppeteer-real-browser';
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUALITY = process.env.QUALITY || '1080p';
const PLAYER = process.env.PLAYER || 'https://csst';
const FROM = parseInt(process.env.FROM, 10) || 1;
const TO = parseInt(process.env.TO, 10) || 12;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Provide a url:\n', (providedUrl) => {
    fetchUrlData(formatUrl(providedUrl));
});

async function fetchUrlData(url) {
    const { page, browser } = await setupBrowser();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(10000);

    const videoUrls = await extractVideoUrls(page);
    if (!videoUrls.length) {
        console.log('No videos found...');
        await browser.close();
        return;
    }

    const filteredUrls = filterUrls(videoUrls);
    await downloadVideos(filteredUrls, browser);
    await browser.close();
}

async function setupBrowser() {
    const { browser } = await connect({
        headless: 'auto',
        fingerprint: true,
        turnstile: true,
        tf: true,
    });

    const page = await browser.newPage();
    return { page, browser };
}

async function extractVideoUrls(page) {
    return await page.$$eval('div.playlists-items ul', uls => {
        return uls.flatMap(ul => 
            Array.from(ul.children)
                .filter(child => child.getAttribute('data-file'))
                .map(child => child.getAttribute('data-file'))
        );
    });
}

function filterUrls(urls) {
    return urls.filter(url => url.startsWith(PLAYER)).slice(FROM - 1, TO);
}

async function downloadVideos(urls, browser) {
    for (const url of urls) {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await setQuality(page);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('video');

        const videoUrl = await page.evaluate(() => {
            const videoElement = document.querySelector('video');
            return videoElement ? videoElement.src : null;
        });

        const name = await page.title();
        await downloadVideo(videoUrl, name);
        await page.close();
    }
}

async function setQuality(page) {
    const quality = QUALITY;
    try {
        await page.evaluate((quality) => {
            localStorage.setItem('pljsquality', quality);
        }, quality);
    } catch (e) {
        console.log(e);
    }
}

async function downloadVideo(videoUrl, name) {
    const response = await fetch(videoUrl);
    const dest = fs.createWriteStream(path.join(__dirname, 'downloads', `${name}.mp4`));
    response.body.pipe(dest);

    return new Promise((resolve, reject) => {
        dest.on('finish', () => {
            console.log('Download completed!');
            resolve();
        });
        dest.on('error', (err) => {
            console.error('Error downloading video:', err);
            reject(err);
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatUrl(url) {
    if (!url.startsWith('https://')) {
        if (url.startsWith('http://')) {
            url = 'https://' + url.slice(7);
        } else {
            url = 'https://' + url;
        }
    }
    return url;
}
