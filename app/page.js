import TradingBot from '../components/TradingBot';

export default function EurUsdPage() {
  return <TradingBot apiPath="/api/state-eurusd" symbolLabel="EUR/USD" />;
}
