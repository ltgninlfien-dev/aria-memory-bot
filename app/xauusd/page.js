import TradingBot from '../components/TradingBot';

export default function XauUsdPage() {
  return <TradingBot apiPath="/api/state" symbolLabel="XAU/USD" />;
}
