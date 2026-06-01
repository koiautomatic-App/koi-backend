const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const { DOMParser } = require('@xmldom/xmldom');
const config = require('../../config');
const { getAfipToken } = require('./wsaa');

const SSL_OP_LEGACY = crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT || 0x00000004;
const httpsAgent = new https.Agent({
  secureOptions: SSL_OP_LEGACY,
  rejectUnauthorized: true,
  keepAlive: true,
  ciphers: 'DEFAULT:@SECLEVEL=0'
});

const getUltimoComprobante = async (cuit, ptoVta, tipoCbte, token, sign) => {
  const soap = '<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">\n  <soapenv:Header/>\n  <soapenv:Body>\n    <ar:FECompUltimoAutorizado>\n      <ar:Auth>\n        <ar:Token>' + token + '</ar:Token>\n        <ar:Sign>' + sign + '</ar:Sign>\n        <ar:Cuit>' + cuit + '</ar:Cuit>\n      </ar:Auth>\n      <ar:PtoVta>' + ptoVta + '</ar:PtoVta>\n      <ar:CbteTipo>' + tipoCbte + '</ar:CbteTipo>\n    </ar:FECompUltimoAutorizado>\n  </soapenv:Body>\n</soapenv:Envelope>';

  const res = await axios.post(config.AFIP_URLS.wsfe, soap, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado' },
    httpsAgent: httpsAgent,
    timeout: 20000,
    validateStatus: () => true
  });

  const xml = new DOMParser().parseFromString(res.data, 'text/xml');
  const fault = xml.getElementsByTagName('faultstring')[0]?.textContent;
  if (fault) throw new Error('WSFE UltimoNro fault: ' + fault);
  
  return parseInt(xml.getElementsByTagName('CbteNro')[0]?.textContent || '0');
};

const getTipoComprobante = (orden, userSettings) => {
  const condicion = userSettings.condicionFiscal || 'responsable_inscripto';
  if (condicion === 'monotributo' || condicion === 'exento') return 11;
  
  const docLen = (orden.customerDoc || '').replace(/\D/g, '').length;
  if (docLen === 11) return 1;
  return 6;
};

const solicitarCAE = async (orden, userSettings, token, sign) => {
  const cuit = userSettings.cuit.replace(/\D/g, '');
  const ptoVta = parseInt(userSettings.arcaPtoVta || userSettings.puntoVenta || 1);
  const tipo = getTipoComprobante(orden, userSettings);

  const ultimo = await getUltimoComprobante(cuit, ptoVta, tipo, token, sign);
  const nroCbte = ultimo + 1;

  let fechaParaAFIP;
  if (orden.orderDate) {
    const fechaOperacion = new Date(orden.orderDate);
    const hoy = new Date();
    const diffDays = Math.ceil((hoy - fechaOperacion) / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 5) {
      fechaParaAFIP = fechaOperacion;
    } else {
      fechaParaAFIP = hoy;
    }
  } else {
    fechaParaAFIP = new Date();
  }

  const fecha = fechaParaAFIP.getFullYear() + String(fechaParaAFIP.getMonth()+1).padStart(2,'0') + String(fechaParaAFIP.getDate()).padStart(2,'0');

  const docClean = (orden.customerDoc || '99999999').replace(/\D/g, '');
  const tipoDoc = docClean === '99999999' ? 99 : (docClean.length === 11 ? 80 : 96);
  const nroDoc = tipoDoc === 99 ? 0 : parseInt(docClean);
  const importe = parseFloat(orden.amount.toFixed(2));

  let impNeto = importe;
  let impIVA = 0;
  let ivaItems = '';

  if (tipo === 1) {
    impIVA = parseFloat((importe / 1.21 * 0.21).toFixed(2));
    impNeto = parseFloat((importe - impIVA).toFixed(2));
    ivaItems = '\n        <ar:Iva>\n          <ar:AlicIva>\n            <ar:Id>5</ar:Id>\n            <ar:BaseImp>' + impNeto + '</ar:BaseImp>\n            <ar:Importe>' + impIVA + '</ar:Importe>\n          </ar:AlicIva>\n        </ar:Iva>';
  }

  const soap = '<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">\n  <soapenv:Header/>\n  <soapenv:Body>\n    <ar:FECAESolicitar>\n      <ar:Auth>\n        <ar:Token>' + token + '</ar:Token>\n        <ar:Sign>' + sign + '</ar:Sign>\n        <ar:Cuit>' + cuit + '</ar:Cuit>\n      </ar:Auth>\n      <ar:FeCAEReq>\n        <ar:FeCabReq>\n          <ar:CantReg>1</ar:CantReg>\n          <ar:PtoVta>' + ptoVta + '</ar:PtoVta>\n          <ar:CbteTipo>' + tipo + '</ar:CbteTipo>\n        </ar:FeCabReq>\n        <ar:FeDetReq>\n          <ar:FECAEDetRequest>\n            <ar:Concepto>1</ar:Concepto>\n            <ar:DocTipo>' + tipoDoc + '</ar:DocTipo>\n            <ar:DocNro>' + nroDoc + '</ar:DocNro>\n            <ar:CbteDesde>' + nroCbte + '</ar:CbteDesde>\n            <ar:CbteHasta>' + nroCbte + '</ar:CbteHasta>\n            <ar:CbteFch>' + fecha + '</ar:CbteFch>\n            <ar:ImpTotal>' + importe + '</ar:ImpTotal>\n            <ar:ImpTotConc>0</ar:ImpTotConc>\n            <ar:ImpNeto>' + impNeto + '</ar:ImpNeto>\n            <ar:ImpOpEx>0</ar:ImpOpEx>\n            <ar:ImpIVA>' + impIVA + '</ar:ImpIVA>\n            <ar:ImpTrib>0</ar:ImpTrib>\n            <ar:MonId>PES</ar:MonId>\n            <ar:MonCotiz>1</ar:MonCotiz>' + ivaItems + '\n          </ar:FECAEDetRequest>\n        </ar:FeDetReq>\n      </ar:FeCAEReq>\n    </ar:FECAESolicitar>\n  </soapenv:Body>\n</soapenv:Envelope>';

  console.log('[AFIP] Enviando solicitud CAE...');
  
  const wsfeResp = await axios.post(config.AFIP_URLS.wsfe, soap, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://ar.gov.afip.dif.FEV1/FECAESolicitar' },
    httpsAgent: httpsAgent,
    timeout: 30000,
    validateStatus: () => true
  });

  const xml = new DOMParser().parseFromString(wsfeResp.data, 'text/xml');
  
  // Verificar SOAP Fault
  const soapFault = xml.getElementsByTagName('faultstring')[0]?.textContent;
  if (soapFault) {
    console.error('[AFIP] SOAP Fault:', soapFault);
    throw new Error('WSFE SOAP Fault: ' + soapFault);
  }
  
  const detResp = xml.getElementsByTagName('FECAEDetResponse')[0];
  const result = detResp?.getElementsByTagName('Resultado')[0]?.textContent;

  if (result !== 'A') {
    // Buscar todos los errores (Err y Obs)
    const errores = [];
    const errNodes = xml.getElementsByTagName('Err');
    for (let i = 0; i < errNodes.length; i++) {
      const msg = errNodes[i].getElementsByTagName('Msg')[0]?.textContent;
      const code = errNodes[i].getElementsByTagName('Code')[0]?.textContent;
      if (msg) errores.push(`[${code}] ${msg}`);
      console.log(`[AFIP] Err: Code=${code}, Msg=${msg}`);
    }
    const obsNodes = xml.getElementsByTagName('Obs');
    for (let i = 0; i < obsNodes.length; i++) {
      const msg = obsNodes[i].getElementsByTagName('Msg')[0]?.textContent;
      if (msg) errores.push(msg);
      console.log(`[AFIP] Obs: ${msg}`);
    }
    const errMsg = errores.join(' | ') || `Resultado=${result || 'vacío'}`;
    console.error('[AFIP] WSFE rechazó:', errMsg);
    throw new Error('AFIP rechazó: ' + errMsg);
  }

  const cae = detResp.getElementsByTagName('CAE')[0]?.textContent;
  const caeVto = detResp.getElementsByTagName('CAEFchVto')[0]?.textContent;
  const caeExpiry = caeVto ? new Date(caeVto.slice(0,4) + '-' + caeVto.slice(4,6) + '-' + caeVto.slice(6,8)) : null;

  const ptoVtaStr = String(ptoVta).padStart(5, '0');
  const nroCbteStr = String(nroCbte).padStart(8, '0');
  const tipoLabel = tipo === 11 ? 'C' : (tipo === 1 ? 'A' : 'B');

  return {
    cae: cae,
    caeExpiry: caeExpiry,
    nroCbte: nroCbte,
    tipo: tipo,
    ptoVta: ptoVta,
    importe: importe,
    impNeto: impNeto,
    impIVA: impIVA,
    nroFormatted: 'FC ' + tipoLabel + ' ' + ptoVtaStr + '-' + nroCbteStr,
    fechaUsada: fechaParaAFIP
  };
};

const emitirCAE = async (orderId, userOverride, fechaForzada) => {
  const Order = require('../../models/Order');
  const User = require('../../models/User');
  
  const orden = await Order.findById(orderId);
  if (!orden) throw new Error('Orden no encontrada');
  if (orden.status === 'invoiced') throw new Error('Esta orden ya tiene CAE emitido');
  if (orden.status === 'error_data') throw new Error('Orden con datos incompletos');

  const user = userOverride || await User.findById(orden.userId).select('settings').lean();
  if (!user?.settings?.cuit) throw new Error('Configurá tu CUIT antes de emitir');

  const cuit = user.settings.cuit.replace(/\D/g, '');
  const { token, sign } = await getAfipToken(cuit);
  const result = await solicitarCAE(orden, user.settings, token, sign);

  await Order.findByIdAndUpdate(orderId, {
    status: 'invoiced',
    caeNumber: result.cae,
    caeExpiry: result.caeExpiry,
    tipoComprobante: result.tipo,
    puntoVenta: result.ptoVta,
    nroComprobante: result.nroCbte,
    nroFormatted: result.nroFormatted,
    fechaEmision: result.fechaUsada,
    impNeto: result.impNeto,
    impIVA: result.impIVA,
    errorLog: ''
  });

  console.log('✅ CAE emitido: ' + result.cae + ' | ' + result.nroFormatted + ' | $' + result.importe);
  return result;
};

module.exports = { emitirCAE, solicitarCAE, getTipoComprobante, getUltimoComprobante };