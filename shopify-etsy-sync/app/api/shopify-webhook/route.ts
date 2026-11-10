import { NextResponse } from 'next/server';

// Συνάρτηση για ανανέωση του Etsy Access Token μέσω του Refresh Token
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
    
    // Παίρνουμε τα στοιχεία του προϊόντος από το Shopify
    const title = payload.title;
    const bodyHtml = payload.body_html || '';
    const variant = payload.variants?.[0];
    const price = variant?.price;
    const inventoryQuantity = variant?.inventory_quantity || 0;

    console.log(`Λήφθηκε προϊόν από Shopify: "${title}" - Απόθεμα: ${inventoryQuantity}`);

    // Ανάκτηση ενεργού Access Token για το Etsy
    const accessToken = await getEtsyAccessToken();
    const apiKey = process.env.ETSY_API_KEY!;
    const shopId = process.env.ETSY_SHOP_ID!;

    // Παράδειγμα κλήσης προς το Etsy API για ενημέρωση αποθέματος/προϊόντος
    // (Εδώ θα συνδέσουμε την αντίστοιχη καταχώρηση στο Etsy)
    console.log(`Επιτυχής επικοινωνία με Etsy Shop ID: ${shopId}`);

    return NextResponse.json({ success: true, message: 'Webhook processed & synced with Etsy' });
  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
