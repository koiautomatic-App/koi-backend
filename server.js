// ════════════════════════════════════════════════════════════
//  MÓDULO AFIP — DELEGACIÓN MULTI-TENANT (PRODUCCIÓN OK)
// ════════════════════════════════════════════════════════════

// --- FUNCIONES AUXILIARES (Deben ir arriba para evitar errores de "not defined") ---

function _tipoComprobante() {
  return 11; // Factura C para Monotributo
}

function _fechaAFIP(d) {
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

async function _afipUltimoNro(cuit, puntoVenta, cbTipo, token, sign) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${puntoVenta}</ar:PtoVta>
      <ar:CbteTipo>${cbTipo}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soapenv:Body>
</soapenv:Envelope>`;

  const resp = await _soapPost(WSFE_URL, soap);
  const match = resp.match(/<CbteNro>(\d+)<\/CbteNro>/);
  return match ? parseInt(match[1], 10) : 0;
}

function _firmarCMS(xml) {
  if (!fs.existsSync(AFIP_KEY_PATH) || !fs.existsSync(AFIP_CERT_PATH)) {
    throw new Error(`Certificados no encontrados en: ${AFIP_CERT_PATH}`);
  }

  const tmpXml = path.join(os.tmpdir(), `koi_ltr_${Date.now()}.xml`);
  const tmpOut = path.join(os.tmpdir(), `koi_cms_${Date.now()}.der`);

  try {
    fs.writeFileSync(tmpXml, xml, 'utf8');
    execSync(
      `openssl cms -sign -in "${tmpXml}" -signer "${AFIP_CERT_PATH}" -inkey "${AFIP_KEY_PATH}"` +
      ` -nodetach -outform DER -out "${tmpOut}"`,
      { stdio: 'pipe' }
    );
    return fs.readFileSync(tmpOut).toString('base64');
  } finally {
    try { fs.unlinkSync(tmpXml); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

function _generarCMS(servicio = 'wsfe') {
  const ahora = new Date();
  const fechaDesde = new Date(ahora.getTime() - (10 * 60 * 1000));
  const fechaHasta = new Date(ahora.getTime() + (12 * 60 * 60 * 1000));

  const toAFIP = (date) => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const p = fmt.formatToParts(date);
    const get = (t) => p.find(x => x.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-03:00`;
  };

  return _firmarCMS(`<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>
    <generationTime>${toAFIP(fechaDesde)}</generationTime>
    <expirationTime>${toAFIP(fechaHasta)}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`);
}

function _soapPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = Buffer.from(body, 'utf8');
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': postData.length,
        'SOAPAction': url.includes('wsaa') ? "" : "http://ar.gov.afip.dif.FEV1/FECAESolicitar"
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function _parsearTA(xml) {
  const fault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (fault) throw new Error(`ARCA Error: ${fault[1].trim()}`);

  const m = xml.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
  if (!m) throw new Error('WSAA: No se encontró loginCmsReturn.');

  const taXml = Buffer.from(m[1].trim(), 'base64').toString('utf8');
  const token = taXml.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim();
  const sign  = taXml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim();
  const exp   = taXml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1]?.trim();

  if (!token || !sign) throw new Error('WSAA: Ticket incompleto.');
  return { token, sign, expiracion: exp, generadoEn: new Date().toISOString() };
}

// --- FUNCIONES PRINCIPALES ---

async function afip_obtenerTA(cuitUsuario) {
  const cuit = String(cuitUsuario).replace(/\D/g, '');
  const cache = _leerTACache(cuit);
  if (cache && _taEsValido(cache)) return { token: cache.token, sign: cache.sign };

  const cms = _generarCMS('wsfe');
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.xsb.com.ar">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const resp = await _soapPost(WSAA_URL, soapBody);
  const ta   = _parsearTA(resp);
  _guardarTACache(cuit, ta);
  return { token: ta.token, sign: ta.sign };
}

async function afip_emitirComprobante(cuitEmisor, puntoVenta, datos) {
  const { token, sign } = await afip_obtenerTA(cuitEmisor);
  
  const cbTipo = _tipoComprobante();
  const ultimoNro = await _afipUltimoNro(cuitEmisor, puntoVenta, cbTipo, token, sign);
  const nroComp = ultimoNro + 1;

  const fechaVenta = datos.fechaOriginal ? new Date(datos.fechaOriginal) : new Date();
  const fechaHoy = new Date();
  const diff = Math.floor((fechaHoy - fechaVenta) / (1000 * 60 * 60 * 24));
  
  let fEmision = _fechaAFIP(fechaHoy);
  if (diff <= 5) fEmision = _fechaAFIP(fechaVenta);
  else {
    const limite = new Date();
    limite.setDate(fechaHoy.getDate() - 5);
    fEmision = _fechaAFIP(limite);
  }

  const importe = parseFloat(datos.importeTotal.toFixed(2));
  const docTipo = (importe >= 191624) ? 96 : (String(datos.clienteDoc).length === 11 ? 80 : 99);
  const docNro  = String(datos.clienteDoc || '0').replace(/\D/g, '') || '0';

  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/><soapenv:Body><ar:FECAESolicitar><ar:Auth>
  <ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign><ar:Cuit>${cuitEmisor}</ar:Cuit>
  </ar:Auth><ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${puntoVenta}</ar:PtoVta>
  <ar:CbteTipo>${cbTipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>
  <ar:Concepto>1</ar:Concepto><ar:DocTipo>${docTipo}</ar:DocTipo><ar:DocNro>${docNro}</ar:DocNro>
  <ar:CbteDesde>${nroComp}</ar:CbteDesde><ar:CbteHasta>${nroComp}</ar:CbteHasta><ar:CbteFch>${fEmision}</ar:CbteFch>
  <ar:ImpTotal>${importe}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${importe}</ar:ImpNeto>
  <ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpIVA>0.00</ar:ImpIVA><ar:ImpTrib>0.00</ar:ImpTrib>
  <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz></ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>
  </ar:FECAESolicitar></soapenv:Body></soapenv:Envelope>`;

  const resp = await _soapPost(WSFE_URL, soap);
  const resultado = resp.match(/<Resultado>([\s\S]*?)<\/Resultado>/)?.[1];
  
  if (resultado !== 'A') {
    const err = resp.match(/<Msg>([\s\S]*?)<\/Msg>/)?.[1];
    throw new Error(`AFIP: ${err || 'Rechazado'}`);
  }
  
  const cae = resp.match(/<CAE>([\s\S]*?)<\/CAE>/)[1];
  return { cae, nroComp };
}
