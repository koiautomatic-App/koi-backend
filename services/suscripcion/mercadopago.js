const axios = require('axios');

const formatMercadoPagoDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  
  return year + '-' + month + '-' + day + 'T' + hours + ':' + minutes + ':' + seconds + '.' + milliseconds + '-03:00';
};

const crearSuscripcionMP = async (email, userId) => {
  const startDate = new Date();
  startDate.setMinutes(startDate.getMinutes() + 10);
  const formattedDate = formatMercadoPagoDate(startDate);
  
  const subscription = {
    reason: "KOI-FACTURA - Suscripción Mensual",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 40000,
      currency_id: "ARS",
      start_date: formattedDate
    },
    back_url: "https://www.koi-factura.lat/dashboard",
    payer_email: email
  };
  
  const response = await axios.post('https://api.mercadopago.com/preapproval', subscription, {
    headers: {
      'Authorization': 'Bearer ' + process.env.MP_ACCESS_TOKEN,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': Date.now() + '-' + userId
    }
  });
  
  return response.data;
};

const cancelarSuscripcionMP = async (preapprovalId) => {
  const response = await axios.put('https://api.mercadopago.com/preapproval/' + preapprovalId, {
    status: 'cancelled'
  }, {
    headers: {
      'Authorization': 'Bearer ' + process.env.MP_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  return response.data;
};

module.exports = { crearSuscripcionMP, cancelarSuscripcionMP, formatMercadoPagoDate };