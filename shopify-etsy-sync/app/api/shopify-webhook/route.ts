import { NextResponse } from 'next/server';

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

async function getShippingProfileId(shopId: string, apiKey: string, accessToken: string) {
  const res = await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/shipping-profiles`, {
    headers: {
      'x-api-key': apiKey,
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Etsy Shipping Profile Error: ${JSON.stringify(data)}`);
  }
  if (data.results && data.results.length > 0) {
    return data.results[0].shipping_profile_id;
  }
  throw new Error('Δεν βρέθηκε shipping profile στο Etsy. Δημιούργησε τουλάχιστον ένα προφίλ αποστολής στο Etsy shop σου.');
}

async function getReadinessStateId(shopId: string, apiKey: string, accessToken: string) {
  const res = await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/readiness-state-definitions`, {
    headers: {
      'x-api-key': apiKey,
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Etsy Readiness State Error: ${JSON.stringify(data)}`);
  }
  const readinessStateId = data.results?.find((profile: { readiness_state_id?: number }) => profile.readiness_state_id)?.readiness_state_id;
  if (readinessStateId) {
    return readinessStateId;
  }
  throw new Error('Δεν βρέθηκε processing profile στο Etsy. Δημιούργησε τουλάχιστον ένα προφίλ επεξεργασίας στο Etsy shop σου.');
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    
    const title = payload.title;
    const tagsStr = payload.tags || '';
    const tags = tagsStr.split(',').map((t: string) => t.trim().toLowerCase());
    
    const TARGET_TAG = 'etsy';
    if (!tags.includes(TARGET_TAG)) {
      console.log(`Το προϊόν "${title}" δεν έχει το tag "${TARGET_TAG}". Παραλείπεται.`);
      return NextResponse.json({ success: true, message: 'Product skipped (missing tag)' });
    }

    const variant = payload.variants?.[0];
    const price = variant?.price || '10.00';
    const inventoryQuantity = variant?.inventory_quantity || 1;
    const bodyHtml = payload.body_html || title;

    console.log(`Δημιουργία στο Etsy για το προϊόν: "${title}" - Τιμή: ${price} - Απόθεμα: ${inventoryQuantity}`);

    const accessToken = await getEtsyAccessToken();
    const apiKey = (process.env.ETSY_API_KEY || '').trim();
    const shopId = (process.env.ETSY_SHOP_ID || process.env.SHOP_ID || '').trim();

    if (!shopId) {
      throw new Error('Missing ETSY_SHOP_ID environment variable!');
    }

    const sharedSecret = (process.env.ETSY_SHARED_SECRET || '').trim();
    const xApiKey = sharedSecret ? `${apiKey}:${sharedSecret}` : apiKey;

    // Αυτόματη εύρεση ενεργού Shipping Profile και Processing Profile
    const shippingProfileId = await getShippingProfileId(shopId, xApiKey, accessToken);
    const readinessStateId = await getReadinessStateId(shopId, xApiKey, accessToken);
    console.log(`Etsy profiles: shipping=${shippingProfileId}, readiness=${readinessStateId}`);

    const etsyRes = await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/listings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': xApiKey,
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        quantity: inventoryQuantity,
        title: title.substring(0, 100),
        description: bodyHtml.replace(/<[^>]*>?/gm, ''),
        price: parseFloat(price),
        who_made: 'i_did',
        when_made: '2020_2026',
        taxonomy_id: 1,
        shipping_profile_id: shippingProfileId,
        readiness_state_id: readinessStateId,
      }),
    });

    const etsyData = await etsyRes.json();
    
    if (!etsyRes.ok) {
      console.error('Etsy API Error:', JSON.stringify(etsyData));
      throw new Error(`Etsy API Error: ${JSON.stringify(etsyData)}`);
    }

    console.log(`Επιτυχής δημιουργία listing στο Etsy! Listing ID: ${etsyData.listing_id}`);

    return NextResponse.json({ success: true, listing_id: etsyData.listing_id });
  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
