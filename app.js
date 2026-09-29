// app.js - Sistema de Agendamiento Online Barbería Paco con Calendario Optimizado y Validación Estricta

const BARBER_PHONE = '3496446229';
const BARBER_WHATSAPP = '5493496446229';

const SERVICES = [
  {
    id: 'corte',
    name: 'Corte de Pelo',
    price: 9000,
    duration: 30,
    desc: 'Corte clásico o moderno con lavado incluido.'
  },
  {
    id: 'corte_barba',
    name: 'Corte + Barba',
    price: 14000,
    duration: 45,
    desc: 'Corte completo y arreglo de barba con navaja y toalla caliente.'
  },
  {
    id: 'barba',
    name: 'Arreglo de Barba',
    price: 7500,
    duration: 30,
    desc: 'Perfilado, emparejado y afeitado tradicional.'
  }
];

const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00'
];

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// Helper seguro para renderizar iconos Lucide sin romper la ejecución
function safeRenderIcons() {
  if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
    try {
      lucide.createIcons();
    } catch (e) {
      console.warn('Error al renderizar iconos Lucide:', e);
    }
  }
}

// Helper para fecha en formato YYYY-MM-DD local
function toDateKey(year, month, day) {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function getDateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return `${days[d.getDay()]} ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}`;
}

function formatDateSimple(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const dayName = days[d.getDay()];
  const dd = String(parts[2]).padStart(2, '0');
  const mm = String(parts[1]).padStart(2, '0');
  const yyyy = parts[0];
  return `${dayName} ${dd}/${mm}/${yyyy}`;
}

// Construye el mensaje simple para WhatsApp al pedir turno
function buildAppointmentWhatsAppMessage(app) {
  const s = SERVICES.find(x => x.id === app.serviceId) || SERVICES[0];
  const dateText = formatDateSimple(app.date);

  let msg = `Hola! Quiero confirmar mi turno para ${s.name} el día ${dateText} a las ${app.time}. Mi nombre es ${app.clientName}.`;
  if (app.notes && app.notes.trim()) {
    msg += ` (Aclaración: ${app.notes.trim()})`;
  }
  return msg;
}

// Comprueba si un horario ya pasó en el día de hoy (o si la fecha ya pasó)
function isTimePassed(dateKey, timeStr) {
  const todayKey = getDateKey(0);
  if (dateKey < todayKey) return true; // Fecha pasada
  if (dateKey > todayKey) return false; // Fecha futura

  // Es hoy: comparar hora y minutos actuales
  const now = new Date();
  const [slotH, slotM] = timeStr.split(':').map(Number);
  const currentH = now.getHours();
  const currentM = now.getMinutes();

  return (slotH < currentH) || (slotH === currentH && slotM <= currentM);
}

// ----------------------------------------------------
// SEGURIDAD: escapar texto que escriben los clientes
// ----------------------------------------------------
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ----------------------------------------------------
// CAPA DE DATOS
// - Con Firebase configurado (config.js): turnos compartidos entre todos los dispositivos.
// - Sin configurar: "modo prueba" que guarda todo solo en este navegador.
// ----------------------------------------------------
const CFG = window.BARBERIA_CONFIG || {};
const USE_FIREBASE = !!(CFG.firebase && CFG.firebase.apiKey && CFG.firebase.projectId && window.firebase);
let fbDb = null;
let fbAuth = null;
if (USE_FIREBASE) {
  firebase.initializeApp(CFG.firebase);
  fbDb = firebase.firestore();
  fbAuth = firebase.auth();
}

const LS_APPS = 'barberia_paco_appointments';
const LS_DISABLED = 'barberia_paco_disabled_slots';
const LS_MY_BOOKINGS = 'barberia_paco_my_bookings'; // [{ id, token }]
const DEMO_PASSWORD = 'demo'; // Solo modo prueba (sin Firebase). Nunca protege datos reales.

// Limpieza única de claves viejas (nombre anterior del proyecto y formato anterior)
(function cleanupLegacyStorage() {
  try {
    ['barberia_said_appointments', 'barberia_said_disabled_slots', 'barberia_paco_my_booking_ids', 'barberia_paco_my_phone']
      .forEach(k => localStorage.removeItem(k));
    ['barberia_said_admin_logged', 'barberia_paco_admin_logged']
      .forEach(k => sessionStorage.removeItem(k));
  } catch (e) {}
})();

function lsRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function lsWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ID del documento de un horario: "2026-10-01_1000"
function slotDocId(date, time) {
  return `${date}_${time.replace(':', '')}`;
}

function mapAppointment(snap) {
  const r = snap.data();
  return {
    id: snap.id,
    token: snap.id, // el ID secreto del turno es el código del cliente
    clientName: r.clientName,
    phone: r.phone,
    notes: r.notes || '',
    serviceId: r.serviceId,
    date: r.date,
    time: r.time,
    status: r.status,
    lock: r.lock
  };
}

function disabledSnapToMap(snap) {
  const map = {};
  snap.forEach(d => {
    const r = d.data();
    if (!map[r.date]) map[r.date] = [];
    map[r.date].push(r.time);
  });
  return map;
}

// Turnos propios guardados en este dispositivo (el ID secreto de cada turno)
function getMyBookings() {
  const list = lsRead(LS_MY_BOOKINGS, []);
  return Array.isArray(list) ? list.filter(b => b && b.id && b.token) : [];
}
function addMyBooking(id, token) {
  const list = getMyBookings().filter(b => b.id !== id);
  list.push({ id, token });
  lsWrite(LS_MY_BOOKINGS, list);
}
function removeMyBooking(id) {
  lsWrite(LS_MY_BOOKINGS, getMyBookings().filter(b => b.id !== id));
}

function waitForAuthReady() {
  return new Promise(resolve => {
    const unsubscribe = fbAuth.onAuthStateChanged(user => {
      unsubscribe();
      resolve(user);
    });
  });
}

const Api = {
  // Horarios ocupados y cerrados (sin datos personales) para el calendario del cliente
  async loadPublic() {
    if (!USE_FIREBASE) {
      return { apps: lsRead(LS_APPS, []), disabled: lsRead(LS_DISABLED, {}) };
    }
    const from = getDateKey(-1);
    const [slots, dis] = await Promise.all([
      fbDb.collection('slots').where('date', '>=', from).get(),
      fbDb.collection('disabled').where('date', '>=', from).get()
    ]);
    const apps = [];
    slots.forEach(d => {
      const r = d.data();
      if (r.taken) apps.push({ date: r.date, time: r.time, status: 'confirmed' });
    });
    return { apps, disabled: disabledSnapToMap(dis) };
  },

  // Turnos completos (con nombre y teléfono) — solo el barbero logueado
  async loadAdmin() {
    if (!USE_FIREBASE) {
      return { apps: lsRead(LS_APPS, []), disabled: lsRead(LS_DISABLED, {}) };
    }
    const from = getDateKey(-62);
    const [apps, dis] = await Promise.all([
      fbDb.collection('appointments').where('date', '>=', from).get(),
      fbDb.collection('disabled').where('date', '>=', from).get()
    ]);
    const list = [];
    apps.forEach(d => {
      const a = mapAppointment(d);
      if (a.status === 'confirmed') list.push(a);
    });
    list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return { apps: list, disabled: disabledSnapToMap(dis) };
  },

  async book(b) {
    if (!USE_FIREBASE) {
      const apps = lsRead(LS_APPS, []);
      const disabled = lsRead(LS_DISABLED, {});
      if (apps.some(a => a.date === b.date && a.time === b.time && a.status === 'confirmed') ||
          (disabled[b.date] || []).includes(b.time)) {
        throw new Error('OCUPADO');
      }
      const app = { id: newId(), status: 'confirmed', createdAt: new Date().toISOString(), ...b };
      app.token = app.id;
      apps.push(app);
      lsWrite(LS_APPS, apps);
      return { id: app.id, token: app.token };
    }

    const id = newId();   // código secreto del turno
    const lock = newId(); // candado que une el turno con su horario
    const slotRef = fbDb.collection('slots').doc(slotDocId(b.date, b.time));
    const apptRef = fbDb.collection('appointments').doc(id);

    const batch = fbDb.batch();
    batch.set(slotRef, { date: b.date, time: b.time, taken: true, lock });
    batch.set(apptRef, {
      clientName: b.clientName,
      phone: b.phone,
      notes: b.notes || '',
      serviceId: b.serviceId,
      date: b.date,
      time: b.time,
      status: 'confirmed',
      lock,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    try {
      await batch.commit();
    } catch (e) {
      if (e && e.code === 'permission-denied') {
        // Las reglas rechazan la reserva: ¿el horario ya estaba tomado?
        try {
          const s = await slotRef.get();
          if (s.exists && s.data().taken) throw new Error('OCUPADO');
        } catch (inner) {
          if (inner.message === 'OCUPADO') throw inner;
        }
        throw new Error('INVALIDO');
      }
      throw e;
    }
    return { id, token: id };
  },

  async myAppointments() {
    const mine = getMyBookings();
    if (mine.length === 0) return [];
    if (!USE_FIREBASE) {
      const tokens = mine.map(m => m.token);
      return lsRead(LS_APPS, []).filter(a => a.status === 'confirmed' && tokens.includes(a.token));
    }
    const results = await Promise.allSettled(
      mine.map(m => fbDb.collection('appointments').doc(m.token).get())
    );
    const list = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.exists && r.value.data().status === 'confirmed') {
        list.push(mapAppointment(r.value));
      } else if (r.status === 'rejected' && r.reason && r.reason.code !== 'permission-denied') {
        // Error de conexión: no borramos nada
      } else {
        // Turno cancelado o inexistente: se quita de este dispositivo
        removeMyBooking(mine[i].id);
      }
    });
    return list;
  },

  async cancelMine(app) {
    if (!USE_FIREBASE) {
      lsWrite(LS_APPS, lsRead(LS_APPS, []).filter(a => a.id !== app.id));
      return;
    }
    await fbDb.collection('appointments').doc(app.id).update({ status: 'cancelled' });
    // Liberar el horario para otra persona (usa el código del turno como prueba)
    try {
      await fbDb.collection('slots').doc(slotDocId(app.date, app.time)).update({ taken: false, proof: app.id });
    } catch (e) {
      console.warn('El turno se canceló pero el horario no se pudo liberar:', e);
    }
  },

  async adminCancel(id) {
    if (!USE_FIREBASE) {
      lsWrite(LS_APPS, lsRead(LS_APPS, []).filter(a => a.id !== id));
      return;
    }
    const app = appointments.find(a => a.id === id);
    const batch = fbDb.batch();
    batch.update(fbDb.collection('appointments').doc(id), { status: 'cancelled' });
    if (app) {
      batch.set(fbDb.collection('slots').doc(slotDocId(app.date, app.time)), { taken: false }, { merge: true });
    }
    await batch.commit();
  },

  async setSlotsDisabled(date, times, disable) {
    if (!USE_FIREBASE) {
      const map = lsRead(LS_DISABLED, {});
      const current = new Set(map[date] || []);
      times.forEach(t => (disable ? current.add(t) : current.delete(t)));
      map[date] = Array.from(current);
      lsWrite(LS_DISABLED, map);
      return;
    }
    const batch = fbDb.batch();
    times.forEach(time => {
      const ref = fbDb.collection('disabled').doc(slotDocId(date, time));
      if (disable) batch.set(ref, { date, time });
      else batch.delete(ref);
    });
    await batch.commit();
  },

  // ---- Acceso del barbero ----
  async isBarberLoggedIn() {
    if (!USE_FIREBASE) {
      try { return sessionStorage.getItem('barberia_paco_demo_admin') === '1'; } catch (e) { return false; }
    }
    const user = fbAuth.currentUser || await waitForAuthReady();
    if (!user) return false;
    return Api.checkBarberAccess();
  },

  // Las reglas de Firestore deciden: solo el barbero puede listar turnos
  async checkBarberAccess() {
    try {
      await fbDb.collection('appointments').where('date', '>=', getDateKey(0)).limit(1).get();
      return true;
    } catch (e) {
      return false;
    }
  },

  async login(email, password) {
    if (!USE_FIREBASE) {
      if (password !== DEMO_PASSWORD) throw new Error('bad');
      try { sessionStorage.setItem('barberia_paco_demo_admin', '1'); } catch (e) {}
      return;
    }
    await fbAuth.signInWithEmailAndPassword(email, password);
    if (!(await Api.checkBarberAccess())) {
      await fbAuth.signOut();
      throw new Error('not_barber');
    }
  },

  async logout() {
    if (!USE_FIREBASE) {
      try { sessionStorage.removeItem('barberia_paco_demo_admin'); } catch (e) {}
      return;
    }
    await fbAuth.signOut();
  }
};

// Caché en memoria que usan las pantallas
let appointments = [];
let disabledSlotsByDate = {};
let adminMode = false; // true mientras el panel del barbero está abierto (datos completos)

function rerenderAll() {
  renderVisualCalendar();
  renderSimpleTimesGrid();
  renderAdminCalendar();
  updateAdminAppointments();
  renderAdminScheduleSlots();
}

async function refreshData() {
  try {
    const result = adminMode ? await Api.loadAdmin() : await Api.loadPublic();
    appointments = Array.isArray(result.apps) ? result.apps : [];
    disabledSlotsByDate = result.disabled || {};
  } catch (e) {
    console.error('No se pudieron cargar los turnos:', e);
  }
  rerenderAll();
}

// Actualización automática: cada 30 s y al volver a la pestaña
setInterval(() => { if (document.visibilityState === 'visible') refreshData(); }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshData(); });

// Modo prueba: sincronizar entre pestañas del mismo navegador
window.addEventListener('storage', (e) => {
  if (!USE_FIREBASE && (e.key === LS_APPS || e.key === LS_DISABLED)) refreshData();
});

// ----------------------------------------------------
// ESTADO DE LA RESERVA CLIENTE (PASO A PASO)
// ----------------------------------------------------
let currentStep = 1;
let currentBooking = {
  service: null,
  date: getDateKey(0),
  time: null
};

// Calendario visual para el cliente (inicia en la fecha real de hoy)
const realToday = new Date();
let calendarViewYear = realToday.getFullYear();
let calendarViewMonth = realToday.getMonth();

// ----------------------------------------------------
// NAVEGACIÓN CLIENTE
// ----------------------------------------------------
function showWelcomeScreen() {
  currentStep = 1;
  const welcome = document.getElementById('welcomeScreen');
  const booking = document.getElementById('bookingFlowContainer');
  if (welcome) welcome.classList.remove('hidden');
  if (booking) booking.classList.add('hidden');
  closeAdminModal();
  closeMyAppointmentsModal();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  safeRenderIcons();
}

function startBookingFlow() {
  currentStep = 1;
  const welcome = document.getElementById('welcomeScreen');
  const booking = document.getElementById('bookingFlowContainer');
  if (welcome) welcome.classList.add('hidden');
  if (booking) booking.classList.remove('hidden');
  closeMyAppointmentsModal();
  renderStepView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToStep(stepNumber) {
  currentStep = stepNumber;
  renderStepView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToPreviousStep() {
  if (currentStep <= 1) {
    showWelcomeScreen();
  } else {
    currentStep--;
    renderStepView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderStepView() {
  const stepServices = document.getElementById('stepServicesSection');
  const stepDateTime = document.getElementById('stepDateTimeSection');
  const stepCustomer = document.getElementById('stepCustomerSection');
  const counter = document.getElementById('stepCounterLabel');

  if (counter) counter.textContent = `Paso ${currentStep} de 3`;

  if (stepServices) stepServices.classList.add('hidden');
  if (stepDateTime) stepDateTime.classList.add('hidden');
  if (stepCustomer) stepCustomer.classList.add('hidden');

  if (currentStep === 1) {
    if (stepServices) stepServices.classList.remove('hidden');
    renderServicesList();
  } else if (currentStep === 2) {
    if (stepDateTime) stepDateTime.classList.remove('hidden');
    renderVisualCalendar();
    renderSimpleTimesGrid();
  } else if (currentStep === 3) {
    if (stepCustomer) stepCustomer.classList.remove('hidden');
    renderSummary();
  }

  safeRenderIcons();
}

// ----------------------------------------------------
// PASO 1: SERVICIOS
// ----------------------------------------------------
function renderServicesList() {
  const container = document.getElementById('servicesListSimple');
  if (!container) return;

  container.innerHTML = SERVICES.map(s => {
    const isSelected = currentBooking.service && currentBooking.service.id === s.id;
    return `
      <div onclick="selectServiceAndNext('${s.id}')" class="p-4 sm:p-5 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${isSelected ? 'service-selected' : 'bg-[#0c0e12] border-white/10 hover:border-amber-400/50 hover:bg-[#11141b]'}">
        <div class="pr-2">
          <h3 class="font-extrabold text-base sm:text-lg text-white">${s.name}</h3>
          <p class="text-xs text-slate-400 mt-1">${s.desc}</p>
        </div>
        <div class="text-right whitespace-nowrap pl-4 flex-shrink-0">
          <span class="text-lg sm:text-xl font-extrabold text-amber-400 font-mono block">$${s.price.toLocaleString('es-AR')}</span>
          <span class="text-xs text-slate-400 font-medium">⏱ ${s.duration} min</span>
        </div>
      </div>
    `;
  }).join('');
}

function selectServiceAndNext(serviceId) {
  currentBooking.service = SERVICES.find(s => s.id === serviceId) || SERVICES[0];
  goToStep(2);
}

// ----------------------------------------------------
// PASO 2: CALENDARIO VISUAL CLIENTE
// ----------------------------------------------------
function changeCalendarMonth(delta) {
  calendarViewMonth += delta;
  if (calendarViewMonth < 0) {
    calendarViewMonth = 11;
    calendarViewYear--;
  } else if (calendarViewMonth > 11) {
    calendarViewMonth = 0;
    calendarViewYear++;
  }
  renderVisualCalendar();
}

function renderVisualCalendar() {
  const title = document.getElementById('calMonthTitle');
  const grid = document.getElementById('calDaysGrid');
  const prevBtn = document.getElementById('calPrevBtn');

  if (!title || !grid) return;

  title.textContent = `${MONTH_NAMES[calendarViewMonth]} ${calendarViewYear}`;

  const isCurrentRealMonth = (calendarViewYear === realToday.getFullYear() && calendarViewMonth === realToday.getMonth());
  if (prevBtn) {
    prevBtn.disabled = isCurrentRealMonth;
  }

  const daysInMonth = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
  const firstDayIndex = new Date(calendarViewYear, calendarViewMonth, 1).getDay();

  let html = '';

  for (let i = 0; i < firstDayIndex; i++) {
    html += `<div></div>`;
  }

  const todayNum = realToday.getFullYear() * 10000 + (realToday.getMonth() + 1) * 100 + realToday.getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(calendarViewYear, calendarViewMonth, day);
    const dayOfWeek = dayDate.getDay();
    const thisDayNum = calendarViewYear * 10000 + (calendarViewMonth + 1) * 100 + day;
    const dateKey = toDateKey(calendarViewYear, calendarViewMonth, day);

    const isPast = thisDayNum < todayNum;
    const isSunday = dayOfWeek === 0;
    const isSelected = currentBooking.date === dateKey;

    // Días pasados o Domingos (En otro color apagado, no clickeable)
    if (isPast || isSunday) {
      html += `
        <div class="h-8 sm:h-9 flex items-center justify-center text-stone-600 text-xs sm:text-sm font-medium cursor-not-allowed select-none">
          <span>${day}</span>
        </div>
      `;
    } else if (isSelected) {
      // Día Seleccionado con Borde Dorado
      html += `
        <button onclick="selectCalendarDate('${dateKey}')" class="h-8 sm:h-9 w-full rounded-xl border-2 border-amber-400 bg-[#1c1b22] text-white flex items-center justify-center text-xs sm:text-sm font-extrabold shadow-md shadow-amber-400/20 transition">
          <span>${day}</span>
        </button>
      `;
    } else {
      // Día disponible futuro
      html += `
        <button onclick="selectCalendarDate('${dateKey}')" class="h-8 sm:h-9 w-full rounded-xl bg-[#17161b] hover:bg-[#23222a] border border-stone-800/80 text-white flex items-center justify-center text-xs sm:text-sm font-bold transition hover:scale-105 active:scale-95">
          <span>${day}</span>
        </button>
      `;
    }
  }

  grid.innerHTML = html;
  safeRenderIcons();
}

function selectCalendarDate(dateKey) {
  currentBooking.date = dateKey;
  currentBooking.time = null;
  renderVisualCalendar();
  renderSimpleTimesGrid();

  // Desplazamiento suave hacia los horarios
  setTimeout(() => {
    const slotsSection = document.getElementById('slotsForSelectedDayContainer');
    if (slotsSection) {
      slotsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 60);
}

function renderSimpleTimesGrid() {
  const container = document.getElementById('timesGridSimple');
  const title = document.getElementById('selectedDaySlotsTitle');
  if (!container) return;

  if (title) {
    title.innerHTML = `Horarios para el <strong class="text-slate-900 font-extrabold">${formatDateDisplay(currentBooking.date)}</strong>:`;
  }

  const occupiedSlots = appointments
    .filter(a => a.date === currentBooking.date && a.status === 'confirmed')
    .map(a => a.time);

  const disabledForDate = disabledSlotsByDate[currentBooking.date] || [];

  const morningSlots = TIME_SLOTS.filter(t => parseInt(t.split(':')[0], 10) < 14);
  const afternoonSlots = TIME_SLOTS.filter(t => parseInt(t.split(':')[0], 10) >= 14);

  function renderSingleSlot(time) {
    const isOccupied = occupiedSlots.includes(time);
    const isDisabled = disabledForDate.includes(time);
    const hasPassed = isTimePassed(currentBooking.date, time);
    const isSelected = currentBooking.time === time;

    // 1. Horario que ya pasó en el día de hoy
    if (hasPassed) {
      return `
        <div class="p-2.5 rounded-xl border border-white/5 bg-white/5 text-center opacity-40 cursor-not-allowed select-none">
          <span class="block font-mono text-xs line-through text-slate-500 font-medium">${time} hs</span>
          <span class="text-[9px] text-slate-500 block mt-0.5">🕒 Pasó</span>
        </div>
      `;
    }

    // 2. Horario ocupado por otro cliente
    if (isOccupied) {
      return `
        <div class="p-2.5 rounded-xl border border-red-900/40 bg-red-950/30 text-center opacity-80 cursor-not-allowed select-none">
          <span class="block font-mono text-xs line-through font-bold text-red-300">${time} hs</span>
          <span class="text-[10px] font-bold text-red-400 uppercase tracking-wide block mt-0.5">🔴 Ocupado</span>
        </div>
      `;
    }

    // 3. Horario deshabilitado por el barbero
    if (isDisabled) {
      return `
        <div class="p-2.5 rounded-xl border border-white/5 bg-white/5 text-center opacity-50 cursor-not-allowed select-none">
          <span class="block font-mono text-xs line-through text-slate-500 font-semibold">${time} hs</span>
          <span class="text-[10px] font-semibold text-slate-500 block mt-0.5">⛔ No atiende</span>
        </div>
      `;
    }

    // 4. Horario libre
    return `
      <button onclick="selectTimeAndNext('${time}')" class="p-2.5 rounded-xl border-2 text-center transition-all cursor-pointer ${isSelected ? 'slot-selected' : 'bg-[#0c0e12] border-white/10 hover:border-amber-400 text-white hover:bg-[#141720]'}">
        <span class="block font-mono font-extrabold text-xs sm:text-sm text-white">${time} hs</span>
        <span class="text-[10px] text-emerald-400 block font-bold mt-0.5">✓ Libre</span>
      </button>
    `;
  }

  // Contar turnos libres para badges informativos
  const morningFreeCount = morningSlots.filter(t => !occupiedSlots.includes(t) && !disabledForDate.includes(t) && !isTimePassed(currentBooking.date, t)).length;
  const afternoonFreeCount = afternoonSlots.filter(t => !occupiedSlots.includes(t) && !disabledForDate.includes(t) && !isTimePassed(currentBooking.date, t)).length;

  container.innerHTML = `
    <!-- BLOQUE TURNO MAÑANA -->
    <div class="p-3.5 bg-[#0c0e12] rounded-2xl border border-white/10 space-y-2.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 text-white font-bold text-xs sm:text-sm">
          <span class="text-base">☀️</span>
          <span>Turno Mañana</span>
          <span class="text-[11px] text-slate-400 font-normal">(09:00 a 12:30 hs)</span>
        </div>
        <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full ${morningFreeCount > 0 ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40' : 'bg-white/5 text-slate-500'}">
          ${morningFreeCount > 0 ? `${morningFreeCount} disponibles` : 'Sin cupos'}
        </span>
      </div>
      <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
        ${morningSlots.map(renderSingleSlot).join('')}
      </div>
    </div>

    <!-- BLOQUE TURNO TARDE -->
    <div class="p-3.5 bg-[#0c0e12] rounded-2xl border border-white/10 space-y-2.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 text-white font-bold text-xs sm:text-sm">
          <span class="text-base">🌙</span>
          <span>Turno Tarde</span>
          <span class="text-[11px] text-slate-400 font-normal">(16:30 a 20:00 hs)</span>
        </div>
        <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full ${afternoonFreeCount > 0 ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40' : 'bg-white/5 text-slate-500'}">
          ${afternoonFreeCount > 0 ? `${afternoonFreeCount} disponibles` : 'Sin cupos'}
        </span>
      </div>
      <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
        ${afternoonSlots.map(renderSingleSlot).join('')}
      </div>
    </div>
  `;
}

function selectTimeAndNext(time) {
  currentBooking.time = time;
  goToStep(3);
}

// ----------------------------------------------------
// PASO 3: RESUMEN Y CONFIRMACIÓN
// ----------------------------------------------------
function renderSummary() {
  const summary = document.getElementById('simpleBookingSummary');
  if (!summary) return;

  const s = currentBooking.service || SERVICES[0];
  const dateStr = formatDateDisplay(currentBooking.date);

  summary.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <p class="font-bold text-white text-sm">
          ✂️ ${s.name} — <strong class="font-mono text-amber-400">$${s.price.toLocaleString('es-AR')}</strong>
        </p>
        <p class="text-slate-400 text-xs mt-0.5">
          📅 ${dateStr} a las <strong class="text-white font-mono">${currentBooking.time || '--:--'} hs</strong>
        </p>
      </div>
      <button onclick="goToStep(2)" class="text-xs text-amber-400 hover:text-amber-300 underline font-semibold transition">Cambiar</button>
    </div>
  `;
}

async function confirmSimpleBooking() {
  const nameInput = document.getElementById('simpleClientName');
  const phoneInput = document.getElementById('simpleClientPhone');
  const notesInput = document.getElementById('simpleClientNotes');

  const name = nameInput ? nameInput.value.trim() : '';
  const rawPhone = phoneInput ? phoneInput.value.trim() : '';
  const phone = rawPhone.replace(/[^0-9]/g, ''); // Solo dígitos
  const notes = notesInput ? notesInput.value.trim() : '';

  if (!name) {
    alert('Por favor, escribí tu Nombre y Apellido.');
    if (nameInput) nameInput.focus();
    return;
  }

  // Validación estricta: sólo números y mínimo 6 dígitos
  if (!phone || phone.length < 6) {
    alert('Por favor escribí tu número de teléfono (solo números, mínimo 6 dígitos).');
    if (phoneInput) {
      phoneInput.value = phone;
      phoneInput.focus();
    }
    return;
  }

  if (!currentBooking.service) {
    currentBooking.service = SERVICES[0];
  }

  if (!currentBooking.date) {
    currentBooking.date = getDateKey(0);
  }

  if (!currentBooking.time) {
    alert('Por favor, seleccioná un horario en el paso anterior.');
    goToStep(2);
    return;
  }

  if (isTimePassed(currentBooking.date, currentBooking.time)) {
    alert('Ese horario ya pasó. Por favor elegí un horario posterior.');
    goToStep(2);
    return;
  }

  if (name.length > 80) {
    alert('El nombre es demasiado largo (máximo 80 caracteres).');
    if (nameInput) nameInput.focus();
    return;
  }
  if (phone.length > 15) {
    alert('El teléfono tiene demasiados dígitos.');
    if (phoneInput) phoneInput.focus();
    return;
  }

  const newApp = {
    clientName: name,
    phone: phone, // Garantizado solo números
    notes: notes.slice(0, 300), // Aclaraciones opcionales del cliente
    serviceId: currentBooking.service.id,
    date: currentBooking.date,
    time: currentBooking.time
  };

  if (bookingInProgress) return;
  bookingInProgress = true;
  setConfirmButtonLoading(true);

  try {
    // La base de datos vuelve a comprobar que el horario esté libre (evita turnos dobles)
    const { id, token } = await Api.book(newApp);
    newApp.id = id;
    newApp.token = token;
    newApp.status = 'confirmed';

    // Guardar en el dispositivo del cliente para la sección Mis Turnos
    addMyBooking(id, token);

    showSimpleSuccess(newApp);
    refreshData();
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (msg.includes('OCUPADO')) {
      alert('Ese horario acaba de ser ocupado. Por favor elegí otro horario.');
      await refreshData();
      goToStep(2);
    } else if (msg.includes('LIMITE')) {
      alert('Ya tenés varios turnos reservados con ese teléfono. Si necesitás otro, escribile a Paco por WhatsApp.');
    } else if (msg.includes('INVALIDO')) {
      alert('Ese día u horario no está disponible. Por favor elegí otro.');
      await refreshData();
      goToStep(2);
    } else {
      console.error('Error al reservar:', e);
      alert('No se pudo guardar el turno. Revisá tu conexión e intentá de nuevo.');
    }
  } finally {
    bookingInProgress = false;
    setConfirmButtonLoading(false);
  }
}

let bookingInProgress = false;

function setConfirmButtonLoading(loading) {
  const btn = document.getElementById('confirmBookingBtn');
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('opacity-60', loading);
  btn.classList.toggle('cursor-wait', loading);
}

function showSimpleSuccess(app) {
  const modal = document.getElementById('successModalSimple');
  const details = document.getElementById('successDetailsCard');
  if (!modal || !details) return;

  const s = SERVICES.find(x => x.id === app.serviceId) || SERVICES[0];
  const msg = buildAppointmentWhatsAppMessage(app);
  const waUrl = `https://wa.me/${BARBER_WHATSAPP}?text=${encodeURIComponent(msg)}`;

  details.innerHTML = `
    <div class="flex justify-between border-b border-white/10 pb-1.5">
      <span class="text-slate-400">Cliente:</span>
      <strong class="text-white font-bold">${escapeHtml(app.clientName)}</strong>
    </div>
    <div class="flex justify-between border-b border-white/10 pb-1.5">
      <span class="text-slate-400">Teléfono:</span>
      <strong class="text-white font-mono">${escapeHtml(app.phone)}</strong>
    </div>
    <div class="flex justify-between border-b border-white/10 pb-1.5">
      <span class="text-slate-400">Servicio:</span>
      <strong class="text-white">${s.name} ($${s.price.toLocaleString('es-AR')})</strong>
    </div>
    <div class="flex justify-between border-b border-white/10 pb-1.5">
      <span class="text-slate-400">Día y Hora:</span>
      <strong class="text-amber-400 font-bold">${formatDateDisplay(app.date)} — ${app.time} hs</strong>
    </div>
    ${app.notes ? `
    <div class="flex justify-between border-b border-white/10 pb-1.5">
      <span class="text-slate-400">Aclaración:</span>
      <span class="text-slate-300 font-medium italic text-right max-w-[200px]">"${escapeHtml(app.notes)}"</span>
    </div>
    ` : ''}
    <div class="flex justify-between pt-1 text-slate-400">
      <span>Lugar:</span>
      <span class="font-medium text-slate-200">Belgrano 1450, Esperanza</span>
    </div>
    <div class="mt-3 pt-3 border-t border-white/10">
      <a href="${waUrl}" class="w-full flex items-center justify-center gap-2 py-3.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl text-sm transition shadow-md shadow-emerald-950/50">
        <i data-lucide="message-circle" class="w-5 h-5"></i>
        <span>Abrir WhatsApp de nuevo</span>
      </a>
      <p class="text-[11px] text-slate-500 text-center mt-1">Si no se abrió solo, tocá este botón.</p>
    </div>
  `;

  modal.classList.remove('hidden');
  safeRenderIcons();

  // Llevar directo a WhatsApp con el mensaje armado para Paco
  setTimeout(() => { window.location.href = waUrl; }, 400);
}

function viewBookedDateInCalendar() {
  const modal = document.getElementById('successModalSimple');
  if (modal) modal.classList.add('hidden');

  const nameInput = document.getElementById('simpleClientName');
  const phoneInput = document.getElementById('simpleClientPhone');
  const notesInput = document.getElementById('simpleClientNotes');
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (notesInput) notesInput.value = '';

  currentBooking.time = null;
  goToStep(2);

  setTimeout(() => {
    const slots = document.getElementById('slotsForSelectedDayContainer');
    if (slots) slots.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function closeSuccessModal() {
  const modal = document.getElementById('successModalSimple');
  if (modal) modal.classList.add('hidden');
  
  const nameInput = document.getElementById('simpleClientName');
  const phoneInput = document.getElementById('simpleClientPhone');
  const notesInput = document.getElementById('simpleClientNotes');
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (notesInput) notesInput.value = '';
  
  currentBooking.time = null;
  showWelcomeScreen();
}

function closeSuccessModalAndOpenMyTurnos() {
  const modal = document.getElementById('successModalSimple');
  if (modal) modal.classList.add('hidden');
  
  const nameInput = document.getElementById('simpleClientName');
  const phoneInput = document.getElementById('simpleClientPhone');
  const notesInput = document.getElementById('simpleClientNotes');
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (notesInput) notesInput.value = '';
  
  currentBooking.time = null;
  currentStep = 1;
  const welcome = document.getElementById('welcomeScreen');
  const booking = document.getElementById('bookingFlowContainer');
  if (welcome) welcome.classList.remove('hidden');
  if (booking) booking.classList.add('hidden');
  closeAdminModal();
  
  // Abrir inmediatamente la sección Mis Turnos
  openMyAppointmentsModal();
}

// ----------------------------------------------------
// SECCIÓN MIS TURNOS (CLIENTE)
// ----------------------------------------------------
function openMyAppointmentsModal() {
  const modal = document.getElementById('myAppointmentsModal');
  if (!modal) return;

  renderMyAppointmentsList();
  modal.classList.remove('hidden');
  safeRenderIcons();
}

function closeMyAppointmentsModal() {
  const modal = document.getElementById('myAppointmentsModal');
  if (modal) modal.classList.add('hidden');
}

let myAppointmentsCache = [];

async function renderMyAppointmentsList() {
  const listContainer = document.getElementById('myAppointmentsList');
  if (!listContainer) return;

  listContainer.innerHTML = `<div class="py-10 text-center text-xs text-slate-400">Cargando tus turnos...</div>`;

  let matched = [];
  try {
    matched = await Api.myAppointments();
  } catch (e) {
    console.error('Error cargando mis turnos:', e);
    listContainer.innerHTML = `<div class="py-10 text-center text-xs text-red-300">No se pudieron cargar tus turnos. Revisá tu conexión.</div>`;
    return;
  }
  myAppointmentsCache = matched;

  if (matched.length === 0) {
    listContainer.innerHTML = `
      <div class="py-10 px-4 text-center bg-[#0c0e12] rounded-2xl border border-dashed border-white/15 space-y-3">
        <div class="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
          <i data-lucide="calendar-x" class="w-6 h-6"></i>
        </div>
        <div>
          <h4 class="font-bold text-white text-sm sm:text-base">No tenés turnos agendados</h4>
          <p class="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
            No encontramos turnos activos guardados en este dispositivo.
          </p>
        </div>
        <button type="button" onclick="closeMyAppointmentsModal(); startBookingFlow();" class="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:brightness-110 text-slate-950 font-extrabold text-xs rounded-xl transition shadow-md shadow-amber-500/20">
          <i data-lucide="calendar-plus" class="w-3.5 h-3.5 stroke-[2.5]"></i>
          <span>Pedir Turno Ahora</span>
        </button>
      </div>
    `;
    safeRenderIcons();
    return;
  }

  // Separar en Próximos (activos) y Pasados
  const upcoming = [];
  const past = [];

  matched.forEach(app => {
    if (isTimePassed(app.date, app.time)) {
      past.push(app);
    } else {
      upcoming.push(app);
    }
  });

  // Ordenar próximos por fecha y hora ascendente
  upcoming.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  // Ordenar pasados por fecha descendente
  past.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  let html = '';

  if (upcoming.length > 0) {
    html += `
      <div class="space-y-3">
        <div class="flex items-center justify-between pb-1">
          <span class="text-xs font-extrabold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Próximos Turnos (${upcoming.length})
          </span>
        </div>
    `;

    upcoming.forEach(app => {
      const s = SERVICES.find(x => x.id === app.serviceId) || SERVICES[0];
      const dateStr = formatDateDisplay(app.date);

      html += `
        <div class="p-4 rounded-2xl border border-amber-500/30 bg-[#0c0e12] shadow-md space-y-3 transition">
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="inline-block px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 text-xs font-mono font-extrabold shadow-sm">
                ${app.time} hs
              </span>
              <h4 class="font-bold text-white text-sm mt-1.5">${dateStr}</h4>
            </div>
            <span class="text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded-full flex items-center gap-1">
              ✓ Confirmado
            </span>
          </div>

          <div class="bg-[#15181e] p-3 rounded-xl border border-white/10 text-xs text-slate-300 space-y-1.5">
            <div class="flex justify-between">
              <span class="text-slate-400">Servicio:</span>
              <strong class="text-white font-bold">${s.name} ($${s.price.toLocaleString('es-AR')})</strong>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">A nombre de:</span>
              <strong class="text-white">${escapeHtml(app.clientName)}</strong>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Lugar:</span>
              <span class="text-slate-200 font-medium">Belgrano 1450, Esperanza</span>
            </div>
            ${app.notes ? `
            <div class="flex justify-between border-t border-white/10 pt-1.5 mt-1">
              <span class="text-slate-400 flex-shrink-0">Aclaración:</span>
              <span class="text-amber-300 font-medium italic text-right pl-2">"${escapeHtml(app.notes)}"</span>
            </div>
            ` : ''}
          </div>

          <div class="flex items-center justify-between gap-2 pt-0.5">
            <button type="button" onclick="clientPromptCancelAppointment('${app.id}')" class="px-3 py-1.5 bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/40 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs">
              <i data-lucide="x" class="w-3.5 h-3.5"></i>
              <span>Cancelar turno</span>
            </button>

            <a href="https://wa.me/${BARBER_WHATSAPP}?text=${encodeURIComponent('Hola Paco, te consulto por mi turno de ' + s.name + ' para el ' + dateStr + ' a las ' + app.time + ' hs' + (app.notes ? ' (Aclaración: ' + app.notes + ')' : ''))}" target="_blank" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs">
              <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
              <span>Avisar por WhatsApp</span>
            </a>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  if (past.length > 0) {
    html += `
      <div class="pt-3 space-y-2">
        <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
          Historial / Turnos Anteriores (${past.length})
        </span>
    `;

    past.forEach(app => {
      const s = SERVICES.find(x => x.id === app.serviceId) || SERVICES[0];
      const dateStr = formatDateDisplay(app.date);

      html += `
        <div class="p-3 rounded-xl border border-white/5 bg-[#0c0e12] text-slate-400 text-xs flex items-center justify-between gap-2 opacity-70">
          <div class="flex items-center gap-2">
            <span class="font-mono text-slate-300 font-semibold">${app.time} hs</span>
            <div>
              <span class="font-bold text-white block">${dateStr}</span>
              <span class="text-[11px] text-slate-400">${s.name} • ${escapeHtml(app.clientName)}</span>
              ${app.notes ? `<span class="text-[10px] text-slate-500 italic block mt-0.5">"${escapeHtml(app.notes)}"</span>` : ''}
            </div>
          </div>
          <span class="text-[10px] text-slate-400 font-medium bg-white/5 px-2 py-0.5 rounded border border-white/5">
            Finalizado
          </span>
        </div>
      `;
    });

    html += `</div>`;
  }

  listContainer.innerHTML = html;
  safeRenderIcons();
}

async function clientPromptCancelAppointment(appId) {
  const app = myAppointmentsCache.find(a => a.id === appId);
  if (!app) return;

  const s = SERVICES.find(x => x.id === app.serviceId) || SERVICES[0];
  const dateStr = formatDateDisplay(app.date);

  const confirmMsg = `¿Estás seguro de que querés cancelar tu turno de ${s.name} para el ${dateStr} a las ${app.time} hs?\n\nAl cancelarlo, el horario quedará libre para otra persona y se abrirá WhatsApp para avisarle a Paco.`;
  if (!confirm(confirmMsg)) {
    return;
  }

  try {
    await Api.cancelMine(app);
    removeMyBooking(app.id);
  } catch (e) {
    console.error('Error cancelando turno:', e);
    alert('No se pudo cancelar el turno. Intentá de nuevo o avisale a Paco por WhatsApp.');
    await refreshData();
    renderMyAppointmentsList();
    return;
  }

  refreshData();
  renderMyAppointmentsList();

  // Avisar a Paco por WhatsApp (obligatorio): se abre directo con el mensaje armado
  const msg = `Hola Paco! Cancelo mi turno de ${s.name} del día ${formatDateSimple(app.date)} a las ${app.time}. Mi nombre es ${app.clientName}.`;
  window.location.href = `https://wa.me/${BARBER_WHATSAPP}?text=${encodeURIComponent(msg)}`;
}

// ----------------------------------------------------
// ACCESO ADMIN BARBERO
// ----------------------------------------------------
async function handleAdminClick() {
  if (await Api.isBarberLoggedIn()) {
    openAdminModal();
  } else {
    openAdminLoginModal();
  }
}

function openAdminLoginModal() {
  const modal = document.getElementById('adminLoginModal');
  const input = document.getElementById('adminPasswordInput');
  const error = document.getElementById('adminLoginError');
  const demoHint = document.getElementById('adminDemoHint');
  if (!modal) return;

  if (demoHint) demoHint.classList.toggle('hidden', USE_FIREBASE);

  if (error) error.classList.add('hidden');
  if (input) input.value = '';
  modal.classList.remove('hidden');
  if (input) input.focus();
}

function closeAdminLoginModal() {
  const modal = document.getElementById('adminLoginModal');
  if (modal) modal.classList.add('hidden');
}

async function verifyAdminLogin(e) {
  e.preventDefault();
  const input = document.getElementById('adminPasswordInput');
  const error = document.getElementById('adminLoginError');
  const btn = document.getElementById('adminLoginSubmitBtn');
  const password = input ? input.value : '';

  if (btn) btn.disabled = true;
  try {
    // Solo contraseña: el email del barbero viene de config.js
    await Api.login(CFG.barberEmail || '', password);
    closeAdminLoginModal();
    openAdminModal();
  } catch (err) {
    if (error) {
      error.textContent = (err && err.code === 'auth/too-many-requests')
        ? 'Demasiados intentos. Esperá unos minutos y probá de nuevo.'
        : 'Contraseña incorrecta. Intentá de nuevo.';
      error.classList.remove('hidden');
    }
    if (input) {
      input.value = '';
      input.focus();
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function logoutAdmin() {
  await Api.logout();
  closeAdminModal();
}

// // ----------------------------------------------------
// PANEL ADMIN: CALENDARIO DESPLEGABLE + CORTES Y HORARIOS
// ----------------------------------------------------
let adminSelectedDate = getDateKey(0); // Abre directo en el DÍA DE HOY
let adminCurrentTab = 'cortes';
let isAdminCalOpen = false;

// Navegación de calendario en el panel admin (inicia en el mes actual)
let adminCalYear = realToday.getFullYear();
let adminCalMonth = realToday.getMonth();

function openAdminModal() {
  const modal = document.getElementById('adminModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  
  // Siempre entra en la fecha de HOY
  adminSelectedDate = getDateKey(0);
  adminCalYear = realToday.getFullYear();
  adminCalMonth = realToday.getMonth();

  // Calendario cerrado por defecto para otorgar MÁXIMO espacio a los turnos
  isAdminCalOpen = false;
  const wrapper = document.getElementById('adminCalendarWrapper');
  const btnText = document.getElementById('toggleAdminCalBtnText');
  if (wrapper) wrapper.classList.add('hidden');
  if (btnText) btnText.textContent = 'Ver Calendario';

  adminMode = true;
  renderAdminCalendar();
  updateAdminAppointments();
  renderAdminScheduleSlots();
  refreshData();
}

function closeAdminModal() {
  const modal = document.getElementById('adminModal');
  if (!modal) return;
  const wasOpen = !modal.classList.contains('hidden');
  modal.classList.add('hidden');
  if (adminMode) {
    // Al salir del panel se descartan los datos personales de la memoria
    adminMode = false;
    appointments = [];
    if (wasOpen) refreshData();
  }
}

function toggleAdminCalendar() {
  const wrapper = document.getElementById('adminCalendarWrapper');
  const btnText = document.getElementById('toggleAdminCalBtnText');
  if (!wrapper) return;

  isAdminCalOpen = !isAdminCalOpen;
  if (isAdminCalOpen) {
    wrapper.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Ocultar Calendario';
  } else {
    wrapper.classList.add('hidden');
    if (btnText) btnText.textContent = 'Ver Calendario';
  }
}

function changeAdminDayOffset(offset) {
  const parts = adminSelectedDate.split('-');
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setDate(d.getDate() + offset);

  adminSelectedDate = toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
  adminCalYear = d.getFullYear();
  adminCalMonth = d.getMonth();

  renderAdminCalendar();
  updateAdminAppointments();
  renderAdminScheduleSlots();
}

function adminGoToToday() {
  adminSelectedDate = getDateKey(0);
  adminCalYear = realToday.getFullYear();
  adminCalMonth = realToday.getMonth();
  renderAdminCalendar();
  updateAdminAppointments();
  renderAdminScheduleSlots();
}

function changeAdminCalendarMonth(delta) {
  adminCalMonth += delta;
  if (adminCalMonth < 0) {
    adminCalMonth = 11;
    adminCalYear--;
  } else if (adminCalMonth > 11) {
    adminCalMonth = 0;
    adminCalYear++;
  }
  renderAdminCalendar();
}

// Renderiza el calendario compacto dentro del panel del barbero
function renderAdminCalendar() {
  const title = document.getElementById('adminCalMonthTitle');
  const grid = document.getElementById('adminCalDaysGrid');
  if (!title || !grid) return;

  title.textContent = `${MONTH_NAMES[adminCalMonth]} ${adminCalYear}`;

  const daysInMonth = new Date(adminCalYear, adminCalMonth + 1, 0).getDate();
  const firstDayIndex = new Date(adminCalYear, adminCalMonth, 1).getDay();

  let html = '';

  for (let i = 0; i < firstDayIndex; i++) {
    html += `<div></div>`;
  }

  const todayNum = realToday.getFullYear() * 10000 + (realToday.getMonth() + 1) * 100 + realToday.getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const thisDayNum = adminCalYear * 10000 + (adminCalMonth + 1) * 100 + day;
    const dateKey = toDateKey(adminCalYear, adminCalMonth, day);
    const isSelected = adminSelectedDate === dateKey;
    const isPast = thisDayNum < todayNum;
    const isToday = thisDayNum === todayNum;

    // 1. Día Seleccionado (Borde Dorado)
    if (isSelected) {
      html += `
        <button onclick="selectAdminCalendarDate('${dateKey}')" class="h-7 sm:h-8 w-full rounded-lg border-2 border-amber-400 bg-[#24222b] text-white flex items-center justify-center text-xs font-extrabold shadow-sm transition">
          <span>${day}</span>
        </button>
      `;
    }
    // 2. Días pasados (En otro color apagado: gris traslúcido)
    else if (isPast) {
      html += `
        <button onclick="selectAdminCalendarDate('${dateKey}')" class="h-7 sm:h-8 w-full rounded-lg bg-stone-900/40 hover:bg-stone-800/60 border border-stone-800/40 text-stone-500 flex items-center justify-center text-[11px] font-normal transition">
          <span>${day}</span>
        </button>
      `;
    }
    // 3. Hoy (Borde ámbar sutil si no está seleccionado)
    else if (isToday) {
      html += `
        <button onclick="selectAdminCalendarDate('${dateKey}')" class="h-7 sm:h-8 w-full rounded-lg bg-stone-900 hover:bg-stone-800 border border-amber-500/50 text-amber-300 flex items-center justify-center text-xs font-bold transition">
          <span>${day}</span>
        </button>
      `;
    }
    // 4. Días futuros normales
    else {
      html += `
        <button onclick="selectAdminCalendarDate('${dateKey}')" class="h-7 sm:h-8 w-full rounded-lg bg-[#18171d] hover:bg-[#25242b] border border-stone-800/80 text-stone-200 flex items-center justify-center text-xs font-bold transition hover:scale-105 active:scale-95">
          <span>${day}</span>
        </button>
      `;
    }
  }

  grid.innerHTML = html;
  safeRenderIcons();
}

function selectAdminCalendarDate(dateKey) {
  adminSelectedDate = dateKey;
  renderAdminCalendar();
  updateAdminAppointments();
  renderAdminScheduleSlots();

  setTimeout(() => {
    const scrollContainer = document.getElementById('adminScrollContent');
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  }, 50);
}

function adminSwitchTab(tab) {
  adminCurrentTab = tab;
  const tabBtnCortes = document.getElementById('tabBtnCortes');
  const tabBtnHorarios = document.getElementById('tabBtnHorarios');
  const contentCortes = document.getElementById('adminTabContentCortes');
  const contentHorarios = document.getElementById('adminTabContentHorarios');

  if (tab === 'cortes') {
    tabBtnCortes.className = 'flex-1 py-3 border-b-2 border-amber-400 text-amber-400 flex items-center justify-center gap-2 transition';
    tabBtnHorarios.className = 'flex-1 py-3 border-b-2 border-transparent text-slate-400 hover:text-white flex items-center justify-center gap-2 transition';
    contentCortes.classList.remove('hidden');
    contentHorarios.classList.add('hidden');
    updateAdminAppointments();
  } else {
    tabBtnCortes.className = 'flex-1 py-3 border-b-2 border-transparent text-slate-400 hover:text-white flex items-center justify-center gap-2 transition';
    tabBtnHorarios.className = 'flex-1 py-3 border-b-2 border-amber-400 text-amber-400 flex items-center justify-center gap-2 transition';
    contentCortes.classList.add('hidden');
    contentHorarios.classList.remove('hidden');
    renderAdminScheduleSlots();
  }
}

function updateAdminAppointments() {
  const container = document.getElementById('adminAppointmentsContainer');
  const label = document.getElementById('adminCurrentDayLabel');
  const countSpan = document.getElementById('adminTotalTurnosCount');
  const badgeCortes = document.getElementById('tabBadgeCortes');

  if (!container) return;

  const isToday = (adminSelectedDate === getDateKey(0));
  if (label) {
    label.textContent = `${formatDateDisplay(adminSelectedDate)}${isToday ? ' (Hoy)' : ''}`;
  }

  const dayApps = appointments
    .filter(a => a.date === adminSelectedDate && a.status === 'confirmed')
    .sort((a, b) => a.time.localeCompare(b.time));

  if (countSpan) countSpan.textContent = dayApps.length;
  if (badgeCortes) badgeCortes.textContent = dayApps.length;

  if (dayApps.length === 0) {
    container.innerHTML = `
      <div class="py-16 text-center text-slate-400 text-sm bg-[#15181e] rounded-2xl border border-dashed border-white/10 p-8 shadow-xs">
        <i data-lucide="calendar-x" class="w-10 h-10 mx-auto mb-3 text-slate-500"></i>
        <p class="font-bold text-white text-base">No hay cortes agendados para esta fecha.</p>
        <p class="text-xs text-slate-400 mt-1">Los turnos que reserven los clientes aparecerán acá en detalle.</p>
      </div>
    `;
    safeRenderIcons();
    return;
  }

  container.innerHTML = dayApps.map(app => {
    const s = SERVICES.find(x => x.id === app.serviceId) || SERVICES[0];
    const hasPassed = isTimePassed(adminSelectedDate, app.time);

    return `
      <div class="p-4 sm:p-5 rounded-2xl border ${hasPassed ? 'border-white/5 bg-[#12141a]/60 opacity-75' : 'border-white/10 bg-[#15181e] hover:border-amber-400/40'} flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md transition">
        <div class="flex items-center gap-3.5">
          <span class="w-16 py-2.5 rounded-xl ${hasPassed ? 'bg-white/10 text-slate-400' : 'bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 font-black'} text-sm font-mono text-center block flex-shrink-0 shadow-xs">
            ${app.time} hs
          </span>
          <div>
            <div class="flex items-center gap-2">
              <h4 class="font-extrabold text-base text-white">${escapeHtml(app.clientName)}</h4>
              ${hasPassed ? '<span class="text-[10px] text-slate-400 font-bold bg-white/10 px-2 py-0.5 rounded-full">🕒 Ya pasó</span>' : '<span class="text-[10px] text-emerald-400 font-bold bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full">Confirmado</span>'}
            </div>
            <p class="text-xs sm:text-sm text-slate-400 mt-1 flex flex-wrap items-center gap-2">
              <span class="font-medium text-amber-400">${s.name}</span>
              <span class="text-slate-600">•</span>
              <span class="inline-flex items-center gap-1 font-mono font-bold text-slate-200">
                📞 <a href="tel:${escapeHtml(app.phone)}" class="hover:underline hover:text-amber-400">${escapeHtml(app.phone)}</a>
              </span>
            </p>
            ${app.notes ? `
            <div class="mt-2 p-2 bg-[#0c0e12] border border-white/10 rounded-xl text-xs text-amber-200 flex items-start gap-1.5">
              <span class="font-bold text-amber-400 flex-shrink-0">💬 Aclaración:</span>
              <span class="italic font-medium">${escapeHtml(app.notes)}</span>
            </div>
            ` : ''}
          </div>
        </div>

        <div class="flex items-center gap-2 self-end sm:self-auto pt-2 sm:pt-0">
          ${hasPassed ? `
            <span class="text-xs font-semibold text-slate-500 bg-white/5 border border-white/5 px-3 py-1.5 rounded-xl select-none">
              Finalizado
            </span>
          ` : `
            <button onclick="adminPromptCancelAppointment('${app.id}')" title="Cancelar este turno" class="px-3.5 py-2 bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 shadow-xs">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
              <span>Cancelar turno</span>
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');

  safeRenderIcons();
}

// ----------------------------------------------------
// GESTIÓN DE CANCELACIÓN CON AVISO POR WHATSAPP
// ----------------------------------------------------
let appointmentToCancel = null;

function adminPromptCancelAppointment(appId) {
  const app = appointments.find(a => a.id === appId);
  if (!app) return;

  appointmentToCancel = app;
  const modal = document.getElementById('cancelAppointmentModal');
  const details = document.getElementById('cancelModalDetails');
  const preview = document.getElementById('cancelModalWhatsappPreview');
  const btnNotify = document.getElementById('btnConfirmCancelAndNotify');
  const btnCancelOnly = document.getElementById('btnConfirmCancelOnly');

  if (!modal || !details) return;

  const s = SERVICES.find(x => x.id === app.serviceId) || SERVICES[0];
  const dateStr = formatDateDisplay(app.date);

  details.innerHTML = `
    <div class="flex justify-between border-b border-white/10 pb-1.5">
      <span class="text-slate-400">Cliente:</span>
      <strong class="text-white font-bold">${escapeHtml(app.clientName)}</strong>
    </div>
    <div class="flex justify-between border-b border-white/10 pb-1.5">
      <span class="text-slate-400">Teléfono:</span>
      <strong class="text-white font-mono">${escapeHtml(app.phone)}</strong>
    </div>
    <div class="flex justify-between border-b border-white/10 pb-1.5">
      <span class="text-slate-400">Servicio:</span>
      <strong class="text-white">${s.name}</strong>
    </div>
    <div class="flex justify-between pt-0.5">
      <span class="text-slate-400">Turno reservado:</span>
      <strong class="text-amber-400 font-bold">${dateStr} a las ${app.time} hs</strong>
    </div>
    ${app.notes ? `
    <div class="flex justify-between border-t border-white/10 pt-1.5 mt-1">
      <span class="text-slate-400">Aclaración:</span>
      <span class="text-slate-300 font-medium italic text-right max-w-[200px]">"${escapeHtml(app.notes)}"</span>
    </div>
    ` : ''}
  `;

  const msgText = `Hola ${app.clientName}, te escribo de Barbería Paco para avisarte que tuvimos que cancelar tu turno del ${dateStr} a las ${app.time} hs. ¡Disculpá las molestias ocasionadas!`;
  if (preview) {
    preview.textContent = msgText;
  }

  if (btnNotify) {
    btnNotify.onclick = () => executeCancelAppointment(true);
  }
  if (btnCancelOnly) {
    btnCancelOnly.onclick = () => executeCancelAppointment(false);
  }

  modal.classList.remove('hidden');
  safeRenderIcons();
}

function closeCancelAppointmentModal() {
  const modal = document.getElementById('cancelAppointmentModal');
  if (modal) modal.classList.add('hidden');
  appointmentToCancel = null;
}

function formatArgentineWhatsAppNumber(phone) {
  let clean = phone.replace(/[^0-9]/g, '');
  if (clean.startsWith('549')) return clean;
  if (clean.startsWith('54')) return '549' + clean.slice(2);
  if (clean.startsWith('0')) clean = clean.slice(1);
  return '549' + clean;
}

async function executeCancelAppointment(notifyWhatsApp) {
  if (!appointmentToCancel) return;
  const app = appointmentToCancel;

  // 1. Cancelar el turno en la base de datos
  try {
    await Api.adminCancel(app.id);
  } catch (e) {
    console.error('Error cancelando turno:', e);
    alert('No se pudo cancelar el turno. Revisá la conexión e intentá de nuevo.');
    return;
  }
  refreshData();

  // 2. Si se solicitó avisar, abrir WhatsApp con mensaje redactado
  if (notifyWhatsApp) {
    const waNumber = formatArgentineWhatsAppNumber(app.phone);
    const dateStr = formatDateDisplay(app.date);
    const msg = `Hola ${app.clientName}, te escribo de Barbería Paco para avisarte que tuvimos que cancelar tu turno del ${dateStr} a las ${app.time} hs. ¡Disculpá las molestias ocasionadas!`;
    const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
  }

  closeCancelAppointmentModal();
}

// Alias de compatibilidad
function adminCancelAppointment(appId) {
  adminPromptCancelAppointment(appId);
}

function renderAdminScheduleSlots() {
  const container = document.getElementById('adminScheduleSlotsGrid');
  if (!container) return;

  const disabledForDate = disabledSlotsByDate[adminSelectedDate] || [];

  const morningSlots = TIME_SLOTS.filter(t => parseInt(t.split(':')[0], 10) < 14);
  const afternoonSlots = TIME_SLOTS.filter(t => parseInt(t.split(':')[0], 10) >= 14);

  function renderAdminSlot(time) {
    const bookedApp = appointments.find(a => a.date === adminSelectedDate && a.time === time && a.status === 'confirmed');
    const isEliminado = disabledForDate.includes(time);
    const hasPassed = isTimePassed(adminSelectedDate, time);

    // 1. Horario que ya pasó (sin reserva)
    if (hasPassed && !bookedApp) {
      return `
        <div class="p-3 rounded-2xl border border-white/5 bg-white/5 flex items-center justify-between gap-2 opacity-50 select-none shadow-xs">
          <div class="flex items-center gap-2.5">
            <span class="font-mono text-xs text-slate-500 line-through bg-white/5 px-2 py-1 rounded-md">${time} hs</span>
            <span class="text-xs text-slate-500">🕒 Ya transcurrido</span>
          </div>
          <span class="text-[10px] text-slate-500 font-semibold px-2 py-0.5 bg-white/5 rounded border border-white/5">Inactivo</span>
        </div>
      `;
    }

    // 2. Horario con reserva agendada
    if (bookedApp) {
      const s = SERVICES.find(x => x.id === bookedApp.serviceId) || SERVICES[0];

      // Si ya pasó, no se permite eliminar ni cancelar
      if (hasPassed) {
        return `
          <div class="p-3.5 rounded-2xl border border-white/5 bg-[#12141a]/60 flex items-center justify-between gap-2 opacity-65 select-none shadow-xs">
            <div class="flex items-center gap-2.5">
              <span class="font-mono text-xs text-slate-500 line-through bg-white/5 px-2.5 py-1.5 rounded-lg">${time} hs</span>
              <div>
                <span class="text-xs font-bold text-slate-400 block">${escapeHtml(bookedApp.clientName)} (Finalizado)</span>
                <span class="text-[11px] text-slate-500 block">${s.name} • 📞 ${escapeHtml(bookedApp.phone)}</span>
                ${bookedApp.notes ? `<span class="text-[10px] text-slate-500 italic block mt-0.5">💬 "${escapeHtml(bookedApp.notes)}"</span>` : ''}
              </div>
            </div>
            <span class="text-[10px] text-slate-400 font-semibold px-2.5 py-1 bg-white/10 rounded-lg border border-white/5">Finalizado</span>
          </div>
        `;
      }

      // Horario futuro/activo: se puede cancelar
      return `
        <div class="p-3.5 rounded-2xl border border-amber-500/30 bg-[#0c0e12] flex items-center justify-between gap-2 shadow-sm">
          <div class="flex items-center gap-2.5">
            <span class="font-mono font-extrabold text-xs bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 px-2.5 py-1.5 rounded-lg shadow-xs">${time} hs</span>
            <div>
              <span class="text-xs sm:text-sm font-bold text-white block">${escapeHtml(bookedApp.clientName)}</span>
              <span class="text-[11px] text-slate-400 block">${s.name} • 📞 ${escapeHtml(bookedApp.phone)}</span>
              ${bookedApp.notes ? `<span class="text-[11px] text-amber-300 font-medium italic block mt-0.5">💬 "${escapeHtml(bookedApp.notes)}"</span>` : ''}
            </div>
          </div>
          <button onclick="adminPromptCancelAppointment('${bookedApp.id}')" class="px-3 py-1.5 text-xs font-bold bg-red-950/40 text-red-300 border border-red-800/40 rounded-xl hover:bg-red-900/50 flex-shrink-0 transition shadow-xs">
            Cancelar
          </button>
        </div>
      `;
    }

    // 3. Horario que fue eliminado por el barbero
    if (isEliminado) {
      if (hasPassed) {
        return `
          <div class="p-3 rounded-2xl border border-white/5 bg-white/5 flex items-center justify-between gap-2 opacity-50 select-none">
            <div class="flex items-center gap-2.5">
              <span class="font-mono text-xs line-through text-slate-500 bg-white/5 px-2 py-1 rounded-md">${time} hs</span>
              <span class="text-xs text-slate-500">⛔ No atendió (Pasó)</span>
            </div>
            <span class="text-[10px] text-slate-500 font-semibold px-2 py-0.5 bg-white/5 rounded border border-white/5">Inactivo</span>
          </div>
        `;
      }

      return `
        <div class="p-3.5 rounded-2xl border border-red-900/40 bg-red-950/25 flex items-center justify-between gap-2 shadow-sm">
          <div class="flex items-center gap-2.5">
            <span class="font-mono font-bold text-xs line-through text-red-300 bg-red-950/50 px-2.5 py-1 rounded-md border border-red-800/40">${time} hs</span>
            <span class="text-xs font-bold text-red-400">⛔ Eliminado</span>
          </div>
          <button onclick="adminToggleSlot('${adminSelectedDate}', '${time}', true)" class="px-3.5 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition flex items-center gap-1 shadow-xs flex-shrink-0">
            <i data-lucide="check" class="w-3.5 h-3.5"></i>
            <span>Habilitar</span>
          </button>
        </div>
      `;
    }

    // 4. Horario libre disponible en fecha actual o futura
    return `
      <div class="p-3.5 rounded-2xl border border-white/10 bg-[#15181e] flex items-center justify-between gap-2 hover:border-amber-400/40 transition shadow-sm">
        <div class="flex items-center gap-2.5">
          <span class="font-mono font-bold text-xs bg-[#0c0e12] text-white px-2.5 py-1 rounded-md border border-white/10">${time} hs</span>
          <span class="text-xs font-semibold text-emerald-400">✓ Disponible</span>
        </div>
        <button onclick="adminToggleSlot('${adminSelectedDate}', '${time}', false)" class="px-3.5 py-1.5 text-xs font-bold bg-white/5 hover:bg-red-950/40 text-slate-300 hover:text-red-300 border border-white/10 hover:border-red-800/40 rounded-xl transition flex items-center gap-1 flex-shrink-0 shadow-xs">
          <i data-lucide="ban" class="w-3.5 h-3.5"></i>
          <span>Eliminar Horario</span>
        </button>
      </div>
    `;
  }

  const isAllMorningDisabled = morningSlots.every(t => disabledForDate.includes(t));
  const isAllAfternoonDisabled = afternoonSlots.every(t => disabledForDate.includes(t));

  container.innerHTML = `
    <div class="space-y-4">
      <!-- BLOQUE MAÑANA -->
      <div class="space-y-2">
        <div class="flex items-center justify-between px-1">
          <span class="text-xs font-extrabold text-white flex items-center gap-1.5">
            <span>☀️</span>
            <span>Turno Mañana (09:00 a 12:30 hs)</span>
          </span>
          <button onclick="adminToggleShiftSlots('morning', ${!isAllMorningDisabled})" class="px-2.5 py-1 ${isAllMorningDisabled ? 'bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border-emerald-700/50' : 'bg-red-950/40 hover:bg-red-900/50 text-red-300 border-red-800/40'} border rounded-lg text-[11px] font-bold transition flex items-center gap-1 shadow-xs" title="${isAllMorningDisabled ? 'Volver a habilitar todos los turnos de la mañana' : 'Deshabilitar todos los turnos de la mañana'}">
            <i data-lucide="${isAllMorningDisabled ? 'check' : 'ban'}" class="w-3 h-3"></i>
            <span>${isAllMorningDisabled ? 'Habilitar Mañana' : 'Eliminar toda la Mañana'}</span>
          </button>
        </div>
        <div class="space-y-2">
          ${morningSlots.map(renderAdminSlot).join('')}
        </div>
      </div>

      <!-- BLOQUE TARDE -->
      <div class="space-y-2 pt-2">
        <div class="flex items-center justify-between px-1">
          <span class="text-xs font-extrabold text-white flex items-center gap-1.5">
            <span>🌙</span>
            <span>Turno Tarde (16:30 a 20:00 hs)</span>
          </span>
          <button onclick="adminToggleShiftSlots('afternoon', ${!isAllAfternoonDisabled})" class="px-2.5 py-1 ${isAllAfternoonDisabled ? 'bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border-emerald-700/50' : 'bg-red-950/40 hover:bg-red-900/50 text-red-300 border-red-800/40'} border rounded-lg text-[11px] font-bold transition flex items-center gap-1 shadow-xs" title="${isAllAfternoonDisabled ? 'Volver a habilitar todos los turnos de la tarde' : 'Deshabilitar todos los turnos de la tarde'}">
            <i data-lucide="${isAllAfternoonDisabled ? 'check' : 'ban'}" class="w-3 h-3"></i>
            <span>${isAllAfternoonDisabled ? 'Habilitar Tarde' : 'Eliminar toda la Tarde'}</span>
          </button>
        </div>
        <div class="space-y-2">
          ${afternoonSlots.map(renderAdminSlot).join('')}
        </div>
      </div>
    </div>
  `;

  safeRenderIcons();
}

async function adminToggleShiftSlots(shift, disableAll) {

  const slots = shift === 'morning' 
    ? TIME_SLOTS.filter(t => parseInt(t.split(':')[0], 10) < 14)
    : TIME_SLOTS.filter(t => parseInt(t.split(':')[0], 10) >= 14);

  const shiftName = shift === 'morning' ? 'la mañana' : 'la tarde';

  if (disableAll) {
    const bookedInShift = appointments.filter(a => a.date === adminSelectedDate && slots.includes(a.time) && a.status === 'confirmed');

    let msg = `¿Querés eliminar todos los turnos de ${shiftName} para esta fecha? Ningún cliente podrá reservar en ese horario.`;
    if (bookedInShift.length > 0) {
      msg = `Atención: Tenés ${bookedInShift.length} turno(s) agendado(s) en ${shiftName}.\n\nAl eliminar la franja horaria, no se podrán agendar nuevos turnos. ¿Deseás continuar?`;
    }

    if (!confirm(msg)) return;
  }

  try {
    await Api.setSlotsDisabled(adminSelectedDate, slots, disableAll);
  } catch (e) {
    console.error('Error actualizando horarios:', e);
    alert('No se pudieron actualizar los horarios. Intentá de nuevo.');
  }
  await refreshData();
}

async function adminToggleSlot(dateKey, time, currentlyDisabled) {
  try {
    await Api.setSlotsDisabled(dateKey, [time], !currentlyDisabled);
  } catch (e) {
    console.error('Error actualizando horario:', e);
    alert('No se pudo actualizar el horario. Intentá de nuevo.');
  }
  await refreshData();
}

document.addEventListener('DOMContentLoaded', () => {
  showWelcomeScreen();
  const demoBanner = document.getElementById('demoModeBanner');
  if (demoBanner) demoBanner.classList.toggle('hidden', USE_FIREBASE);
  refreshData();
});
