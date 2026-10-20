import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // 1. Παραλαβή των δεδομένων από το Shopify
    const body = await request.json();
    
    // Κάνουμε log τον τίτλο του προϊόντος για να δούμε ότι δουλεύει
    console.log("Ολόκληρο το Payload από Shopify:", body);
    console.log("ID Προϊόντος:", body.id);
    console.log("Τίτλος Προϊόντος:", body.title);

    // 2. ΕΔΩ ΘΑ ΜΠΕΙ Ο ΚΩΔΙΚΑΣ ΓΙΑ ΤΟ ETSY (Σύντομα)
    // const etsyApiKey = process.env.ETSY_API_KEY;
    // await fetch('https://openapi.etsy.com/v3/application/...', { ... })

    // 3. Επιστρέφουμε "200 OK" στο Shopify για να ξέρει ότι το λάβαμε
    return NextResponse.json({ message: "Webhook received and processed" }, { status: 200 });
    
  } catch (error) {
    console.error("Σφάλμα κατά τη λήψη του webhook:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
