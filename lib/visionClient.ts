// lib/visionClient.ts
import { ImageAnnotatorClient } from '@google-cloud/vision';

let client: ImageAnnotatorClient | null = null;

export function getVisionClient() {
  if (!client) {
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!raw) throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS env');

    const credentials = JSON.parse(raw);
    client = new ImageAnnotatorClient({ credentials });
  }
  return client;
}
