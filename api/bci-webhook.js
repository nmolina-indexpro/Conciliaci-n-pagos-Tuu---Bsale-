// /api/bci-webhook.js
// Recibe las notificaciones de transferencias que Bci envía via webhook
// (producto "Business Notifications"), y las guarda en base de datos para
// poder cruzarlas después contra los documentos de Bsale.
//
// IMPORTANTE: todavía no tenemos confirmado el formato exacto del payload que
// manda Bci (falta revisar "simulateNotification" en su portal), así que
// guardamos el body COMPLETO en una columna JSONB (columna "payload") y
// además intentamos extraer algunos campos comunes de forma defensiva. Una
// vez confirmado el formato real, hay que ajustar esa extracción para que
// quede exacta.
//
// Requiere la variable de entorno POSTGRES_URL, que Vercel agrega sola al
// conectar una base de datos Postgres desde Storage > Create Database.

import { sql } from '@vercel/postgres';

async function asegurarTabla() {
  await sql`
    CREATE TABLE IF NOT EXISTS bci_notificaciones (
      id SERIAL PRIMARY KEY,
      recibido_en TIMESTAMPTZ DEFAULT now(),
      monto NUMERIC,
      fecha TEXT,
      referencia TEXT,
      origen TEXT,
      payload JSONB
    );
  `;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, se espera POST' });
  }

  if (!process.env.POSTGRES_URL) {
    return res.status(500).json({ error: 'POSTGRES_URL no está configurada en el servidor (falta conectar la base de datos en Vercel)' });
  }

  try {
    const body = req.body || {};

    // Extracción defensiva de campos comunes -> AJUSTAR cuando se confirme el
    // formato real con simulateNotification.
    const monto = body.amount ?? body.Amount ?? body.monto ?? body.value ?? null;
    const fecha = body.date ?? body.Date ?? body.fecha ?? body.transactionDate ?? null;
    const referencia = body.reference ?? body.Reference ?? body.glosa ?? body.description ?? body.id ?? null;
    const origen = body.senderName ?? body.SenderName ?? body.origen ?? body.payer ?? body.debtorName ?? null;

    await asegurarTabla();

    await sql`
      INSERT INTO bci_notificaciones (monto, fecha, referencia, origen, payload)
      VALUES (${monto}, ${fecha}, ${referencia}, ${origen}, ${JSON.stringify(body)});
    `;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error guardando la notificación', detail: String(err) });
  }
}
