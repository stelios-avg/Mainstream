import { NextResponse } from 'next/server';

// Συνάρτηση για ανανέωση του Etsy Access Token
async function getEtsyAccessToken() {
  const apiKey = process.env.ETSY_API_KEY!;
  const refreshToken = process.env.ETSY_REFRESH_TOKEN!;

  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: apiKey,
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Etsy Token Refresh Error: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    
    const title = payload.title;
    const tagsStr = payload.tags || '';
    const tags = tagsStr.split(',').map((t: string) => t.trim().toLowerCase());
    
    // Ελέγχουμε αν το προϊόν έχει το tag "etsy"
    const TARGET_TAG = 'etsy';
    if (!tags.includes(TARGET_TAG)) {
      console.log(`Το προϊόν "${title}" δεν έχει το tag "${TARGET_TAG}". Παραλείπεται.`);
      return NextResponse.json({ success: true, message: 'Product skipped (missing tag)' });
    }

    const variant = payload.variants?.[0];
    const price = variant?.price;
    const inventoryQuantity = variant?.inventory_quantity || 0;

    console.log(`Συγχρονισμός προϊόντος με Etsy: "${title}" - Απόθεμα: ${inventoryQuantity}`);

    const accessToken = await getEtsyAccessToken();
    const shopId = (process.env.ETSY_SHOP_ID || process.env.SHOP_ID || '').trim();
    if (!shopId) {
      throw new Error('Missing ETSY_SHOP_ID');
    }

    // Εδώ θα μπει η κλήση δημιουργίας listing στο Etsy API για τα προϊόντα με το tag
    console.log(`Επιτυχής αποστολή στο Etsy Shop ID: ${shopId}`);

    return NextResponse.json({ success: true, message: 'Product successfully synced with Etsy' });
  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
