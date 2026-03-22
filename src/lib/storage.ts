import { google } from "googleapis";
import { randomUUID } from "crypto";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
});

const storage = google.storage({ version: "v1", auth });
const BUCKET = process.env.GCS_BUCKET_NAME!;

export async function uploadFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const ext = fileName.match(/\.[^.]+$/)?.[0] || ".png";
  const objectName = `${randomUUID()}${ext}`;

  await storage.objects.insert({
    bucket: BUCKET,
    name: objectName,
    media: {
      mimeType,
      body: buffer,
    },
  });

  return `https://storage.googleapis.com/${BUCKET}/${objectName}`;
}
