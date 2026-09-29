// Reads a photo/screenshot of a grocery receipt and returns the ingredient lines it
// finds (what it was, package size in g/ml, price paid) so the app can update its
// ingredient prices. The image goes to the Anthropic API and is not stored here.
//
// Required env var: ANTHROPIC_API_KEY
// Optional:         RECEIPT_CODE  — if set, requests must send it as x-receipt-code (the app URL is
//                                   public, so without this anyone could spend your API credits)
//                   RECEIPT_MODEL — defaults to claude-sonnet-5-5
//                   APP_KEY       — same optional gate as the other endpoints

const MAX_IMAGE_CHARS = 6_000_000;   // base64 length (~4.5MB) — the client downsizes well below this
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const TOOL = {
  name: 'record_receipt',
  description: 'Record the food and baking-ingredient line items found on a receipt.',
  input_schema: {
    type: 'object',
    properties: {
      store: { type: 'string', description: 'Store name, or empty string if not visible' },
      date: { type: 'string', description: 'Receipt date as YYYY-MM-DD, or empty string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The line exactly as printed' },
            ingredient: { type: ['string', 'null'], description: 'The best match from the known ingredient list, or null if none fits' },
            size_amount: { type: ['number', 'null'], description: 'Total package size for the whole line (all packs), in grams or millilitres. null if not printed or not reliably inferable' },
            size_unit: { type: ['string', 'null'], enum: ['g', 'ml', null] },
            price: { type: 'number', description: 'What was paid for the whole line in USD, after any line discount, before tax' },
          },
          required: ['text', 'ingredient', 'size_amount', 'size_unit', 'price'],
        },
      },
    },
    required: ['store', 'date', 'items'],
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, x-receipt-code');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (process.env.RECEIPT_CODE && req.headers['x-receipt-code'] !== process.env.RECEIPT_CODE) {
    return res.status(401).json({ error: 'Wrong receipt code' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Receipt scanning is not set up yet (ANTHROPIC_API_KEY is missing on the server).' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    const image = body && typeof body.image === 'string' ? body.image : '';
    const mediaType = body && body.mediaType;
    if (!image || image.length > MAX_IMAGE_CHARS || !TYPES.has(mediaType)) {
      return res.status(400).json({ error: 'Send a JPEG/PNG/WebP image under about 4MB.' });
    }
    const known = (Array.isArray(body.known) ? body.known : []).slice(0, 250)
      .map((n) => String(n).slice(0, 60)).filter(Boolean);

    const prompt = [
      'This is a receipt from a home bakery buying ingredients. Extract only the food / baking-ingredient lines',
      '(skip bags, tax, totals, tips, non-food items) by calling record_receipt.',
      'For each line: convert the package size to grams (oz ×28.35, lb ×453.6, kg ×1000) or millilitres (fl oz ×29.57, L ×1000, gal ×3785).',
      'If the line covers several packs (e.g. "2 × 10 lb" or quantity 2), size_amount is the TOTAL for the line and price is the TOTAL paid for the line.',
      'A count of eggs is fine to leave as size null unless a weight is printed (one large egg is about 57 g; a dozen ≈ 680 g).',
      'Only set size_amount when it is printed or clearly inferable from the item name — never guess.',
      'Set "ingredient" to the closest entry from this known list, or null if none is a real match:',
      known.join('; '),
    ].join('\n');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.RECEIPT_MODEL || 'claude-sonnet-5-5',
        max_tokens: 4000,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'record_receipt' },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: prompt },
        ] }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'The receipt reader failed (' + r.status + ').', detail: t.slice(0, 300) });
    }
    const data = await r.json();
    const use = (data.content || []).find((c) => c.type === 'tool_use');
    if (!use || !use.input) return res.status(502).json({ error: 'Could not read that receipt.' });
    const items = (Array.isArray(use.input.items) ? use.input.items : []).map((i) => ({
      text: String(i.text || '').slice(0, 120),
      ingredient: i.ingredient && known.includes(i.ingredient) ? i.ingredient : null,
      size_amount: Number(i.size_amount) > 0 ? Number(i.size_amount) : null,
      size_unit: i.size_unit === 'ml' ? 'ml' : i.size_unit === 'g' ? 'g' : null,
      price: Number(i.price) > 0 ? Number(i.price) : null,
    })).filter((i) => i.price != null);
    return res.status(200).json({ store: String(use.input.store || '').slice(0, 60), date: String(use.input.date || '').slice(0, 10), items });
  } catch (e) {
    return res.status(500).json({ error: 'Receipt scan failed: ' + (e && e.message ? e.message : e) });
  }
}
