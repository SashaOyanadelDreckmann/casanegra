const express = require('express');
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Variables de entorno
const CALENDAR_EMAIL = process.env.CALENDAR_ID || 'casanegra.contacto.cl@gmail.com';
const GMAIL_USER = process.env.GMAIL_USER || 'casanegra.contacto.cl@gmail.com';
const GMAIL_PASSWORD = process.env.GMAIL_PASSWORD || '';

// Validar que las credenciales están configuradas
if (!GMAIL_PASSWORD || GMAIL_PASSWORD.includes('tu_contraseña')) {
  console.warn('GMAIL_PASSWORD no está configurada correctamente');
}

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

    // Enviar email de confirmación al usuario
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
          <li><strong>Suite/Servicio:</strong> ${suite}</li>
          <li><strong>Check-in:</strong> ${checkIn}</li>
          <li><strong>Check-out:</strong> ${checkOut}</li>
          <li><strong>Noches:</strong> ${nights}</li>
          <li><strong>Huéspedes:</strong> ${guests}</li>
          <li><strong>Servicios adicionales:</strong> ${services || 'Ninguno'}</li>
          <li><strong>Total a pagar:</strong> $${total.toLocaleString('es-CL')}</li>
        </ul>
        <hr>
        <p>Te contactaremos pronto para confirmar detalles de pago.</p>
        <p><strong>Casa Negra</strong><br>Premium Guest Room en Ñuñoa, Santiago<br>
        <a href="https://casanegra-production.up.railway.app">casanegra-production.up.railway.app</a></p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Email de confirmación enviado a:', email);

    // Enviar notificación al administrador
    const adminMailOptions = {
      from: GMAIL_USER,
      to: 'casanegra.contacto.cl@gmail.com',
      subject: `Nueva Reserva - ${name} - ${suite}`,
      html: `
        <h2>Nueva Reserva Recibida</h2>
        <p><strong>Huésped:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Teléfono:</strong> ${phone}</p>
        <p><strong>Suite/Servicio:</strong> ${suite}</p>
        <p><strong>Check-in:</strong> ${checkIn}</p>
        <p><strong>Check-out:</strong> ${checkOut}</p>
        <p><strong>Noches:</strong> ${nights}</p>
        <p><strong>Servicios:</strong> ${services || 'Ninguno'}</p>
        <p><strong>Total:</strong> $${total.toLocaleString('es-CL')}</p>
        <p>Hora de reserva: ${new Date().toLocaleString('es-CL')}</p>
      `
    };

    await transporter.sendMail(adminMailOptions);
    console.log('Notificación de reserva enviada al administrador');

    // Responder al cliente
    res.json({
      success: true,
      message: 'Reserva confirmada exitosamente'
    });

  } catch (error) {
    console.error('Error al procesar reserva:', error);
    const errorMsg = error.message || 'Error desconocido';
    res.status(500).json({
      success: false,
      error: 'Error al procesar la reserva',
      details: errorMsg
    });
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
