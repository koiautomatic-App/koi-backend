cat > utils/constants.js << 'EOF'
const ARCA_LIMIT = 380000;
const CUIT_CF = '99999999';

const cleanDoc = (raw) => String(raw || '').replace(/\D/g, '');

const resolveDoc = (doc, amount) => {
  if (doc.length >= 7 && doc.length <= 11) return doc;
  return amount >= ARCA_LIMIT ? null : CUIT_CF;
};

module.exports = {
  ARCA_LIMIT,
  CUIT_CF,
  cleanDoc,
  resolveDoc
};
EOF