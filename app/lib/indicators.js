// app/lib/indicators.js
// Indicateurs techniques purs (EMA, ADX, ATR) — V2.0
// Convention: candles = tableau d'objets { open, high, low, close }, du plus ancien au plus récent

/**
 * Moyenne Mobile Exponentielle
 * @param {Array} candles - bougies triées ancien -> récent
 * @param {number} period
 * @returns {Array} tableau de même longueur, null tant que pas assez de données
 */
export function calculateEMA(candles, period) {
  const closes = candles.map(c => c.close);
  const result = new Array(closes.length).fill(null);

  if (closes.length < period) return result;

  const k = 2 / (period + 1);

  // Amorçage: SMA sur les 'period' premières valeurs
  let sma = 0;
  for (let i = 0; i < period; i++) sma += closes[i];
  sma /= period;
  result[period - 1] = sma;

  // Récursion EMA
  let emaPrev = sma;
  for (let i = period; i < closes.length; i++) {
    const ema = closes[i] * k + emaPrev * (1 - k);
    result[i] = ema;
    emaPrev = ema;
  }

  return result;
}

/**
 * True Range pour une bougie donnée
 */
function trueRange(current, previous) {
  const highLow = current.high - current.low;
  const highClose = Math.abs(current.high - previous.close);
  const lowClose = Math.abs(current.low - previous.close);
  return Math.max(highLow, highClose, lowClose);
}

/**
 * Lissage de Wilder (utilisé par ADX et ATR)
 * Différent d'une simple moyenne mobile: chaque valeur = (valeur_précédente * (period-1) + nouvelle) / period
 */
function wilderSmooth(values, period) {
  const result = new Array(values.length).fill(null);
  if (values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let smoothed = sum / period;
  result[period - 1] = smoothed;

  for (let i = period; i < values.length; i++) {
    smoothed = (smoothed * (period - 1) + values[i]) / period;
    result[i] = smoothed;
  }

  return result;
}

/**
 * Average True Range (Wilder, 14 périodes par défaut)
 * @returns {Array} ATR aligné sur candles, null au début
 */
export function calculateATR(candles, period = 14) {
  const result = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return result;

  const trValues = [];
  for (let i = 1; i < candles.length; i++) {
    trValues.push(trueRange(candles[i], candles[i - 1]));
  }
  // trValues[i] correspond à candles[i+1]

  const smoothed = wilderSmooth(trValues, period);
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] !== null) result[i + 1] = smoothed[i];
  }

  return result;
}

/**
 * Average Directional Index (Wilder, 14 périodes par défaut)
 * @returns {{ adx: Array, plusDI: Array, minusDI: Array }}
 */
export function calculateADX(candles, period = 14) {
  const n = candles.length;
  const adx = new Array(n).fill(null);
  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);

  if (n < period * 2) return { adx, plusDI, minusDI };

  const trValues = [];
  const plusDMValues = [];
  const minusDMValues = [];

  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    const plusDM = (upMove > downMove && upMove > 0) ? upMove : 0;
    const minusDM = (downMove > upMove && downMove > 0) ? downMove : 0;

    plusDMValues.push(plusDM);
    minusDMValues.push(minusDM);
    trValues.push(trueRange(candles[i], candles[i - 1]));
  }
  // index i de ces tableaux correspond à candles[i+1]

  const smoothedTR = wilderSmooth(trValues, period);
  const smoothedPlusDM = wilderSmooth(plusDMValues, period);
  const smoothedMinusDM = wilderSmooth(minusDMValues, period);

  const dxValues = new Array(trValues.length).fill(null);

  for (let i = 0; i < trValues.length; i++) {
    if (smoothedTR[i] === null || smoothedTR[i] === 0) continue;

    const pDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
    const mDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100;

    plusDI[i + 1] = pDI;
    minusDI[i + 1] = mDI;

    const diSum = pDI + mDI;
    if (diSum > 0) {
      dxValues[i] = (Math.abs(pDI - mDI) / diSum) * 100;
    }
  }

  // ADX = lissage de Wilder appliqué au DX (en ignorant les null en tête)
  const firstValidDX = dxValues.findIndex(v => v !== null);
  if (firstValidDX === -1) return { adx, plusDI, minusDI };

  const dxClean = dxValues.slice(firstValidDX).map(v => v ?? 0);
  const smoothedADX = wilderSmooth(dxClean, period);

  for (let i = 0; i < smoothedADX.length; i++) {
    if (smoothedADX[i] !== null) {
      const targetIndex = firstValidDX + i + 1; // +1 car dxValues[i] -> candles[i+1]
      adx[targetIndex] = smoothedADX[i];
    }
  }

  return { adx, plusDI, minusDI };
}
