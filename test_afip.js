const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CERT_PATH = process.env.AFIP_CERT_PATH || '/etc/secrets/koi.crt';
const KEY_PATH = process.env.AFIP_KEY_PATH || '/etc/secrets/koi.key';

console.log('🔍 Test de certificados AFIP');
console.log(`   CERT: ${CERT_PATH} -> existe? ${fs.existsSync(CERT_PATH)}`);
console.log(`   KEY:  ${KEY_PATH}  -> existe? ${fs.existsSync(KEY_PATH)}`);

if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
  // Verificar que el certificado no esté expirado
  try {
    const certInfo = execSync(`openssl x509 -in ${CERT_PATH} -noout -dates`, { encoding: 'utf8' });
    console.log('   📅 Certificado:', certInfo.trim());
  } catch(e) { console.log('   Error leyendo cert:', e.message); }
  
  // Probar firmar un XML simple
  const testXml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>123</uniqueId>
    <generationTime>2024-01-01T00:00:00-03:00</generationTime>
    <expirationTime>2024-01-01T12:00:00-03:00</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;
  
  const tmpXml = path.join(os.tmpdir(), 'test.xml');
  const tmpOut = path.join(os.tmpdir(), 'test.p7s');
  
  fs.writeFileSync(tmpXml, testXml, 'utf8');
  try {
    execSync(
      `openssl cms -sign -in "${tmpXml}" -signer "${CERT_PATH}" -inkey "${KEY_PATH}" -nodetach -outform PEM -out "${tmpOut}"`,
      { stdio: 'pipe' }
    );
    const signed = fs.readFileSync(tmpOut, 'utf8');
    console.log('   ✅ Firma CMS exitosa (longitud:', signed.length, 'bytes)');
  } catch(e) {
    console.log('   ❌ Error firmando:', e.message);
  } finally {
    try { fs.unlinkSync(tmpXml); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}
