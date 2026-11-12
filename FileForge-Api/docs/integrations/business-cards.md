# Business cards and contacts

Photo of a card -> fields read by a Groq vision model -> the user reviews and corrects -> approve -> a **centralized contact**
linked back to the scan. The photo is kept in **central storage** (the administrator's OneDrive), owned by the user who scanned it.

## Flow

1. `POST /workspaces/:workspaceId/business-cards/scan` (multipart: `front` required, `back` optional; each JPG, PNG or WebP, up to 10 MB; role owner/admin/editor).
   - **Front and back are ONE card:** both photos go to the model in a single request (front first) and are merged into one result,
     the front winning where they disagree. Both photos are stored, and if anything fails after an upload every photo of that card is removed.
   - The file type is decided from the **bytes**, not the name. Anything else answers 415.
   - The card is read **first** (so a failure stores nothing), then the photo is uploaded to central storage, then a **pending** scan
     is saved. If saving fails after the upload, the upload is removed.
   - The scan route shares the upload rate limit of "My Files" (default 10 uploads / 10 min / user, `CENTRAL_UPLOAD_*`).
2. `GET .../business-cards/:id` / `GET .../business-cards/:id/image` show the result and the photos (`?side=front` by default, `?side=back` for the back; 404 when the card has none).
3. `PATCH .../business-cards/:id` corrects fields (only pending scans; only the fields sent change; `null` or `""` clears one).
4. `POST .../business-cards/:id/approve` saves the contact. `POST .../reject` discards it (the photo stays in central storage).
5. `GET .../contacts`, `GET .../contacts/:id`, `PATCH`, `DELETE` (soft) work on the centralized contacts.

A scan is visible **only to the user who made it**. Contacts belong to the **workspace** (every member with a role can read them).

## Using the camera (web app)

**Scan with camera** opens a guided window: take the front, crop it (cropperjs: drag the corners, rotate, any shape or card-shaped),
choose **Add the back** or **No back**, and carry straight on with the next card. Finished cards wait in a queue on the page, and
**Scan all** reads them **one at a time** (the card reader and the upload limit are shared). A card that fails stays in the queue with
its reason; a rate limit pauses the queue and keeps the rest waiting. Photos dropped on the page (or chosen from the gallery in the
camera window) work too; only the camera window crops.

- The browser only gives a page a camera on **https or localhost**. On a phone, open the app over https; on plain http the window says
  so and offers choosing a photo instead.
- It asks for the rear camera, lets you pick another, offers the light where the camera has one, and switches the camera off the
  moment the window closes.
- Nothing is uploaded until **Scan**. The cropped pictures only exist in the browser until then.

## What is read from the card

```json
{
  "fullName": "Arun Kumar", "jobTitle": "Software Developer", "companyName": "ABC Technologies", "department": "Engineering",
  "email": "arun@example.com", "mobile": "+91 9876543210", "website": "https://example.com",
  "address": { "line1": null, "city": "Chennai", "state": "Tamil Nadu", "postalCode": null, "country": "India" },
  "socialLinks": { "linkedin": null, "github": null }
}
```

Every value is `null` when the card does not show it. `address.line1` and `address.postalCode` are additions to the sample shape.
The model's answer is never trusted as it is: each field is validated on its own (e-mail format, phone digits, http(s) links, lengths) and
a bad value becomes `null` instead of failing the scan. The model's untouched answer is kept in `business_card_scans.raw_extraction`.

## Centralized contacts

One set of tables for the contacts of **every** module, scoped to a workspace:

| Table                  | Holds                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `contacts`             | the person; `source_type_id` + `source_record_id` = where it **first** came from             |
| `contact_methods`      | e-mail (stored lowercase), phone, website, social; `label` = mobile / work / linkedin / ...  |
| `contact_addresses`    | postal addresses                                                                             |
| `contact_entity_links` | **entity type + entity id**: every record of any module the contact is linked to             |
| `business_card_scans`  | one scanned card: `central_file_id` (front photo), `back_central_file_id` (back photo, optional), raw + corrected data, `review_status`       |

An approved card is linked as **entity type `business_card_scan`, entity id = the scan id** (`master.entity_types`), and the contact's
source is `business_card` (`master.contact_source_types`). A future module links its own records the same way:
`ContactsService.saveFromSource(tx, { entityTypeCode, entityId, sourceTypeCode, person })` inside its own transaction.

**Duplicates:** if a live contact of the workspace already has one of the card's e-mail addresses (case-insensitive), the card is added
to that contact instead of creating a second one. Only blank fields are filled and missing methods are added; nothing is overwritten.

## Setup

| Setting        | Default             | Notes                                                                              |
| -------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `GROQ_API_KEY` | none                | https://console.groq.com/keys. Without it the API still starts and scanning answers 503. |
| `GROQ_MODEL`   | `qwen/qwen3.8-27b`  | Must accept images and JSON mode. An image costs a fixed 2048 input tokens.        |

Central storage must be connected (admin page) or uploads fail. Groq's free tier has rate limits: a 429 from Groq answers
`EXTRACTION_RATE_LIMITED` with the wait time. The card photo and its text go to Groq; neither the image, the card text nor the key is logged.

## Errors

`IMAGE_TYPE_NOT_SUPPORTED` 415 · `IMAGE_TOO_LARGE` 413 · `EXTRACTION_NOT_CONFIGURED` 503 · `EXTRACTION_RATE_LIMITED` 429 ·
`EXTRACTION_UNAVAILABLE` / `EXTRACTION_INVALID_RESPONSE` 502 · `NOTHING_TO_SAVE` 422 (approve needs a name, company, e-mail or phone) ·
`SCAN_ALREADY_REVIEWED` 409 · `SCAN_NOT_FOUND` / `CONTACT_NOT_FOUND` 404.

## Tests

`npm test` covers the sanitizer, the Groq client (mocked `fetch`: bad JSON, `<think>` text, 401/413/429/5xx, no key leak), the scan rules
and that the routes are registered. `business-cards.integration.spec.ts` runs the real services on the real schema; it is skipped unless `IT_DATABASE_URL`
points at a **local** migrated database (see the header of that file).
