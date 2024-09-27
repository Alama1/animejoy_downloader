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
const NAME = process.env.NAME || 'Title';

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
    await sleep(15000);

    const urlsWithTitles = await extractVideoUrls(page);
    if (!urlsWithTitles.length) {
        console.log('No videos found...');
        await browser.close();
        return;
    }

    const filteredUrls = filterUrls(urlsWithTitles);

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
        const links = uls.flatMap(ul => 
            Array.from(ul.children)
                .filter(child => child.getAttribute('data-file'))
                .map(child => {
                    return {"url": child.getAttribute('data-file'),
                            "title": child.innerText
                    }
                })
        );
        const title = uls.flatMap(ul =>
            Array.from(ul.children)
                .filter(child => child.getAttribute('data-file'))
                .map(child => child.innerText)

        )
        return links
    });
}

function filterUrls(urlsWithTitles) {
    return urlsWithTitles.filter(title => title.url.startsWith(PLAYER)).slice(FROM - 1, TO);
}

async function downloadVideos(urlsWithTitles, browser) {
    for (const url of urlsWithTitles) {
        const page = await browser.newPage();
        await page.goto(url.url, { waitUntil: 'domcontentloaded' });
        await setQuality(page);
        await page.goto(url.url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('video');

        const videoUrl = await page.evaluate(() => {
            const videoElement = document.querySelector('video');
            return videoElement ? videoElement.src : null;
        });

        const name = `${NAME} ${url.title}`;
        await downloadVideo(videoUrl, name, url.url);
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

async function downloadVideo(videoUrl, name, url) {
    console.log(`Downloading video from: ${videoUrl}`);
    console.log(`Referer link: ${url}`)
    try {
        const response = await fetch(videoUrl, {
            headers: {
                'Referer': url
            }
        });
        console.log(`Response status: ${response.status}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch video: ${response.statusText}`);
        }

        const contentLength = response.headers.get('content-length');
        console.log(`Content-Length: ${contentLength}`);
        if (!contentLength || contentLength === '0') {
            throw new Error('The video file is empty or not available.');
        }

        const destPath = path.join(__dirname, 'downloads', `${name}.mp4`);
        const dest = fs.createWriteStream(destPath);

        response.body.pipe(dest);

        const totalBytes = parseInt(contentLength, 10);
        let downloadedBytes = 0;

        response.body.on('data', chunk => {
            downloadedBytes += chunk.length;
            const progress = ((downloadedBytes / totalBytes) * 100).toFixed(2);
            console.log(`Download progress: ${progress}%`);
        });

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
    } catch (error) {
        console.error('Error in downloadVideo:', error);
    }
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
