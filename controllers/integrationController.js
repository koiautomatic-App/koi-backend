const Integration = require('../models/Integration');
const { encrypt, decrypt } = require('../utils/encrypt');

const listarIntegraciones = async (req, res) => {
  try {
    const list = await Integration.find({ userId: req.userId })
      .select('-credentials -webhookSecret')
      .lean();
    res.json({ ok: true, integrations: list });
  } catch (error) {
    console.error('listarIntegraciones error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

const conectarIntegracionToken = async (req, res) => {
  try {
    const { platform } = req.params;
    const { storeId, storeName, storeUrl, apiToken, apiKey, apiSecret } = req.body;
    
    if (!storeId) {
      return res.status(400).json({ error: 'storeId requerido' });
    }
    
    const creds = {};
    if (apiToken) creds.apiToken = encrypt(apiToken);
    if (apiKey) creds.apiKey = encrypt(apiKey);
    if (apiSecret) creds.apiSecret = encrypt(apiSecret);
    
    const integration = await Integration.findOneAndUpdate(
      { userId: req.userId, platform, storeId: String(storeId) },
      {
        $set: {
          storeName: storeName || platform + ' ' + storeId,
          storeUrl: storeUrl || '',
          status: 'active',
          errorLog: '',
          credentials: creds,
          updatedAt: new Date()
        },
        $setOnInsert: {
          userId: req.userId,
          platform: platform,
          storeId: String(storeId),
          createdAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
    
    res.json({ ok: true, message: platform + ' conectado correctamente', integration });
  } catch (error) {
    console.error('conectarIntegracionToken error:', error);
    res.status(500).json({ error: 'Error al conectar' });
  }
};

const desconectarIntegracion = async (req, res) => {
  try {
    const doc = await Integration.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'Integración no encontrada' });
    res.json({ ok: true });
  } catch (error) {
    console.error('desconectarIntegracion error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

const toggleIntegracionEstado = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    
    const doc = await Integration.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { status: status },
      { new: true, select: '-credentials -webhookSecret' }
    );
    
    if (!doc) return res.status(404).json({ error: 'Integración no encontrada' });
    res.json({ ok: true, integration: doc });
  } catch (error) {
    console.error('toggleIntegracionEstado error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

const obtenerWebhookUrl = async (req, res) => {
  try {
    const doc = await Integration.findOne({ _id: req.params.id, userId: req.userId })
      .select('platform webhookSecret');
    if (!doc) return res.status(404).json({ error: 'Integración no encontrada' });
    
    const base = process.env.BASE_URL || 'http://localhost:10000';
    res.json({ ok: true, url: base + '/webhook/' + doc.platform + '/' + doc.webhookSecret });
  } catch (error) {
    console.error('obtenerWebhookUrl error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

module.exports = {
  listarIntegraciones,
  conectarIntegracionToken,
  desconectarIntegracion,
  toggleIntegracionEstado,
  obtenerWebhookUrl
};