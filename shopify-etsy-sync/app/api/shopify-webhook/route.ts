import { NextResponse } from 'next/server';

function toEtsyTitle(title: string) {
  const cleaned = title
    .replace(/<[^>]*>?/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
  return (cleaned || 'Product').slice(0, 140);
}

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

function shopifyImageUrls(payload: { images?: { src?: string; position?: number }[]; image?: { src?: string } }) {
  const images = Array.isArray(payload.images) ? payload.images : [];
  const urls = [...images]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((image) => image.src)
    .filter((src): src is string => Boolean(src));

  if (urls.length === 0 && payload.image?.src) {
    urls.push(payload.image.src);
  }

  return [...new Set(urls)].slice(0, 10);
}

async function uploadListingImage(
  shopId: string,
  listingId: number,
  apiKey: string,
  accessToken: string,
  imageUrl: string,
  rank: number,
) {
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) {
    throw new Error(`Αποτυχία λήψης φωτογραφίας Shopify (${imageRes.status}): ${imageUrl}`);
  }

  const contentType = imageRes.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  const extension = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg';
  const bytes = await imageRes.arrayBuffer();
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: contentType }), `photo-${rank}.${extension}`);
  form.append('rank', String(rank));
  form.append('overwrite', 'true');

  const res = await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/listings/${listingId}/images`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Etsy Image Error: ${JSON.stringify(data)}`);
  }

  return data.listing_image_id as number;
}

async function findExistingListingId(shopId: string, apiKey: string, accessToken: string, title: string) {
  const target = toEtsyTitle(title).toLowerCase();

  for (const state of ['draft', 'active']) {
    const url = new URL(`https://api.etsy.com/v3/application/shops/${shopId}/listings`);
    url.searchParams.set('state', state);
    url.searchParams.set('limit', '100');

    const res = await fetch(url, {
      headers: {
        'x-api-key': apiKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Etsy Listings Error: ${JSON.stringify(data)}`);
    }

    const match = (data.results || []).find(
      (listing: { title?: string }) => (listing.title || '').trim().toLowerCase() === target,
    );
    if (match?.listing_id) {
      return match.listing_id as number;
    }
  }

  return null;
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

    console.log(`Συγχρονισμός στο Etsy για το προϊόν: "${title}" - Τιμή: ${price} - Απόθεμα: ${inventoryQuantity}`);

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

    const listingTitle = toEtsyTitle(title);
    let listingId = await findExistingListingId(shopId, xApiKey, accessToken, listingTitle);

    if (listingId) {
      console.log(`Υπάρχει ήδη listing ${listingId} για "${listingTitle}". Δεν δημιουργείται δεύτερο.`);
    } else {
      const etsyRes = await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': xApiKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          quantity: inventoryQuantity,
          title: listingTitle,
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

      listingId = etsyData.listing_id;
      console.log(`Επιτυχής δημιουργία listing στο Etsy! Listing ID: ${listingId}`);
    }

    if (!listingId) {
      throw new Error('Missing Etsy listing id');
    }

    const imageUrls = shopifyImageUrls(payload);
    const imageIds: number[] = [];
    const imageErrors: string[] = [];

    for (let index = 0; index < imageUrls.length; index += 1) {
      const rank = index + 1;
      try {
        const imageId = await uploadListingImage(
          shopId,
          listingId,
          xApiKey,
          accessToken,
          imageUrls[index],
          rank,
        );
        imageIds.push(imageId);
        console.log(`Ανέβηκε φωτογραφία ${rank}/${imageUrls.length} στο listing ${listingId}`);
      } catch (imageError) {
        const message = imageError instanceof Error ? imageError.message : String(imageError);
        imageErrors.push(message);
        console.error(message);
      }
    }

    if (imageUrls.length === 0) {
      console.log(`Το προϊόν "${title}" δεν έχει φωτογραφίες στο Shopify.`);
    }

    return NextResponse.json({
      success: true,
      listing_id: listingId,
      images_uploaded: imageIds.length,
      image_errors: imageErrors,
    });
  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
