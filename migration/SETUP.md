# Migrating the backend from Notion → Google Sheets

The app's serverless functions now read/write a **Google Sheet** instead of Notion.
This is a one-time setup. Until you finish steps 1–4 and deploy, the live app keeps
running on Notion (this work is on the `migrate-to-sheets` branch).

## What changed in the code

| Function          | Before (Notion)                    | After (Sheets)                          |
|-------------------|------------------------------------|-----------------------------------------|
| `api/sync.js`     | Create a page in Deliveries/Inventory DB | Append a row to the Deliveries/Inventory tab |
| `api/entries.js`  | Query both DBs                     | Read both tabs                          |
| `api/tag-delete.js` | Tick "Tagged for deletion" on a page | Set "Tagged for deletion" = TRUE on the row |
| `api/sales.js`    | Query the Sales DB                | Read the Sales tab                      |
| `api/_sheets.js`  | —                                 | New shared, zero-dependency Sheets client |

`NOTION_TOKEN` and the `NOTION_*_DB` env vars are no longer used.

---

## 1. Create the Google Sheet

1. Upload `migration/kairos-baking.xlsx` to Google Drive and open it with Google
   Sheets (**File → Save as Google Sheets**), OR create a blank sheet and
   **File → Import → Upload** the xlsx (choose *Replace spreadsheet*).
2. Confirm it has three tabs named exactly **Deliveries**, **Inventory**, **Sales**,
   each with a header row. (The headers and historical rows are already filled in.)
3. From the URL, copy the **spreadsheet id**: `.../spreadsheets/d/`**`<SHEET_ID>`**`/edit`.

## 2. Create a Google service account

1. Go to <https://console.cloud.google.com/> → create (or pick) a project.
2. **APIs & Services → Library →** search **Google Sheets API** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account.**
   Give it a name (e.g. `kairos-sheets`), click **Done**.
4. Open the service account → **Keys → Add key → Create new key → JSON**. A
   `*.json` file downloads. Keep it secret.
5. Copy the service account's **email** (looks like
   `kairos-sheets@PROJECT.iam.gserviceaccount.com`).

## 3. Share the sheet with the service account

In the Google Sheet → **Share** → paste the service account email → give it
**Editor** → send. (No email actually goes anywhere; this just grants access.)

## 4. Set Vercel environment variables

In the Vercel project → **Settings → Environment Variables**, add:

| Name             | Value                                                                 |
|------------------|-----------------------------------------------------------------------|
| `SHEET_ID`       | the spreadsheet id from step 1                                         |
| `GOOGLE_SA_JSON` | the **base64** of the downloaded JSON key (see command below)          |
| `APP_KEY`        | *(optional, keep if you already use it)*                               |
| `NTFY_TOPIC`     | *(optional, keep your existing value for phone push)*                  |

Base64-encode the key file (run locally):

```sh
base64 -i ~/Downloads/your-service-account-key.json | tr -d '\n' | pbcopy
# now paste into the GOOGLE_SA_JSON value
```

> Why base64? The JSON contains newlines in the private key; base64 makes it a
> single safe line for an env var. The function decodes it at runtime.

## 5. Deploy & verify

1. Merge `migrate-to-sheets` (or deploy it as a Vercel preview).
2. Smoke-test the endpoints (replace the host with your deployment URL):

   ```sh
   curl -s https://<your-app>.vercel.app/api/entries | head -c 400
   curl -s https://<your-app>.vercel.app/api/sales   | head -c 400
   ```

   Both should return JSON with your migrated rows.
3. In the app: add a test Delivery → it should appear in the **Deliveries** tab of
   the sheet within a second, and show **✓ Synced to Sheets**. Tag it for deletion
   (password `kairos`) → the row's **Tagged for deletion** cell flips to TRUE.

## 6. After cutover

- Remove the unused `NOTION_TOKEN` / `NOTION_*_DB` env vars from Vercel.
- **Sales stays fresh only if the OCR pipeline also writes to the sheet.** Right now
  your local OCR pipeline (`~/Downloads/kairos_videos_raw/`) writes the Sales rows to
  Notion. After this migration, repoint that pipeline to append to the **Sales** tab
  (same service account + sheet) — otherwise the Sales tab shows only the history
  exported here and won't get new days. This is a separate, follow-up change.

## Notes / caveats on the exported data

- Row **ids** for Deliveries/Inventory reuse the old Notion page ids, so devices that
  already synced those entries won't show duplicates after cutover. New rows get a
  fresh UUID.
- The export was pulled from the live `/api/entries` and `/api/sales` endpoints
  (the data the app actually uses). Two Notion-only Sales fields the app never read —
  **Orders** and **Summary** — are left blank; the columns exist so the OCR pipeline
  can fill them later. Historical **Matcha/Chocolate** on delivery/inventory rows are
  blank (the app stopped writing them long ago).
