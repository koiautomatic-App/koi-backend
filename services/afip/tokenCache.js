const tokenCache = new Map();

const getToken = (cuit) => {
  return tokenCache.get(cuit);
};

const setToken = (cuit, tokenData) => {
  tokenCache.set(cuit, tokenData);
};

const removeToken = (cuit) => {
  tokenCache.delete(cuit);
};

const clearCache = () => {
  tokenCache.clear();
};

module.exports = { getToken, setToken, removeToken, clearCache };
