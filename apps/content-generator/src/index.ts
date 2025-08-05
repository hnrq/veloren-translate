import { HttpFunction } from '@google-cloud/functions-framework';
import { Storage } from '@google-cloud/storage';
import slugify from 'slugify';

const storage = new Storage();

const TRANSLATED_HTML_BUCKET_NAME = process.env.TRANSLATED_HTML_BUCKET_NAME;
const CONTENT_BUCKET_NAME = process.env.CONTENT_BUCKET_NAME;

interface GCSObjectData {
  bucket: string;
  name: string;
}

export const main = async (file: GCSObjectData) => {
  if (!file) throw new Error('No file data found in the event.');

  const { name: filePath, bucket: bucketName } = file;

  console.log(`Processing file: ${filePath} from bucket: ${bucketName}`);

  if (bucketName !== TRANSLATED_HTML_BUCKET_NAME) {
    console.log(`Ignoring file from unexpected bucket: ${bucketName}`);
    return;
  }

  const fileMatch = filePath.match(
    /(?:.*\/)?(.*)_([a-z]{2,3}(?:-[a-zA-Z]{2,4})?)_translations\.html$/,
  );

  if (!fileMatch) {
    console.log(
      `Skipping file ${filePath}: Does not match expected format '<original_file_name>_[trg]_translations.html'`,
    );
    return;
  }

  const originalFileName = fileMatch[1].replace(
    'veloren-html-raw_raw-html_',
    '',
  );
  const language = fileMatch[2];
  console.log(
    `Detected language: ${language} for original file: ${originalFileName}`,
  );

  try {
    const bucket = storage.bucket(bucketName);
    const [fileContentBuffer] = await bucket.file(filePath).download();
    const htmlString = fileContentBuffer.toString('utf8');
    console.log(`HTML content read from ${filePath}.`);

    const titleMatch = htmlString.match(/data-title="([^"]*)"/);
    const pubDateMatch = htmlString.match(/data-pubdate="([^"]*)"/);
    const urlMatch = htmlString.match(/data-url="([^"]*)"/);
    const coverMatch = htmlString.match(/data-cover="([^"]*)"/);

    const title = titleMatch
      ? decodeURIComponent(titleMatch[1])
      : 'Untitled Post';
    const pubDate = pubDateMatch ? pubDateMatch[1] : new Date().toISOString();
    const url = urlMatch?.[1];
    const cover = coverMatch?.[1];

    console.log(
      `Extracted metadata: Title="${title}", PubDate="${pubDate}", URL="${url}"`,
    );

    const cleanHtmlString: string = htmlString.replace(
      /<div style="display:none;"[^>]*>[\s\S]*?<\/div>/,
      '',
    );

    console.log('HTML converted to JSON.');

    const jsonFileName = `${originalFileName}.json`;
    const jsonFilePath = `${language}/${Date.now()}/${jsonFileName}`;
    const jsonBucket = storage.bucket(CONTENT_BUCKET_NAME);
    const jsonFile = jsonBucket.file(jsonFilePath);

    await jsonFile.save(
      JSON.stringify({
        title,
        date: pubDate,
        source_url: url,
        language: language,
        content: cleanHtmlString,
        cover,
        slug: slugify(title, { lower: true }),
      }),
      {
        contentType: 'application/json',
      },
    );
    console.log(`Saved JSON file: ${jsonFilePath} to ${CONTENT_BUCKET_NAME}`);
  } catch (error: any) {
    throw new Error(`Error converting HTML to JSON for ${filePath}: ${error}`);
  }
};
