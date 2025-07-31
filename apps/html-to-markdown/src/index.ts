import { Storage } from '@google-cloud/storage';
import TurndownService from 'turndown';
import * as yaml from 'js-yaml';
import { CloudEvent } from '@google-cloud/functions-framework';

const storage = new Storage();
const turndownService = new TurndownService();

const TRANSLATED_HTML_BUCKET_NAME = process.env.TRANSLATED_HTML_BUCKET_NAME;
const MARKDOWN_BUCKET_NAME = process.env.MARKDOWN_BUCKET_NAME;

/**
 * Interface for the Cloud Storage event data.
 */
interface GCSObjectData {
  bucket: string;
  name: string;
  contentType?: string;
  metageneration?: string;
  timeCreated?: string;
  updated?: string;
}

/**
 * Converts an HTML file from Cloud Storage to Markdown with frontmatter.
 * This function is triggered by a Cloud Storage object finalization event.
 *
 * @param {CloudEvent<GCSObjectData>} event The Cloud Storage event object that triggered the event.
 */
export const main = async (event: CloudEvent<GCSObjectData>): Promise<void> => {
  const file = event.data;

  if (!file) {
    console.error('No file data found in the event.');
    return;
  }

  const { name: filePath, bucket: bucketName } = file;

  console.log(`Processing file: ${filePath} from bucket: ${bucketName}`);

  if (bucketName !== TRANSLATED_HTML_BUCKET_NAME) {
    console.log(`Ignoring file from unexpected bucket: ${bucketName}`);
    return;
  }

  const languageMatch = filePath.match(/^(es|pt-br)\//);
  if (!languageMatch) {
    console.log(
      `Skipping file ${filePath}: Does not match expected language prefix (es/ or pt-br/).`,
    );
    return;
  }
  const language: string = languageMatch[1];
  console.log(`Detected language: ${language}`);

  try {
    const bucket = storage.bucket(bucketName);
    const [fileContentBuffer] = await bucket.file(filePath).download();
    const htmlString: string = fileContentBuffer.toString('utf8');
    console.log(`HTML content read from ${filePath}.`);

    const titleMatch = htmlString.match(/data-title="([^"]*)"/);
    const pubDateMatch = htmlString.match(/data-pubdate="([^"]*)"/);
    const urlMatch = htmlString.match(/data-url="([^"]*)"/);

    const title: string = titleMatch
      ? decodeURIComponent(titleMatch[1])
      : 'Untitled Post';
    const pubDate: string = pubDateMatch
      ? pubDateMatch[1]
      : new Date().toISOString();
    const url: string = urlMatch ? urlMatch[1] : 'No URL';

    console.log(
      `Extracted metadata: Title="${title}", PubDate="${pubDate}", URL="${url}"`,
    );

    const cleanHtmlString: string = htmlString.replace(
      /<div style="display:none;"[^>]*>[\s\S]*?<\/div>/,
      '',
    );

    const markdownContent: string = turndownService.turndown(cleanHtmlString);
    console.log('HTML converted to Markdown.');

    const frontmatter = {
      title: title,
      date: pubDate,
      source_url: url,
      language: language,
    };
    const yamlFrontmatter: string = yaml.dump(frontmatter);

    const finalMarkdown: string = `---\n${yamlFrontmatter}---\n\n${markdownContent}`;

    const markdownFileName: string = filePath.replace('.html', '.md');
    const markdownFilePath: string = `markdown/${markdownFileName}`;
    const markdownBucket = storage.bucket(MARKDOWN_BUCKET_NAME);
    const markdownFile = markdownBucket.file(markdownFilePath);

    await markdownFile.save(finalMarkdown, {
      contentType: 'text/markdown',
    });
    console.log(
      `Saved Markdown file: ${markdownFilePath} to ${MARKDOWN_BUCKET_NAME}`,
    );
  } catch (error: any) {
    console.error(`Error converting HTML to Markdown for ${filePath}:`, error);
  }
};
