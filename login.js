const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Configuration
const LOGIN_URL = config.LOGIN_URL; // Replace with the login page URL
const PARENT_PAGE_URL = config.PARENT_PAGE_URL; // Replace with the page containing the iframe
const COOKIES_FILE = config.COOKIES_FILE; // Where cookies will be saved

// Main function
async function loginAndSaveCookies() {
	// Launch browser with stealth options
	const browser = await puppeteer.launch({
		headless: false, // Non-headless so you can sign in
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-infobars',
			'--window-size=1280,720',
			'--disable-features=site-per-process', // Avoid iframe issues
		],
		defaultViewport: null, // Use the window size
	});

	const page = await browser.newPage();

	// Optional: Set a realistic User-Agent
	await page.setUserAgent(
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	);

	// Navigate to login page
	console.log('Navigating to login page...');
	await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

	// Wait for manual login
	console.log('Please sign in manually in the browser. Waiting for navigation to complete...');
	await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 0 }); // No timeout, waits indefinitely

	// After login, get all cookies
	const cookies = await page.cookies();
	console.log(`Captured ${cookies.length} cookies.`);

	// Save cookies to disk as JSON
	fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
	console.log(`Cookies saved to ${COOKIES_FILE}`);

	// Optional: Navigate to parent page to verify login
	console.log('Navigating to parent page to verify login...');
	await page.goto(PARENT_PAGE_URL, { waitUntil: 'networkidle2' });
	console.log('You should now see the PDF viewer. Press Ctrl+C to close the script when done.');

	// Keep browser open until manually closed
	// await browser.close(); // Uncomment to auto-close after saving cookies
}

// Run the script
loginAndSaveCookies().catch(console.error);
