// /api/bci-transferencias-report.js
// Consulta las notificaciones de transferencias de Bci ya guardadas en base
// de datos (por api/bci-webhook.js), para un rango de fechas. Mismo patrón
// que tuu-report.js / bsale-report.js / shopify-report.js, para poder
// enchufarlo en Conciliación y Flujo de Caja de la misma forma.
//
// OJO: el import de '@vercel/postgres' se hace DINÁMICO (adentro del
// handler, después de comprobar POSTGRES_URL) porque importarlo a nivel de
// módulo hace que la función completa se caiga con un error crudo de Vercel
// (no un JSON controlado) cuando la variable de entorno todavía no existe.

export default async function handler(req, res) {
  const { date, startDate: qStart, endDate: qEnd } = req.query;
  const startDate = qStart || date;
  const endDate = qEnd || date;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Falta parámetro date, o startDate y endDate (YYYY-MM-DD)' });
  }

  if (!process.env.POSTGRES_URL) {
    return res.status(200).json({
      startDate, endDate, transferencias: [], totalRegistros: 0,
      error: 'POSTGRES_URL no configurada',
      detail: 'Falta conectar la base de datos Postgres en Vercel (Storage > Create Database)'
    });
  }

  try {
    const { sql } = await import('@vercel/postgres');

    const { rows } = await sql`
      SELECT id, recibido_en, monto, fecha, referencia, origen, payload
      FROM bci_notificaciones
      WHERE recibido_en::date >= ${startDate}::date AND recibido_en::date <= ${endDate}::date
      ORDER BY recibido_en ASC;
    `;

    const transferencias = rows.map(r => ({
      monto: r.monto !== null ? Number(r.monto) : null,
      fecha: r.fecha || (r.recibido_en ? new Date(r.recibido_en).toISOString().slice(0, 10) : null),
      referencia: r.referencia,
      origen: r.origen,
      recibidoEn: r.recibido_en
    }));

    return res.status(200).json({ startDate, endDate, transferencias, totalRegistros: rows.length });
  } catch (err) {
    // Si la tabla todavía no existe (nunca llegó una notificación real todavía)
    if (String(err).includes('does not exist')) {
      return res.status(200).json({ startDate, endDate, transferencias: [], totalRegistros: 0, aviso: 'Todavía no ha llegado ninguna notificación de Bci.' });
    }
    return res.status(200).json({ startDate, endDate, transferencias: [], totalRegistros: 0, error: 'Error consultando notificaciones', detail: String(err) });
  }
}
