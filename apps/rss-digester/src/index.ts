import { Storage } from "@google-cloud/storage";
import Parser from "rss-parser";
import { Request, Response } from "@google-cloud/functions-framework";

// Initialize Google Cloud Storage client
const storage = new Storage();
const parser = new Parser();

// Configuration for the RSS feed and storage bucket
// Use environment variables for sensitive or deployment-specific values
const RSS_FEED_URL: string = process.env.RSS_FEED_URL || "https://www.nasa.gov/news-release/feed/";
const RAW_HTML_BUCKET_NAME: string =
  process.env.RAW_HTML_BUCKET_NAME || "your-raw-html-bucket-name";

// File to store the list of processed RSS item URLs in Cloud Storage
const PROCESSED_ITEMS_FILE: string = "processed_rss_items.json";

/**
 * Reads the list of previously processed RSS item URLs from Cloud Storage.
 * @returns {Promise<Set<string>>} A Set containing URLs of processed items.
 */
async function getProcessedItems(): Promise<Set<string>> {
  const bucket = storage.bucket(RAW_HTML_BUCKET_NAME);
  const file = bucket.file(PROCESSED_ITEMS_FILE);

  try {
    const [content] = await file.download();
    const urls: string[] = JSON.parse(content.toString("utf8"));
    console.log(`Loaded ${urls.length} previously processed items.`);
    return new Set(urls);
  } catch (error: any) {
    if (error.code === 404) {
      console.log("No previous processed items file found. Starting fresh.");
    } else {
      console.error("Error reading processed items file:", error);
    }
    return new Set(); // Return empty set if file not found or error
  }
}

/**
 * Writes the updated list of processed RSS item URLs to Cloud Storage.
 * @param {Set<string>} processedItems The Set of all processed item URLs.
 */
async function saveProcessedItems(processedItems: Set<string>): Promise<void> {
  const bucket = storage.bucket(RAW_HTML_BUCKET_NAME);
  const file = bucket.file(PROCESSED_ITEMS_FILE);

  const urlsArray = Array.from(processedItems);
  await file.save(JSON.stringify(urlsArray), {
    contentType: "application/json",
  });
  console.log(`Saved ${urlsArray.length} processed items to ${PROCESSED_ITEMS_FILE}.`);
}

/**
 * Parses an RSS feed and saves only newly added items' content as an HTML file
 * in a Cloud Storage bucket, embedding metadata for later retrieval.
 *
 * @param {Request} req The HTTP request object.
 * @param {Response} res The HTTP response object.
 */
export const main = async (req: Request, res: Response): Promise<void> => {
  // Renamed to 'main' for Nx
  console.log("Starting RSS feed digestion process...");

  try {
    // 1. Fetch and parse the RSS feed using rss-parser
    console.log(`Fetching and parsing RSS feed from: ${RSS_FEED_URL}`);
    const feed = await parser.parseURL(RSS_FEED_URL);
    console.log("RSS feed fetched and parsed successfully.");

    const currentItems = feed.items;

    if (!currentItems || currentItems.length === 0) {
      console.log("No items found in the RSS feed.");
      res.status(200).send("No RSS items to process.");
      return;
    }

    // 2. Get previously processed items
    const processedItems = await getProcessedItems();
    const newProcessedItems = new Set(processedItems); // Create a mutable copy

    // 3. Filter for new items
    const newItems = currentItems.filter((item) => {
      // Use item.link as the unique identifier for simplicity
      const isNew = item.link && !processedItems.has(item.link);
      if (isNew) {
        console.log(`Found new item: ${item.title} (${item.link})`);
      }
      return isNew;
    });

    if (newItems.length === 0) {
      console.log("No new RSS items to process.");
      res.status(200).send("No new RSS items to process.");
      return;
    }

    console.log(`Found ${newItems.length} new items to process.`);

    // 4. Process each new RSS item
    const uploadPromises = newItems.map(async (item) => {
      const title: string = item.title || "No Title";
      const pubDate: string = item.pubDate || new Date().toISOString();
      const url: string = item.link || "No URL";
      const content: string = item.content || item.contentEncoded || "";

      const fileName: string = `${encodeURIComponent(title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50))}-${Date.now()}.html`;
      const filePath: string = `raw-html/${fileName}`;

      const htmlContent: string = `
        <div style="display:none;"
             data-title="${title}"
             data-pubdate="${pubDate}"
             data-url="${url}">
        </div>
        ${content}
      `;

      const bucket = storage.bucket(RAW_HTML_BUCKET_NAME);
      const file = bucket.file(filePath);

      await file.save(htmlContent, {
        contentType: "text/html",
      });
      console.log(`Uploaded ${filePath} to ${RAW_HTML_BUCKET_NAME}`);

      // Add the URL of the newly processed item to the set
      if (item.link) {
        newProcessedItems.add(item.link);
      }
    });

    await Promise.all(uploadPromises);

    // 5. Save the updated list of processed items
    await saveProcessedItems(newProcessedItems);

    console.log("All new RSS items processed and uploaded to Cloud Storage.");
    res.status(200).send("New RSS feed digestion completed successfully.");
  } catch (error: any) {
    console.error("Error digesting RSS feed:", error);
    res.status(500).send(`Error processing RSS feed: ${error.message}`);
  }
};
