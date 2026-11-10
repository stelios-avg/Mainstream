import { NextResponse } from 'next/server';
import crypto from 'crypto';

const REDIRECT_URI = 'https://mainstream-six.vercel.app/api/etsy-callback';

function getVerifier() {
  const secret = (process.env.ETSY_SHARED_SECRET || 'default_secret_fallback_string').trim();
  return crypto.createHash('sha256').update(secret).digest('base64url');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const apiKey = (process.env.ETSY_API_KEY || 'hypp4rgfdxu7zqcmlb48elga').trim();
  const verifier = getVerifier();

  // Βήμα Α: Ανακατεύθυνση στο Etsy για έγκριση (OAuth)
  if (!code) {
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authUrl = new URL('https://www.etsy.com/oauth/connect');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('scope', 'listings_r listings_w listings_d transactions_r shops_r');
    authUrl.searchParams.set('client_id', apiKey);
    authUrl.searchParams.set('state', 'mainstream_sync');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return NextResponse.redirect(authUrl.toString());
  }

  // Βήμα Β: Ανταλλαγή του code με Access & Refresh Token
  const tokenRes = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: apiKey,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    return NextResponse.json({ error: tokenData }, { status: 400 });
  }

  // Βήμα Γ: Αυτόματη εύρεση του Shop ID
  const userId = tokenData.access_token.split('.')[0];
  const sharedSecret = (process.env.ETSY_SHARED_SECRET || '').trim();
  const xApiKey = sharedSecret ? `${apiKey}:${sharedSecret}` : apiKey;

  const shopRes = await fetch(`https://api.etsy.com/v3/application/users/${userId}/shops`, {
    headers: {
      'x-api-key': xApiKey,
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });
  const shopData = await shopRes.json();

  return NextResponse.json({
    message: 'Αντέγραψε αυτές τις τιμές:',
    ETSY_REFRESH_TOKEN: tokenData.refresh_token,
    SHOP_ID: shopData.results?.[0]?.shop_id || shopData.shop_id || shopData,
  });
}
