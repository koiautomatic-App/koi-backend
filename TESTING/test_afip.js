const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');

// Usar los archivos que están en esta carpeta
const CERT_PATH = './koi-produccion_31a3dd828a5332c0.crt';
const KEY_PATH = './koi.key';

console.log('═══════════════════════════════════════════════════════');
console.log('🔍 TEST AFIP - CERTIFICADOS LOCALES');
console.log('═══════════════════════════════════════════════════════\n');

// Verificar archivos
console.log('📁 Verificando archivos:');
console.log(`   ${CERT_PATH} → ${fs.existsSync(CERT_PATH) ? '✅' : '❌'}`);
console.log(`   ${KEY_PATH} → ${fs.existsSync(KEY_PATH) ? '✅' : '❌'}`);

if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
  console.error('\n❌ No se encuentran los archivos');
  process.exit(1);
}

// Info del certificado
console.log('\n📋 Información del certificado:');
try {
  const info = execSync(`openssl x509 -in "${CERT_PATH}" -noout -subject -dates`, { encoding: 'utf8' });
  console.log(info);
} catch(e) { console.log('Error leyendo certificado:', e.message); }

// Verificar coincidencia
console.log('\n🔐 Verificando coincidencia Cert/Key:');
try {
  const certMod = execSync(`openssl x509 -noout -modulus -in "${CERT_PATH}" | openssl md5`, { encoding: 'utf8' });
  const keyMod = execSync(`openssl rsa -noout -modulus -in "${KEY_PATH}" | openssl md5`, { encoding: 'utf8' });
  console.log(`   Cert MD5: ${certMod.trim()}`);
  console.log(`   Key MD5:  ${keyMod.trim()}`);
  if (certMod === keyMod) {
    console.log('   ✅ Certificado y clave coinciden');
  } else {
    console.log('   ❌ NO coinciden');
  }
} catch(e) { console.log('Error:', e.message); }

// Generar LoginTicketRequest
console.log('\n📝 Generando LoginTicketRequest...');

const ahora = new Date();
const desde = new Date(ahora.getTime() - 60000);
const hasta = new Date(ahora.getTime() + 12 * 3600000);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Date.now()}</uniqueId>
    <generationTime>${desde.toISOString().replace('Z', '-03:00')}</generationTime>
    <expirationTime>${hasta.toISOString().replace('Z', '-03:00')}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;

console.log('   XML generado correctamente');

// Firmar el XML
console.log('\n🔐 Firmando CMS...');

const tmpXml = path.join(os.tmpdir(), `req_${Date.now()}.xml`);
const tmpDer = path.join(os.tmpdir(), `sig_${Date.now()}.der`);

fs.writeFileSync(tmpXml, xml, 'utf8');

try {
  execSync(
    `openssl cms -sign -in "${tmpXml}" -signer "${CERT_PATH}" -inkey "${KEY_PATH}" -nodetach -outform DER -out "${tmpDer}"`,
    { stdio: 'pipe', timeout: 30000 }
  );
  const cmsBase64 = fs.readFileSync(tmpDer).toString('base64');
  console.log(`   ✅ CMS firmado (${cmsBase64.length} caracteres)`);
  
  // Enviar a WSAA
  console.log('\n📡 Enviando a WSAA (homologación)...');
  
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope 
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov/">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
  
  const postData = Buffer.from(soapBody, 'utf8');
  const options = {
    hostname: 'wsaahomo.afip.gov.ar',
    port: 443,
    path: '/ws/services/LoginCms',
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Length': postData.length,
      'SOAPAction': '',
    },
    timeout: 30000,
  };
  
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log(`   Respuesta HTTP: ${res.statusCode}`);
      
      if (res.statusCode === 200) {
        const match = data.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
        if (match) {
          const taBase64 = match[1].trim();
          const taXml = Buffer.from(taBase64, 'base64').toString('utf8');
          const token = taXml.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim();
          const sign = taXml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim();
          
          if (token && sign) {
            console.log('\n═══════════════════════════════════════════════════════');
            console.log('🎉 ¡ÉXITO! El certificado es válido');
            console.log('═══════════════════════════════════════════════════════');
            console.log(`\nToken: ${token.substring(0, 50)}...`);
            console.log(`Sign: ${sign.substring(0, 50)}...`);
            console.log('\n✅ Este certificado puede usarse en producción');
          } else {
            console.log('\n❌ Error: No se encontraron token/sign en la respuesta');
          }
        } else {
          console.log('\n❌ Error: No se encontró loginCmsReturn');
          console.log('Respuesta:', data.substring(0, 300));
        }
      } else {
        console.log(`\n❌ Error HTTP ${res.statusCode}`);
        console.log('Respuesta:', data.substring(0, 300));
      }
      
      // Limpiar archivos temporales
      try { fs.unlinkSync(tmpXml); } catch(e) {}
      try { fs.unlinkSync(tmpDer); } catch(e) {}
    });
  });
  
  req.on('error', (err) => {
    console.log('\n❌ Error de conexión:', err.message);
    try { fs.unlinkSync(tmpXml); } catch(e) {}
    try { fs.unlinkSync(tmpDer); } catch(e) {}
  });
  
  req.write(postData);
  req.end();
  
} catch(err) {
  console.log('\n❌ Error al firmar:', err.message);
  try { fs.unlinkSync(tmpXml); } catch(e) {}
  try { fs.unlinkSync(tmpDer); } catch(e) {}
}
