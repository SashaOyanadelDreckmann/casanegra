const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || 'https://casanegra-production.up.railway.app';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'casanegra.contacto.cl@gmail.com';
const GMAIL_USER = process.env.GMAIL_USER || CONTACT_EMAIL;
const GMAIL_PASSWORD = process.env.GMAIL_PASSWORD || '';
const MAX_REQUESTS_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const RESERVABLES = {
  'Habitacion Montenegro': { name: 'Habitación Montenegro', type: 'suite', basePrice: 65000, minNights: 1 },
  'Habitacion Bohemia': { name: 'Habitación Bohemia', type: 'suite', basePrice: 32000, minNights: 1 },
  'Habitacion Lastarria': { name: 'Habitación Lastarría', type: 'suite', basePrice: 44000, minNights: 1 },
  'Jacuzzi Tropical': { name: 'Jacuzzi Tropical', type: 'service', basePrice: 25000, minNights: 1 }
};

const EXTRA_SERVICES = {
  'Jacuzzi Privado 2h': { name: 'Jacuzzi Privado 2h', price: 20000, maxPerNight: true },
  Desayuno: { name: 'Desayuno', price: 8000, maxPerNight: true },
  'Limpieza y Cambio de Sabanas': { name: 'Limpieza y Cambio de Sábanas', price: 10000, maxPerNight: true },
  Lavanderia: { name: 'Lavandería', price: 10000, maxPerNight: true },
  'Planchado + Lavado de Ropa': { name: 'Planchado + Lavado de Ropa', price: 20000, maxPerNight: true },
  'Experiencia Completa Jacuzzi': { name: 'Experiencia Completa Jacuzzi', price: 43000, maxPerNight: true }
};

const rateLimitStore = new Map();

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('es-CL');
}

function cleanString(value, maxLength = 150) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function applyRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const current = rateLimitStore.get(ip);

  if (!current || current.expiresAt <= now) {
    rateLimitStore.set(ip, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      success: false,
      error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.'
    });
  }

  current.count += 1;
  next();
}

function buildReservationSummary({ item, checkIn, checkOut, nights, guestName, phone, email, selectedServices, total }) {
  const servicesMarkup = selectedServices.length > 0
    ? `<ul>${selectedServices.map((service) => `<li>${escapeHtml(service.name)} x${service.quantity} - $${formatCurrency(service.subtotal)}</li>`).join('')}</ul>`
    : '<p>Ninguno</p>';

  return `
    <h2>Solicitud de reserva recibida</h2>
    <p>Hola <strong>${escapeHtml(guestName)}</strong>,</p>
    <p>Recibimos tu solicitud para <strong>${escapeHtml(item.name)}</strong>. Te contactaremos pronto para confirmar disponibilidad y pago.</p>
    <hr>
    <h3>Resumen</h3>
    <ul>
      <li><strong>Servicio/Habitación:</strong> ${escapeHtml(item.name)}</li>
      <li><strong>Check-in:</strong> ${escapeHtml(checkIn)}</li>
      <li><strong>Check-out:</strong> ${escapeHtml(checkOut)}</li>
      <li><strong>Noches:</strong> ${nights}</li>
      <li><strong>Teléfono:</strong> ${escapeHtml(phone)}</li>
      <li><strong>Email:</strong> ${escapeHtml(email)}</li>
      <li><strong>Total estimado:</strong> $${formatCurrency(total)}</li>
    </ul>
    <h3>Servicios adicionales</h3>
    ${servicesMarkup}
    <hr>
    <p><strong>Casa Negra</strong><br>Premium Guest Room en Ñuñoa, Santiago<br><a href="${escapeHtml(APP_URL)}">${escapeHtml(APP_URL)}</a></p>
  `;
}

function validateReservationPayload(body) {
  const guestName = cleanString(body.name, 120);
  const email = cleanString(body.email, 150).toLowerCase();
  const phone = cleanString(body.phone, 40);
  const suiteKey = normalizeText(body.suite);
  const item = RESERVABLES[suiteKey];
  const checkIn = cleanString(body.checkIn, 10);
  const checkOut = cleanString(body.checkOut, 10);
  const selectedServicesInput = Array.isArray(body.selectedServices) ? body.selectedServices : [];
  const honey = cleanString(body.website, 200);

  if (honey) {
    return { error: 'Solicitud inválida.' };
  }

  if (!guestName || !email || !phone || !item || !checkIn || !checkOut) {
    return { error: 'Datos incompletos o inválidos.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Debes ingresar un email válido.' };
  }

  const checkInDate = parseDateOnly(checkIn);
  const checkOutDate = parseDateOnly(checkOut);
  if (!checkInDate || !checkOutDate) {
    return { error: 'Las fechas ingresadas no son válidas.' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (checkInDate < today) {
    return { error: 'La fecha de entrada no puede estar en el pasado.' };
  }

  const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
  if (!Number.isInteger(nights) || nights < item.minNights || nights > 30) {
    return { error: 'La cantidad de noches no es válida.' };
  }

  const selectedServices = [];
  let servicesTotal = 0;

  for (const service of selectedServicesInput) {
    const serviceKey = normalizeText(service?.name);
    const knownService = EXTRA_SERVICES[serviceKey];
    const quantity = Number.parseInt(service?.quantity, 10);

    if (!knownService || !Number.isInteger(quantity) || quantity < 1) {
      return { error: 'Hay servicios adicionales inválidos en la solicitud.' };
    }

    if (knownService.maxPerNight && quantity > nights) {
      return { error: `El servicio ${knownService.name} supera el máximo permitido para la estadía.` };
    }

    const subtotal = knownService.price * quantity;
    servicesTotal += subtotal;
    selectedServices.push({
      name: knownService.name,
      quantity,
      subtotal
    });
  }

  const baseTotal = item.type === 'service' ? item.basePrice : item.basePrice * nights;
  const total = baseTotal + servicesTotal;

  return {
    reservation: {
      guestName,
      email,
      phone,
      item,
      checkIn,
      checkOut,
      nights,
      selectedServices,
      total
    }
  };
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '25kb' }));
app.use(express.urlencoded({ extended: false, limit: '25kb' }));
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

if (!GMAIL_PASSWORD || GMAIL_PASSWORD.includes('tu_contraseña')) {
  console.warn('GMAIL_PASSWORD no está configurada correctamente');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASSWORD
  }
});

transporter.verify((error) => {
  if (error) {
    console.error('Error de configuración de Gmail:', error.message);
  } else {
    console.log(`Gmail configurado correctamente para ${GMAIL_USER}`);
  }
});

app.post('/api/reservar', applyRateLimit, async (req, res) => {
  try {
    const { reservation, error } = validateReservationPayload(req.body);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    const {
      guestName,
      email,
      phone,
      item,
      checkIn,
      checkOut,
      nights,
      selectedServices,
      total
    } = reservation;

    const servicesText = selectedServices.length > 0
      ? selectedServices.map((service) => `${service.name} (x${service.quantity})`).join(', ')
      : 'Ninguno';

    const customerEmail = {
      from: GMAIL_USER,
      to: email,
      subject: `Solicitud de reserva recibida - Casa Negra ${item.name}`,
      html: buildReservationSummary({
        item,
        checkIn,
        checkOut,
        nights,
        guestName,
        phone,
        email,
        selectedServices,
        total
      })
    };

    const adminEmail = {
      from: GMAIL_USER,
      to: CONTACT_EMAIL,
      subject: `Nueva solicitud - ${guestName} - ${item.name}`,
      html: `
        <h2>Nueva solicitud de reserva</h2>
        <p><strong>Huésped:</strong> ${escapeHtml(guestName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Teléfono:</strong> ${escapeHtml(phone)}</p>
        <p><strong>Servicio/Habitación:</strong> ${escapeHtml(item.name)}</p>
        <p><strong>Check-in:</strong> ${escapeHtml(checkIn)}</p>
        <p><strong>Check-out:</strong> ${escapeHtml(checkOut)}</p>
        <p><strong>Noches:</strong> ${nights}</p>
        <p><strong>Servicios:</strong> ${escapeHtml(servicesText)}</p>
        <p><strong>Total estimado:</strong> $${formatCurrency(total)}</p>
        <p><strong>Hora de solicitud:</strong> ${new Date().toLocaleString('es-CL')}</p>
      `
    };

    await transporter.sendMail(customerEmail);
    await transporter.sendMail(adminEmail);

    return res.json({
      success: true,
      message: 'Solicitud enviada correctamente.',
      reservation: {
        suite: item.name,
        nights,
        total,
        services: selectedServices
      }
    });
  } catch (error) {
    console.error('Error al procesar reserva:', error);
    return res.status(500).json({
      success: false,
      error: 'No pudimos procesar la solicitud en este momento.'
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Casa Negra running on port ${PORT}`);
});
