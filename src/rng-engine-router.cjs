'use strict';

const RNG_ENGINE_ENV = 'NTC_RNG_ENGINE';

function createRngRollRouter({ mode = process.env[RNG_ENGINE_ENV], legacyRollBatch, luck2RollBatch } = {}) {
  const requestedMode = mode == null ? 'legacy' : String(mode).trim().toLowerCase();

  if (requestedMode === '' || requestedMode === 'legacy') {
    if (typeof legacyRollBatch !== 'function') throw new TypeError('O motor RNG legado não foi fornecido.');
    return legacyRollBatch;
  }

  if (requestedMode === 'luck2') {
    if (typeof luck2RollBatch !== 'function') {
      throw new Error('Luck 2.0 foi solicitado, mas ainda não está disponível; nenhum roll será executado.');
    }
    return luck2RollBatch;
  }

  throw new Error(`Motor RNG inválido em ${RNG_ENGINE_ENV}; use "legacy".`);
}

module.exports = { RNG_ENGINE_ENV, createRngRollRouter };
