const puppeteer = require('puppeteer');
const PDFDocument = require('pdfkit');
const PNG = require('pngjs').PNG;
const bmp = require('bmp-js');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

// Global configuration
const PARENT_PAGE_URLS = config.PARENT_PAGE_URLS;
const OUTPUT_PDF_PREFIX = config.OUTPUT_PDF_PREFIX;
const TEMP_DIR = config.TEMP_DIR;
const COOKIES_FILE = config.COOKIES_FILE;

// Helper to ensure temp directory exists
function ensureDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		console.log(`Created directory: ${dir}`);
	}
}

// Sleep helper function
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Convert BMP buffer to PNG with enforced white background
function convertBmpToPng(bmpBuffer) {
	const bmpData = bmp.decode(bmpBuffer);
	const png = new PNG({ width: bmpData.width, height: bmpData.height });

	// Fill with solid white background
	for (let i = 0; i < png.data.length; i += 4) {
		png.data[i] = 255; // R
		png.data[i + 1] = 255; // G
		png.data[i + 2] = 255; // B
		png.data[i + 3] = 255; // A
	}

	// Copy BMP data, replacing yellow (255, 255, 0) if needed
	for (let y = 0; y < bmpData.height; y++) {
		for (let x = 0; x < bmpData.width; x++) {
			const idx = (bmpData.width * y + x) * 4;
			const pngIdx = (png.width * y + x) * 4;
			const b = bmpData.data[idx]; // BMP is BGR
			const g = bmpData.data[idx + 1];
			const r = bmpData.data[idx + 2];

			// Log sample pixel for debugging
			if (x === 0 && y === 0) {
				console.log(`Sample pixel at (0,0): R=${r}, G=${g}, B=${b}`);
			}

			// Replace yellow (255, 255, 0) with white (255, 255, 255)
			if (r === 255 && g === 255 && b === 0) {
				png.data[pngIdx] = 255;
				png.data[pngIdx + 1] = 255;
				png.data[pngIdx + 2] = 255;
				png.data[pngIdx + 3] = 255;
			} else {
				png.data[pngIdx] = r;
				png.data[pngIdx + 1] = g;
				png.data[pngIdx + 2] = b;
				png.data[pngIdx + 3] = 255;
			}
		}
	}

	return PNG.sync.write(png);
}

// Process and save image buffer (BMP or PNG)
function processImageBuffer(buffer, filePath) {
	const signature = buffer.slice(0, 2).toString('hex');
	let finalBuffer;

	if (signature === '424d') {
		// BMP signature
		console.log(`Detected BMP for ${filePath}, converting to PNG`);
		finalBuffer = convertBmpToPng(buffer);
	} else {
		try {
			PNG.sync.read(buffer); // Validate PNG
			finalBuffer = buffer;
			console.log(`Detected valid PNG for ${filePath}`);
		} catch (error) {
			console.error(`Invalid PNG for ${filePath}: ${error.message}, attempting re-encode`);
			finalBuffer = PNG.sync.write(PNG.sync.read(buffer));
		}
	}

	fs.writeFileSync(filePath, finalBuffer);
	console.log(`Saved ${filePath}`);
	return true;
}

// Function to scrape a single PDF
async function scrapeSinglePDF(frame, totalPages, tempDir, outputPdf) {
	const seenSources = new Set();

	for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
		console.log(`Processing page ${currentPage}/${totalPages}`);

		const elements = await frame.$$('img[src^="blob:"], canvas');
		console.log(`Found ${elements.length} elements on page ${currentPage}`);

		let saved = false;
		for (const el of elements) {
			const filePath = path.join(tempDir, `page_${currentPage}.png`);
			try {
				const isCanvas = await el.evaluate((el) => el.tagName === 'CANVAS');
				let buffer;

				if (isCanvas) {
					const canvasSignature = await el.evaluate((el) => el.outerHTML);
					if (currentPage > 1 && seenSources.has(canvasSignature)) continue;
					seenSources.add(canvasSignature);

					buffer = await frame
						.evaluate((canvas) => {
							const dataUrl = canvas.toDataURL('image/png');
							return fetch(dataUrl)
								.then((res) => res.blob())
								.then((blob) => blob.arrayBuffer());
						}, el)
						.then((ab) => Buffer.from(ab));
				} else {
					const src = await el.evaluate((el) => el.src);
					if (currentPage > 1 && seenSources.has(src)) continue;
					seenSources.add(src);

					buffer = await frame
						.evaluate(async (blobUrl) => {
							const response = await fetch(blobUrl);
							if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
							const blob = await response.blob();
							const arrayBuffer = await blob.arrayBuffer();
							return Array.from(new Uint8Array(arrayBuffer));
						}, src)
						.then((byteArray) => Buffer.from(byteArray));
				}

				if (buffer && buffer.length > 0) {
					if (processImageBuffer(buffer, filePath)) {
						saved = true;
						break;
					}
				} else {
					console.warn(`Empty buffer for page ${currentPage}`);
				}
			} catch (error) {
				console.error(`Failed to process page ${currentPage}:`, error.message);
			}
		}

		if (!saved) {
			console.warn(`No valid image saved for page ${currentPage}`);
		}

		if (currentPage < totalPages) {
			const nextButton = await frame.$('[aria-label="Go to next page"]');
			if (!nextButton) {
				console.error('Next button not found');
				break;
			}
			await nextButton.click();
			await sleep(2000);
		}
	}

	// Combine images into PDF with dynamic page sizing
	const doc = new PDFDocument({ autoFirstPage: false });
	const pdfStream = fs.createWriteStream(outputPdf);
	doc.pipe(pdfStream);

	for (let i = 1; i <= totalPages; i++) {
		const imgPath = path.join(tempDir, `page_${i}.png`);
		if (fs.existsSync(imgPath)) {
			try {
				const img = doc.openImage(imgPath);
				const imgWidth = img.width;
				const imgHeight = img.height;

				doc.addPage({ size: [imgWidth, imgHeight] });
				doc.image(img, 0, 0, { width: imgWidth, height: imgHeight });
				console.log(`Added page ${i} to PDF (width: ${imgWidth}px, height: ${imgHeight}px)`);
			} catch (error) {
				console.error(`Failed to add page ${i} to PDF:`, error.message);
				console.log(`Skipping page ${i} due to format error`);
			}
		} else {
			console.warn(`Page ${i} not found in ${tempDir}`);
		}
	}

	doc.end();
	console.log(`PDF saved as ${outputPdf}`);
}

// Main function to handle multiple URLs
async function scrapeMultiplePDFs() {
	let cookies;
	try {
		cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
	} catch (error) {
		console.error('Failed to load cookies from file:', error.message);
		return;
	}

	if (!Array.isArray(cookies) || !cookies.length) {
		console.error('No valid cookies found in', COOKIES_FILE);
		return;
	}

	const browser = await puppeteer.launch({
		headless: false,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-infobars'],
		defaultViewport: null,
		protocolTimeout: 120000,
	});

	const page = await browser.newPage();
	await page.setCookie(...cookies);

	for (let i = 0; i < PARENT_PAGE_URLS.length; i++) {
		const url = PARENT_PAGE_URLS[i];
		console.log(`\nStarting scrape for URL ${i + 1}/${PARENT_PAGE_URLS.length}: ${url}`);

		await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

		const iframeHandle = await page.waitForSelector('iframe', { timeout: 60000 });
		if (!iframeHandle) {
			console.error(`Iframe not found for ${url}`);
			continue;
		}
		const frame = await iframeHandle.contentFrame();
		if (!frame) {
			console.error(`Iframe content inaccessible for ${url}`);
			continue;
		}

		await sleep(10000);

		let totalPages;
		try {
			totalPages = await frame.evaluate(() => {
				const totalPagesElement = document.querySelector('.PageNumberUI__totalPagesModern___1zDK_');
				return totalPagesElement ? parseInt(totalPagesElement.textContent.trim(), 10) : null;
			});
			if (!totalPages || isNaN(totalPages)) throw new Error('Total pages not found or invalid');
			console.log(`Detected total pages: ${totalPages}`);
		} catch (error) {
			console.error(`Failed to detect total pages for ${url}:`, error.message);
			totalPages = 165;
			console.log(`Using fallback total pages: ${totalPages}`);
		}

		const urlSlug = url
			.split('/')
			.pop()
			.replace(/[^a-z0-9]/gi, '_');
		const tempDir = path.join(TEMP_DIR, urlSlug);
		const outputPdf = `${OUTPUT_PDF_PREFIX}_${urlSlug}.pdf`;

		ensureDir(tempDir);

		await scrapeSinglePDF(frame, totalPages, tempDir, outputPdf);
	}

	await browser.close();
	console.log('All PDFs scraped successfully.');
}

// Run the script
scrapeMultiplePDFs().catch(console.error);
