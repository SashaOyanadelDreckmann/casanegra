const express = require('express');
const path = require('path');
const cors = require('cors');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Variables de entorno
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyA9Q0fTUrQ10rkwNchZsssvAmG1SfacbcY';
const CALENDAR_EMAIL = 'casanegra.contacto.cl@gmail.com';
const GMAIL_USER = process.env.GMAIL_USER || 'casanegra.contacto.cl@gmail.com';
const GMAIL_PASSWORD = process.env.GMAIL_PASSWORD || '';

// Configurar Google Calendar
const calendar = google.calendar({
  version: 'v3',
  auth: GOOGLE_API_KEY
});

// Configurar Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASSWORD
  }
});

// ENDPOINT: Procesar reserva
app.post('/api/reservar', async (req, res) => {
  try {
    const { suite, checkIn, checkOut, nights, guests, services, total, email, phone, name } = req.body;

    // Validar datos
    if (!suite || !checkIn || !checkOut || !email || !name) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Crear evento en Google Calendar
    const event = {
      summary: `Reserva - ${suite}`,
      description: `Huésped: ${name}\nTeléfono: ${phone}\nServicios: ${services || 'Ninguno'}\nTotal: $${total}`,
      start: {
        dateTime: new Date(checkIn).toISOString(),
        timeZone: 'America/Santiago'
      },
      end: {
        dateTime: new Date(checkOut).toISOString(),
        timeZone: 'America/Santiago'
      },
      attendees: [
        { email: CALENDAR_EMAIL },
        { email: email }
      ]
    };

    // Insertar evento en calendario
    const calendarRes = await calendar.events.insert({
      calendarId: CALENDAR_EMAIL,
      resource: event
    });

    // Enviar email de confirmación
    const mailOptions = {
      from: GMAIL_USER,
      to: email,
      subject: `Reserva confirmada - Casa Negra ${suite}`,
      html: `
        <h2>¡Reserva Confirmada!</h2>
        <p>Estimado/a <strong>${name}</strong>,</p>
        <p>Tu reserva en Casa Negra ha sido confirmada exitosamente.</p>
        <hr>
        <h3>Detalles de tu reserva:</h3>
        <ul>
          <li><strong>Suite:</strong> ${suite}</li>
          <li><strong>Check-in:</strong> ${checkIn}</li>
          <li><strong>Check-out:</strong> ${checkOut}</li>
          <li><strong>Noches:</strong> ${nights}</li>
          <li><strong>Huéspedes:</strong> ${guests}</li>
          <li><strong>Servicios adicionales:</strong> ${services || 'Ninguno'}</li>
          <li><strong>Total:</strong> $${total}</li>
        </ul>
        <hr>
        <p>Te contactaremos pronto para confirmar detalles.</p>
        <p><strong>Casa Negra</strong><br>Premium Guest Room en Ñuñoa, Santiago<br>
        <a href="https://casanegra-production.up.railway.app">casanegra-production.up.railway.app</a></p>
      `
    };

    await transporter.sendMail(mailOptions);

    // Responder al cliente
    res.json({
      success: true,
      message: 'Reserva confirmada',
      eventId: calendarRes.data.id
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al procesar la reserva', details: error.message });
  }
});

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Manejar 404
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Casa Negra running on port ${PORT}`);
});
