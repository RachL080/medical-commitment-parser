# Local extraction API

## Configure Gemini

1. Copy `.env.example` to `.env` in this directory.
2. Set `GEMINI_API_KEY` in `.env`. Do not commit or share this file.
3. Install dependencies from the repository root with `npm install --prefix backend`.
4. Start the API with `npm run dev --prefix backend`.
5. Start the frontend separately with `npm run dev --prefix frontend`.

The browser only calls `/api/extract` after the user explicitly presses **חלצי בעזרת Gemini**. The server keeps uploaded content in memory and does not write it to disk. The selected Gemini service receives the document for processing, so use only documents approved for external processing.

The API accepts one PDF, PNG, JPEG, or WebP file up to 12 MB. It returns extracted field values and fields that require manual review.
