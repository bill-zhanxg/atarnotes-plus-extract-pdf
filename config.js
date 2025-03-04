export const config = {
	PARENT_PAGE_URLS: [
		'https://plus.atarnotes.com/books/viewer/vce-general-maths-34-topic-tests',
	],
	OUTPUT_PDF_PREFIX: 'scraped_pdf',
	TEMP_DIR: 'temp_images',
	COOKIES_FILE: 'cookies.json',

	LOGIN_URL: 'https://plus.atarnotes.com/login',
	// Not correct
	SUCCESS_SELECTOR: '.pdf-viewer',
};
